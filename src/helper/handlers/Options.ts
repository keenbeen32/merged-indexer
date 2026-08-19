/** Options exercise handlers. */
import { indexer } from "envio";
import type { Helper_Exercise as Exercise, Helper_ExerciseVe as ExerciseVe } from "envio";
import { cid } from "../config/chains.js";

indexer.onEvent(
  { contract: "Options", event: "Exercise" },
  async ({ event, context }) => {
    const entity: Exercise = {
      id: cid(event.chainId, `${event.transaction.hash}-${event.logIndex}`),
      sender: event.params.sender,
      recipient: event.params.recipient,
      amount: event.params.amount,
      paymentAmount: event.params.paymentAmount,
      timestamp: BigInt(event.block.timestamp),
      blockNumber: BigInt(event.block.number),
      transactionHash: event.transaction.hash,
    };
    context.Helper_Exercise.set(entity);
  },
);

indexer.onEvent(
  { contract: "Options", event: "ExerciseVe" },
  async ({ event, context }) => {
    const entity: ExerciseVe = {
      id: cid(event.chainId, `${event.transaction.hash}-${event.logIndex}`),
      sender: event.params.sender,
      recipient: event.params.recipient,
      amount: event.params.amount,
      paymentAmount: event.params.paymentAmount,
      nftId: event.params.nftId,
      timestamp: BigInt(event.block.timestamp),
      blockNumber: BigInt(event.block.number),
      transactionHash: event.transaction.hash,
    };
    context.Helper_ExerciseVe.set(entity);
  },
);
