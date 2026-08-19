/** BigDecimal arithmetic for the v4 handlers. */
import { BigDecimal } from "envio";

BigDecimal.set({
  DECIMAL_PLACES: 300,
  ROUNDING_MODE: BigDecimal.ROUND_HALF_UP,
  EXPONENTIAL_AT: [-1e9, 1e9],
  RANGE: [-1e9, 1e9],
});

export const MAX_SIGNIFICANT_DIGITS = 34;

export const ZERO_BD = new BigDecimal(0);
export const ONE_BD = new BigDecimal(1);

export function normalize(value: BigDecimal): BigDecimal {
  if (value.isZero()) return ZERO_BD;
  return value.precision(MAX_SIGNIFICANT_DIGITS, BigDecimal.ROUND_HALF_UP);
}

export function bd(value: string | number | bigint): BigDecimal {
  return normalize(new BigDecimal(value.toString()));
}

export const bdPlus = (a: BigDecimal, b: BigDecimal): BigDecimal => normalize(a.plus(b));
export const bdMinus = (a: BigDecimal, b: BigDecimal): BigDecimal => normalize(a.minus(b));
export const bdTimes = (a: BigDecimal, b: BigDecimal): BigDecimal => normalize(a.times(b));

export const bdDiv = (a: BigDecimal, b: BigDecimal): BigDecimal => normalize(a.div(b));

export const bdFromBigInt = (value: bigint): BigDecimal => bd(value);

export { BigDecimal };
