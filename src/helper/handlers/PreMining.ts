/** PreMining handlers. Bound on Zircuit 48900 only. */
import { indexer } from "envio";
import type {
  Helper_PreMining as PreMining,
  Helper_PreMiningDeposit as PreMiningDeposit,
  Helper_PreMiningDepositTokenBalance as PreMiningDepositTokenBalance,
  Helper_PreMiningLiquidityPosition as PreMiningLiquidityPosition,
  Helper_PreMiningLiquidityPositionSnapshot as PreMiningLiquidityPositionSnapshot,
  Helper_PreMiningWithdraw as PreMiningWithdraw,
  Helper_Token as Token,
  EvmOnEventContext,
} from "envio";
import { getPairReserves, getPairTokens, getPreMiningPoolAddress, getTokenMetadata } from "../effects.js";
import { cid } from "../config/chains.js";
import {
  BI_18,
  ONE_BI,
  ZERO_BD,
  ZERO_BI,
  bdDiv,
  bdMinus,
  bdPlus,
  bdTimes,
  concatI32,
  convertTokenToDecimal,
  norm,
} from "../helpers.js";

type HandlerContext = EvmOnEventContext;

function unprefix(id: string): string {
  return id.replace(/^\d+-/, "");
}

function poolKey(preminingAddress: string, pid: bigint): string {
  return `${preminingAddress}-${pid}`;
}

async function createPreMiningUser(
  context: HandlerContext,
  chainId: number,
  address: string,
): Promise<void> {
  const id = cid(chainId, address);
  const existing = await context.Helper_PreMiningUser.get(id);
  if (existing === undefined) {
    context.Helper_PreMiningUser.set({ id });
  }
}

async function createPreMiningLiquidityPosition(
  context: HandlerContext,
  chainId: number,
  preminingAddress: string,
  user: string,
  pid: bigint,
): Promise<PreMiningLiquidityPosition> {
  const id = cid(chainId, `${preminingAddress}-${pid}-${user}`);
  const existing = await context.Helper_PreMiningLiquidityPosition.get(id);
  if (existing !== undefined) return existing;

  const preminingId = cid(chainId, poolKey(preminingAddress, pid));
  const position: PreMiningLiquidityPosition = {
    id,
    premining_id: preminingId,
    user_id: cid(chainId, user),
    amount: ZERO_BI,
    userShare: ZERO_BD,
    userToken0: ZERO_BI,
    userToken1: ZERO_BI,
    userToken0Decimals: ZERO_BD,
    userToken1Decimals: ZERO_BD,
    reserve0: ZERO_BI,
    reserve1: ZERO_BI,
    liquidityTokenTotalSupply: ZERO_BI,
  };

  const premining = await context.Helper_PreMining.get(preminingId);
  if (premining === undefined) {
    context.log.error(`PreMining entity not found for pool ${unprefix(preminingId)}`);
    context.Helper_PreMiningLiquidityPosition.set(position);
    return position;
  }

  context.Helper_PreMining.set({
    ...premining,
    liquidityProviderCount: premining.liquidityProviderCount + ONE_BI,
  });
  context.Helper_PreMiningLiquidityPosition.set(position);
  return position;
}

async function createPreMiningDepositTokenBalance(
  context: HandlerContext,
  chainId: number,
  tokenId: string,
  userId: string,
): Promise<PreMiningDepositTokenBalance> {
  const id = cid(chainId, `${unprefix(tokenId)}-${unprefix(userId)}`);
  const existing = await context.Helper_PreMiningDepositTokenBalance.get(id);
  if (existing !== undefined) return existing;

  await context.Helper_Token.getOrThrow(
    tokenId,
    `Token ${tokenId} missing while creating a PreMiningDepositTokenBalance`,
  );
  const balance: PreMiningDepositTokenBalance = {
    id,
    token_id: tokenId,
    user_id: userId,
    amount: ZERO_BI,
    amountDecimals: ZERO_BD,
  };
  context.Helper_PreMiningDepositTokenBalance.set(balance);
  return balance;
}

async function createPreMiningLiquiditySnapshot(
  context: HandlerContext,
  chainId: number,
  position: PreMiningLiquidityPosition,
  blockNumber: number,
  blockTimestamp: number,
): Promise<void> {
  const premining = await context.Helper_PreMining.get(position.premining_id);
  if (premining === undefined) {
    context.log.error(`PreMining not found for position ${unprefix(position.id)}`);
    return;
  }

  const token0 = await context.Helper_Token.get(premining.token0_id);
  const token1 = await context.Helper_Token.get(premining.token1_id);
  if (token0 === undefined || token1 === undefined) {
    context.log.error(`Tokens not found for premining ${unprefix(premining.id)}`);
    return;
  }

  const snapshotId = `${position.id}${blockTimestamp}`;

  const reserves = await context.effect(getPairReserves, {
    chainId,
    pool: premining.pool,
    blockNumber,
  });

  const totalSupplyBD = convertTokenToDecimal(reserves.liquidityTokenTotalSupply, BI_18);
  if (totalSupplyBD.isZero()) {
    context.log.error(`Total supply is zero for premining ${unprefix(premining.id)}`);
    return;
  }

  const userAmount = convertTokenToDecimal(position.amount, BI_18);
  const userShare = bdDiv(userAmount, totalSupplyBD);

  const newSnapshotBalance0 =
    (reserves.reserve0 * position.amount) / reserves.liquidityTokenTotalSupply;
  const diff0 = newSnapshotBalance0 - position.userToken0;
  const newSnapshotBalance1 =
    (reserves.reserve1 * position.amount) / reserves.liquidityTokenTotalSupply;
  const diff1 = newSnapshotBalance1 - position.userToken1;

  const newSnapshotDecimalBalance0 = bdTimes(
    convertTokenToDecimal(reserves.reserve0, token0.decimals),
    userShare,
  );
  const diffDecimals0 = bdMinus(newSnapshotDecimalBalance0, position.userToken0Decimals);
  const newSnapshotDecimalBalance1 = bdTimes(
    convertTokenToDecimal(reserves.reserve1, token1.decimals),
    userShare,
  );
  const diffDecimals1 = bdMinus(newSnapshotDecimalBalance1, position.userToken1Decimals);

  const snapshot: PreMiningLiquidityPositionSnapshot = {
    id: snapshotId,
    liquidityPosition_id: position.id,
    premining_id: position.premining_id,
    user_id: position.user_id,
    amount: position.amount,
    userShare: norm(userShare),
    userToken0: newSnapshotBalance0,
    userToken1: newSnapshotBalance1,
    userToken0Decimals: norm(newSnapshotDecimalBalance0),
    userToken1Decimals: norm(newSnapshotDecimalBalance1),
    reserve0: reserves.reserve0,
    reserve1: reserves.reserve1,
    liquidityTokenTotalSupply: reserves.liquidityTokenTotalSupply,
    blockNumber: BigInt(blockNumber),
    blockTimestamp: BigInt(blockTimestamp),
  };

  const depositToken0Balance = await createPreMiningDepositTokenBalance(
    context,
    chainId,
    premining.token0_id,
    position.user_id,
  );
  const depositToken1Balance = await createPreMiningDepositTokenBalance(
    context,
    chainId,
    premining.token1_id,
    position.user_id,
  );

  context.Helper_PreMiningDepositTokenBalance.set({
    ...depositToken0Balance,
    amount: depositToken0Balance.amount + diff0,
    amountDecimals: norm(bdPlus(depositToken0Balance.amountDecimals, diffDecimals0)),
  });
  context.Helper_PreMiningDepositTokenBalance.set({
    ...depositToken1Balance,
    amount: depositToken1Balance.amount + diff1,
    amountDecimals: norm(bdPlus(depositToken1Balance.amountDecimals, diffDecimals1)),
  });
  context.Helper_PreMiningLiquidityPositionSnapshot.set(snapshot);
  context.Helper_PreMiningLiquidityPosition.set({
    ...position,
    userShare: norm(userShare),
    reserve0: reserves.reserve0,
    reserve1: reserves.reserve1,
    liquidityTokenTotalSupply: reserves.liquidityTokenTotalSupply,
    userToken0: newSnapshotBalance0,
    userToken1: newSnapshotBalance1,
    userToken0Decimals: norm(newSnapshotDecimalBalance0),
    userToken1Decimals: norm(newSnapshotDecimalBalance1),
  });
}

indexer.onEvent(
  { contract: "PreMining", event: "LogPoolAddition" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const preminingId = cid(chainId, poolKey(event.srcAddress, event.params.pid));
    if ((await context.Helper_PreMining.get(preminingId)) !== undefined) return;

    const { token0: token0Address, token1: token1Address } = await context.effect(
      getPairTokens,
      { chainId, pool: event.params.stakeToken, blockNumber: event.block.number },
    );
    const token0Id = cid(chainId, token0Address);
    const token1Id = cid(chainId, token1Address);

    for (const [id, address] of [
      [token0Id, token0Address],
      [token1Id, token1Address],
    ] as const) {
      if ((await context.Helper_Token.get(id)) !== undefined) continue;
      const meta = await context.effect(getTokenMetadata, {
        chainId,
        token: address,
        blockNumber: event.block.number,
      });
      const token: Token = {
        id,
        symbol: meta.symbol,
        name: meta.name,
        decimals: meta.decimals,
        totalSupply: meta.totalSupply,
      };
      context.Helper_Token.set(token);
    }

    const premining: PreMining = {
      id: preminingId,
      premining: event.srcAddress,
      pool: event.params.stakeToken,
      pid: event.params.pid,
      token0_id: token0Id,
      token1_id: token1Id,
      liquidityProviderCount: ZERO_BI,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    };
    context.Helper_PreMining.set(premining);
  },
);

async function handleStakeChange(
  context: HandlerContext,
  chainId: number,
  preminingAddress: string,
  pid: bigint,
  user: string,
  amount: bigint,
  sign: 1n | -1n,
  createUser: boolean,
  transactionHash: string,
  logIndex: number,
  blockNumber: number,
  blockTimestamp: number,
): Promise<void> {
  const preminingId = cid(chainId, poolKey(preminingAddress, pid));
  const premining = await context.Helper_PreMining.get(preminingId);
  if (premining === undefined) {
    context.log.error(`PreMining entity not found for pool ${poolKey(preminingAddress, pid)}`);
    return;
  }

  const { pool } = await context.effect(getPreMiningPoolAddress, {
    chainId,
    premining: preminingAddress,
    pid,
    blockNumber,
  });

  const id = cid(chainId, concatI32(transactionHash, logIndex));
  const common = {
    id,
    premining_id: premining.id,
    pool,
    pid,
    user,
    amount,
    blockNumber: BigInt(blockNumber),
    blockTimestamp: BigInt(blockTimestamp),
    transactionHash,
  };
  if (sign === 1n) {
    context.Helper_PreMiningDeposit.set(common as PreMiningDeposit);
  } else {
    context.Helper_PreMiningWithdraw.set(common as PreMiningWithdraw);
  }

  if (createUser) {
    await createPreMiningUser(context, chainId, user);
  }

  const position = await createPreMiningLiquidityPosition(
    context,
    chainId,
    preminingAddress,
    user,
    pid,
  );
  const updated: PreMiningLiquidityPosition = {
    ...position,
    amount: position.amount + sign * amount,
  };
  context.Helper_PreMiningLiquidityPosition.set(updated);
  await createPreMiningLiquiditySnapshot(
    context,
    chainId,
    updated,
    blockNumber,
    blockTimestamp,
  );
}

indexer.onEvent(
  { contract: "PreMining", event: "Deposit" },
  async ({ event, context }) => {
    await handleStakeChange(
      context,
      event.chainId,
      event.srcAddress,
      event.params.pid,
      event.params.user,
      event.params.amount,
      1n,
      true,
      event.transaction.hash,
      event.logIndex,
      event.block.number,
      event.block.timestamp,
    );
  },
);

indexer.onEvent(
  { contract: "PreMining", event: "Withdraw" },
  async ({ event, context }) => {
    await handleStakeChange(
      context,
      event.chainId,
      event.srcAddress,
      event.params.pid,
      event.params.user,
      event.params.amount,
      -1n,
      false,
      event.transaction.hash,
      event.logIndex,
      event.block.number,
      event.block.timestamp,
    );
  },
);

indexer.onEvent(
  { contract: "PreMining", event: "EmergencyWithdraw" },
  async ({ event, context }) => {
    await handleStakeChange(
      context,
      event.chainId,
      event.srcAddress,
      event.params.pid,
      event.params.user,
      event.params.amount,
      -1n,
      false,
      event.transaction.hash,
      event.logIndex,
      event.block.number,
      event.block.timestamp,
    );
  },
);
