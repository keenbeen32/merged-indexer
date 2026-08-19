/** Analytics pricing. */
import type { Analytics_Bundle as Bundle, Analytics_Pool as Pool, Analytics_Token as Token } from "envio";
import {
  chainConfig,
  singletonId,
  referenceTokenId,
  stableCoinIds,
  stableTokenPoolId,
  whitelistTokenIds,
} from "../config/chain.js";
import {
  ONE_BD,
  ZERO_BD,
  bd,
  plus,
  times,
  safeDiv,
  priceToTokenPrices as pricesFromSqrt,
} from "./bigdecimal.js";
import { ZERO_BI } from "./constants.js";

export { priceToTokenPrices } from "./bigdecimal.js";

type Ctx = {
  Analytics_Pool: { get: (id: string) => Promise<Pool | undefined> };
  Analytics_Token: { get: (id: string) => Promise<Token | undefined> };
  Analytics_Bundle: { get: (id: string) => Promise<Bundle | undefined> };
};

export async function getEthPriceInUSD(
  chainId: number,
  context: Ctx,
): Promise<typeof ZERO_BD> {
  const usdcPool = await context.Analytics_Pool.get(stableTokenPoolId(chainId));
  if (usdcPool !== undefined) {
    if (usdcPool.token0_id === referenceTokenId(chainId)) {
      return usdcPool.token1Price;
    }
    return usdcPool.token0Price;
  }
  return ZERO_BD;
}

export async function findEthPerToken(
  chainId: number,
  token: Token,
  context: Ctx,
): Promise<typeof ZERO_BD> {
  if (token.id === referenceTokenId(chainId)) return ONE_BD;

  const whiteList = token.whitelistPools;
  let largestLiquidityNative = ZERO_BD;
  let priceSoFar = ZERO_BD;
  const bundle = await context.Analytics_Bundle.get(singletonId(chainId));

  if (stableCoinIds(chainId).has(token.id)) {
    priceSoFar = safeDiv(ONE_BD, bundle!.maticPriceUSD);
  } else {
    for (let i = 0; i < whiteList.length; ++i) {
      const poolAddress = whiteList[i]!;
      const pool = (await context.Analytics_Pool.get(poolAddress))!;
      if (pool.liquidity > ZERO_BI) {
        if (pool.token0_id === token.id) {
          const token1 = (await context.Analytics_Token.get(pool.token1_id))!;
          const nativeLocked = times(pool.totalValueLockedToken1, token1.derivedMatic);
          const minLocked = bd(chainConfig(chainId).minimumNativeLocked);
          if (
            nativeLocked.gt(largestLiquidityNative) &&
            nativeLocked.gt(minLocked)
          ) {
            largestLiquidityNative = nativeLocked;
            priceSoFar = times(pool.token1Price, token1.derivedMatic);
          }
        }
        if (pool.token1_id === token.id) {
          const token0 = (await context.Analytics_Token.get(pool.token0_id))!;
          const nativeLocked = times(pool.totalValueLockedToken0, token0.derivedMatic);
          const minLocked = bd(chainConfig(chainId).minimumNativeLocked);
          if (
            nativeLocked.gt(largestLiquidityNative) &&
            nativeLocked.gt(minLocked)
          ) {
            largestLiquidityNative = nativeLocked;
            priceSoFar = times(pool.token0Price, token0.derivedMatic);
          }
        }
      }
    }
  }
  return priceSoFar;
}

export async function getTrackedAmountUSD(
  chainId: number,
  tokenAmount0: typeof ZERO_BD,
  token0: Token,
  tokenAmount1: typeof ZERO_BD,
  token1: Token,
  context: Ctx,
): Promise<typeof ZERO_BD> {
  const bundle = (await context.Analytics_Bundle.get(singletonId(chainId)))!;
  const price0USD = times(token0.derivedMatic, bundle.maticPriceUSD);
  const price1USD = times(token1.derivedMatic, bundle.maticPriceUSD);

  const whitelisted = whitelistTokenIds(chainId);
  const has0 = whitelisted.has(token0.id);
  const has1 = whitelisted.has(token1.id);

  if (has0 && has1) {
    return plus(times(tokenAmount0, price0USD), times(tokenAmount1, price1USD));
  }
  if (has0 && !has1) {
    return times(times(tokenAmount0, price0USD), bd(2));
  }
  if (!has0 && has1) {
    return times(times(tokenAmount1, price1USD), bd(2));
  }
  return ZERO_BD;
}

export function priceToTokenPricesFromTokens(
  price: bigint,
  token0: Token,
  token1: Token,
) {
  return pricesFromSqrt(price, token0.decimals, token1.decimals);
}
