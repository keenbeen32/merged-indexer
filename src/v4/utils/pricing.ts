/** v4 pricing. */
import type { V4_Pool as Pool, V4_Token as Token } from "envio";
import { BigDecimal, ZERO_BD, ONE_BD, bd, bdPlus, bdTimes, bdDiv } from "./bigDecimal";
import { ADDRESS_ZERO, Q192, ZERO_BI } from "./constants";
import { exponentToBigDecimal, safeDiv } from "./index";
import { entityId, stripChainPrefix } from "./id";
import type { NativeTokenDetails } from "./chains";

type Ctx = {
  V4_Pool: { get: (id: string) => Promise<Pool | undefined> };
  V4_Token: { get: (id: string) => Promise<Token | undefined> };
};

export function sqrtPriceX96ToTokenPrices(
  sqrtPriceX96: bigint,
  token0: Token,
  token1: Token,
  nativeTokenDetails: NativeTokenDetails,
): [BigDecimal, BigDecimal] {
  const token0Decimals =
    stripChainPrefix(token0.id) === ADDRESS_ZERO ? nativeTokenDetails.decimals : token0.decimals;
  const token1Decimals =
    stripChainPrefix(token1.id) === ADDRESS_ZERO ? nativeTokenDetails.decimals : token1.decimals;

  const num = bd(sqrtPriceX96 * sqrtPriceX96);
  const denom = bd(Q192);

  const price1 = bdDiv(
    bdTimes(bdDiv(num, denom), exponentToBigDecimal(token0Decimals)),
    exponentToBigDecimal(token1Decimals),
  );
  const price0 = safeDiv(ONE_BD, price1);

  return [price0, price1];
}

export async function getNativePriceInUSD(
  context: Ctx,
  chainId: number,
  stablecoinWrappedNativePoolId: string,
  stablecoinIsToken0: boolean,
): Promise<BigDecimal> {
  const pool = await context.V4_Pool.get(entityId(chainId, stablecoinWrappedNativePoolId));
  if (pool !== undefined) {
    return stablecoinIsToken0 ? pool.token0Price : pool.token1Price;
  }
  return ZERO_BD;
}

export async function findNativePerToken(
  context: Ctx,
  token: Token,
  bundleNativePriceUSD: BigDecimal,
  wrappedNativeAddress: string,
  stablecoinAddresses: string[],
  minimumNativeLocked: BigDecimal,
): Promise<BigDecimal> {
  const tokenAddress = stripChainPrefix(token.id);
  if (tokenAddress === wrappedNativeAddress || tokenAddress === ADDRESS_ZERO) {
    return ONE_BD;
  }

  const whiteList = token.whitelistPools;
  let largestLiquidityETH = ZERO_BD;
  let priceSoFar = ZERO_BD;

  if (stablecoinAddresses.includes(tokenAddress)) {
    priceSoFar = safeDiv(ONE_BD, bundleNativePriceUSD);
  } else {
    for (let i = 0; i < whiteList.length; ++i) {
      const poolAddress = whiteList[i]!;
      const pool = await context.V4_Pool.get(poolAddress);
      if (pool === undefined) continue;
      if (!(pool.liquidity > ZERO_BI)) continue;

      if (pool.token0_id === token.id) {
        const token1 = await context.V4_Token.get(pool.token1_id);
        if (token1 !== undefined) {
          const ethLocked = bdTimes(pool.totalValueLockedToken1, token1.derivedNative);
          if (
            ethLocked.isGreaterThan(largestLiquidityETH) &&
            ethLocked.isGreaterThan(minimumNativeLocked)
          ) {
            largestLiquidityETH = ethLocked;
            priceSoFar = bdTimes(pool.token1Price, token1.derivedNative);
          }
        }
      }
      if (pool.token1_id === token.id) {
        const token0 = await context.V4_Token.get(pool.token0_id);
        if (token0 !== undefined) {
          const ethLocked = bdTimes(pool.totalValueLockedToken0, token0.derivedNative);
          if (
            ethLocked.isGreaterThan(largestLiquidityETH) &&
            ethLocked.isGreaterThan(minimumNativeLocked)
          ) {
            largestLiquidityETH = ethLocked;
            priceSoFar = bdTimes(pool.token0Price, token0.derivedNative);
          }
        }
      }
    }
  }
  return priceSoFar;
}

export function getTrackedAmountUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  whitelistTokens: string[],
  bundleNativePriceUSD: BigDecimal,
): BigDecimal {
  const price0USD = bdTimes(token0.derivedNative, bundleNativePriceUSD);
  const price1USD = bdTimes(token1.derivedNative, bundleNativePriceUSD);

  const addr0 = stripChainPrefix(token0.id);
  const addr1 = stripChainPrefix(token1.id);
  const in0 = whitelistTokens.includes(addr0);
  const in1 = whitelistTokens.includes(addr1);

  if (in0 && in1) {
    return bdPlus(bdTimes(tokenAmount0, price0USD), bdTimes(tokenAmount1, price1USD));
  }
  if (in0 && !in1) {
    return bdTimes(bdTimes(tokenAmount0, price0USD), bd("2"));
  }
  if (!in0 && in1) {
    return bdTimes(bdTimes(tokenAmount1, price1USD), bd("2"));
  }
  return ZERO_BD;
}

export function calculateAmountUSD(
  amount0: BigDecimal,
  amount1: BigDecimal,
  token0DerivedETH: BigDecimal,
  token1DerivedETH: BigDecimal,
  ethPriceUSD: BigDecimal,
): BigDecimal {
  const a = bdTimes(amount0, bdTimes(token0DerivedETH, ethPriceUSD));
  const b = bdTimes(amount1, bdTimes(token1DerivedETH, ethPriceUSD));
  return bdPlus(a, b);
}
