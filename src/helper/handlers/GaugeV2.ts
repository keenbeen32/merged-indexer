/** Gauge deposit, withdraw and harvest handlers. */
import { indexer } from "envio";
import type {
  Helper_DepositTokenBalance as DepositTokenBalance,
  Helper_Gauge as Gauge,
  Helper_GaugeDeposit as GaugeDeposit,
  Helper_GaugeWithdraw as GaugeWithdraw,
  Helper_Harvest as Harvest,
  Helper_LiquidityPosition as LiquidityPosition,
  Helper_LiquidityPositionSnapshot as LiquidityPositionSnapshot,
  EvmOnEventContext,
} from "envio";
import { getHarvestRewardToken, getPairReserves } from "../effects.js";
import { cid, features } from "../config/chains.js";
import {
  BI_18,
  ONE_BI,
  ZERO_ADDRESS,
  ZERO_BD,
  ZERO_BI,
  bdDiv,
  bdMinus,
  bdPlus,
  bdTimes,
  concatI32,
  convertTokenToDecimal,
  norm,
  toBigDecimal,
} from "../helpers.js";

type HandlerContext = EvmOnEventContext;

type Reserves = {
  reserve0: bigint;
  reserve1: bigint;
  liquidityTokenTotalSupply: bigint;
};

export async function createUser(
  context: HandlerContext,
  chainId: number,
  address: string,
): Promise<void> {
  const id = cid(chainId, address);
  const user = await context.Helper_User.get(id);
  if (user !== undefined) return;

  if (features(chainId).vePoints) {
    context.Helper_User.set({
      id,
      shareSecondsTotal: ZERO_BD,
      amountSecondsTotal: ZERO_BD,
      pointsUpdatedAt: ZERO_BI,
    });
  } else {
    context.Helper_User.set({
      id,
      shareSecondsTotal: undefined,
      amountSecondsTotal: undefined,
      pointsUpdatedAt: undefined,
    });
  }
}

export async function createLiquidityPosition(
  context: HandlerContext,
  chainId: number,
  gaugeAddress: string,
  user: string,
): Promise<LiquidityPosition> {
  const id = cid(chainId, `${gaugeAddress}-${user}`);
  const existing = await context.Helper_LiquidityPosition.get(id);
  if (existing !== undefined) {
    return existing;
  }

  const gaugeId = cid(chainId, gaugeAddress);
  const gauge = await context.Helper_Gauge.getOrThrow(
    gaugeId,
    `Gauge ${gaugeId} missing while creating a LiquidityPosition`,
  );
  context.Helper_Gauge.set({
    ...gauge,
    liquidityProviderCount: gauge.liquidityProviderCount + ONE_BI,
  });

  const vePoints = features(chainId).vePoints;
  const position: LiquidityPosition = {
    id,
    gauge_id: gaugeId,
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
    shareSecondsTotal: vePoints ? ZERO_BD : undefined,
    amountSecondsTotal: vePoints ? ZERO_BD : undefined,
    lastAccruedAt: vePoints ? ZERO_BI : undefined,
  };
  context.Helper_LiquidityPosition.set(position);
  return position;
}

async function createDepositTokenBalance(
  context: HandlerContext,
  chainId: number,
  tokenId: string,
  userId: string,
): Promise<DepositTokenBalance> {
  const id = cid(chainId, `${unprefix(tokenId)}-${unprefix(userId)}`);
  const existing = await context.Helper_DepositTokenBalance.get(id);
  if (existing !== undefined) {
    return existing;
  }
  await context.Helper_Token.getOrThrow(
    tokenId,
    `Token ${tokenId} missing while creating a DepositTokenBalance`,
  );
  const balance: DepositTokenBalance = {
    id,
    token_id: tokenId,
    user_id: userId,
    amount: ZERO_BI,
    amountDecimals: ZERO_BD,
  };
  context.Helper_DepositTokenBalance.set(balance);
  return balance;
}

function unprefix(id: string): string {
  return id.replace(/^\d+-/, "");
}

async function fetchPairReserves(
  context: HandlerContext,
  chainId: number,
  gaugeId: string,
  pool: string,
  blockNumber: number,
  blockTimestamp: number,
): Promise<Reserves> {
  if (features(chainId).vePoints) {
    const coreSnapshotId = `${cid(chainId, `${unprefix(gaugeId)}-${ZERO_ADDRESS}`)}${blockTimestamp}`;
    const core = await context.Helper_LiquidityPositionSnapshot.get(coreSnapshotId);
    if (core !== undefined) {
      return {
        reserve0: core.reserve0,
        reserve1: core.reserve1,
        liquidityTokenTotalSupply: core.liquidityTokenTotalSupply,
      };
    }
  }

  return await context.effect(getPairReserves, { chainId, pool, blockNumber });
}

export async function createLiquiditySnapshot(
  context: HandlerContext,
  chainId: number,
  position: LiquidityPosition,
  blockNumber: number,
  blockTimestamp: number,
): Promise<void> {
  const { vePoints, divideByZero } = features(chainId);

  const gauge = await context.Helper_Gauge.getOrThrow(
    position.gauge_id,
    `Gauge ${position.gauge_id} missing while snapshotting ${position.id}`,
  );
  const token0 = await context.Helper_Token.getOrThrow(gauge.token0_id);
  const token1 = await context.Helper_Token.getOrThrow(gauge.token1_id);

  const snapshotId = `${position.id}${blockTimestamp}`;

  const reserves = await fetchPairReserves(
    context,
    chainId,
    position.gauge_id,
    gauge.pool,
    blockNumber,
    blockTimestamp,
  );

  if (
    reserves.liquidityTokenTotalSupply === ZERO_BI &&
    divideByZero === "throw" &&
    position.amount !== ZERO_BI
  ) {
    throw new Error(
      `liquidityTokenTotalSupply is zero for pool ${gauge.pool} at block ${blockNumber} ` +
        `with a nonzero position amount (${position.amount}); ` +
        `this aborts the handler deliberately`,
    );
  }

  const totalSupplyBD = convertTokenToDecimal(
    reserves.liquidityTokenTotalSupply,
    BI_18,
  );
  const userAmount = convertTokenToDecimal(position.amount, BI_18);
  const userShare = totalSupplyBD.isZero()
    ? ZERO_BD
    : bdDiv(userAmount, totalSupplyBD);

  const zeroSupply = reserves.liquidityTokenTotalSupply === ZERO_BI;

  let newSnapshotBalance0 = position.userToken0;
  let newSnapshotBalance1 = position.userToken1;
  let newSnapshotDecimalBalance0 = position.userToken0Decimals;
  let newSnapshotDecimalBalance1 = position.userToken1Decimals;
  let diff0 = ZERO_BI;
  let diff1 = ZERO_BI;
  let diffDecimals0 = ZERO_BD;
  let diffDecimals1 = ZERO_BD;

  if (!zeroSupply) {
    newSnapshotBalance0 =
      (reserves.reserve0 * position.amount) / reserves.liquidityTokenTotalSupply;
    diff0 = newSnapshotBalance0 - position.userToken0;
    newSnapshotBalance1 =
      (reserves.reserve1 * position.amount) / reserves.liquidityTokenTotalSupply;
    diff1 = newSnapshotBalance1 - position.userToken1;

    newSnapshotDecimalBalance0 = bdTimes(
      convertTokenToDecimal(reserves.reserve0, token0.decimals),
      userShare,
    );
    diffDecimals0 = bdMinus(newSnapshotDecimalBalance0, position.userToken0Decimals);
    newSnapshotDecimalBalance1 = bdTimes(
      convertTokenToDecimal(reserves.reserve1, token1.decimals),
      userShare,
    );
    diffDecimals1 = bdMinus(newSnapshotDecimalBalance1, position.userToken1Decimals);
  }

  let deltaSeconds = ZERO_BI;
  let deltaShareSeconds = ZERO_BD;
  let deltaAmountSeconds = ZERO_BD;
  let shareSecondsTotal = position.shareSecondsTotal;
  let amountSecondsTotal = position.amountSecondsTotal;
  let lastAccruedAt = position.lastAccruedAt;

  if (vePoints) {
    if ((position.lastAccruedAt ?? ZERO_BI) === ZERO_BI) {
      lastAccruedAt = BigInt(blockTimestamp);
    } else {
      deltaSeconds = BigInt(blockTimestamp) - (position.lastAccruedAt ?? ZERO_BI);
      const deltaSecondsBD = toBigDecimal(deltaSeconds);

      deltaShareSeconds = bdTimes(userShare, deltaSecondsBD);
      deltaAmountSeconds = bdTimes(userAmount, deltaSecondsBD);

      shareSecondsTotal = bdPlus(position.shareSecondsTotal ?? ZERO_BD, deltaShareSeconds);
      amountSecondsTotal = bdPlus(
        position.amountSecondsTotal ?? ZERO_BD,
        deltaAmountSeconds,
      );
      lastAccruedAt = BigInt(blockTimestamp);

      const userEntity = await context.Helper_User.get(position.user_id);
      if (userEntity !== undefined) {
        context.Helper_User.set({
          ...userEntity,
          shareSecondsTotal: norm(
            bdPlus(userEntity.shareSecondsTotal ?? ZERO_BD, deltaShareSeconds),
          ),
          amountSecondsTotal: norm(
            bdPlus(userEntity.amountSecondsTotal ?? ZERO_BD, deltaAmountSeconds),
          ),
          pointsUpdatedAt: BigInt(blockTimestamp),
        });
      }
    }
  }

  const snapshot: LiquidityPositionSnapshot = {
    id: snapshotId,
    liquidityPosition_id: position.id,
    gauge_id: position.gauge_id,
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
    deltaSeconds: vePoints ? deltaSeconds : undefined,
    deltaShareSeconds: vePoints ? norm(deltaShareSeconds) : undefined,
    deltaAmountSeconds: vePoints ? norm(deltaAmountSeconds) : undefined,
  };

  const updatedPosition: LiquidityPosition = {
    ...position,
    userShare: norm(userShare),
    reserve0: reserves.reserve0,
    reserve1: reserves.reserve1,
    liquidityTokenTotalSupply: reserves.liquidityTokenTotalSupply,
    userToken0: newSnapshotBalance0,
    userToken1: newSnapshotBalance1,
    userToken0Decimals: norm(newSnapshotDecimalBalance0),
    userToken1Decimals: norm(newSnapshotDecimalBalance1),
    shareSecondsTotal: shareSecondsTotal === undefined ? undefined : norm(shareSecondsTotal),
    amountSecondsTotal:
      amountSecondsTotal === undefined ? undefined : norm(amountSecondsTotal),
    lastAccruedAt,
  };

  const depositToken0Balance = await createDepositTokenBalance(
    context,
    chainId,
    gauge.token0_id,
    position.user_id,
  );
  const depositToken1Balance = await createDepositTokenBalance(
    context,
    chainId,
    gauge.token1_id,
    position.user_id,
  );

  context.Helper_DepositTokenBalance.set({
    ...depositToken0Balance,
    amount: depositToken0Balance.amount + diff0,
    amountDecimals: norm(bdPlus(depositToken0Balance.amountDecimals, diffDecimals0)),
  });
  context.Helper_DepositTokenBalance.set({
    ...depositToken1Balance,
    amount: depositToken1Balance.amount + diff1,
    amountDecimals: norm(bdPlus(depositToken1Balance.amountDecimals, diffDecimals1)),
  });
  context.Helper_LiquidityPositionSnapshot.set(snapshot);
  context.Helper_LiquidityPosition.set(updatedPosition);
}

indexer.onEvent(
  { contract: "GaugeV2", event: "Deposit" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const gaugeId = cid(chainId, event.srcAddress);
    const gauge: Gauge = await context.Helper_Gauge.getOrThrow(
      gaugeId,
      `Gauge ${gaugeId} missing while handling a Deposit`,
    );

    const entity: GaugeDeposit = {
      id: cid(chainId, concatI32(event.transaction.hash, event.logIndex)),
      gauge_id: gauge.id,
      pool: gauge.pool,
      user: event.params.user,
      amount: event.params.amount,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    };
    context.Helper_GaugeDeposit.set(entity);

    await createUser(context, chainId, event.params.user);

    if (features(chainId).vePoints) {
      await applyDelta(
        context,
        chainId,
        event.srcAddress,
        ZERO_ADDRESS,
        event.params.amount,
        event.block.number,
        event.block.timestamp,
      );
    }

    await applyDelta(
      context,
      chainId,
      event.srcAddress,
      event.params.user,
      event.params.amount,
      event.block.number,
      event.block.timestamp,
    );
  },
);

indexer.onEvent(
  { contract: "GaugeV2", event: "Withdraw" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const gaugeId = cid(chainId, event.srcAddress);
    const gauge: Gauge = await context.Helper_Gauge.getOrThrow(
      gaugeId,
      `Gauge ${gaugeId} missing while handling a Withdraw`,
    );

    const entity: GaugeWithdraw = {
      id: cid(chainId, concatI32(event.transaction.hash, event.logIndex)),
      gauge_id: gauge.id,
      pool: gauge.pool,
      user: event.params.user,
      amount: event.params.amount,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    };
    context.Helper_GaugeWithdraw.set(entity);

    if (features(chainId).vePoints) {
      await applyDelta(
        context,
        chainId,
        event.srcAddress,
        ZERO_ADDRESS,
        -event.params.amount,
        event.block.number,
        event.block.timestamp,
      );
    }

    await applyDelta(
      context,
      chainId,
      event.srcAddress,
      event.params.user,
      -event.params.amount,
      event.block.number,
      event.block.timestamp,
    );
  },
);

async function applyDelta(
  context: HandlerContext,
  chainId: number,
  gaugeAddress: string,
  user: string,
  delta: bigint,
  blockNumber: number,
  blockTimestamp: number,
): Promise<void> {
  const position = await createLiquidityPosition(context, chainId, gaugeAddress, user);
  const updated: LiquidityPosition = { ...position, amount: position.amount + delta };
  context.Helper_LiquidityPosition.set(updated);
  await createLiquiditySnapshot(context, chainId, updated, blockNumber, blockTimestamp);
}

indexer.onEvent(
  { contract: "GaugeV2", event: "Harvest" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    if (!features(chainId).vePoints) return;

    const { tokenAddress } = await context.effect(getHarvestRewardToken, {
      chainId,
      transactionHash: event.transaction.hash,
      gauge: event.srcAddress,
      user: event.params.user,
      reward: event.params.reward,
    });

    const entity: Harvest = {
      id: cid(chainId, concatI32(event.transaction.hash, event.logIndex)),
      gauge_id: cid(chainId, event.srcAddress),
      receiver_id: cid(chainId, event.params.user),
      tokenAddress,
      rewardAmount: event.params.reward,
      rewardAmountDecimals: convertTokenToDecimal(event.params.reward, BI_18),
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
    };
    context.Helper_Harvest.set(entity);
  },
);
