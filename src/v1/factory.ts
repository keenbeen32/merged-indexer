/** v1 factory: PairCreated, and dynamic registration of the new pair. */
import { indexer } from "envio";
import { getTokenMetadata } from "./effects/tokenMetadata.js";
import { effectOrDefault } from "./effects/safe.js";
import { pairLookupId } from "./utils/pricing.js";
import { ZERO_BD, ZERO_BI } from "./utils/helpers.js";
import { bundleId, cid, factoryId } from "./config/chains.js";

const FALLBACK_TOKEN_METADATA = {
  name: "unknown",
  symbol: "unknown",
  decimals: 18n,
  totalSupply: 0n,
};

indexer.contractRegister(
  { contract: "V1_Factory", event: "PairCreated" },
  async ({ event, context }) => {
    context.chain.V1_Pair.add(event.params.pair);
  },
);

indexer.onEvent(
  { contract: "V1_Factory", event: "PairCreated" },
  async ({ event, context }) => {
    const chainId = event.chainId;

    const logIndexLE = Buffer.alloc(4);
    logIndexLE.writeInt32LE(event.logIndex, 0);
    const pairCreatedId = cid(
      chainId,
      `${event.transaction.hash}${logIndexLE.toString("hex")}`,
    );

    context.V1_PairCreated.set({
      id: pairCreatedId,
      token0: event.params.token0,
      token1: event.params.token1,
      stable: event.params.stable,
      pair: event.params.pair,
      param4: event.params.param4,
      blockNumber: BigInt(event.block.number),
      blockTimestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    });

    const fid = factoryId(chainId);
    let factory = await context.V1_Factory.get(fid);
    if (factory === undefined) {
      factory = {
        id: fid,
        pairCount: 0,
        totalVolumeETH: ZERO_BD,
        totalLiquidityETH: ZERO_BD,
        totalVolumeUSD: ZERO_BD,
        untrackedVolumeUSD: ZERO_BD,
        totalLiquidityUSD: ZERO_BD,
        txCount: ZERO_BI,
      };
      context.V1_Bundle.set({ id: bundleId(chainId), ethPrice: ZERO_BD });
    }
    factory = { ...factory, pairCount: factory.pairCount + 1 };
    context.V1_Factory.set(factory);

    const token0Addr = event.params.token0;
    const token1Addr = event.params.token1;
    const token0Id = cid(chainId, token0Addr);
    const token1Id = cid(chainId, token1Addr);
    let token0 = await context.V1_Token.get(token0Id);
    let token1 = await context.V1_Token.get(token1Id);

    if (token0 === undefined) {
      const meta = await effectOrDefault(
        context,
        "getTokenMetadata(token0)",
        { chain: chainId, token: token0Addr, block: event.block.number },
        FALLBACK_TOKEN_METADATA,
        () =>
          context.effect(getTokenMetadata, {
            chainId,
            address: token0Addr,
            blockNumber: event.block.number,
          }),
      );
      token0 = {
        id: token0Id,
        symbol: meta.symbol,
        name: meta.name,
        totalSupply: meta.totalSupply,
        decimals: meta.decimals,
        derivedETH: ZERO_BD,
        tradeVolume: ZERO_BD,
        tradeVolumeUSD: ZERO_BD,
        untrackedVolumeUSD: ZERO_BD,
        totalLiquidity: ZERO_BD,
        txCount: ZERO_BI,
      };
    }

    if (token1 === undefined) {
      const meta = await effectOrDefault(
        context,
        "getTokenMetadata(token1)",
        { chain: chainId, token: token1Addr, block: event.block.number },
        FALLBACK_TOKEN_METADATA,
        () =>
          context.effect(getTokenMetadata, {
            chainId,
            address: token1Addr,
            blockNumber: event.block.number,
          }),
      );
      token1 = {
        id: token1Id,
        symbol: meta.symbol,
        name: meta.name,
        totalSupply: meta.totalSupply,
        decimals: meta.decimals,
        derivedETH: ZERO_BD,
        tradeVolume: ZERO_BD,
        tradeVolumeUSD: ZERO_BD,
        untrackedVolumeUSD: ZERO_BD,
        totalLiquidity: ZERO_BD,
        txCount: ZERO_BI,
      };
    }

    const pairId = cid(chainId, event.params.pair);
    context.V1_Pair.set({
      id: pairId,
      token0_id: token0.id,
      token1_id: token1.id,
      liquidityProviderCount: ZERO_BI,
      createdAtTimestamp: BigInt(event.block.timestamp),
      createdAtBlockNumber: BigInt(event.block.number),
      isStable: event.params.stable,
      txCount: ZERO_BI,
      reserve0: ZERO_BD,
      reserve1: ZERO_BD,
      trackedReserveETH: ZERO_BD,
      reserveETH: ZERO_BD,
      reserveUSD: ZERO_BD,
      totalSupply: ZERO_BD,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      token0Price: ZERO_BD,
      token1Price: ZERO_BD,
    });

    context.V1_PairLookup.set({
      id: pairLookupId(chainId, token0Addr, token1Addr, event.params.stable),
      pair: pairId,
    });
    context.V1_PairLookup.set({
      id: pairLookupId(chainId, token1Addr, token0Addr, event.params.stable),
      pair: pairId,
    });

    context.V1_Token.set(token0);
    context.V1_Token.set(token1);
  },
);
