/** Shared entity helpers: loadTransaction and createTick. */
import type { V4_Tick as Tick, V4_Transaction as Transaction } from "envio";
import { bd, ONE_BD, ZERO_BD } from "./bigDecimal";
import { ZERO_BI } from "./constants";
import { fastExponentiation, safeDiv } from "./index";
import { entityId, toLowerHex } from "./id";

type Ctx = any;

type TxEvent = {
  chainId: number;
  block: { number: number; timestamp: number };
  transaction: { hash: string; gasPrice?: bigint };
};

export function loadTransaction(context: Ctx, event: TxEvent): Transaction {
  const transaction: Transaction = {
    id: entityId(event.chainId, toLowerHex(event.transaction.hash)),
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    gasUsed: ZERO_BI, // B-7
    gasPrice: event.transaction.gasPrice ?? ZERO_BI,
  };
  context.V4_Transaction.set(transaction);
  return transaction;
}

export function createTick(
  tickId: string,
  tickIdx: number,
  poolId: string,
  blockNumber: number,
  blockTimestamp: number,
): Tick {
  const price0 = fastExponentiation(bd("1.0001"), tickIdx);
  return {
    id: tickId,
    tickIdx: BigInt(tickIdx),
    pool_id: poolId,
    poolAddress: poolId.replace(/^\d+-/, ""),
    createdAtTimestamp: BigInt(blockTimestamp),
    createdAtBlockNumber: BigInt(blockNumber),
    liquidityGross: ZERO_BI,
    liquidityNet: ZERO_BI,
    price0,
    price1: safeDiv(ONE_BD, price0),
  };
}
