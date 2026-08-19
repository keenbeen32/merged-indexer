/** BigDecimal arithmetic for the helper handlers. */
import { BigDecimal } from "envio";

const SIGNIFICANT_DIGITS = 34;

BigDecimal.set({
  DECIMAL_PLACES: 200,
  ROUNDING_MODE: BigDecimal.ROUND_HALF_UP,
  EXPONENTIAL_AT: [-1e9, 1e9],
});

export const ZERO_BD = new BigDecimal(0);

export function norm(x: BigDecimal): BigDecimal {
  return x.precision(SIGNIFICANT_DIGITS, BigDecimal.ROUND_HALF_UP);
}

export function toBigDecimal(x: bigint): BigDecimal {
  return norm(new BigDecimal(x.toString()));
}

export const bdPlus = (a: BigDecimal, b: BigDecimal): BigDecimal => a.plus(b);
export const bdMinus = (a: BigDecimal, b: BigDecimal): BigDecimal => a.minus(b);
export const bdTimes = (a: BigDecimal, b: BigDecimal): BigDecimal => norm(a.times(b));

export function bdDiv(a: BigDecimal, b: BigDecimal): BigDecimal {
  if (b.isZero()) {
    throw new Error(
      `BigDecimal division by zero (${a.toFixed()} / 0)`,
    );
  }
  return norm(a.dividedBy(b));
}
