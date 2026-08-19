/** Polling block handlers, registered through indexer.onBlock. */
import { indexer } from "envio";
import type { Helper_Block as Block, Helper_LiquidityPosition as LiquidityPosition, EvmOnEventContext } from "envio";
import { getBlockMeta } from "../effects.js";
import { cid, features, gaugeStateId, isHelperChain } from "../config/chains.js";
import { ZERO_ADDRESS } from "../helpers.js";
import { createLiquidityPosition, createLiquiditySnapshot } from "./GaugeV2.js";
import { handleVeBlock } from "./VeToken.js";

type HandlerContext = EvmOnEventContext;

async function handleBlock(
  context: HandlerContext,
  chainId: number,
  blockNumber: number,
  blockHash: string,
  blockTimestamp: number,
): Promise<void> {
  const entity: Block = {
    id: cid(chainId, blockHash),
    blockNumber: BigInt(blockNumber),
    blockTimestamp: BigInt(blockTimestamp),
  };
  context.Helper_Block.set(entity);

  const stateId = gaugeStateId(chainId);
  const state = await context.Helper_GaugeState.get(stateId);
  if (state === undefined) return;

  const gauges = (await context.Helper_Gauge.getWhere({ state_id: { _eq: stateId } })).slice();
  gauges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const gauge of gauges) {
    const positions: LiquidityPosition[] = (
      await context.Helper_LiquidityPosition.getWhere({ gauge_id: { _eq: gauge.id } })
    ).slice();
    positions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const aggregate = await createLiquidityPosition(
      context,
      chainId,
      gauge.gauge,
      ZERO_ADDRESS,
    );
    await createLiquiditySnapshot(
      context,
      chainId,
      aggregate,
      blockNumber,
      blockTimestamp,
    );

    for (const position of positions) {
      await createLiquiditySnapshot(
        context,
        chainId,
        position,
        blockNumber,
        blockTimestamp,
      );
    }
  }
}

indexer.onBlock(
  {
    name: "voterGaugeSnapshots",
    where: ({ chain }) => {
      if (!isHelperChain(chain.id)) return false;
      const polling = features(chain.id).gaugePolling;
      if (polling === undefined) return false;
      return {
        block: { number: { _gte: polling.startBlock, _every: polling.every } },
      };
    },
  },
  async ({ block, context }) => {
    const chainId = context.chain.id;
    const meta = await context.effect(getBlockMeta, {
      chainId,
      blockNumber: block.number,
    });
    await handleBlock(context, chainId, block.number, meta.hash, meta.timestamp);
  },
);

indexer.onBlock(
  {
    name: "veTokenSnapshots",
    where: ({ chain }) => {
      if (!isHelperChain(chain.id)) return false;
      const polling = features(chain.id).veTokenPolling;
      if (polling === undefined) return false;
      return {
        block: { number: { _gte: polling.startBlock, _every: polling.every } },
      };
    },
  },
  async ({ block, context }) => {
    const chainId = context.chain.id;
    const meta = await context.effect(getBlockMeta, {
      chainId,
      blockNumber: block.number,
    });
    await handleVeBlock(context, chainId, block.number, meta.timestamp);
  },
);
