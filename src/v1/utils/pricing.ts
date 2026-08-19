/** Native and token pricing for v1. */
import { BigDecimal } from "envio";
import type { EvmOnEventContext } from "envio";
import { ZERO_BD, ONE_BD, plus, times, div } from "./math.js";
import { UNTRACKED_PAIRS } from "./helpers.js";
import { chainConfig, cid, stripCid, whitelistIds } from "../config/chains.js";

type PairLike = {
  id: string;
  token0_id: string;
  token1_id: string;
  token0Price: BigDecimal;
  token1Price: BigDecimal;
  reserve0: BigDecimal;
  reserve1: BigDecimal;
  reserveETH: BigDecimal;
};

async function loadPair(
  context: EvmOnEventContext,
  id: string,
  current?: PairLike,
): Promise<PairLike | undefined> {
  if (current !== undefined && current.id === id) return current;
  return await context.V1_Pair.get(id);
}

export function pairLookupId(
  chainId: number,
  tokenA: string,
  tokenB: string,
  stable: boolean,
): string {
  return cid(chainId, `${tokenA}-${tokenB}-${stable}`);
}

function refPrice(pair: PairLike, wethIsToken0: boolean): BigDecimal {
  return wethIsToken0 ? pair.token1Price : pair.token0Price;
}

function refReserve(pair: PairLike, wethIsToken0: boolean): BigDecimal {
  return wethIsToken0 ? pair.reserve0 : pair.reserve1;
}

export async function getEthPriceInUSD(
  context: EvmOnEventContext,
  chainId: number,
  blockNumber: number,
  current?: PairLike,
): Promise<BigDecimal> {
  const cfg = chainConfig(chainId);

  if (
    cfg.preSwitchPair !== undefined &&
    cfg.switchBlock !== undefined &&
    blockNumber < cfg.switchBlock
  ) {
    const pre = await loadPair(
      context,
      cid(chainId, cfg.preSwitchPair.address),
      current,
    );
    return pre !== undefined
      ? refPrice(pre, cfg.preSwitchPair.wethIsToken0)
      : ZERO_BD;
  }

  const usdcPair =
    cfg.usdcWethPair !== undefined
      ? await loadPair(context, cid(chainId, cfg.usdcWethPair.address), current)
      : undefined;
  const usdtPair =
    cfg.usdtWethPair !== undefined
      ? await loadPair(context, cid(chainId, cfg.usdtWethPair.address), current)
      : undefined;

  if (usdtPair !== undefined && usdcPair !== undefined) {
    const usdtSide = cfg.usdtWethPair!.wethIsToken0;
    const usdcSide = cfg.usdcWethPair!.wethIsToken0;
    const usdtReserve = refReserve(usdtPair, usdtSide);
    const usdcReserve = refReserve(usdcPair, usdcSide);
    const totalLiquidityETH = plus(usdtReserve, usdcReserve);
    const usdtWeight = div(usdtReserve, totalLiquidityETH);
    const usdcWeight = div(usdcReserve, totalLiquidityETH);
    return plus(
      times(refPrice(usdtPair, usdtSide), usdtWeight),
      times(refPrice(usdcPair, usdcSide), usdcWeight),
    );
  } else if (usdtPair !== undefined) {
    return refPrice(usdtPair, cfg.usdtWethPair!.wethIsToken0);
  } else if (usdcPair !== undefined) {
    return refPrice(usdcPair, cfg.usdcWethPair!.wethIsToken0);
  } else {
    return ZERO_BD;
  }
}

const MINIMUM_VOLATILE_LIQUIDITY_THRESHOLD_ETH = new BigDecimal("0.1");
const MINIMUM_STABLE_LIQUIDITY_THRESHOLD_ETH = new BigDecimal("0.2");

export async function findEthPerToken(
  context: EvmOnEventContext,
  chainId: number,
  token: { id: string },
  current?: PairLike,
): Promise<BigDecimal> {
  const cfg = chainConfig(chainId);
  if (token.id === cid(chainId, cfg.wethAddress)) {
    return ONE_BD;
  }
  const tokenAddr = stripCid(token.id);
  for (let i = 0; i < cfg.whitelistLookup.length; ++i) {
    const wl = cfg.whitelistLookup[i]!;
    const volatile = await context.V1_PairLookup.get(
      pairLookupId(chainId, tokenAddr, wl, false),
    );
    if (volatile !== undefined) {
      const pair = await loadPair(context, volatile.pair, current);
      if (pair !== undefined) {
        if (
          pair.token0_id === token.id &&
          pair.reserveETH.gt(MINIMUM_VOLATILE_LIQUIDITY_THRESHOLD_ETH)
        ) {
          const token1 = await context.V1_Token.get(pair.token1_id);
          if (token1 !== undefined) {
            return times(pair.token1Price, token1.derivedETH ?? ZERO_BD);
          }
        }
        if (
          pair.token1_id === token.id &&
          pair.reserveETH.gt(MINIMUM_VOLATILE_LIQUIDITY_THRESHOLD_ETH)
        ) {
          const token0 = await context.V1_Token.get(pair.token0_id);
          if (token0 !== undefined) {
            return times(pair.token0Price, token0.derivedETH ?? ZERO_BD);
          }
        }
      }
    }
    const stable = await context.V1_PairLookup.get(
      pairLookupId(chainId, tokenAddr, wl, true),
    );
    if (stable !== undefined) {
      const pair = await loadPair(context, stable.pair, current);
      if (pair !== undefined) {
        if (
          pair.token0_id === token.id &&
          pair.reserveETH.gt(MINIMUM_STABLE_LIQUIDITY_THRESHOLD_ETH)
        ) {
          const token1 = await context.V1_Token.get(pair.token1_id);
          if (token1 !== undefined) {
            return token1.derivedETH ?? ZERO_BD; // return Eth per token 1
          }
        }
        if (
          pair.token1_id === token.id &&
          pair.reserveETH.gt(MINIMUM_STABLE_LIQUIDITY_THRESHOLD_ETH)
        ) {
          const token0 = await context.V1_Token.get(pair.token0_id);
          if (token0 !== undefined) {
            return token0.derivedETH ?? ZERO_BD; // return ETH per token 0
          }
        }
      }
    }
  }
  return ZERO_BD; // nothing was found return 0
}

const TWO_BD = new BigDecimal("2");

export function getTrackedVolumeUSD(
  chainId: number,
  ethPrice: BigDecimal,
  tokenAmount0: BigDecimal,
  token0: { id: string; derivedETH: BigDecimal | undefined },
  tokenAmount1: BigDecimal,
  token1: { id: string; derivedETH: BigDecimal | undefined },
  pair: { id: string },
): BigDecimal {
  let price0 = ZERO_BD;
  let price1 = ZERO_BD;
  if (token0.derivedETH != null) price0 = times(token0.derivedETH, ethPrice);
  if (token1.derivedETH != null) price1 = times(token1.derivedETH, ethPrice);

  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD;
  }

  const wl = whitelistIds(chainId);
  const w0 = wl.has(token0.id);
  const w1 = wl.has(token1.id);

  if (w0 && w1) {
    return div(plus(times(tokenAmount0, price0), times(tokenAmount1, price1)), TWO_BD);
  }

  if (w0 && !w1) {
    return times(tokenAmount0, price0);
  }

  if (!w0 && w1) {
    return times(tokenAmount1, price1);
  }

  return ZERO_BD;
}

export function getTrackedLiquidityUSD(
  chainId: number,
  ethPrice: BigDecimal,
  tokenAmount0: BigDecimal,
  token0: { id: string; derivedETH: BigDecimal | undefined },
  tokenAmount1: BigDecimal,
  token1: { id: string; derivedETH: BigDecimal | undefined },
): BigDecimal {
  let price0 = ZERO_BD;
  let price1 = ZERO_BD;
  if (token0.derivedETH != null) price0 = times(token0.derivedETH, ethPrice);
  if (token1.derivedETH != null) price1 = times(token1.derivedETH, ethPrice);

  const wl = whitelistIds(chainId);
  const w0 = wl.has(token0.id);
  const w1 = wl.has(token1.id);

  if (w0 && w1) {
    return plus(times(tokenAmount0, price0), times(tokenAmount1, price1));
  }

  if (w0 && !w1) {
    return times(times(tokenAmount0, price0), TWO_BD);
  }

  if (!w0 && w1) {
    return times(times(tokenAmount1, price1), TWO_BD);
  }

  return ZERO_BD;
}
