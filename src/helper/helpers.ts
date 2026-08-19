/** Shared helper constants and utilities. */
import type { BigDecimal } from "envio";
import {
  ZERO_BD,
  bdDiv,
  bdMinus,
  bdPlus,
  bdTimes,
  norm,
  toBigDecimal,
} from "./bigdecimal.js";

export const ZERO_BI = 0n;
export const ONE_BI = 1n;
export const BI_18 = 18n;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function concatI32(hexPrefix: string, value: number): string {
  const bytes = [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
  return hexPrefix + bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function exponentToBigDecimal(decimals: bigint): BigDecimal {
  let bd = toBigDecimal(1n);
  const ten = toBigDecimal(10n);
  for (let i = ZERO_BI; i < decimals; i = i + ONE_BI) {
    bd = bdTimes(bd, ten);
  }
  return bd;
}

export function convertTokenToDecimal(
  tokenAmount: bigint,
  exchangeDecimals: bigint,
): BigDecimal {
  if (exchangeDecimals === ZERO_BI) {
    return toBigDecimal(tokenAmount);
  }
  return bdDiv(toBigDecimal(tokenAmount), exponentToBigDecimal(exchangeDecimals));
}

export { ZERO_BD, bdDiv, bdMinus, bdPlus, bdTimes, norm, toBigDecimal };
