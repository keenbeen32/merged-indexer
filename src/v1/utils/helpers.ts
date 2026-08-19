/** Shared v1 helpers. */
import type {
  EvmOnEventContext,
  BigDecimal,
  V1_Pair as Pair,
  V1_LiquidityPosition as LiquidityPosition,
} from "envio";
import { ZERO_BD, ONE_BD, div, times, plus, exponentToBigDecimal, toBigDecimal } from "./math.js";
import { bundleId, cid } from "../config/chains.js";

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

export const ZERO_BI = 0n;
export const ONE_BI = 1n;
export { ZERO_BD, ONE_BD };
export const BI_18 = 18n;

export const UNTRACKED_PAIRS: string[] = [];

const expCache = new Map<bigint, BigDecimal>();
function exp10(decimals: bigint): BigDecimal {
  let v = expCache.get(decimals);
  if (v === undefined) {
    v = exponentToBigDecimal(decimals);
    expCache.set(decimals, v);
  }
  return v;
}

export { exponentToBigDecimal };

export function bigDecimalExp18(): BigDecimal {
  return exp10(18n);
}

export function convertEthToDecimal(eth: bigint): BigDecimal {
  return div(toBigDecimal(eth), exp10(0n));
}

export function convertTokenToDecimal(
  tokenAmount: bigint,
  exchangeDecimals: bigint,
): BigDecimal {
  if (exchangeDecimals === ZERO_BI) {
    return toBigDecimal(tokenAmount);
  }
  return div(toBigDecimal(tokenAmount), exp10(exchangeDecimals));
}

export function equalToZero(value: BigDecimal): boolean {
  const formattedVal = parseFloat(value.toFixed());
  const zero = parseFloat(ZERO_BD.toFixed());
  return zero === formattedVal;
}

export function isNullEthValue(value: string): boolean {
  return (
    value ===
    "0x0000000000000000000000000000000000000000000000000000000000000001"
  );
}

export async function createLiquidityPosition(
  context: EvmOnEventContext,
  chainId: number,
  exchange: string,
  user: string,
  currentPair: Pair,
): Promise<{ position: LiquidityPosition; pair: Pair }> {
  const id = cid(chainId, `${exchange}-${user}`);
  const existing = await context.V1_LiquidityPosition.get(id);
  if (existing !== undefined) {
    return { position: existing, pair: currentPair };
  }
  const pair = {
    ...currentPair,
    liquidityProviderCount: currentPair.liquidityProviderCount + ONE_BI,
  };
  context.V1_Pair.set(pair);
  const position = {
    id,
    liquidityTokenBalance: ZERO_BD,
    pair_id: cid(chainId, exchange),
    user_id: cid(chainId, user),
  };
  context.V1_LiquidityPosition.set(position);
  return { position, pair };
}

export async function createUser(
  context: EvmOnEventContext,
  chainId: number,
  address: string,
): Promise<void> {
  const id = cid(chainId, address);
  const user = await context.V1_User.get(id);
  if (user === undefined) {
    context.V1_User.set({ id, usdSwapped: ZERO_BD });
  }
}

export async function createLiquiditySnapshot(
  context: EvmOnEventContext,
  chainId: number,
  position: { id: string; pair_id: string; user_id: string; liquidityTokenBalance: BigDecimal },
  blockNumber: number,
  blockTimestamp: number,
  currentPair: {
    id: string;
    token0_id: string;
    token1_id: string;
    reserve0: BigDecimal;
    reserve1: BigDecimal;
    reserveUSD: BigDecimal;
    totalSupply: BigDecimal;
  },
): Promise<void> {
  const timestamp = blockTimestamp;
  const bundle = await context.V1_Bundle.get(bundleId(chainId));
  const pair = currentPair;
  if (bundle === undefined) return;
  const token0 = await context.V1_Token.get(pair.token0_id);
  const token1 = await context.V1_Token.get(pair.token1_id);
  if (token0 === undefined || token1 === undefined) return;

  const token0PriceUSD =
    token0.derivedETH != null ? times(token0.derivedETH, bundle.ethPrice) : ZERO_BD;
  const token1PriceUSD =
    token1.derivedETH != null ? times(token1.derivedETH, bundle.ethPrice) : ZERO_BD;

  context.V1_LiquidityPositionSnapshot.set({
    id: `${position.id}${timestamp.toString()}`,
    liquidityPosition_id: position.id,
    timestamp,
    block: blockNumber,
    user_id: position.user_id,
    pair_id: position.pair_id,
    token0PriceUSD,
    token1PriceUSD,
    reserve0: pair.reserve0,
    reserve1: pair.reserve1,
    reserveUSD: pair.reserveUSD,
    liquidityTokenTotalSupply: pair.totalSupply,
    liquidityTokenBalance: position.liquidityTokenBalance,
  });
}

export { div, times, plus, toBigDecimal };
