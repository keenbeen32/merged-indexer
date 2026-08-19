/** LP token balanceOf, pinned to the event's block. */
import { createEffect, S } from "envio";
import { parseAbi, type Address } from "viem";
import { client } from "./client.js";

const balanceOfAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

export const getLpBalance = createEffect(
  {
    name: "getLpBalance",
    input: {
      chainId: S.number,
      pair: S.string,
      account: S.string,
      blockNumber: S.number,
    },
    output: S.bigint,
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    try {
      return (await client(input.chainId).readContract({
        address: input.pair as Address,
        abi: balanceOfAbi,
        functionName: "balanceOf",
        args: [input.account as Address],
        blockNumber: BigInt(input.blockNumber),
      })) as bigint;
    } catch (e) {
      context.log.error(
        `balanceOf reverted: chain=${input.chainId} pair=${input.pair} ` +
          `account=${input.account} block=${input.blockNumber}: ` +
          `${String(e).split("\n")[0]}`,
      );
      throw e;
    }
  },
);
