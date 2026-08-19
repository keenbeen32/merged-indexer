/** fullMath, sqrtPriceMath, tickMath and liquidityAmounts. Exact integer arithmetic. */
import { MaxUint256, ONE_BI, Q96, ZERO_BI } from "./constants";

export function mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
  const product = a * b;
  let result = product / denominator;
  if (product % denominator !== ZERO_BI) result = result + ONE_BI;
  return result;
}

export function getAmount0Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  let a = sqrtRatioAX96;
  let b = sqrtRatioBX96;
  if (a > b) {
    const temp = a;
    a = b;
    b = temp;
  }

  const numerator1 = liquidity << 96n;
  const numerator2 = b - a;

  return roundUp
    ? mulDivRoundingUp(mulDivRoundingUp(numerator1, numerator2, b), ONE_BI, a)
    : (numerator1 * numerator2) / b / a;
}

export function getAmount1Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  let a = sqrtRatioAX96;
  let b = sqrtRatioBX96;
  if (a > b) {
    const temp = a;
    a = b;
    b = temp;
  }

  const difference = b - a;
  return roundUp
    ? mulDivRoundingUp(liquidity, difference, Q96)
    : (liquidity * difference) / Q96;
}

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

const mulShift = (val: bigint, mulBy: bigint): bigint => (val * mulBy) >> 128n;

export function getSqrtRatioAtTick(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error("TICK");
  }
  const absTick = tick < 0 ? -tick : tick;

  let ratio =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  if ((absTick & 0x2) !== 0) ratio = mulShift(ratio, 0xfff97272373d413259a46990580e213an);
  if ((absTick & 0x4) !== 0) ratio = mulShift(ratio, 0xfff2e50f5f656932ef12357cf3c7fdccn);
  if ((absTick & 0x8) !== 0) ratio = mulShift(ratio, 0xffe5caca7e10e4e61c3624eaa0941cd0n);
  if ((absTick & 0x10) !== 0) ratio = mulShift(ratio, 0xffcb9843d60f6159c9db58835c926644n);
  if ((absTick & 0x20) !== 0) ratio = mulShift(ratio, 0xff973b41fa98c081472e6896dfb254c0n);
  if ((absTick & 0x40) !== 0) ratio = mulShift(ratio, 0xff2ea16466c96a3843ec78b326b52861n);
  if ((absTick & 0x80) !== 0) ratio = mulShift(ratio, 0xfe5dee046a99a2a811c461f1969c3053n);
  if ((absTick & 0x100) !== 0) ratio = mulShift(ratio, 0xfcbe86c7900a88aedcffc83b479aa3a4n);
  if ((absTick & 0x200) !== 0) ratio = mulShift(ratio, 0xf987a7253ac413176f2b074cf7815e54n);
  if ((absTick & 0x400) !== 0) ratio = mulShift(ratio, 0xf3392b0822b70005940c7a398e4b70f3n);
  if ((absTick & 0x800) !== 0) ratio = mulShift(ratio, 0xe7159475a2c29b7443b29c7fa6e889d9n);
  if ((absTick & 0x1000) !== 0) ratio = mulShift(ratio, 0xd097f3bdfd2022b8845ad8f792aa5825n);
  if ((absTick & 0x2000) !== 0) ratio = mulShift(ratio, 0xa9f746462d870fdf8a65dc1f90e061e5n);
  if ((absTick & 0x4000) !== 0) ratio = mulShift(ratio, 0x70d869a156d2a1b890bb3df62baf32f7n);
  if ((absTick & 0x8000) !== 0) ratio = mulShift(ratio, 0x31be135f97d08fd981231505542fcfa6n);
  if ((absTick & 0x10000) !== 0) ratio = mulShift(ratio, 0x9aa508b5b7a84e1c677de54f3e99bc9n);
  if ((absTick & 0x20000) !== 0) ratio = mulShift(ratio, 0x5d6af8dedb81196699c329225ee604n);
  if ((absTick & 0x40000) !== 0) ratio = mulShift(ratio, 0x2216e584f5fa1ea926041bedfe98n);
  if ((absTick & 0x80000) !== 0) ratio = mulShift(ratio, 0x48a170391f7dc42444e8fa2n);
  if (tick > 0) ratio = MaxUint256 / ratio;

  const twoPow32 = 2n ** 32n;
  return ratio / twoPow32 + (ratio % twoPow32 > 0n ? 1n : 0n);
}

export function getAmount0(
  tickLower: number,
  tickUpper: number,
  currTick: number,
  amount: bigint,
  currSqrtPriceX96: bigint,
): bigint {
  const sqrtRatioAX96 = getSqrtRatioAtTick(tickLower);
  const sqrtRatioBX96 = getSqrtRatioAtTick(tickUpper);
  const roundUp = amount > ZERO_BI;

  if (currTick < tickLower) {
    return getAmount0Delta(sqrtRatioAX96, sqrtRatioBX96, amount, roundUp);
  } else if (currTick < tickUpper) {
    return getAmount0Delta(currSqrtPriceX96, sqrtRatioBX96, amount, roundUp);
  }
  return ZERO_BI;
}

export function getAmount1(
  tickLower: number,
  tickUpper: number,
  currTick: number,
  amount: bigint,
  currSqrtPriceX96: bigint,
): bigint {
  const sqrtRatioAX96 = getSqrtRatioAtTick(tickLower);
  const sqrtRatioBX96 = getSqrtRatioAtTick(tickUpper);
  const roundUp = amount > ZERO_BI;

  if (currTick < tickLower) {
    return ZERO_BI;
  } else if (currTick < tickUpper) {
    return getAmount1Delta(sqrtRatioAX96, currSqrtPriceX96, amount, roundUp);
  }
  return getAmount1Delta(sqrtRatioAX96, sqrtRatioBX96, amount, roundUp);
}
