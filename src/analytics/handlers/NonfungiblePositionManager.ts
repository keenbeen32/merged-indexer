/** Analytics position manager handlers. */
import { indexer } from "envio";
import type { Analytics_Mint as Mint, Analytics_Position as Position, Analytics_PositionSnapshot as PositionSnapshot, Analytics_PositionTransferCache as PositionTransferCache } from "envio";
import { cid, singletonId } from "../config/chain.js";
import { ZERO_BI } from "../utils/constants.js";
import { ZERO_BD, convertTokenToDecimal, minus, plus } from "../utils/bigdecimal.js";
import { loadTransaction } from "../utils/transaction.js";

function positionId(chainId: number, tokenId: bigint): string {
  return cid(chainId, tokenId.toString());
}

async function getPosition(
  chainId: number,
  tokenId: bigint,
  context: { Analytics_Position: { get: (id: string) => Promise<Position | undefined> } },
): Promise<Position | undefined> {
  return context.Analytics_Position.get(positionId(chainId, tokenId));
}

async function createPositionIfNeccessary(
  event: {
    chainId: number;
    block: { number: number; timestamp: number | bigint };
    transaction: { hash: string; from?: string; gasPrice?: bigint; gas?: bigint; transactionIndex?: number };
    logIndex: number;
  },
  tokenId: bigint,
  poolAddress: string,
  context: any,
): Promise<Position> {
  const chainId = event.chainId;
  let position = await context.Analytics_Position.get(
    positionId(chainId, tokenId),
  );
  if (!position) {
    const transferCache = (await context.Analytics_PositionTransferCache.get(
      singletonId(chainId),
    )) as PositionTransferCache;

    const pool = await context.Analytics_Pool.getOrThrow(
      cid(chainId, poolAddress),
    );
    const transaction = await loadTransaction(event, context);
    const mintKey = `${transaction.id}#${pool.lastMintIndex.toString()}`;
    const mint = (await context.Analytics_Mint.get(mintKey)) as Mint | undefined;
    if (!mint) {
      throw new Error(
        `createPositionIfNeccessary: Mint not found at key ${mintKey} ` +
          `(tokenId=${tokenId}, pool=${poolAddress}, lastMintIndex=${pool.lastMintIndex}). ` +
          `Upstream uses pool.txCount as lastMintIndex vs Mint.id logIndex — see §6.3.`,
      );
    }

    position = {
      id: positionId(chainId, tokenId),
      owner: transferCache.owner,
      pool_id: cid(chainId, poolAddress),
      token0_id: pool.token0_id,
      token1_id: pool.token1_id,
      tickLower_id: cid(chainId, `${poolAddress}#${mint.tickLower.toString()}`),
      tickUpper_id: cid(chainId, `${poolAddress}#${mint.tickUpper.toString()}`),
      liquidity: ZERO_BI,
      depositedToken0: ZERO_BD,
      depositedToken1: ZERO_BD,
      withdrawnToken0: ZERO_BD,
      withdrawnToken1: ZERO_BD,
      collectedToken0: ZERO_BD,
      collectedToken1: ZERO_BD,
      collectedFeesToken0: ZERO_BD,
      collectedFeesToken1: ZERO_BD,
      transaction_id: transaction.id,
    };
  }
  return position;
}

async function savePositionSnapshot(
  position: Position,
  event: {
    chainId: number;
    block: { number: number; timestamp: number | bigint };
    transaction: { hash: string; from?: string; gasPrice?: bigint; gas?: bigint; transactionIndex?: number };
  },
  context: any,
): Promise<void> {
  const transaction = await loadTransaction(event, context);
  const snapshot: PositionSnapshot = {
    id: `${position.id}#${event.block.number.toString()}`,
    owner: position.owner,
    pool_id: position.pool_id,
    position_id: position.id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    liquidity: position.liquidity,
    depositedToken0: position.depositedToken0,
    depositedToken1: position.depositedToken1,
    withdrawnToken0: position.withdrawnToken0,
    withdrawnToken1: position.withdrawnToken1,
    collectedFeesToken0: position.collectedFeesToken0,
    collectedFeesToken1: position.collectedFeesToken1,
    transaction_id: transaction.id,
  };
  context.Analytics_PositionSnapshot.set(snapshot);
}

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "IncreaseLiquidity" },
  async ({ event, context }) => {
    let position = await createPositionIfNeccessary(
      event,
      event.params.tokenId,
      event.params.pool,
      context,
    );

    const [token0, token1] = await Promise.all([
      context.Analytics_Token.getOrThrow(position.token0_id),
      context.Analytics_Token.getOrThrow(position.token1_id),
    ]);

    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    position = {
      ...position,
      liquidity: position.liquidity + event.params.actualLiquidity,
      depositedToken0: plus(position.depositedToken0, amount0),
      depositedToken1: plus(position.depositedToken1, amount1),
    };
    context.Analytics_Position.set(position);
    await savePositionSnapshot(position, event, context);
  },
);

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "DecreaseLiquidity" },
  async ({ event, context }) => {
    let position = await getPosition(event.chainId, event.params.tokenId, context);
    if (!position) return;

    const [token0, token1] = await Promise.all([
      context.Analytics_Token.getOrThrow(position.token0_id),
      context.Analytics_Token.getOrThrow(position.token1_id),
    ]);

    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    position = {
      ...position,
      liquidity: position.liquidity - event.params.liquidity,
      withdrawnToken0: plus(position.withdrawnToken0, amount0),
      withdrawnToken1: plus(position.withdrawnToken1, amount1),
    };
    context.Analytics_Position.set(position);
    await savePositionSnapshot(position, event, context);
  },
);

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "Collect" },
  async ({ event, context }) => {
    let position = await getPosition(event.chainId, event.params.tokenId, context);
    if (!position) return;

    const [token0, token1] = await Promise.all([
      context.Analytics_Token.getOrThrow(position.token0_id),
      context.Analytics_Token.getOrThrow(position.token1_id),
    ]);

    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    position = {
      ...position,
      collectedToken0: plus(position.collectedToken0, amount0),
      collectedToken1: plus(position.collectedToken1, amount1),
    };
    position = {
      ...position,
      collectedFeesToken0: minus(
        position.collectedToken0,
        position.withdrawnToken0,
      ),
      collectedFeesToken1: minus(
        position.collectedToken1,
        position.withdrawnToken1,
      ),
    };
    context.Analytics_Position.set(position);
    await savePositionSnapshot(position, event, context);
  },
);

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "Transfer" },
  async ({ event, context }) => {
    let position = await getPosition(event.chainId, event.params.tokenId, context);

    const transferCache = (await context.Analytics_PositionTransferCache.get(
      singletonId(event.chainId),
    )) as PositionTransferCache;
    context.Analytics_PositionTransferCache.set({
      ...transferCache,
      owner: event.params.to,
    });

    if (!position) return;

    position = { ...position, owner: event.params.to };
    context.Analytics_Position.set(position);
    await savePositionSnapshot(position, event, context);
  },
);
