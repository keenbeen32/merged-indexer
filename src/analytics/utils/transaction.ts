/** Load-or-create the Analytics_Transaction row for an event. */
import type { Analytics_Transaction as Transaction } from "envio";
import { cid } from "../config/chain.js";
import { ZERO_BI } from "./constants.js";

export async function loadTransaction(
  event: {
    chainId: number;
    transaction: {
      hash: string;
      from?: string;
      gasPrice?: bigint;
      gas?: bigint;
      transactionIndex?: number;
    };
    block: { number: number; timestamp: number | bigint };
  },
  context: { Analytics_Transaction: { set: (t: Transaction) => void }; log: { warn: (m: string) => void } },
): Promise<Transaction> {
  const id = cid(event.chainId, event.transaction.hash);

  let gasPrice = event.transaction.gasPrice;
  if (gasPrice === undefined) {
    context.log.warn(`tx.gasPrice missing for ${id}; defaulting to 0`);
    gasPrice = ZERO_BI;
  }

  let gasLimit = event.transaction.gas;
  if (gasLimit === undefined) {
    context.log.warn(`tx.gas missing for ${id}; defaulting to 0`);
    gasLimit = ZERO_BI;
  }
  let index = event.transaction.transactionIndex;
  if (index === undefined) {
    context.log.warn(`tx.transactionIndex missing for ${id}; defaulting to 0`);
    index = 0;
  }

  const transaction: Transaction = {
    id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    gasLimit,
    gasPrice,
    index: BigInt(index),
  };

  context.Analytics_Transaction.set(transaction);
  return transaction;
}
