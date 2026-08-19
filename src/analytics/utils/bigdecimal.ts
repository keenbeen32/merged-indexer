/** BigDecimal arithmetic for the analytics handlers. */
import { BigDecimal } from "envio";
import { Q192 } from "./constants.js";

export const SIGNIFICANT_DIGITS = 34;

export const ROUNDING_MODE = BigDecimal.ROUND_HALF_UP;

BigDecimal.set({ DECIMAL_PLACES: 200, ROUNDING_MODE });

export function norm(x: BigDecimal): BigDecimal {
  if (x.isZero()) return x;
  return x.precision(SIGNIFICANT_DIGITS, ROUNDING_MODE);
}

export const ZERO_BD = new BigDecimal("0");
export const ONE_BD = new BigDecimal("1");
export const FEE_DENOMINATOR = new BigDecimal("1000000");

export function bdExact(value: string | number | bigint): BigDecimal {
  return new BigDecimal(value.toString());
}

export function bd(value: string | number | bigint): BigDecimal {
  return norm(new BigDecimal(value.toString()));
}

export const plus = (a: BigDecimal, b: BigDecimal) => norm(a.plus(b));
export const minus = (a: BigDecimal, b: BigDecimal) => norm(a.minus(b));
export const times = (a: BigDecimal, b: BigDecimal) => norm(a.times(b));
export const div = (a: BigDecimal, b: BigDecimal) => norm(a.div(b));

export function safeDiv(amount0: BigDecimal, amount1: BigDecimal): BigDecimal {
  if (amount1.isZero()) return ZERO_BD;
  return div(amount0, amount1);
}

const expCache = new Map<string, BigDecimal>();
export function exponentToBigDecimal(decimals: bigint): BigDecimal {
  const key = decimals.toString();
  const hit = expCache.get(key);
  if (hit) return hit;
  let result = ONE_BD;
  const ten = bd(10);
  for (let i = 0n; i < decimals; i++) result = times(result, ten);
  expCache.set(key, result);
  return result;
}

const powCache = new Map<string, BigDecimal>();

export function fastExponentiation(value: BigDecimal, power: number): BigDecimal {
  if (power < 0) {
    const result = fastExponentiation(value, -power);
    return safeDiv(ONE_BD, result);
  }

  if (power === 0) return ONE_BD;
  if (power === 1) return value;

  const key = `${value.toString()}^${power}`;
  const hit = powCache.get(key);
  if (hit) return hit;

  const halfPower = Math.trunc(power / 2);
  const halfResult = fastExponentiation(value, halfPower);
  let result = times(halfResult, halfResult);
  if (power % 2 === 1) {
    result = times(result, value);
  }

  powCache.set(key, result);
  return result;
}

export function convertTokenToDecimal(
  tokenAmount: bigint,
  exchangeDecimals: bigint,
): BigDecimal {
  if (exchangeDecimals === 0n) return bdExact(tokenAmount);
  return div(bdExact(tokenAmount), exponentToBigDecimal(exchangeDecimals));
}

export function priceToTokenPrices(
  price: bigint,
  token0Decimals: bigint,
  token1Decimals: bigint,
): [BigDecimal, BigDecimal] {
  const num = bdExact(price * price);
  const denom = bdExact(Q192);
  const price1 = div(
    times(div(num, denom), exponentToBigDecimal(token0Decimals)),
    exponentToBigDecimal(token1Decimals),
  );
  const price0 = safeDiv(ONE_BD, price1);
  return [price0, price1];
}
