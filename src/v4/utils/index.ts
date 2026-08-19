/** Shared v4 utilities. */
import { BigDecimal, ZERO_BD, ONE_BD, bd, bdDiv, bdTimes, normalize } from "./bigDecimal";
import { NULL_NATIVE_HEX_STRING, ZERO_BI } from "./constants";

export function exponentToBigDecimal(decimals: bigint): BigDecimal {
  let resultString = "1";
  for (let i = 0n; i < decimals; i++) {
    resultString += "0";
  }
  return bd(resultString);
}

export function safeDiv(amount0: BigDecimal, amount1: BigDecimal): BigDecimal {
  if (amount1.isEqualTo(ZERO_BD)) {
    return ZERO_BD;
  }
  return bdDiv(amount0, amount1);
}

export function fastExponentiation(value: BigDecimal, power: number): BigDecimal {
  if (power < 0) {
    const result = fastExponentiation(value, -power);
    return safeDiv(ONE_BD, result);
  }
  if (power === 0) return ONE_BD;
  if (power === 1) return value;

  const halfPower = Math.trunc(power / 2);
  const halfResult = fastExponentiation(value, halfPower);

  let result = bdTimes(halfResult, halfResult);
  if (power % 2 === 1) {
    result = bdTimes(result, value);
  }
  return result;
}

export function isNullNativeValue(value: string): boolean {
  return value.toLowerCase() === NULL_NATIVE_HEX_STRING;
}

export function convertTokenToDecimal(
  tokenAmount: bigint,
  exchangeDecimals: bigint,
): BigDecimal {
  const amount = bd(tokenAmount);
  if (exchangeDecimals === ZERO_BI) {
    return amount;
  }
  return bdDiv(amount, exponentToBigDecimal(exchangeDecimals));
}

export { normalize, bd };
