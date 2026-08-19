/** Analytics factory: pool creation and the default community fee. */
import { indexer } from "envio";
import type {
  Analytics_Bundle as Bundle,
  Analytics_BurnFeeCache as BurnFeeCache,
  Analytics_Factory as Factory,
  Analytics_Pool as Pool,
  Analytics_PositionTransferCache as PositionTransferCache,
  Analytics_SwapFeeCache as SwapFeeCache,
  Analytics_Token as Token,
} from "envio";
import {
  cid,
  factoryId,
  singletonId,
  whitelistTokenIds,
} from "../config/chain.js";
import { ZERO_ADDRESS, ZERO_BI, ONE_BI } from "../utils/constants.js";
import { ZERO_BD } from "../utils/bigdecimal.js";
import { getTokenMetadata } from "../utils/effects.js";
import {
  takeEarlyPlugin,
  takeEarlyPluginConfig,
} from "../utils/earlyPlugin.js";

indexer.contractRegister(
  { contract: "Analytics_Factory", event: "PoolCreated" },
  async ({ event, context }) => {
    context.chain.Analytics_Pool.add(event.params.pool);
  },
);

indexer.contractRegister(
  { contract: "Analytics_Factory", event: "CustomPool" },
  async ({ event, context }) => {
    context.chain.Analytics_Pool.add(event.params.pool);
  },
);

function bootstrapSingletons(
  chainId: number,
  context: {
    Analytics_Bundle: { set: (b: Bundle) => void };
    Analytics_BurnFeeCache: { set: (b: BurnFeeCache) => void };
    Analytics_SwapFeeCache: { set: (b: SwapFeeCache) => void };
    Analytics_PositionTransferCache: { set: (b: PositionTransferCache) => void };
  },
) {
  const id = singletonId(chainId);
  context.Analytics_BurnFeeCache.set({ id, pluginFee: ZERO_BI });
  context.Analytics_SwapFeeCache.set({
    id,
    pluginFee: ZERO_BI,
    overrideFee: ZERO_BI,
  });
  context.Analytics_PositionTransferCache.set({ id, owner: ZERO_ADDRESS });
  context.Analytics_Bundle.set({ id, maticPriceUSD: ZERO_BD });
}

function newFactory(
  chainId: number,
  withDefaultCommunityFeeZero: boolean,
): Factory {
  return {
    id: factoryId(chainId),
    poolCount: ZERO_BI,
    totalVolumeMatic: ZERO_BD,
    totalVolumeUSD: ZERO_BD,
    untrackedVolumeUSD: ZERO_BD,
    totalFeesUSD: ZERO_BD,
    totalFeesMatic: ZERO_BD,
    defaultCommunityFee: withDefaultCommunityFeeZero ? ZERO_BI : ZERO_BI,
    totalValueLockedMatic: ZERO_BD,
    totalValueLockedUSD: ZERO_BD,
    totalValueLockedUSDUntracked: ZERO_BD,
    totalValueLockedMaticUntracked: ZERO_BD,
    txCount: ZERO_BI,
    owner: ZERO_ADDRESS,
  };
}

async function createPool(
  poolAddress: string,
  token0Address: string,
  token1Address: string,
  deployer: string,
  timestamp: bigint,
  blockNumber: bigint,
  event: { chainId: number; block: { number: number } },
  context: any,
): Promise<void> {
  const chainId = event.chainId;
  const poolId = cid(chainId, poolAddress);
  const token0Id = cid(chainId, token0Address);
  const token1Id = cid(chainId, token1Address);

  let factory = await context.Analytics_Factory.get(factoryId(chainId));
  if (!factory) {
    factory = newFactory(chainId, true);
    bootstrapSingletons(chainId, context);
  }

  factory = { ...factory, poolCount: factory.poolCount + ONE_BI };

  let [token0, token1] = await Promise.all([
    context.Analytics_Token.get(token0Id) as Promise<Token | undefined>,
    context.Analytics_Token.get(token1Id) as Promise<Token | undefined>,
  ]);

  if (!token0) {
    const md = await context.effect(getTokenMetadata, {
      chainId,
      address: token0Address,
      blockNumber: BigInt(event.block.number),
    });
    token0 = {
      id: token0Id,
      symbol: md.symbol,
      name: md.name,
      totalSupply: md.totalSupply,
      decimals: md.decimals,
      derivedMatic: ZERO_BD,
      volume: ZERO_BD,
      volumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      totalValueLocked: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
      totalValueLockedUSDUntracked: ZERO_BD,
      txCount: ZERO_BI,
      poolCount: ZERO_BI, // never incremented (bug 7.5)
      whitelistPools: [],
    };
  }

  if (!token1) {
    const md = await context.effect(getTokenMetadata, {
      chainId,
      address: token1Address,
      blockNumber: BigInt(event.block.number),
    });
    token1 = {
      id: token1Id,
      symbol: md.symbol,
      name: md.name,
      totalSupply: md.totalSupply,
      decimals: md.decimals,
      derivedMatic: ZERO_BD,
      volume: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      totalValueLocked: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
      totalValueLockedUSDUntracked: ZERO_BD,
      txCount: ZERO_BI,
      poolCount: ZERO_BI,
      whitelistPools: [],
    };
  }

  const whitelisted = whitelistTokenIds(chainId);
  if (whitelisted.has(token0.id)) {
    token1 = {
      ...token1,
      whitelistPools: [...token1.whitelistPools, poolId],
    };
  }
  if (whitelisted.has(token1.id)) {
    token0 = {
      ...token0,
      whitelistPools: [...token0.whitelistPools, poolId],
    };
  }

  const earlyPlugin = takeEarlyPlugin(chainId, poolAddress);
  const earlyPluginConfig = takeEarlyPluginConfig(chainId, poolAddress);

  const pool: Pool = {
    id: poolId,
    deployer,
    plugin: earlyPlugin ?? ZERO_ADDRESS,
    token0_id: token0.id,
    token1_id: token1.id,
    fee: 100n,
    pluginConfig: earlyPluginConfig ?? 0,
    createdAtTimestamp: timestamp,
    createdAtBlockNumber: blockNumber,
    liquidityProviderCount: ZERO_BI,
    tickSpacing: 60n,
    tick: ZERO_BI,
    txCount: ZERO_BI,
    liquidity: ZERO_BI,
    sqrtPrice: ZERO_BI,
    communityFee: factory.defaultCommunityFee,
    token0Price: ZERO_BD,
    token1Price: ZERO_BD,
    observationIndex: ZERO_BI,
    totalValueLockedToken0: ZERO_BD,
    totalValueLockedToken1: ZERO_BD,
    totalValueLockedUSD: ZERO_BD,
    lastMintIndex: ZERO_BI,
    totalValueLockedMatic: ZERO_BD,
    totalValueLockedUSDUntracked: ZERO_BD,
    volumeToken0: ZERO_BD,
    volumeToken1: ZERO_BD,
    volumeUSD: ZERO_BD,
    feesUSD: ZERO_BD,
    feesToken0: ZERO_BD,
    feesToken1: ZERO_BD,
    untrackedVolumeUSD: ZERO_BD,
    untrackedFeesUSD: ZERO_BD,
    collectedFeesToken0: ZERO_BD,
    collectedFeesToken1: ZERO_BD,
    collectedFeesUSD: ZERO_BD,
  };

  context.Analytics_Pool.set(pool);
  context.Analytics_Token.set(token0);
  context.Analytics_Token.set(token1);
  context.Analytics_Factory.set(factory);
}

indexer.onEvent(
  { contract: "Analytics_Factory", event: "PoolCreated" },
  async ({ event, context }) => {
    await createPool(
      event.params.pool,
      event.params.token0,
      event.params.token1,
      ZERO_ADDRESS,
      BigInt(event.block.timestamp),
      BigInt(event.block.number),
      event,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "Analytics_Factory", event: "CustomPool" },
  async ({ event, context }) => {
    await createPool(
      event.params.pool,
      event.params.token0,
      event.params.token1,
      event.params.deployer,
      BigInt(event.block.timestamp),
      BigInt(event.block.number),
      event,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "Analytics_Factory", event: "DefaultCommunityFee" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    let factory = await context.Analytics_Factory.get(factoryId(chainId));
    if (!factory) {
      factory = newFactory(chainId, false);
      bootstrapSingletons(chainId, context);
    }
    factory = {
      ...factory,
      defaultCommunityFee: BigInt(event.params.newDefaultCommunityFee),
    };
    context.Analytics_Factory.set(factory);
  },
);
