/** PositionManager handlers: Transfer, Subscription, Unsubscription, ModifyLiquidity. */
import { indexer } from "envio";
import type { V4_Position as Position } from "envio";

import { ZERO_BD, bdPlus, bdMinus } from "../utils/bigDecimal";
import {
  ADDRESS_ZERO,
  BYTES32_ZERO,
  POSM_CACHE_MAX_BLOCK_AGE,
  POSM_MATCH_AMBIGUOUS,
  POSM_MATCH_NOT_FOUND,
  ZERO_BI,
} from "../utils/constants";
import { getPositionInfo } from "../utils/contractReads";
import { loadTransaction } from "../utils/entities";
import { entityId, eventId, positionId, stripChainPrefix, toLowerHex } from "../utils/id";

indexer.onEvent({ contract: "PositionManager", event: "Transfer" }, async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = positionId(event.params.id);
  const prefixedPositionId = entityId(chainId, tokenId);

  const existing = await context.V4_Position.get(prefixedPositionId);

  let position: Position;
  if (existing === undefined) {
    const info = await context.effect(getPositionInfo, {
      chainId,
      positionManager: toLowerHex(event.srcAddress),
      tokenId: event.params.id,
      blockNumber: event.block.number,
    });

    position = {
      id: prefixedPositionId,
      tokenId: event.params.id,
      owner: "", // overwritten unconditionally below
      origin: toLowerHex(event.transaction.from ?? ADDRESS_ZERO),
      token0Balance: ZERO_BD,
      token1Balance: ZERO_BD,
      depositedToken0: ZERO_BD,
      depositedToken1: ZERO_BD,
      withdrawnToken0: ZERO_BD,
      withdrawnToken1: ZERO_BD,
      createdAtBlock: BigInt(event.block.number),
      createdAtTimestamp: BigInt(event.block.timestamp),
      pool_id: entityId(chainId, info.reverted ? BYTES32_ZERO : info.poolId),
      tickLower: info.tickLower,
      tickUpper: info.tickUpper,
      liquidity: ZERO_BI,
    };
  } else {
    position = existing;
  }

  position = { ...position, owner: toLowerHex(event.params.to) };

  const transaction = loadTransaction(context, event);

  context.V4_Position.set(position);
  context.V4_Transfer.set({
    id: entityId(chainId, eventId(event.transaction.hash, event.logIndex)),
    tokenId: event.params.id,
    from: toLowerHex(event.params.from),
    to: toLowerHex(event.params.to),
    origin: toLowerHex(event.transaction.from ?? ADDRESS_ZERO),
    transaction_id: transaction.id,
    logIndex: BigInt(event.logIndex),
    timestamp: transaction.timestamp,
    position_id: position.id,
  });
});

indexer.onEvent(
  { contract: "PositionManager", event: "Subscription" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const transaction = loadTransaction(context, event);
    context.V4_Subscribe.set({
      id: entityId(chainId, eventId(event.transaction.hash, event.logIndex)),
      tokenId: event.params.tokenId,
      address: toLowerHex(event.params.subscriber),
      origin: toLowerHex(event.transaction.from ?? ADDRESS_ZERO),
      transaction_id: transaction.id,
      logIndex: BigInt(event.logIndex),
      timestamp: transaction.timestamp,
      position_id: entityId(chainId, positionId(event.params.tokenId)),
    });
  },
);

indexer.onEvent(
  { contract: "PositionManager", event: "Unsubscription" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const transaction = loadTransaction(context, event);
    context.V4_Unsubscribe.set({
      id: entityId(chainId, eventId(event.transaction.hash, event.logIndex)),
      tokenId: event.params.tokenId,
      address: toLowerHex(event.params.subscriber),
      origin: toLowerHex(event.transaction.from ?? ADDRESS_ZERO),
      transaction_id: transaction.id,
      logIndex: BigInt(event.logIndex),
      timestamp: transaction.timestamp,
      position_id: entityId(chainId, positionId(event.params.tokenId)),
    });
  },
);

interface PosmMatchCandidate {
  id: string;
  transactionHash: string;
  sender: string;
  pool: string;
  tickLower: bigint;
  tickUpper: bigint;
  transactionLogIndex: bigint;
  salt: string;
}

export function tokenIdToSaltHex(tokenId: bigint): string {
  return `0x${tokenId.toString(16).padStart(64, "0")}`;
}

export function selectPosmModifyLiquidityCandidate(
  candidates: PosmMatchCandidate[],
  posmTransactionHash: string,
  poolId: string,
  tickLower: bigint,
  tickUpper: bigint,
  posmSalt: string,
  posmTransactionLogIndex: bigint,
  positionManagerAddress: string,
): number {
  let found = false;
  let ambiguous = false;
  let selectedIndex: number = POSM_MATCH_NOT_FOUND;
  let nearestDistance = ZERO_BI;
  const positionManagerAddressLower = positionManagerAddress.toLowerCase();
  const posmSaltHex = posmSalt.toLowerCase();

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    if (candidate.transactionHash !== posmTransactionHash) continue;
    if (candidate.sender.toLowerCase() !== positionManagerAddressLower) continue;
    if (candidate.pool !== poolId) continue;
    if (candidate.tickLower !== tickLower || candidate.tickUpper !== tickUpper) continue;
    if (!(candidate.transactionLogIndex <= posmTransactionLogIndex)) continue;
    if (candidate.salt.toLowerCase() !== posmSaltHex) continue;

    const logDistance = posmTransactionLogIndex - candidate.transactionLogIndex;
    if (!found || logDistance < nearestDistance) {
      found = true;
      ambiguous = false;
      selectedIndex = i;
      nearestDistance = logDistance;
      continue;
    }
    if (logDistance === nearestDistance) {
      ambiguous = true;
    }
  }

  if (!found) return POSM_MATCH_NOT_FOUND;
  if (ambiguous) return POSM_MATCH_AMBIGUOUS;
  return selectedIndex;
}

indexer.onEvent(
  { contract: "PositionManager", event: "ModifyLiquidity" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const prefixedPositionId = entityId(chainId, positionId(event.params.tokenId));

    const position = await context.V4_Position.get(prefixedPositionId);
    if (position === undefined) {
      context.log.debug(
        `handleModifyLiquidityPosm: position not found for tokenId ${event.params.tokenId}`,
      );
      return;
    }

    const cacheId = entityId(chainId, "1");
    const modifyLiquidityCache = await context.V4_ModifyLiquidityCache.get(cacheId);
    if (modifyLiquidityCache === undefined) {
      context.log.debug("handleModifyLiquidityPosm: modifyLiquidity cache not found");
      return;
    }

    const currentBlock = BigInt(event.block.number);
    const retainedModifyLiquidityIds: string[] = [];
    for (const id of modifyLiquidityCache.modifyLiquidities) {
      const ml = await context.V4_ModifyLiquidity.get(id);
      if (ml === undefined) continue;
      const tx = await context.V4_Transaction.get(ml.transaction_id);
      if (tx === undefined) continue;
      if (currentBlock - tx.blockNumber > POSM_CACHE_MAX_BLOCK_AGE) continue;
      retainedModifyLiquidityIds.push(id);
    }

    if (retainedModifyLiquidityIds.length === 0) {
      context.V4_ModifyLiquidityCache.set({
        ...modifyLiquidityCache,
        modifyLiquidities: retainedModifyLiquidityIds,
      });
      context.log.debug("handleModifyLiquidityPosm: no cached modifyLiquidity entities found");
      return;
    }

    const candidates: PosmMatchCandidate[] = [];
    const retainedIndexes: number[] = [];

    for (let i = 0; i < retainedModifyLiquidityIds.length; i++) {
      const id = retainedModifyLiquidityIds[i]!;
      const ml = await context.V4_ModifyLiquidity.get(id);
      if (ml === undefined || ml.transactionLogIndex === undefined || ml.sender === undefined) {
        continue;
      }
      const tx = await context.V4_Transaction.get(ml.transaction_id);
      if (tx === undefined) continue;

      candidates.push({
        id,
        transactionHash: stripChainPrefix(tx.id),
        sender: ml.sender,
        pool: ml.pool_id,
        tickLower: ml.tickLower,
        tickUpper: ml.tickUpper,
        transactionLogIndex: ml.transactionLogIndex,
        salt: ml.salt,
      });
      retainedIndexes.push(i);
    }

    const selectedCandidateIndex = selectPosmModifyLiquidityCandidate(
      candidates,
      toLowerHex(event.transaction.hash),
      position.pool_id,
      position.tickLower,
      position.tickUpper,
      tokenIdToSaltHex(event.params.tokenId),
      BigInt(event.logIndex),
      toLowerHex(event.srcAddress),
    );

    if (selectedCandidateIndex === POSM_MATCH_AMBIGUOUS) {
      context.V4_ModifyLiquidityCache.set({
        ...modifyLiquidityCache,
        modifyLiquidities: retainedModifyLiquidityIds,
      });
      context.log.debug(
        `handleModifyLiquidityPosm: ambiguous candidate match for tokenId ${event.params.tokenId}`,
      );
      return;
    }

    if (selectedCandidateIndex === POSM_MATCH_NOT_FOUND) {
      context.V4_ModifyLiquidityCache.set({
        ...modifyLiquidityCache,
        modifyLiquidities: retainedModifyLiquidityIds,
      });
      context.log.debug(
        `handleModifyLiquidityPosm: no valid cached modifyLiquidity entity found, array length ${retainedModifyLiquidityIds.length}`,
      );
      return;
    }

    const targetIndexInCache = retainedIndexes[selectedCandidateIndex]!;
    const targetModifyLiquidity = await context.V4_ModifyLiquidity.get(
      retainedModifyLiquidityIds[targetIndexInCache]!,
    );
    if (targetModifyLiquidity === undefined) {
      context.V4_ModifyLiquidityCache.set({
        ...modifyLiquidityCache,
        modifyLiquidities: retainedModifyLiquidityIds,
      });
      context.log.debug(
        "handleModifyLiquidityPosm: selected cached modifyLiquidity was pruned before load",
      );
      return;
    }

    let liquidity = position.liquidity + event.params.liquidityChange;
    if (liquidity < ZERO_BI) {
      context.log.warn(
        `handleModifyLiquidityPosm: clamping negative liquidity for position ${position.id} to zero`,
      );
      liquidity = ZERO_BI;
    }

    let depositedToken0 = position.depositedToken0 ?? ZERO_BD;
    let depositedToken1 = position.depositedToken1 ?? ZERO_BD;
    let withdrawnToken0 = position.withdrawnToken0 ?? ZERO_BD;
    let withdrawnToken1 = position.withdrawnToken1 ?? ZERO_BD;

    const amount0 = targetModifyLiquidity.amount0;
    const amount1 = targetModifyLiquidity.amount1;

    if (amount0.isGreaterThan(ZERO_BD)) {
      depositedToken0 = bdPlus(depositedToken0, amount0);
    } else if (amount0.isLessThan(ZERO_BD)) {
      withdrawnToken0 = bdPlus(withdrawnToken0, bdMinus(ZERO_BD, amount0));
    }

    if (amount1.isGreaterThan(ZERO_BD)) {
      depositedToken1 = bdPlus(depositedToken1, amount1);
    } else if (amount1.isLessThan(ZERO_BD)) {
      withdrawnToken1 = bdPlus(withdrawnToken1, bdMinus(ZERO_BD, amount1));
    }

    context.V4_Position.set({
      ...position,
      liquidity,
      depositedToken0,
      depositedToken1,
      withdrawnToken0,
      withdrawnToken1,
      token0Balance: bdPlus(position.token0Balance, amount0),
      token1Balance: bdPlus(position.token1Balance, amount1),
    });

    const remaining = [...retainedModifyLiquidityIds];
    remaining.splice(targetIndexInCache, 1);
    context.V4_ModifyLiquidityCache.set({
      ...modifyLiquidityCache,
      modifyLiquidities: remaining,
    });
  },
);
