/** BigDecimal arithmetic for the v1 handlers. */
import { BigDecimal } from "envio";

const MAX_SIGNIFICANT_DIGITS = 34;
const DIVISION_PRECISION = 100;
const ROUND_HALF_UP = 4;

BigDecimal.set({
  DECIMAL_PLACES: 400,
  ROUNDING_MODE: ROUND_HALF_UP,
  POW_PRECISION: 100,
  EXPONENTIAL_AT: [-1e9, 1e9],
});

export function norm(x: BigDecimal): BigDecimal {
  return x.precision(MAX_SIGNIFICANT_DIGITS, ROUND_HALF_UP);
}

export const ZERO_BD: BigDecimal = new BigDecimal(0);
export const ONE_BD: BigDecimal = new BigDecimal(1);

export function plus(a: BigDecimal, b: BigDecimal): BigDecimal {
  return norm(a.plus(b));
}

export function minus(a: BigDecimal, b: BigDecimal): BigDecimal {
  return norm(a.minus(b));
}

export function times(a: BigDecimal, b: BigDecimal): BigDecimal {
  return norm(a.times(b));
}

export function div(a: BigDecimal, b: BigDecimal): BigDecimal {
  if (b.isZero()) {
    throw new Error(
      `BigDecimal division by zero (${a.toFixed()} / 0)`,
    );
  }
  const quotient = a.div(b).precision(DIVISION_PRECISION, ROUND_HALF_UP);
  return norm(quotient);
}

export function toBigDecimal(x: bigint): BigDecimal {
  return norm(new BigDecimal(x.toString()));
}

export function exponentToBigDecimal(decimals: bigint): BigDecimal {
  let bd = ONE_BD;
  for (let i = 0n; i < decimals; i++) {
    bd = times(bd, TEN_BD);
  }
  return bd;
}
const TEN_BD: BigDecimal = new BigDecimal(10);
