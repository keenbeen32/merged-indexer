/** Analytics day and hour rollups. */
import type {
  Analytics_AlgebraDayData as AlgebraDayData,
  Analytics_AlgebraHourData as AlgebraHourData,
  Analytics_Bundle as Bundle,
  Analytics_Factory as Factory,
  Analytics_FeeHourData as FeeHourData,
  Analytics_Pool as Pool,
  Analytics_PoolDayData as PoolDayData,
  Analytics_PoolHourData as PoolHourData,
  Analytics_Token as Token,
  Analytics_TokenDayData as TokenDayData,
  Analytics_TokenHourData as TokenHourData,
} from "envio";
import { cid, factoryId, singletonId } from "../config/chain.js";
import { ZERO_BD, times } from "./bigdecimal.js";
import { ONE_BI, ZERO_BI } from "./constants.js";

type Evt = { chainId: number; block: { timestamp: number | bigint } };

type Ctx = {
  Analytics_Factory: {
    get: (id: string) => Promise<Factory | undefined>;
  };
  Analytics_Bundle: {
    get: (id: string) => Promise<Bundle | undefined>;
  };
  Analytics_Pool: {
    get: (id: string) => Promise<Pool | undefined>;
  };
  Analytics_AlgebraDayData: {
    get: (id: string) => Promise<AlgebraDayData | undefined>;
    set: (e: AlgebraDayData) => void;
  };
  Analytics_AlgebraHourData: {
    get: (id: string) => Promise<AlgebraHourData | undefined>;
    set: (e: AlgebraHourData) => void;
  };
  Analytics_PoolDayData: {
    get: (id: string) => Promise<PoolDayData | undefined>;
    set: (e: PoolDayData) => void;
  };
  Analytics_PoolHourData: {
    get: (id: string) => Promise<PoolHourData | undefined>;
    set: (e: PoolHourData) => void;
  };
  Analytics_TokenDayData: {
    get: (id: string) => Promise<TokenDayData | undefined>;
    set: (e: TokenDayData) => void;
  };
  Analytics_TokenHourData: {
    get: (id: string) => Promise<TokenHourData | undefined>;
    set: (e: TokenHourData) => void;
  };
  Analytics_FeeHourData: {
    get: (id: string) => Promise<FeeHourData | undefined>;
    set: (e: FeeHourData) => void;
  };
};

function dayId(ts: number): number {
  return Math.floor(ts / 86400);
}

function hourId(ts: number): number {
  return Math.floor(ts / 3600);
}

export async function updateAlgebraDayData(
  event: Evt & { srcAddress: string },
  context: Ctx,
): Promise<AlgebraDayData> {
  const chainId = event.chainId;
  const algebra = (await context.Analytics_Factory.get(factoryId(chainId)))!;
  const timestamp = Number(event.block.timestamp);
  const dId = dayId(timestamp);
  const dayStartTimestamp = dId * 86400;
  const dayDataId = cid(chainId, dId.toString());
  let algebraDayData = await context.Analytics_AlgebraDayData.get(dayDataId);
  if (!algebraDayData) {
    algebraDayData = {
      id: dayDataId,
      date: dayStartTimestamp,
      volumeMatic: ZERO_BD,
      volumeUSD: ZERO_BD,
      volumeUSDUntracked: ZERO_BD,
      feesUSD: ZERO_BD,
      tvlUSD: ZERO_BD,
      txCount: ZERO_BI,
    };
  }
  algebraDayData = {
    ...algebraDayData,
    tvlUSD: algebra.totalValueLockedUSD,
    txCount: algebra.txCount,
  };
  context.Analytics_AlgebraDayData.set(algebraDayData);
  return algebraDayData;
}

export async function updateAlgebraHourData(
  event: Evt,
  context: Ctx,
): Promise<AlgebraHourData> {
  const chainId = event.chainId;
  const algebra = (await context.Analytics_Factory.get(factoryId(chainId)))!;
  const timestamp = Number(event.block.timestamp);
  const hId = hourId(timestamp);
  const hourStartTimestamp = hId * 3600;
  const hourDataId = cid(chainId, hId.toString());
  let algebraHourData = await context.Analytics_AlgebraHourData.get(hourDataId);
  if (!algebraHourData) {
    algebraHourData = {
      id: hourDataId,
      date: hourStartTimestamp,
      volumeMatic: ZERO_BD,
      volumeUSD: ZERO_BD,
      volumeUSDUntracked: ZERO_BD,
      feesUSD: ZERO_BD,
      tvlUSD: ZERO_BD,
      txCount: ZERO_BI,
    };
  }
  algebraHourData = {
    ...algebraHourData,
    tvlUSD: algebra.totalValueLockedUSD,
    txCount: algebra.txCount,
  };
  context.Analytics_AlgebraHourData.set(algebraHourData);
  return algebraHourData;
}

export async function updatePoolDayData(
  event: Evt & { srcAddress: string },
  context: Ctx,
): Promise<PoolDayData> {
  const chainId = event.chainId;
  const timestamp = Number(event.block.timestamp);
  const dId = dayId(timestamp);
  const dayStartTimestamp = dId * 86400;
  const dayPoolID = cid(chainId, `${event.srcAddress}-${dId}`);
  const pool = (await context.Analytics_Pool.get(
    cid(chainId, event.srcAddress),
  ))!;
  let poolDayData = await context.Analytics_PoolDayData.get(dayPoolID);
  if (!poolDayData) {
    poolDayData = {
      id: dayPoolID,
      date: dayStartTimestamp,
      pool_id: pool.id,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      feesToken0: ZERO_BD,
      feesToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      txCount: ZERO_BI,
      open: pool.token0Price,
      high: pool.token0Price,
      low: pool.token0Price,
      close: pool.token0Price, // never updated after create (bug 7.3)
      liquidity: ZERO_BI,
      sqrtPrice: ZERO_BI,
      token0Price: ZERO_BD,
      token1Price: ZERO_BD,
      tick: undefined,
      tvlUSD: ZERO_BD,
    };
  }

  let high = poolDayData.high;
  let low = poolDayData.low;
  if (pool.token0Price.gt(high)) high = pool.token0Price;
  if (pool.token0Price.lt(low)) low = pool.token0Price;

  poolDayData = {
    ...poolDayData,
    high,
    low,
    liquidity: pool.liquidity,
    sqrtPrice: pool.sqrtPrice,
    token0Price: pool.token0Price,
    token1Price: pool.token1Price,
    tick: pool.tick,
    tvlUSD: pool.totalValueLockedUSD,
    txCount: poolDayData.txCount + ONE_BI,
  };
  context.Analytics_PoolDayData.set(poolDayData);
  return poolDayData;
}

export async function updatePoolHourData(
  event: Evt & { srcAddress: string },
  context: Ctx,
): Promise<PoolHourData> {
  const chainId = event.chainId;
  const timestamp = Number(event.block.timestamp);
  const hIndex = hourId(timestamp);
  const hourStartUnix = hIndex * 3600;
  const hourPoolID = cid(chainId, `${event.srcAddress}-${hIndex}`);
  const pool = (await context.Analytics_Pool.get(
    cid(chainId, event.srcAddress),
  ))!;
  let poolHourData = await context.Analytics_PoolHourData.get(hourPoolID);
  if (!poolHourData) {
    poolHourData = {
      id: hourPoolID,
      periodStartUnix: hourStartUnix,
      pool_id: pool.id,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      txCount: ZERO_BI,
      feesUSD: ZERO_BD,
      open: pool.token0Price,
      high: pool.token0Price,
      low: pool.token0Price,
      close: pool.token0Price,
      liquidity: ZERO_BI,
      sqrtPrice: ZERO_BI,
      token0Price: ZERO_BD,
      token1Price: ZERO_BD,
      tick: undefined,
      tvlUSD: ZERO_BD,
    };
  }

  let high = poolHourData.high;
  let low = poolHourData.low;
  if (pool.token0Price.gt(high)) high = pool.token0Price;
  if (pool.token0Price.lt(low)) low = pool.token0Price;

  poolHourData = {
    ...poolHourData,
    high,
    low,
    liquidity: pool.liquidity,
    sqrtPrice: pool.sqrtPrice,
    token0Price: pool.token0Price,
    token1Price: pool.token1Price,
    close: pool.token0Price, // hour DOES update close
    tick: pool.tick,
    tvlUSD: pool.totalValueLockedUSD,
    txCount: poolHourData.txCount + ONE_BI,
  };
  context.Analytics_PoolHourData.set(poolHourData);
  return poolHourData;
}

export async function updateFeeHourData(
  event: Evt & { srcAddress: string },
  Fee: bigint,
  context: Ctx,
): Promise<void> {
  const timestamp = Number(event.block.timestamp);
  const hIndex = hourId(timestamp);
  const hourStartUnix = hIndex * 3600;
  const hourFeeID = cid(event.chainId, `${event.srcAddress}-${hIndex}`);
  let entity = await context.Analytics_FeeHourData.get(hourFeeID);
  if (entity) {
    entity = {
      ...entity,
      timestamp: BigInt(hourStartUnix),
      fee: entity.fee + Fee,
      changesCount: entity.changesCount + ONE_BI,
      maxFee: entity.maxFee < Fee ? Fee : entity.maxFee,
      minFee: entity.minFee > Fee ? Fee : entity.minFee,
      endFee: Fee,
    };
  } else {
    if (Fee !== ZERO_BI) {
      entity = {
        id: hourFeeID,
        timestamp: BigInt(hourStartUnix),
        fee: Fee,
        changesCount: ONE_BI,
        pool: event.srcAddress,
        startFee: Fee,
        endFee: Fee,
        maxFee: Fee,
        minFee: Fee,
      };
    } else {
      entity = {
        id: hourFeeID,
        timestamp: BigInt(hourStartUnix),
        fee: Fee,
        changesCount: ONE_BI,
        pool: event.srcAddress,
        startFee: ZERO_BI,
        endFee: ZERO_BI,
        maxFee: ZERO_BI,
        minFee: ZERO_BI,
      };
    }
  }
  context.Analytics_FeeHourData.set(entity);
}

export async function updateTokenDayData(
  token: Token,
  event: Evt,
  context: Ctx,
): Promise<TokenDayData> {
  const bundle = (await context.Analytics_Bundle.get(
    singletonId(event.chainId),
  ))!;
  const timestamp = Number(event.block.timestamp);
  const dId = dayId(timestamp);
  const dayStartTimestamp = dId * 86400;
  const tokenDayID = `${token.id}-${dId}`;
  const tokenPrice = times(token.derivedMatic, bundle.maticPriceUSD);

  let tokenDayData = await context.Analytics_TokenDayData.get(tokenDayID);
  if (!tokenDayData) {
    tokenDayData = {
      id: tokenDayID,
      date: dayStartTimestamp,
      token_id: token.id,
      volume: ZERO_BD,
      volumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      open: tokenPrice,
      high: tokenPrice,
      low: tokenPrice,
      close: tokenPrice,
      priceUSD: ZERO_BD,
      totalValueLocked: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
    };
  }

  let high = tokenDayData.high;
  let low = tokenDayData.low;
  if (tokenPrice.gt(high)) high = tokenPrice;
  if (tokenPrice.lt(low)) low = tokenPrice;

  tokenDayData = {
    ...tokenDayData,
    high,
    low,
    close: tokenPrice,
    priceUSD: times(token.derivedMatic, bundle.maticPriceUSD),
    totalValueLocked: token.totalValueLocked,
    totalValueLockedUSD: token.totalValueLockedUSD,
  };
  context.Analytics_TokenDayData.set(tokenDayData);
  return tokenDayData;
}

export async function updateTokenHourData(
  token: Token,
  event: Evt,
  context: Ctx,
): Promise<TokenHourData> {
  const bundle = (await context.Analytics_Bundle.get(
    singletonId(event.chainId),
  ))!;
  const timestamp = Number(event.block.timestamp);
  const hIndex = hourId(timestamp);
  const hourStartUnix = hIndex * 3600;
  const tokenHourID = `${token.id}-${hIndex}`;
  const tokenPrice = times(token.derivedMatic, bundle.maticPriceUSD);

  let tokenHourData = await context.Analytics_TokenHourData.get(tokenHourID);
  if (!tokenHourData) {
    tokenHourData = {
      id: tokenHourID,
      periodStartUnix: hourStartUnix,
      token_id: token.id,
      volume: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      open: tokenPrice,
      high: tokenPrice,
      low: tokenPrice,
      close: tokenPrice,
      priceUSD: ZERO_BD,
      totalValueLocked: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
    };
  }

  let high = tokenHourData.high;
  let low = tokenHourData.low;
  if (tokenPrice.gt(high)) high = tokenPrice;
  if (tokenPrice.lt(low)) low = tokenPrice;

  tokenHourData = {
    ...tokenHourData,
    high,
    low,
    close: tokenPrice,
    priceUSD: tokenPrice,
    totalValueLocked: token.totalValueLocked,
    totalValueLockedUSD: token.totalValueLockedUSD,
  };
  context.Analytics_TokenHourData.set(tokenHourData);
  return tokenHourData;
}
