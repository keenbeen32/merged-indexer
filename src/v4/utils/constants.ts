/** v4 constants. */
import { ZERO_BD, ONE_BD } from "./bigDecimal";

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
export const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
export const NULL_NATIVE_HEX_STRING =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

export const ZERO_BI = 0n;
export const ONE_BI = 1n;
export { ZERO_BD, ONE_BD };

export const Q96 = 2n ** 96n;
export const Q192 = 2n ** 192n;

export const MaxUint256 = 2n ** 256n - 1n;

export const DYNAMIC_LP_FEE_FLAG = 8388608n;

export const POSM_CACHE_MAX_BLOCK_AGE = 250n;
export const POSM_MATCH_NOT_FOUND = -1;
export const POSM_MATCH_AMBIGUOUS = -2;
