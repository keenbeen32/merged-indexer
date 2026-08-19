/** Gauge creation handler. */
import "./Blocks.js";
import { indexer } from "envio";
import type { Helper_Gauge as Gauge, Helper_GaugeCreated as GaugeCreated, Helper_Token as Token } from "envio";
import { getPairTokens, getTokenMetadata } from "../effects.js";
import { cid, features, gaugeStateId } from "../config/chains.js";
import { ZERO_ADDRESS, ZERO_BI, concatI32 } from "../helpers.js";
import { createLiquidityPosition, createLiquiditySnapshot, createUser } from "./GaugeV2.js";

indexer.contractRegister(
  { contract: "VoterV5", event: "GaugeCreated" },
  async ({ event, context }) => {
    context.chain.GaugeV2.add(event.params.gauge);
  },
);

indexer.onEvent(
  { contract: "VoterV5", event: "GaugeCreated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const { vePoints } = features(chainId);

    let stateId: string | undefined;
    if (vePoints) {
      stateId = gaugeStateId(chainId);
      const state = await context.Helper_GaugeState.get(stateId);
      if (state === undefined) {
        context.Helper_GaugeState.set({ id: stateId });
      }
    }

    const gaugeEvent: GaugeCreated = {
      id: cid(chainId, concatI32(event.transaction.hash, event.logIndex)),
      gauge: event.params.gauge,
      creator: event.params.creator,
      internalBribe: event.params.internal_bribe,
      externalBribe: event.params.external_bribe,
      pool: event.params.pool,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    };
    context.Helper_GaugeCreated.set(gaugeEvent);

    const { token0: token0Address, token1: token1Address } = await context.effect(
      getPairTokens,
      {
        chainId,
        pool: event.params.pool,
        blockNumber: event.block.number,
      },
    );
    const token0Id = cid(chainId, token0Address);
    const token1Id = cid(chainId, token1Address);

    const [existingToken0, existingToken1] = await Promise.all([
      context.Helper_Token.get(token0Id),
      context.Helper_Token.get(token1Id),
    ]);

    let token0: Token;
    if (existingToken0 === undefined) {
      const meta = await context.effect(getTokenMetadata, {
        chainId,
        token: token0Address,
        blockNumber: event.block.number,
      });
      token0 = {
        id: token0Id,
        symbol: meta.symbol,
        name: meta.name,
        totalSupply: meta.totalSupply,
        decimals: meta.decimals,
      };
    } else {
      token0 = existingToken0;
    }

    let token1: Token;
    if (existingToken1 === undefined) {
      const meta = await context.effect(getTokenMetadata, {
        chainId,
        token: token1Address,
        blockNumber: event.block.number,
      });
      token1 = {
        id: token1Id,
        symbol: meta.symbol,
        name: meta.name,
        totalSupply: meta.totalSupply,
        decimals: meta.decimals,
      };
    } else {
      token1 = existingToken1;
    }

    const gauge: Gauge = {
      id: cid(chainId, event.params.gauge),
      state_id: stateId,
      gauge: event.params.gauge,
      creator: event.params.creator,
      internalBribe: event.params.internal_bribe,
      externalBribe: event.params.external_bribe,
      pool: event.params.pool,
      token0_id: token0.id,
      token1_id: token1.id,
      liquidityProviderCount: ZERO_BI,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    };

    context.Helper_Token.set(token0);
    context.Helper_Token.set(token1);
    context.Helper_Gauge.set(gauge);

    if (!vePoints) return;

    await createUser(context, chainId, ZERO_ADDRESS);
    const aggregate = await createLiquidityPosition(
      context,
      chainId,
      event.params.gauge,
      ZERO_ADDRESS,
    );
    await createLiquiditySnapshot(
      context,
      chainId,
      aggregate,
      event.block.number,
      event.block.timestamp,
    );
  },
);
