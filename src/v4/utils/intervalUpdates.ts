/** v4 day and hour rollups. */
import type {
  V4_Pool as Pool,
  V4_PoolDayData as PoolDayData,
  V4_PoolHourData as PoolHourData,
  V4_PoolManager as PoolManager,
  V4_ProtocolDayData as ProtocolDayData,
  V4_Token as Token,
  V4_TokenDayData as TokenDayData,
  V4_TokenHourData as TokenHourData,
} from "envio";
import { BigDecimal, ZERO_BD, bdTimes } from "./bigDecimal";
import { ONE_BI, ZERO_BI } from "./constants";
import { entityId } from "./id";

type Ctx = any;

export const dayIdFromTimestamp = (timestamp: number): number => Math.trunc(timestamp / 86400);
export const hourIndexFromTimestamp = (timestamp: number): number => Math.trunc(timestamp / 3600);

export async function updateProtocolDayData(
  context: Ctx,
  chainId: number,
  timestamp: number,
  poolManagerId: string,
): Promise<ProtocolDayData> {
  const poolManager: PoolManager = await context.V4_PoolManager.getOrThrow(poolManagerId);
  const dayID = dayIdFromTimestamp(timestamp);
  const dayStartTimestamp = dayID * 86400;
  const id = entityId(chainId, dayID.toString());

  let protocolDayData = await context.V4_ProtocolDayData.get(id);
  if (protocolDayData === undefined) {
    protocolDayData = {
      id,
      date: dayStartTimestamp,
      volumeNative: ZERO_BD,
      volumeUSD: ZERO_BD,
      volumeUSDUntracked: ZERO_BD,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      lpFeesUSD: ZERO_BD,
      txCount: ZERO_BI,
      tvlUSD: ZERO_BD,
    };
  }

  protocolDayData = {
    ...protocolDayData,
    tvlUSD: poolManager.totalValueLockedUSD,
    txCount: poolManager.txCount,
  };
  context.V4_ProtocolDayData.set(protocolDayData);
  return protocolDayData;
}

export async function updatePoolDayData(
  context: Ctx,
  chainId: number,
  timestamp: number,
  poolId: string,
): Promise<PoolDayData> {
  const pool: Pool = await context.V4_Pool.getOrThrow(poolId);
  const dayID = dayIdFromTimestamp(timestamp);
  const dayStartTimestamp = dayID * 86400;
  const rawPoolId = pool.id.replace(/^\d+-/, "");
  const id = entityId(chainId, `${rawPoolId}-${dayID}`);

  let poolDayData = await context.V4_PoolDayData.get(id);
  if (poolDayData === undefined) {
    poolDayData = {
      id,
      date: dayStartTimestamp,
      pool_id: pool.id,
      liquidity: ZERO_BI,
      sqrtPrice: ZERO_BI,
      token0Price: ZERO_BD,
      token1Price: ZERO_BD,
      tick: undefined,
      tvlUSD: ZERO_BD,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      lpFeesUSD: ZERO_BD,
      txCount: ZERO_BI,
      open: pool.token0Price,
      high: pool.token0Price,
      low: pool.token0Price,
      close: pool.token0Price,
    };
  }

  let high = poolDayData.high;
  let low = poolDayData.low;
  if (pool.token0Price.isGreaterThan(high)) high = pool.token0Price;
  if (pool.token0Price.isLessThan(low)) low = pool.token0Price;

  poolDayData = {
    ...poolDayData,
    high,
    low,
    liquidity: pool.liquidity,
    sqrtPrice: pool.sqrtPrice,
    token0Price: pool.token0Price,
    token1Price: pool.token1Price,
    close: pool.token0Price,
    tick: pool.tick,
    tvlUSD: pool.totalValueLockedUSD,
    txCount: poolDayData.txCount + ONE_BI,
  };
  context.V4_PoolDayData.set(poolDayData);
  return poolDayData;
}

export async function updatePoolHourData(
  context: Ctx,
  chainId: number,
  timestamp: number,
  poolId: string,
): Promise<PoolHourData> {
  const pool: Pool = await context.V4_Pool.getOrThrow(poolId);
  const hourIndex = hourIndexFromTimestamp(timestamp);
  const hourStartUnix = hourIndex * 3600;
  const rawPoolId = pool.id.replace(/^\d+-/, "");
  const id = entityId(chainId, `${rawPoolId}-${hourIndex}`);

  let poolHourData = await context.V4_PoolHourData.get(id);
  if (poolHourData === undefined) {
    poolHourData = {
      id,
      periodStartUnix: hourStartUnix,
      pool_id: pool.id,
      liquidity: ZERO_BI,
      sqrtPrice: ZERO_BI,
      token0Price: ZERO_BD,
      token1Price: ZERO_BD,
      tick: undefined,
      tvlUSD: ZERO_BD,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      txCount: ZERO_BI,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      lpFeesUSD: ZERO_BD,
      open: pool.token0Price,
      high: pool.token0Price,
      low: pool.token0Price,
      close: pool.token0Price,
    };
  }

  let high = poolHourData.high;
  let low = poolHourData.low;
  if (pool.token0Price.isGreaterThan(high)) high = pool.token0Price;
  if (pool.token0Price.isLessThan(low)) low = pool.token0Price;

  poolHourData = {
    ...poolHourData,
    high,
    low,
    liquidity: pool.liquidity,
    sqrtPrice: pool.sqrtPrice,
    token0Price: pool.token0Price,
    token1Price: pool.token1Price,
    close: pool.token0Price,
    tick: pool.tick,
    tvlUSD: pool.totalValueLockedUSD,
    txCount: poolHourData.txCount + ONE_BI,
  };
  context.V4_PoolHourData.set(poolHourData);
  return poolHourData;
}

export async function updateTokenDayData(
  context: Ctx,
  chainId: number,
  timestamp: number,
  token: Token,
  bundleNativePriceUSD: BigDecimal,
): Promise<TokenDayData> {
  const dayID = dayIdFromTimestamp(timestamp);
  const dayStartTimestamp = dayID * 86400;
  const rawTokenId = token.id.replace(/^\d+-/, "");
  const id = entityId(chainId, `${rawTokenId}-${dayID}`);
  const tokenPrice = bdTimes(token.derivedNative, bundleNativePriceUSD);

  let tokenDayData = await context.V4_TokenDayData.get(id);
  if (tokenDayData === undefined) {
    tokenDayData = {
      id,
      date: dayStartTimestamp,
      token_id: token.id,
      txCount: ZERO_BI,
      volume: ZERO_BD,
      volumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      lpFeesUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      totalValueLocked: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
      priceUSD: ZERO_BD,
      open: tokenPrice,
      high: tokenPrice,
      low: tokenPrice,
      close: tokenPrice,
    };
  }

  let high = tokenDayData.high;
  let low = tokenDayData.low;
  if (tokenPrice.isGreaterThan(high)) high = tokenPrice;
  if (tokenPrice.isLessThan(low)) low = tokenPrice;

  tokenDayData = {
    ...tokenDayData,
    high,
    low,
    close: tokenPrice,
    priceUSD: bdTimes(token.derivedNative, bundleNativePriceUSD),
    totalValueLocked: token.totalValueLocked,
    totalValueLockedUSD: token.totalValueLockedUSD,
    txCount: tokenDayData.txCount + ONE_BI,
  };
  context.V4_TokenDayData.set(tokenDayData);
  return tokenDayData;
}

export async function updateTokenHourData(
  context: Ctx,
  chainId: number,
  timestamp: number,
  token: Token,
  bundleNativePriceUSD: BigDecimal,
): Promise<TokenHourData> {
  const hourIndex = hourIndexFromTimestamp(timestamp);
  const hourStartUnix = hourIndex * 3600;
  const rawTokenId = token.id.replace(/^\d+-/, "");
  const id = entityId(chainId, `${rawTokenId}-${hourIndex}`);
  const tokenPrice = bdTimes(token.derivedNative, bundleNativePriceUSD);

  let tokenHourData = await context.V4_TokenHourData.get(id);
  if (tokenHourData === undefined) {
    tokenHourData = {
      id,
      periodStartUnix: hourStartUnix,
      token_id: token.id,
      txCount: ZERO_BI,
      volume: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      protocolFeesUSD: ZERO_BD,
      lpFeesUSD: ZERO_BD,
      totalValueLocked: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
      priceUSD: ZERO_BD,
      open: tokenPrice,
      high: tokenPrice,
      low: tokenPrice,
      close: tokenPrice,
    };
  }

  let high = tokenHourData.high;
  let low = tokenHourData.low;
  if (tokenPrice.isGreaterThan(high)) high = tokenPrice;
  if (tokenPrice.isLessThan(low)) low = tokenPrice;

  tokenHourData = {
    ...tokenHourData,
    high,
    low,
    close: tokenPrice,
    priceUSD: tokenPrice,
    totalValueLocked: token.totalValueLocked,
    totalValueLockedUSD: token.totalValueLockedUSD,
    txCount: tokenHourData.txCount + ONE_BI,
  };
  context.V4_TokenHourData.set(tokenHourData);
  return tokenHourData;
}
