/** PoolManager handlers: Initialize, fee updates, ModifyLiquidity and Swap. */
import { indexer } from "envio";
import type { V4_Pool as Pool, V4_PoolManager as PoolManager, V4_Token as Token } from "envio";

import { ZERO_BD, bd, bdPlus, bdMinus, bdTimes, bdDiv } from "../utils/bigDecimal";
import {
  ADDRESS_ZERO,
  DYNAMIC_LP_FEE_FLAG,
  ONE_BI,
  ZERO_BI,
  POSM_CACHE_MAX_BLOCK_AGE,
} from "../utils/constants";
import { getChainConfig, getStaticDefinition } from "../utils/chains";
import { getTokenMetadata, DECIMALS_NULL } from "../utils/contractReads";
import { createTick, loadTransaction } from "../utils/entities";
import { entityId, stripChainPrefix, toLowerHex } from "../utils/id";
import { convertTokenToDecimal, safeDiv } from "../utils/index";
import {
  updatePoolDayData,
  updatePoolHourData,
  updateProtocolDayData,
  updateTokenDayData,
  updateTokenHourData,
} from "../utils/intervalUpdates";
import { getAmount0, getAmount1 } from "../utils/liquidityMath";
import {
  calculateAmountUSD,
  findNativePerToken,
  getNativePriceInUSD,
  getTrackedAmountUSD,
  sqrtPriceX96ToTokenPrices,
} from "../utils/pricing";

export function tickSpacingFromParameters(parameters: string): bigint {
  const body = parameters.startsWith("0x") ? parameters.slice(2) : parameters;
  const byteAt = (i: number): number => parseInt(body.slice(i * 2, i * 2 + 2), 16);
  let value = (byteAt(27) << 16) | (byteAt(28) << 8) | byteAt(29);
  if (value >= 0x800000) value -= 0x1000000; // signed 24-bit
  return BigInt(value);
}

export function hooksRegistrationFromParameters(parameters: string): string {
  const body = parameters.startsWith("0x") ? parameters.slice(2) : parameters;
  return `0x${body.slice(60, 64)}`;
}

indexer.onEvent({ contract: "PoolManager", event: "Initialize" }, async ({ event, context }) => {
  const chainId = event.chainId;
  const config = getChainConfig(chainId);
  const poolId = toLowerHex(event.params.id);

  if (config.poolsToSkip.includes(poolId)) return;

  const poolManagerId = entityId(chainId, config.poolManagerAddress);
  const currency0 = toLowerHex(event.params.currency0);
  const currency1 = toLowerHex(event.params.currency1);
  const token0Id = entityId(chainId, currency0);
  const token1Id = entityId(chainId, currency1);

  const [existingPoolManager, existingToken0, existingToken1] = await Promise.all([
    context.V4_PoolManager.get(poolManagerId),
    context.V4_Token.get(token0Id),
    context.V4_Token.get(token1Id),
  ]);

  let poolManager: PoolManager;
  if (existingPoolManager === undefined) {
    poolManager = {
      id: poolManagerId,
      poolCount: ZERO_BI,
      totalVolumeNative: ZERO_BD,
      totalVolumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      totalFeesUSD: ZERO_BD,
      totalProtocolFeesUSD: ZERO_BD,
      totalLpFeesUSD: ZERO_BD,
      totalFeesNative: ZERO_BD,
      totalProtocolFeesNative: ZERO_BD,
      totalLpFeesNative: ZERO_BD,
      totalValueLockedNative: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
      totalValueLockedUSDUntracked: ZERO_BD,
      totalValueLockedNativeUntracked: ZERO_BD,
      txCount: ZERO_BI,
      owner: ADDRESS_ZERO, // B-4: never updated afterwards
    };
    context.V4_Bundle.set({ id: entityId(chainId, "1"), nativePriceUSD: ZERO_BD });
  } else {
    poolManager = existingPoolManager;
  }

  poolManager = { ...poolManager, poolCount: poolManager.poolCount + ONE_BI };

  const blockNumber = event.block.number;
  const blockTimestamp = event.block.timestamp;

  let token0: Token;
  if (existingToken0 === undefined) {
    const meta = await resolveTokenMetadata(context, chainId, currency0, blockNumber, config);
    if (meta.decimals === DECIMALS_NULL) {
      context.log.debug("mybug the decimal on token 0 was null");
      return;
    }
    token0 = newToken(token0Id, meta);
  } else {
    token0 = existingToken0;
  }

  let token1: Token;
  if (existingToken1 === undefined) {
    const meta = await resolveTokenMetadata(context, chainId, currency1, blockNumber, config);
    if (meta.decimals === DECIMALS_NULL) {
      context.log.debug("mybug the decimal on token 0 was null");
      return;
    }
    token1 = newToken(token1Id, meta);
  } else {
    token1 = existingToken1;
  }

  const prefixedPoolId = entityId(chainId, poolId);
  if (config.whitelistTokens.includes(stripChainPrefix(token0.id))) {
    token1 = { ...token1, whitelistPools: [...token1.whitelistPools, prefixedPoolId] };
  }
  if (config.whitelistTokens.includes(stripChainPrefix(token1.id))) {
    token0 = { ...token0, whitelistPools: [...token0.whitelistPools, prefixedPoolId] };
  }

  const parameters = toLowerHex(event.params.parameters);
  const sqrtPrice = event.params.sqrtPriceX96;

  const prices = sqrtPriceX96ToTokenPrices(sqrtPrice, token0, token1, config.nativeTokenDetails);

  const pool: Pool = {
    id: prefixedPoolId,
    token0_id: token0.id,
    token1_id: token1.id,
    dynamicLPFee: event.params.fee === DYNAMIC_LP_FEE_FLAG,
    feeTier: event.params.fee,
    swapFee: ZERO_BI,
    protocolFee: ZERO_BI,
    lpFee: ZERO_BI,
    hooks: toLowerHex(event.params.hooks),
    tickSpacing: tickSpacingFromParameters(parameters),
    createdAtTimestamp: BigInt(blockTimestamp),
    createdAtBlockNumber: BigInt(blockNumber),
    liquidityProviderCount: ZERO_BI,
    txCount: ZERO_BI,
    liquidity: ZERO_BI,
    sqrtPrice,
    token0Price: prices[0],
    token1Price: prices[1],
    observationIndex: ZERO_BI,
    parameters,
    hooksRegistration: hooksRegistrationFromParameters(parameters),
    totalValueLockedToken0: ZERO_BD,
    totalValueLockedToken1: ZERO_BD,
    totalValueLockedUSD: ZERO_BD,
    totalValueLockedNative: ZERO_BD,
    totalValueLockedUSDUntracked: ZERO_BD,
    volumeToken0: ZERO_BD,
    volumeToken1: ZERO_BD,
    volumeUSD: ZERO_BD,
    feesUSD: ZERO_BD,
    protocolFeesUSD: ZERO_BD,
    lpFeesUSD: ZERO_BD,
    untrackedVolumeUSD: ZERO_BD,
    collectedFeesToken0: ZERO_BD,
    collectedFeesToken1: ZERO_BD,
    collectedFeesUSD: ZERO_BD,
    tick: event.params.tick,
  };

  context.V4_Pool.set(pool);
  context.V4_Token.set(token0);
  context.V4_Token.set(token1);
  context.V4_PoolManager.set(poolManager);

  const nativePriceUSD = await getNativePriceInUSD(
    context,
    chainId,
    config.stablecoinWrappedNativePoolId,
    config.stablecoinIsToken0,
  );
  context.V4_Bundle.set({ id: entityId(chainId, "1"), nativePriceUSD });

  await updatePoolDayData(context, chainId, blockTimestamp, pool.id);
  await updatePoolHourData(context, chainId, blockTimestamp, pool.id);

  const token1DerivedNative = await findNativePerToken(
    context, token1, nativePriceUSD, config.wrappedNativeAddress,
    config.stablecoinAddresses, config.minimumNativeLocked,
  );
  const token0DerivedNative = await findNativePerToken(
    context, token0, nativePriceUSD, config.wrappedNativeAddress,
    config.stablecoinAddresses, config.minimumNativeLocked,
  );

  context.V4_Token.set({
    ...token1,
    derivedNative: token1DerivedNative,
    derivedUSD: bdTimes(token1DerivedNative, nativePriceUSD),
  });
  context.V4_Token.set({
    ...token0,
    derivedNative: token0DerivedNative,
    derivedUSD: bdTimes(token0DerivedNative, nativePriceUSD),
  });
});

type TokenMeta = { symbol: string; name: string; totalSupply: bigint; decimals: bigint };

async function resolveTokenMetadata(
  context: any,
  chainId: number,
  address: string,
  blockNumber: number,
  config: ReturnType<typeof getChainConfig>,
): Promise<TokenMeta> {
  const native = config.nativeTokenDetails;

  if (address === ADDRESS_ZERO) {
    return {
      symbol: native.symbol,
      name: native.name,
      totalSupply: ZERO_BI,
      decimals: native.decimals,
    };
  }

  const override = getStaticDefinition(address, config.tokenOverrides);
  if (override !== null) {
    const fetched = await context.effect(getTokenMetadata, { chainId, address, blockNumber });
    return {
      symbol: override.symbol,
      name: override.name,
      totalSupply: fetched.totalSupply,
      decimals: override.decimals,
    };
  }

  return await context.effect(getTokenMetadata, { chainId, address, blockNumber });
}

function newToken(id: string, meta: TokenMeta): Token {
  return {
    id,
    symbol: meta.symbol,
    name: meta.name,
    totalSupply: meta.totalSupply,
    decimals: meta.decimals,
    derivedNative: ZERO_BD,
    derivedUSD: ZERO_BD,
    volume: ZERO_BD,
    volumeUSD: ZERO_BD,
    feesUSD: ZERO_BD,
    protocolFeesUSD: ZERO_BD,
    lpFeesUSD: ZERO_BD,
    untrackedVolumeUSD: ZERO_BD,
    totalValueLocked: ZERO_BD,
    totalValueLockedUSD: ZERO_BD,
    totalValueLockedUSDUntracked: ZERO_BD,
    txCount: ZERO_BI,
    poolCount: ZERO_BI,
    whitelistPools: [],
  };
}

indexer.onEvent(
  { contract: "PoolManager", event: "DynamicLPFeeUpdated" },
  async ({ event, context }) => {
    const id = entityId(event.chainId, toLowerHex(event.params.id));
    const pool = await context.V4_Pool.getOrThrow(id);
    const lpFee = event.params.dynamicLPFee;
    context.V4_Pool.set({ ...pool, lpFee, swapFee: lpFee + pool.protocolFee });
  },
);

indexer.onEvent(
  { contract: "PoolManager", event: "ProtocolFeeUpdated" },
  async ({ event, context }) => {
    const id = entityId(event.chainId, toLowerHex(event.params.id));
    const pool = await context.V4_Pool.getOrThrow(id);
    const protocolFee = event.params.protocolFee & 0xfffn;
    context.V4_Pool.set({ ...pool, protocolFee, swapFee: protocolFee + pool.lpFee });
  },
);

indexer.onEvent(
  { contract: "PoolManager", event: "ModifyLiquidity" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const config = getChainConfig(chainId);
    const poolId = toLowerHex(event.params.id);
    const prefixedPoolId = entityId(chainId, poolId);

    const [bundle, pool, poolManagerEntity] = await Promise.all([
      context.V4_Bundle.getOrThrow(entityId(chainId, "1")),
      context.V4_Pool.get(prefixedPoolId),
      context.V4_PoolManager.get(entityId(chainId, config.poolManagerAddress)),
    ]);

    if (pool === undefined) {
      context.log.debug(`handleModifyLiquidityHelper: pool not found ${poolId}`);
      return;
    }
    if (poolManagerEntity === undefined) {
      context.log.debug(
        `handleModifyLiquidityHelper: pool manager not found ${config.poolManagerAddress}`,
      );
      return;
    }

    const [token0Entity, token1Entity] = await Promise.all([
      context.V4_Token.get(pool.token0_id),
      context.V4_Token.get(pool.token1_id),
    ]);
    if (token0Entity === undefined || token1Entity === undefined) return;

    let token0 = token0Entity;
    let token1 = token1Entity;
    let poolManager = poolManagerEntity;
    let updatedPool = pool;

    if (updatedPool.tick === undefined) {
      throw new Error(`ModifyLiquidity: pool ${poolId} has a null tick`);
    }
    const currTick = Number(updatedPool.tick);
    const currSqrtPriceX96 = updatedPool.sqrtPrice;
    const tickLower = Number(event.params.tickLower);
    const tickUpper = Number(event.params.tickUpper);

    const amount0Raw = getAmount0(
      tickLower, tickUpper, currTick, event.params.liquidityDelta, currSqrtPriceX96,
    );
    const amount1Raw = getAmount1(
      tickLower, tickUpper, currTick, event.params.liquidityDelta, currSqrtPriceX96,
    );
    const amount0 = convertTokenToDecimal(amount0Raw, token0.decimals);
    const amount1 = convertTokenToDecimal(amount1Raw, token1.decimals);

    const amountUSD = calculateAmountUSD(
      amount0, amount1, token0.derivedNative, token1.derivedNative, bundle.nativePriceUSD,
    );

    poolManager = {
      ...poolManager,
      totalValueLockedNative: bdMinus(
        poolManager.totalValueLockedNative,
        updatedPool.totalValueLockedNative,
      ),
      txCount: poolManager.txCount + ONE_BI,
    };

    token0 = {
      ...token0,
      txCount: token0.txCount + ONE_BI,
      totalValueLocked: bdPlus(token0.totalValueLocked, amount0),
    };
    token0 = {
      ...token0,
      totalValueLockedUSD: bdTimes(
        token0.totalValueLocked,
        bdTimes(token0.derivedNative, bundle.nativePriceUSD),
      ),
    };

    token1 = {
      ...token1,
      txCount: token1.txCount + ONE_BI,
      totalValueLocked: bdPlus(token1.totalValueLocked, amount1),
    };
    token1 = {
      ...token1,
      totalValueLockedUSD: bdTimes(
        token1.totalValueLocked,
        bdTimes(token1.derivedNative, bundle.nativePriceUSD),
      ),
    };

    updatedPool = { ...updatedPool, txCount: updatedPool.txCount + ONE_BI };

    if (
      updatedPool.tick !== undefined &&
      event.params.tickLower <= updatedPool.tick &&
      event.params.tickUpper > updatedPool.tick
    ) {
      updatedPool = {
        ...updatedPool,
        liquidity: updatedPool.liquidity + event.params.liquidityDelta,
      };
    }

    updatedPool = {
      ...updatedPool,
      totalValueLockedToken0: bdPlus(updatedPool.totalValueLockedToken0, amount0),
      totalValueLockedToken1: bdPlus(updatedPool.totalValueLockedToken1, amount1),
    };
    updatedPool = {
      ...updatedPool,
      totalValueLockedNative: bdPlus(
        bdTimes(updatedPool.totalValueLockedToken0, token0.derivedNative),
        bdTimes(updatedPool.totalValueLockedToken1, token1.derivedNative),
      ),
    };
    updatedPool = {
      ...updatedPool,
      totalValueLockedUSD: bdTimes(updatedPool.totalValueLockedNative, bundle.nativePriceUSD),
    };

    poolManager = {
      ...poolManager,
      totalValueLockedNative: bdPlus(
        poolManager.totalValueLockedNative,
        updatedPool.totalValueLockedNative,
      ),
    };
    poolManager = {
      ...poolManager,
      totalValueLockedUSD: bdTimes(poolManager.totalValueLockedNative, bundle.nativePriceUSD),
    };

    const transaction = loadTransaction(context, event);
    const modifyLiquidityId = entityId(
      chainId,
      `${toLowerHex(event.transaction.hash)}-${event.logIndex}`,
    );

    context.V4_ModifyLiquidity.set({
      id: modifyLiquidityId,
      transaction_id: transaction.id,
      timestamp: transaction.timestamp,
      pool_id: updatedPool.id,
      token0_id: updatedPool.token0_id,
      token1_id: updatedPool.token1_id,
      sender: toLowerHex(event.params.sender),
      origin: toLowerHex(event.transaction.from ?? ADDRESS_ZERO),
      amount: event.params.liquidityDelta,
      amount0,
      amount1,
      amountUSD,
      tickLower: event.params.tickLower,
      tickUpper: event.params.tickUpper,
      salt: toLowerHex(event.params.salt),
      logIndex: BigInt(event.logIndex),
      transactionLogIndex: BigInt(event.logIndex),
    });

    const cacheId = entityId(chainId, "1");
    const existingCache = await context.V4_ModifyLiquidityCache.get(cacheId);
    const currentIds = existingCache === undefined ? [] : existingCache.modifyLiquidities;
    const retained = await pruneModifyLiquidityCacheEntries(
      context, currentIds, BigInt(event.block.number),
    );
    retained.push(modifyLiquidityId);

    context.V4_ModifyLiquidityCache.set({
      id: cacheId,
      hash: toLowerHex(event.transaction.hash),
      logIndex: BigInt(event.logIndex),
      modifyLiquidities: retained,
    });

    const lowerTickId = entityId(chainId, `${poolId}#${event.params.tickLower.toString()}`);
    const upperTickId = entityId(chainId, `${poolId}#${event.params.tickUpper.toString()}`);

    const [existingLower, existingUpper] = await Promise.all([
      context.V4_Tick.get(lowerTickId),
      context.V4_Tick.get(upperTickId),
    ]);

    const lowerTick =
      existingLower ??
      createTick(lowerTickId, tickLower, updatedPool.id, event.block.number, event.block.timestamp);
    const upperTick =
      existingUpper ??
      createTick(upperTickId, tickUpper, updatedPool.id, event.block.number, event.block.timestamp);

    const amount = event.params.liquidityDelta;
    context.V4_Tick.set({
      ...lowerTick,
      liquidityGross: lowerTick.liquidityGross + amount,
      liquidityNet: lowerTick.liquidityNet + amount,
    });
    context.V4_Tick.set({
      ...upperTick,
      liquidityGross: upperTick.liquidityGross + amount,
      liquidityNet: upperTick.liquidityNet - amount,
    });

    const blockTimestamp = event.block.timestamp;
    await updateProtocolDayData(context, chainId, blockTimestamp, poolManager.id);
    await updatePoolDayData(context, chainId, blockTimestamp, updatedPool.id);
    await updatePoolHourData(context, chainId, blockTimestamp, updatedPool.id);
    await updateTokenDayData(context, chainId, blockTimestamp, token0, bundle.nativePriceUSD);
    await updateTokenDayData(context, chainId, blockTimestamp, token1, bundle.nativePriceUSD);
    await updateTokenHourData(context, chainId, blockTimestamp, token0, bundle.nativePriceUSD);
    await updateTokenHourData(context, chainId, blockTimestamp, token1, bundle.nativePriceUSD);

    context.V4_Token.set(token0);
    context.V4_Token.set(token1);
    context.V4_Pool.set(updatedPool);
    context.V4_PoolManager.set(poolManager);
  },
);

export async function pruneModifyLiquidityCacheEntries(
  context: any,
  ids: readonly string[],
  currentBlock: bigint,
): Promise<string[]> {
  const retained: string[] = [];
  for (const id of ids) {
    const modifyLiquidity = await context.V4_ModifyLiquidity.get(id);
    if (modifyLiquidity === undefined) continue;
    const transaction = await context.V4_Transaction.get(modifyLiquidity.transaction_id);
    if (transaction === undefined) continue;
    if (currentBlock - transaction.blockNumber > POSM_CACHE_MAX_BLOCK_AGE) continue;
    retained.push(id);
  }
  return retained;
}

indexer.onEvent({ contract: "PoolManager", event: "Swap" }, async ({ event, context }) => {
  const chainId = event.chainId;
  const config = getChainConfig(chainId);
  const poolId = toLowerHex(event.params.id);
  const prefixedPoolId = entityId(chainId, poolId);

  const [bundleEntity, poolManagerEntity, poolEntity] = await Promise.all([
    context.V4_Bundle.getOrThrow(entityId(chainId, "1")),
    context.V4_PoolManager.getOrThrow(entityId(chainId, config.poolManagerAddress)),
    context.V4_Pool.getOrThrow(prefixedPoolId),
  ]);

  const [token0Entity, token1Entity] = await Promise.all([
    context.V4_Token.get(poolEntity.token0_id),
    context.V4_Token.get(poolEntity.token1_id),
  ]);
  if (token0Entity === undefined || token1Entity === undefined) return;

  let bundle = bundleEntity;
  let poolManager = poolManagerEntity;
  let pool = poolEntity;
  let token0 = token0Entity;
  let token1 = token1Entity;

  const amount0Raw = event.params.amount0 * -1n;
  const amount1Raw = event.params.amount1 * -1n;

  const amount0 = convertTokenToDecimal(amount0Raw, token0.decimals);
  const amount1 = convertTokenToDecimal(amount1Raw, token1.decimals);

  const amount0Abs = amount0.isLessThan(ZERO_BD) ? bdTimes(amount0, bd("-1")) : amount0;
  const amount1Abs = amount1.isLessThan(ZERO_BD) ? bdTimes(amount1, bd("-1")) : amount1;

  const amount0Native = bdTimes(amount0Abs, token0.derivedNative);
  const amount1Native = bdTimes(amount1Abs, token1.derivedNative);
  const amount0USD = bdTimes(amount0Native, bundle.nativePriceUSD);
  const amount1USD = bdTimes(amount1Native, bundle.nativePriceUSD);

  const amountTotalUSDTracked = bdDiv(
    getTrackedAmountUSD(
      amount0Abs, token0, amount1Abs, token1, config.whitelistTokens, bundle.nativePriceUSD,
    ),
    bd("2"),
  );
  const amountTotalNativeTracked = safeDiv(amountTotalUSDTracked, bundle.nativePriceUSD);
  const amountTotalUSDUntracked = bdDiv(bdPlus(amount0USD, amount1USD), bd("2"));

  const fee = bd(event.params.fee);
  const feeBigInt = event.params.fee;
  const protocolFee = bd(event.params.protocolFee);
  const protocolFeeBigInt = event.params.protocolFee;
  const lpFeeBigInt = feeBigInt - protocolFeeBigInt;

  if (protocolFeeBigInt !== pool.protocolFee) pool = { ...pool, protocolFee: protocolFeeBigInt };
  if (lpFeeBigInt !== pool.lpFee) pool = { ...pool, lpFee: lpFeeBigInt };
  if (feeBigInt !== pool.swapFee) pool = { ...pool, swapFee: feeBigInt };

  const MILLION = bd("1000000");
  const feesNative = bdDiv(bdTimes(amountTotalNativeTracked, fee), MILLION);
  const feesUSD = bdDiv(bdTimes(amountTotalUSDTracked, fee), MILLION);
  const protocolFeesNative = bdDiv(bdTimes(amountTotalNativeTracked, protocolFee), MILLION);
  const protocolFeesUSD = bdDiv(bdTimes(amountTotalNativeTracked, protocolFee), MILLION);
  const lpFeesNative = bdMinus(feesNative, protocolFeesNative);
  const lpFeesUSD = bdMinus(feesUSD, protocolFeesUSD);

  poolManager = {
    ...poolManager,
    txCount: poolManager.txCount + ONE_BI,
    totalVolumeNative: bdPlus(poolManager.totalVolumeNative, amountTotalNativeTracked),
    totalVolumeUSD: bdPlus(poolManager.totalVolumeUSD, amountTotalUSDTracked),
    untrackedVolumeUSD: bdPlus(poolManager.untrackedVolumeUSD, amountTotalUSDUntracked),
    totalFeesNative: bdPlus(poolManager.totalFeesNative, feesNative),
    totalProtocolFeesNative: bdPlus(poolManager.totalProtocolFeesNative, protocolFeesNative),
    totalLpFeesNative: bdPlus(poolManager.totalLpFeesNative, lpFeesNative),
    totalFeesUSD: bdPlus(poolManager.totalFeesUSD, feesUSD),
    totalProtocolFeesUSD: bdPlus(poolManager.totalProtocolFeesUSD, protocolFeesUSD),
    totalLpFeesUSD: bdPlus(poolManager.totalLpFeesUSD, lpFeesUSD),
  };

  poolManager = {
    ...poolManager,
    totalValueLockedNative: bdMinus(
      poolManager.totalValueLockedNative,
      pool.totalValueLockedNative,
    ),
  };

  pool = {
    ...pool,
    volumeToken0: bdPlus(pool.volumeToken0, amount0Abs),
    volumeToken1: bdPlus(pool.volumeToken1, amount1Abs),
    volumeUSD: bdPlus(pool.volumeUSD, amountTotalUSDTracked),
    untrackedVolumeUSD: bdPlus(pool.untrackedVolumeUSD, amountTotalUSDUntracked),
    feesUSD: bdPlus(pool.feesUSD, feesUSD),
    protocolFeesUSD: bdPlus(pool.protocolFeesUSD, protocolFeesUSD),
    lpFeesUSD: bdPlus(pool.lpFeesUSD, lpFeesUSD),
    txCount: pool.txCount + ONE_BI,
    liquidity: event.params.liquidity,
    tick: event.params.tick,
    sqrtPrice: event.params.sqrtPriceX96,
  };
  pool = {
    ...pool,
    totalValueLockedToken0: bdPlus(pool.totalValueLockedToken0, amount0),
    totalValueLockedToken1: bdPlus(pool.totalValueLockedToken1, amount1),
  };

  token0 = {
    ...token0,
    volume: bdPlus(token0.volume, amount0Abs),
    totalValueLocked: bdPlus(token0.totalValueLocked, amount0),
    volumeUSD: bdPlus(token0.volumeUSD, amountTotalUSDTracked),
    untrackedVolumeUSD: bdPlus(token0.untrackedVolumeUSD, amountTotalUSDUntracked),
    feesUSD: bdPlus(token0.feesUSD, feesUSD),
    protocolFeesUSD: bdPlus(token0.protocolFeesUSD, protocolFeesUSD),
    lpFeesUSD: bdPlus(token0.lpFeesUSD, lpFeesUSD),
    txCount: token0.txCount + ONE_BI,
  };
  token1 = {
    ...token1,
    volume: bdPlus(token1.volume, amount1Abs),
    totalValueLocked: bdPlus(token1.totalValueLocked, amount1),
    volumeUSD: bdPlus(token1.volumeUSD, amountTotalUSDTracked),
    untrackedVolumeUSD: bdPlus(token1.untrackedVolumeUSD, amountTotalUSDUntracked),
    feesUSD: bdPlus(token1.feesUSD, feesUSD),
    protocolFeesUSD: bdPlus(token1.protocolFeesUSD, protocolFeesUSD),
    lpFeesUSD: bdPlus(token1.lpFeesUSD, lpFeesUSD),
    txCount: token1.txCount + ONE_BI,
  };

  const prices = sqrtPriceX96ToTokenPrices(
    pool.sqrtPrice, token0, token1, config.nativeTokenDetails,
  );
  pool = { ...pool, token0Price: prices[0], token1Price: prices[1] };
  context.V4_Pool.set(pool);

  const nativePriceUSD = await getNativePriceInUSD(
    context, chainId, config.stablecoinWrappedNativePoolId, config.stablecoinIsToken0,
  );
  bundle = { ...bundle, nativePriceUSD };
  context.V4_Bundle.set(bundle);

  const token0DerivedNative = await findNativePerToken(
    context, token0, bundle.nativePriceUSD, config.wrappedNativeAddress,
    config.stablecoinAddresses, config.minimumNativeLocked,
  );
  const token1DerivedNative = await findNativePerToken(
    context, token1, bundle.nativePriceUSD, config.wrappedNativeAddress,
    config.stablecoinAddresses, config.minimumNativeLocked,
  );

  token0 = {
    ...token0,
    derivedNative: token0DerivedNative,
    derivedUSD: bdTimes(token0DerivedNative, bundle.nativePriceUSD),
  };
  token1 = {
    ...token1,
    derivedNative: token1DerivedNative,
    derivedUSD: bdTimes(token1DerivedNative, bundle.nativePriceUSD),
  };

  pool = {
    ...pool,
    totalValueLockedNative: bdPlus(
      bdTimes(pool.totalValueLockedToken0, token0.derivedNative),
      bdTimes(pool.totalValueLockedToken1, token1.derivedNative),
    ),
  };
  pool = {
    ...pool,
    totalValueLockedUSD: bdTimes(pool.totalValueLockedNative, bundle.nativePriceUSD),
  };

  poolManager = {
    ...poolManager,
    totalValueLockedNative: bdPlus(
      poolManager.totalValueLockedNative,
      pool.totalValueLockedNative,
    ),
  };
  poolManager = {
    ...poolManager,
    totalValueLockedUSD: bdTimes(poolManager.totalValueLockedNative, bundle.nativePriceUSD),
  };

  token0 = {
    ...token0,
    totalValueLockedUSD: bdTimes(
      bdTimes(token0.totalValueLocked, token0.derivedNative),
      bundle.nativePriceUSD,
    ),
  };
  token1 = {
    ...token1,
    totalValueLockedUSD: bdTimes(
      bdTimes(token1.totalValueLocked, token1.derivedNative),
      bundle.nativePriceUSD,
    ),
  };

  const transaction = loadTransaction(context, event);
  context.V4_Swap.set({
    id: entityId(chainId, `${toLowerHex(event.transaction.hash)}-${event.logIndex}`),
    transaction_id: transaction.id,
    timestamp: transaction.timestamp,
    pool_id: pool.id,
    token0_id: pool.token0_id,
    token1_id: pool.token1_id,
    sender: toLowerHex(event.params.sender),
    origin: toLowerHex(event.transaction.from ?? ADDRESS_ZERO),
    amount0Raw,
    amount1Raw,
    amount0,
    amount1,
    swapFee: feeBigInt,
    protocolFee: protocolFeeBigInt,
    lpFee: lpFeeBigInt,
    amountUSD: amountTotalUSDTracked,
    tick: event.params.tick,
    sqrtPriceX96: event.params.sqrtPriceX96,
    logIndex: BigInt(event.logIndex),
  });

  const ts = event.block.timestamp;
  const protocolDayData = await updateProtocolDayData(context, chainId, ts, poolManager.id);
  const poolDayData = await updatePoolDayData(context, chainId, ts, pool.id);
  const poolHourData = await updatePoolHourData(context, chainId, ts, pool.id);
  const token0DayData = await updateTokenDayData(context, chainId, ts, token0, bundle.nativePriceUSD);
  const token1DayData = await updateTokenDayData(context, chainId, ts, token1, bundle.nativePriceUSD);
  const token0HourData = await updateTokenHourData(context, chainId, ts, token0, bundle.nativePriceUSD);
  const token1HourData = await updateTokenHourData(context, chainId, ts, token1, bundle.nativePriceUSD);

  context.V4_ProtocolDayData.set({
    ...protocolDayData,
    volumeNative: bdPlus(protocolDayData.volumeNative, amountTotalNativeTracked),
    volumeUSD: bdPlus(protocolDayData.volumeUSD, amountTotalUSDTracked),
    feesUSD: bdPlus(protocolDayData.feesUSD, feesUSD),
    protocolFeesUSD: bdPlus(protocolDayData.protocolFeesUSD, protocolFeesUSD),
    lpFeesUSD: bdPlus(protocolDayData.lpFeesUSD, lpFeesUSD),
  });

  context.V4_PoolDayData.set({
    ...poolDayData,
    volumeUSD: bdPlus(poolDayData.volumeUSD, amountTotalUSDTracked),
    untrackedVolumeUSD: bdPlus(poolDayData.untrackedVolumeUSD, amountTotalUSDUntracked),
    volumeToken0: bdPlus(poolDayData.volumeToken0, amount0Abs),
    volumeToken1: bdPlus(poolDayData.volumeToken1, amount1Abs),
    feesUSD: bdPlus(poolDayData.feesUSD, feesUSD),
    protocolFeesUSD: bdPlus(poolDayData.protocolFeesUSD, protocolFeesUSD),
    lpFeesUSD: bdPlus(poolDayData.lpFeesUSD, lpFeesUSD),
  });

  context.V4_PoolHourData.set({
    ...poolHourData,
    volumeUSD: bdPlus(poolHourData.volumeUSD, amountTotalUSDTracked),
    untrackedVolumeUSD: bdPlus(poolHourData.untrackedVolumeUSD, amountTotalUSDUntracked),
    volumeToken0: bdPlus(poolHourData.volumeToken0, amount0Abs),
    volumeToken1: bdPlus(poolHourData.volumeToken1, amount1Abs),
    feesUSD: bdPlus(poolHourData.feesUSD, feesUSD),
    protocolFeesUSD: bdPlus(poolHourData.protocolFeesUSD, protocolFeesUSD),
    lpFeesUSD: bdPlus(poolHourData.lpFeesUSD, lpFeesUSD),
  });

  context.V4_TokenDayData.set({
    ...token0DayData,
    volume: bdPlus(token0DayData.volume, amount0Abs),
    volumeUSD: bdPlus(token0DayData.volumeUSD, amountTotalUSDTracked),
    untrackedVolumeUSD: bdPlus(token0DayData.untrackedVolumeUSD, amountTotalUSDTracked),
    feesUSD: bdPlus(token0DayData.feesUSD, feesUSD),
    protocolFeesUSD: bdPlus(token0DayData.protocolFeesUSD, protocolFeesUSD),
    lpFeesUSD: bdPlus(token0DayData.lpFeesUSD, lpFeesUSD),
  });
  context.V4_TokenHourData.set({
    ...token0HourData,
    volume: bdPlus(token0HourData.volume, amount0Abs),
    volumeUSD: bdPlus(token0HourData.volumeUSD, amountTotalUSDTracked),
    untrackedVolumeUSD: bdPlus(token0HourData.untrackedVolumeUSD, amountTotalUSDTracked),
    feesUSD: bdPlus(token0HourData.feesUSD, feesUSD),
    protocolFeesUSD: bdPlus(token0HourData.protocolFeesUSD, protocolFeesUSD),
    lpFeesUSD: bdPlus(token0HourData.lpFeesUSD, lpFeesUSD),
  });
  context.V4_TokenDayData.set({
    ...token1DayData,
    volume: bdPlus(token1DayData.volume, amount1Abs),
    volumeUSD: bdPlus(token1DayData.volumeUSD, amountTotalUSDTracked),
    untrackedVolumeUSD: bdPlus(token1DayData.untrackedVolumeUSD, amountTotalUSDTracked),
    feesUSD: bdPlus(token1DayData.feesUSD, feesUSD),
    protocolFeesUSD: bdPlus(token1DayData.protocolFeesUSD, protocolFeesUSD),
    lpFeesUSD: bdPlus(token1DayData.lpFeesUSD, lpFeesUSD),
  });
  context.V4_TokenHourData.set({
    ...token1HourData,
    volume: bdPlus(token1HourData.volume, amount1Abs),
    volumeUSD: bdPlus(token1HourData.volumeUSD, amountTotalUSDTracked),
    untrackedVolumeUSD: bdPlus(token1HourData.untrackedVolumeUSD, amountTotalUSDTracked),
    feesUSD: bdPlus(token1HourData.feesUSD, feesUSD),
    protocolFeesUSD: bdPlus(token1HourData.protocolFeesUSD, protocolFeesUSD),
    lpFeesUSD: bdPlus(token1HourData.lpFeesUSD, lpFeesUSD),
  });

  context.V4_PoolManager.set(poolManager);
  context.V4_Pool.set(pool);
  context.V4_Token.set(token0);
  context.V4_Token.set(token1);
});
