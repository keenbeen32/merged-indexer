/** v1 day and hour buckets. */
import type { EvmOnEventContext, BigDecimal } from "envio";
import { ZERO_BD } from "./math.js";
import { ONE_BI, ZERO_BI, times } from "./helpers.js";
import { bundleId, cid, factoryId } from "../config/chains.js";

export type DayUpdateEvent = {
  chainId: number;
  srcAddress: string;
  block: { number: number; timestamp: number };
};

function dayId(timestamp: number): number {
  return Math.floor(timestamp / 86400);
}
function hourIndex(timestamp: number): number {
  return Math.floor(timestamp / 3600);
}

export async function updateDayData(
  context: EvmOnEventContext,
  event: DayUpdateEvent,
  currentFactory?: {
    totalLiquidityUSD: BigDecimal;
    totalLiquidityETH: BigDecimal;
    txCount: bigint;
  },
) {
  const chainId = event.chainId;
  const factory =
    currentFactory ?? (await context.V1_Factory.get(factoryId(chainId)));
  const timestamp = event.block.timestamp;
  const id = dayId(timestamp);
  const dayStartTimestamp = id * 86400;
  const dayDataId = cid(chainId, id.toString());

  const existing = await context.V1_DayData.get(dayDataId);
  let dayData = existing ?? {
    id: dayDataId,
    date: dayStartTimestamp,
    dailyVolumeUSD: ZERO_BD,
    dailyVolumeETH: ZERO_BD,
    totalVolumeUSD: ZERO_BD,
    totalVolumeETH: ZERO_BD,
    dailyVolumeUntracked: ZERO_BD,
    totalLiquidityUSD: ZERO_BD,
    totalLiquidityETH: ZERO_BD,
    txCount: ZERO_BI,
  };

  if (factory !== undefined) {
    dayData = {
      ...dayData,
      totalLiquidityUSD: factory.totalLiquidityUSD,
      totalLiquidityETH: factory.totalLiquidityETH,
      txCount: factory.txCount,
    };
  }

  context.V1_DayData.set(dayData);
  return dayData;
}

export async function updatePairDayData(
  context: EvmOnEventContext,
  event: DayUpdateEvent,
) {
  const chainId = event.chainId;
  const timestamp = event.block.timestamp;
  const id = dayId(timestamp);
  const dayStartTimestamp = id * 86400;
  const dayPairID = cid(chainId, `${event.srcAddress}-${id}`);
  const pair = await context.V1_Pair.get(cid(chainId, event.srcAddress));

  const existing = await context.V1_PairDayData.get(dayPairID);
  let pairDayData =
    existing ??
    ({
      id: dayPairID,
      date: dayStartTimestamp,
      pairAddress: event.srcAddress,
      dailyVolumeToken0: ZERO_BD,
      dailyVolumeToken1: ZERO_BD,
      dailyVolumeUSD: ZERO_BD,
      dailyTxns: ZERO_BI,
      token0_id: pair !== undefined ? pair.token0_id : "",
      token1_id: pair !== undefined ? pair.token1_id : "",
      reserve0: ZERO_BD,
      reserve1: ZERO_BD,
      totalSupply: ZERO_BD,
      reserveUSD: ZERO_BD,
    } as const);

  if (pair !== undefined) {
    pairDayData = {
      ...pairDayData,
      totalSupply: pair.totalSupply,
      reserve0: pair.reserve0,
      reserve1: pair.reserve1,
      reserveUSD: pair.reserveUSD,
    };
  }

  pairDayData = { ...pairDayData, dailyTxns: pairDayData.dailyTxns + ONE_BI };
  context.V1_PairDayData.set(pairDayData);
  return pairDayData;
}

export async function updatePairHourData(
  context: EvmOnEventContext,
  event: DayUpdateEvent,
) {
  const chainId = event.chainId;
  const timestamp = event.block.timestamp;
  const idx = hourIndex(timestamp);
  const hourStartUnix = idx * 3600;
  const hourPairID = cid(chainId, `${event.srcAddress}-${idx}`);
  const pairId = cid(chainId, event.srcAddress);
  const pair = await context.V1_Pair.get(pairId);

  const existing = await context.V1_PairHourData.get(hourPairID);
  let pairHourData =
    existing ??
    {
      id: hourPairID,
      hourStartUnix,
      pair_id: pairId,
      hourlyVolumeToken0: ZERO_BD,
      hourlyVolumeToken1: ZERO_BD,
      hourlyVolumeUSD: ZERO_BD,
      hourlyTxns: ZERO_BI,
      reserve0: ZERO_BD,
      reserve1: ZERO_BD,
      totalSupply: ZERO_BD,
      reserveUSD: ZERO_BD,
    };

  if (pair !== undefined) {
    pairHourData = {
      ...pairHourData,
      totalSupply: pair.totalSupply,
      reserve0: pair.reserve0,
      reserve1: pair.reserve1,
      reserveUSD: pair.reserveUSD,
    };
  }

  pairHourData = { ...pairHourData, hourlyTxns: pairHourData.hourlyTxns + ONE_BI };
  context.V1_PairHourData.set(pairHourData);
  return pairHourData;
}

export async function updateTokenDayData(
  context: EvmOnEventContext,
  token: { id: string; totalLiquidity: BigDecimal; derivedETH: BigDecimal | undefined },
  event: DayUpdateEvent,
) {
  const chainId = event.chainId;
  const bundle = await context.V1_Bundle.get(bundleId(chainId));
  const timestamp = event.block.timestamp;
  const id = dayId(timestamp);
  const dayStartTimestamp = id * 86400;
  const tokenDayID = `${token.id}-${id}`;

  const existing = await context.V1_TokenDayData.get(tokenDayID);
  let tokenDayData =
    existing ??
    {
      id: tokenDayID,
      date: dayStartTimestamp,
      token_id: token.id,
      dailyVolumeToken: ZERO_BD,
      dailyVolumeETH: ZERO_BD,
      dailyVolumeUSD: ZERO_BD,
      dailyTxns: ZERO_BI,
      totalLiquidityUSD: ZERO_BD,
      totalLiquidityToken: ZERO_BD,
      totalLiquidityETH: ZERO_BD,
      priceUSD: ZERO_BD,
    };

  const priceUSD =
    token.derivedETH != null && bundle !== undefined
      ? times(token.derivedETH, bundle.ethPrice)
      : tokenDayData.priceUSD;

  const totalLiquidityETH = times(token.totalLiquidity, token.derivedETH ?? ZERO_BD);

  const totalLiquidityUSD =
    token.derivedETH != null && bundle !== undefined
      ? times(totalLiquidityETH, bundle.ethPrice)
      : tokenDayData.totalLiquidityUSD;

  tokenDayData = {
    ...tokenDayData,
    priceUSD,
    totalLiquidityToken: token.totalLiquidity,
    totalLiquidityETH,
    totalLiquidityUSD,
    dailyTxns: tokenDayData.dailyTxns + ONE_BI,
  };

  context.V1_TokenDayData.set(tokenDayData);
  return tokenDayData;
}
