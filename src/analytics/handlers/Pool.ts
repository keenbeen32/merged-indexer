/** Analytics pool handlers: Initialize, Mint, Burn, Swap, fee and plugin events. */
import { indexer } from "envio";
import type {
  Analytics_Bundle as Bundle,
  Analytics_Burn as Burn,
  Analytics_Mint as Mint,
  Analytics_Plugin as Plugin,
  Analytics_Pool as Pool,
  Analytics_PoolFeeData as PoolFeeData,
  Analytics_PoolPosition as PoolPosition,
  Analytics_Swap as Swap,
  Analytics_Tick as Tick,
  Analytics_Token as Token,
} from "envio";
import { cid, factoryId, singletonId } from "../config/chain.js";
import {
  ZERO_BD,
  FEE_DENOMINATOR,
  bd,
  bdExact,
  plus,
  minus,
  times,
  div,
  safeDiv,
  convertTokenToDecimal,
} from "../utils/bigdecimal.js";
import { ONE_BI, ZERO_BI } from "../utils/constants.js";
import { loadTransaction } from "../utils/transaction.js";
import {
  findEthPerToken,
  getEthPriceInUSD,
  getTrackedAmountUSD,
  priceToTokenPricesFromTokens,
} from "../utils/pricing.js";
import {
  updateAlgebraDayData,
  updateAlgebraHourData,
  updatePoolDayData,
  updatePoolHourData,
  updateTokenDayData,
  updateTokenHourData,
  updateFeeHourData,
} from "../utils/intervalUpdates.js";
import { createTick } from "../utils/tick.js";
import {
  stashEarlyPlugin,
  stashEarlyPluginConfig,
} from "../utils/earlyPlugin.js";

indexer.onEvent(
  { contract: "Analytics_Pool", event: "Initialize" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    let pool = (await context.Analytics_Pool.get(cid(chainId, event.srcAddress)))!;
    pool = {
      ...pool,
      sqrtPrice: event.params.price,
      tick: BigInt(event.params.tick),
    };
    context.Analytics_Pool.set(pool);

    let [token0, token1] = await Promise.all([
      context.Analytics_Token.getOrThrow(pool.token0_id),
      context.Analytics_Token.getOrThrow(pool.token1_id),
    ]);

    const bundle: Bundle = {
      id: singletonId(chainId),
      maticPriceUSD: await getEthPriceInUSD(chainId, context),
    };
    context.Analytics_Bundle.set(bundle);

    await updatePoolDayData(event, context);
    await updatePoolHourData(event, context);

    token0 = {
      ...token0,
      derivedMatic: await findEthPerToken(chainId, token0, context),
    };
    token1 = {
      ...token1,
      derivedMatic: await findEthPerToken(chainId, token1, context),
    };
    context.Analytics_Token.set(token0);
    context.Analytics_Token.set(token1);
  },
);

indexer.onEvent(
  { contract: "Analytics_Pool", event: "Mint" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const bundle = (await context.Analytics_Bundle.get(singletonId(chainId)))!;
    const poolAddress = event.srcAddress;
    let pool = (await context.Analytics_Pool.get(cid(chainId, poolAddress)))!;
    let factory = (await context.Analytics_Factory.get(factoryId(chainId)))!;
    let [token0, token1] = await Promise.all([
      context.Analytics_Token.getOrThrow(pool.token0_id),
      context.Analytics_Token.getOrThrow(pool.token1_id),
    ]);

    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);
    const amountUSD = plus(
      times(amount0, times(token0.derivedMatic, bundle.maticPriceUSD)),
      times(amount1, times(token1.derivedMatic, bundle.maticPriceUSD)),
    );

    factory = {
      ...factory,
      totalValueLockedMatic: minus(
        factory.totalValueLockedMatic,
        pool.totalValueLockedMatic,
      ),
      txCount: factory.txCount + ONE_BI,
    };

    token0 = {
      ...token0,
      txCount: token0.txCount + ONE_BI,
      totalValueLocked: plus(token0.totalValueLocked, amount0),
    };
    token0 = {
      ...token0,
      totalValueLockedUSD: times(
        token0.totalValueLocked,
        times(token0.derivedMatic, bundle.maticPriceUSD),
      ),
    };

    token1 = {
      ...token1,
      txCount: token1.txCount + ONE_BI,
      totalValueLocked: plus(token1.totalValueLocked, amount1),
    };
    token1 = {
      ...token1,
      totalValueLockedUSD: times(
        token1.totalValueLocked,
        times(token1.derivedMatic, bundle.maticPriceUSD),
      ),
    };

    const bottomTick = BigInt(event.params.bottomTick);
    const topTick = BigInt(event.params.topTick);
    let liquidity = pool.liquidity;
    if (bottomTick <= pool.tick && topTick > pool.tick) {
      liquidity = pool.liquidity + event.params.liquidityAmount;
    }

    pool = {
      ...pool,
      txCount: pool.txCount + ONE_BI,
      liquidity,
      totalValueLockedToken0: plus(pool.totalValueLockedToken0, amount0),
      totalValueLockedToken1: plus(pool.totalValueLockedToken1, amount1),
    };
    pool = {
      ...pool,
      totalValueLockedMatic: plus(
        times(pool.totalValueLockedToken0, token0.derivedMatic),
        times(pool.totalValueLockedToken1, token1.derivedMatic),
      ),
    };
    pool = {
      ...pool,
      totalValueLockedUSD: times(pool.totalValueLockedMatic, bundle.maticPriceUSD),
    };

    factory = {
      ...factory,
      totalValueLockedMatic: plus(
        factory.totalValueLockedMatic,
        pool.totalValueLockedMatic,
      ),
    };
    factory = {
      ...factory,
      totalValueLockedUSD: times(
        factory.totalValueLockedMatic,
        bundle.maticPriceUSD,
      ),
    };

    const transaction = await loadTransaction(event, context);
    const mint: Mint = {
      id: `${transaction.id}#${event.logIndex.toString()}`,
      transaction_id: transaction.id,
      timestamp: transaction.timestamp,
      pool_id: pool.id,
      token0_id: pool.token0_id,
      token1_id: pool.token1_id,
      owner: event.params.owner,
      sender: event.params.sender,
      origin: event.transaction.from ?? "0x",
      amount: event.params.liquidityAmount,
      amount0,
      amount1,
      amountUSD,
      tickLower: bottomTick,
      tickUpper: topTick,
      reserves0: pool.totalValueLockedToken0,
      reserves1: pool.totalValueLockedToken1,
      logIndex: BigInt(event.logIndex),
    };
    pool = { ...pool, lastMintIndex: BigInt(event.logIndex) };

    const lowerTickIdx = Number(event.params.bottomTick);
    const upperTickIdx = Number(event.params.topTick);
    const lowerTickId = cid(chainId, `${poolAddress}#${bottomTick.toString()}`);
    const upperTickId = cid(chainId, `${poolAddress}#${topTick.toString()}`);

    let [lowerTick, upperTick] = await Promise.all([
      context.Analytics_Tick.get(lowerTickId) as Promise<Tick | undefined>,
      context.Analytics_Tick.get(upperTickId) as Promise<Tick | undefined>,
    ]);
    if (!lowerTick) {
      lowerTick = createTick(
        lowerTickId,
        lowerTickIdx,
        pool.id,
        poolAddress, // bare — plain String column, see createTick
        BigInt(event.block.timestamp),
        BigInt(event.block.number),
      );
    }
    if (!upperTick) {
      upperTick = createTick(
        upperTickId,
        upperTickIdx,
        pool.id,
        poolAddress,
        BigInt(event.block.timestamp),
        BigInt(event.block.number),
      );
    }

    const amount = event.params.liquidityAmount;
    lowerTick = {
      ...lowerTick,
      liquidityGross: lowerTick.liquidityGross + amount,
      liquidityNet: lowerTick.liquidityNet + amount,
    };
    upperTick = {
      ...upperTick,
      liquidityGross: upperTick.liquidityGross + amount,
      liquidityNet: upperTick.liquidityNet - amount,
    };

    const poolPositionid = `${pool.id}#${event.params.owner}#${bottomTick.toString()}#${topTick.toString()}`;
    let poolPosition = (await context.Analytics_PoolPosition.get(
      poolPositionid,
    )) as PoolPosition | undefined;
    if (poolPosition) {
      poolPosition = {
        ...poolPosition,
        liquidity: poolPosition.liquidity + event.params.liquidityAmount,
      };
    } else {
      poolPosition = {
        id: poolPositionid,
        pool_id: pool.id,
        lowerTick_id: lowerTick.id,
        upperTick_id: upperTick.id,
        liquidity: event.params.liquidityAmount,
        owner: event.params.owner,
      };
    }

    await updateAlgebraDayData(event, context);
    await updatePoolDayData(event, context);
    await updatePoolHourData(event, context);
    await updateTokenDayData(token0, event, context);
    await updateTokenDayData(token1, event, context);
    await updateTokenHourData(token0, event, context);
    await updateTokenHourData(token1, event, context);

    context.Analytics_Token.set(token0);
    context.Analytics_Token.set(token1);
    context.Analytics_Pool.set(pool);
    context.Analytics_PoolPosition.set(poolPosition);
    context.Analytics_Factory.set(factory);
    context.Analytics_Mint.set(mint);
    context.Analytics_Tick.set(lowerTick);
    context.Analytics_Tick.set(upperTick);
  },
);

indexer.onEvent(
  { contract: "Analytics_Pool", event: "Burn" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const bundle = (await context.Analytics_Bundle.get(singletonId(chainId)))!;
    const poolAddress = event.srcAddress;
    let pool = (await context.Analytics_Pool.get(cid(chainId, poolAddress)))!;
    const burnFeeCache = (await context.Analytics_BurnFeeCache.get(
      singletonId(chainId),
    ))!;
    let plugin = (await context.Analytics_Plugin.get(
      cid(chainId, pool.plugin),
    )) as Plugin | undefined;
    let factory = (await context.Analytics_Factory.get(factoryId(chainId)))!;
    let [token0, token1] = await Promise.all([
      context.Analytics_Token.getOrThrow(pool.token0_id),
      context.Analytics_Token.getOrThrow(pool.token1_id),
    ]);

    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);
    const amountUSD = plus(
      times(amount0, times(token0.derivedMatic, bundle.maticPriceUSD)),
      times(amount1, times(token1.derivedMatic, bundle.maticPriceUSD)),
    );

    if (plugin) {
      const pluginFee = bdExact(burnFeeCache.pluginFee);
      plugin = {
        ...plugin,
        collectedFeesToken0: plus(
          plugin.collectedFeesToken0,
          div(times(amount0, pluginFee), FEE_DENOMINATOR),
        ),
        collectedFeesToken1: plus(
          plugin.collectedFeesToken1,
          div(times(amount1, pluginFee), FEE_DENOMINATOR),
        ),
        collectedFeesUSD: plus(
          plugin.collectedFeesUSD,
          div(times(amountUSD, pluginFee), FEE_DENOMINATOR),
        ),
      };
      context.Analytics_Plugin.set(plugin);
    }

    factory = {
      ...factory,
      totalValueLockedMatic: minus(
        factory.totalValueLockedMatic,
        pool.totalValueLockedMatic,
      ),
      txCount: factory.txCount + ONE_BI,
    };

    token0 = {
      ...token0,
      txCount: token0.txCount + ONE_BI,
      totalValueLocked: minus(token0.totalValueLocked, amount0),
    };
    token0 = {
      ...token0,
      totalValueLockedUSD: times(
        token0.totalValueLocked,
        times(token0.derivedMatic, bundle.maticPriceUSD),
      ),
    };

    token1 = {
      ...token1,
      txCount: token1.txCount + ONE_BI,
      totalValueLocked: minus(token1.totalValueLocked, amount1),
    };
    token1 = {
      ...token1,
      totalValueLockedUSD: times(
        token1.totalValueLocked,
        times(token1.derivedMatic, bundle.maticPriceUSD),
      ),
    };

    const bottomTick = BigInt(event.params.bottomTick);
    const topTick = BigInt(event.params.topTick);
    let liquidity = pool.liquidity;
    if (bottomTick <= pool.tick && topTick > pool.tick) {
      liquidity = pool.liquidity - event.params.liquidityAmount;
    }

    pool = {
      ...pool,
      txCount: pool.txCount + ONE_BI,
      liquidity,
      totalValueLockedToken0: minus(pool.totalValueLockedToken0, amount0),
      totalValueLockedToken1: minus(pool.totalValueLockedToken1, amount1),
    };
    pool = {
      ...pool,
      totalValueLockedMatic: plus(
        times(pool.totalValueLockedToken0, token0.derivedMatic),
        times(pool.totalValueLockedToken1, token1.derivedMatic),
      ),
    };
    pool = {
      ...pool,
      totalValueLockedUSD: times(pool.totalValueLockedMatic, bundle.maticPriceUSD),
    };

    factory = {
      ...factory,
      totalValueLockedMatic: plus(
        factory.totalValueLockedMatic,
        pool.totalValueLockedMatic,
      ),
    };
    factory = {
      ...factory,
      totalValueLockedUSD: times(
        factory.totalValueLockedMatic,
        bundle.maticPriceUSD,
      ),
    };

    const transaction = await loadTransaction(event, context);
    const burn: Burn = {
      id: `${transaction.id}#${event.logIndex.toString()}`,
      transaction_id: transaction.id,
      timestamp: transaction.timestamp,
      pool_id: pool.id,
      token0_id: pool.token0_id,
      token1_id: pool.token1_id,
      owner: event.params.owner,
      origin: event.transaction.from ?? "0x",
      amount: event.params.liquidityAmount,
      amount0,
      amount1,
      amountUSD,
      tickLower: bottomTick,
      tickUpper: topTick,
      reserves0: pool.totalValueLockedToken0,
      reserves1: pool.totalValueLockedToken1,
      logIndex: BigInt(event.logIndex),
    };

    const lowerTickId = cid(chainId, `${poolAddress}#${bottomTick.toString()}`);
    const upperTickId = cid(chainId, `${poolAddress}#${topTick.toString()}`);
    let lowerTick = (await context.Analytics_Tick.getOrThrow(lowerTickId)) as Tick;
    let upperTick = (await context.Analytics_Tick.getOrThrow(upperTickId)) as Tick;
    const amount = event.params.liquidityAmount;
    lowerTick = {
      ...lowerTick,
      liquidityGross: lowerTick.liquidityGross - amount,
      liquidityNet: lowerTick.liquidityNet - amount,
    };
    upperTick = {
      ...upperTick,
      liquidityGross: upperTick.liquidityGross - amount,
      liquidityNet: upperTick.liquidityNet + amount,
    };

    const poolPositionid = `${pool.id}#${event.params.owner}#${bottomTick.toString()}#${topTick.toString()}`;
    let poolPosition = (await context.Analytics_PoolPosition.get(
      poolPositionid,
    )) as PoolPosition | undefined;
    if (poolPosition) {
      poolPosition = {
        ...poolPosition,
        liquidity: poolPosition.liquidity - event.params.liquidityAmount,
      };
      context.Analytics_PoolPosition.set(poolPosition);
    }

    await updateAlgebraDayData(event, context);
    await updatePoolDayData(event, context);
    await updatePoolHourData(event, context);
    await updateTokenDayData(token0, event, context);
    await updateTokenDayData(token1, event, context);
    await updateTokenHourData(token0, event, context);
    await updateTokenHourData(token1, event, context);

    context.Analytics_Token.set(token0);
    context.Analytics_Token.set(token1);
    context.Analytics_Pool.set(pool);
    context.Analytics_Factory.set(factory);
    context.Analytics_Burn.set(burn);
    context.Analytics_Tick.set(lowerTick);
    context.Analytics_Tick.set(upperTick);
  },
);

indexer.onEvent(
  { contract: "Analytics_Pool", event: "Swap" },
  async ({ event, context }) => {
    const diagnoseGap = process.env.DIAGNOSE_SWAP_GAP === "1";
    if (diagnoseGap) {
      console.log(
        `[SWAP-GAP] block=${event.block.number} ts=${event.block.timestamp} tx=${event.transaction.hash} logIndex=${event.logIndex} pool=${event.srcAddress}`,
      );
    }

    const chainId = event.chainId;
    let bundle = await context.Analytics_Bundle.get(singletonId(chainId));
    let factory = await context.Analytics_Factory.get(factoryId(chainId));
    const swapFeeCache = await context.Analytics_SwapFeeCache.get(
      singletonId(chainId),
    );
    let pool = await context.Analytics_Pool.get(cid(chainId, event.srcAddress));
    if (!bundle || !factory || !swapFeeCache || !pool) {
      if (diagnoseGap) {
        console.log(
          `[SWAP-GAP-SKIP] missing entities bundle=${!!bundle} factory=${!!factory} feeCache=${!!swapFeeCache} pool=${!!pool} — event delivered but not persisted`,
        );
        return;
      }
      throw new Error(
        `Swap missing required entity: bundle=${!!bundle} factory=${!!factory} feeCache=${!!swapFeeCache} pool=${!!pool} src=${event.srcAddress}`,
      );
    }
    let [token0, token1] = await Promise.all([
      context.Analytics_Token.getOrThrow(pool.token0_id),
      context.Analytics_Token.getOrThrow(pool.token1_id),
    ]);

    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    let swapFee = pool.fee;
    if (swapFeeCache.overrideFee > ZERO_BI) {
      swapFee = swapFeeCache.overrideFee;
    }
    const pluginFee = swapFeeCache.pluginFee;

    let amount0Abs = amount0;
    let amount0withFee = amount0;
    if (amount0.lt(ZERO_BD)) {
      amount0Abs = times(amount0, bd("-1"));
    } else {
      void times(
        amount0,
        div(bdExact(swapFee * pool.communityFee), bd("1000000000")),
      );
      amount0withFee = div(
        times(amount0, minus(FEE_DENOMINATOR, bdExact(swapFee + pluginFee))),
        FEE_DENOMINATOR,
      );
      amount0Abs = amount0;
    }

    let amount1Abs = amount1;
    let amount1withFee = amount1;
    if (amount1.lt(ZERO_BD)) {
      amount1Abs = times(amount1, bd("-1"));
    } else {
      void times(
        amount1,
        div(bdExact(swapFee * pool.communityFee), bd("1000000000")),
      );
      amount1Abs = amount1;
      amount1withFee = div(
        times(amount1, minus(FEE_DENOMINATOR, bdExact(swapFee + pluginFee))),
        FEE_DENOMINATOR,
      );
    }

    const amount0Matic = times(amount0Abs, token0.derivedMatic);
    const amount1Matic = times(amount1Abs, token1.derivedMatic);
    const amount0USD = times(amount0Matic, bundle.maticPriceUSD);
    const amount1USD = times(amount1Matic, bundle.maticPriceUSD);

    const amountTotalUSDTracked = div(
      await getTrackedAmountUSD(
        chainId,
        amount0Abs,
        token0,
        amount1Abs,
        token1,
        context,
      ),
      bd(2),
    );
    const amountTotalMaticTracked = safeDiv(
      amountTotalUSDTracked,
      bundle.maticPriceUSD,
    );
    const amountTotalUSDUntracked = div(plus(amount0USD, amount1USD), bd(2));

    const feesMatic = div(
      times(amountTotalMaticTracked, bdExact(swapFee)),
      FEE_DENOMINATOR,
    );
    const feesUSD = div(
      times(amountTotalUSDTracked, bdExact(swapFee)),
      FEE_DENOMINATOR,
    );
    const untrackedFees = div(
      times(amountTotalUSDUntracked, bdExact(swapFee)),
      FEE_DENOMINATOR,
    );

    factory = {
      ...factory,
      txCount: factory.txCount + ONE_BI,
      totalVolumeMatic: plus(factory.totalVolumeMatic, amountTotalMaticTracked),
      totalVolumeUSD: plus(factory.totalVolumeUSD, amountTotalUSDTracked),
      untrackedVolumeUSD: plus(
        factory.untrackedVolumeUSD,
        amountTotalUSDUntracked,
      ),
      totalFeesMatic: plus(factory.totalFeesMatic, feesMatic),
      totalFeesUSD: plus(factory.totalFeesUSD, feesUSD),
    };

    const currentPoolTvlMatic = pool.totalValueLockedMatic;
    factory = {
      ...factory,
      totalValueLockedMatic: minus(
        factory.totalValueLockedMatic,
        currentPoolTvlMatic,
      ),
    };

    pool = {
      ...pool,
      volumeToken0: plus(pool.volumeToken0, amount0Abs),
      volumeToken1: plus(pool.volumeToken1, amount1Abs),
      volumeUSD: plus(pool.volumeUSD, amountTotalUSDTracked),
      untrackedVolumeUSD: plus(pool.untrackedVolumeUSD, amountTotalUSDUntracked),
      feesUSD: plus(pool.feesUSD, feesUSD),
      untrackedFeesUSD: plus(pool.untrackedFeesUSD, untrackedFees),
      txCount: pool.txCount + ONE_BI,
      liquidity: event.params.liquidity,
      tick: BigInt(event.params.tick),
      sqrtPrice: event.params.price,
      totalValueLockedToken0: plus(pool.totalValueLockedToken0, amount0withFee),
      totalValueLockedToken1: plus(pool.totalValueLockedToken1, amount1withFee),
    };

    token0 = {
      ...token0,
      volume: plus(token0.volume, amount0Abs),
      totalValueLocked: plus(token0.totalValueLocked, amount0withFee),
      volumeUSD: plus(token0.volumeUSD, amountTotalUSDTracked),
      untrackedVolumeUSD: plus(token0.untrackedVolumeUSD, amountTotalUSDUntracked),
      feesUSD: plus(token0.feesUSD, feesUSD),
      txCount: token0.txCount + ONE_BI,
    };
    token1 = {
      ...token1,
      volume: plus(token1.volume, amount1Abs),
      totalValueLocked: plus(token1.totalValueLocked, amount1withFee),
      volumeUSD: plus(token1.volumeUSD, amountTotalUSDTracked),
      untrackedVolumeUSD: plus(token1.untrackedVolumeUSD, amountTotalUSDUntracked),
      feesUSD: plus(token1.feesUSD, feesUSD),
      txCount: token1.txCount + ONE_BI,
    };

    const prices = priceToTokenPricesFromTokens(pool.sqrtPrice, token0, token1);
    pool = { ...pool, token0Price: prices[0], token1Price: prices[1] };

    let plugin = (await context.Analytics_Plugin.get(
      cid(chainId, pool.plugin),
    )) as Plugin | undefined;
    if (plugin) {
      if (amount0.lt(ZERO_BD)) {
        plugin = {
          ...plugin,
          collectedFeesToken1: plus(
            plugin.collectedFeesToken1,
            div(times(amount1, bdExact(pluginFee)), FEE_DENOMINATOR),
          ),
        };
      } else {
        plugin = {
          ...plugin,
          collectedFeesToken0: plus(
            plugin.collectedFeesToken0,
            div(times(amount0, bdExact(pluginFee)), FEE_DENOMINATOR),
          ),
        };
      }
      plugin = {
        ...plugin,
        collectedFeesUSD: plus(
          plugin.collectedFeesUSD,
          div(times(amountTotalUSDTracked, bdExact(pluginFee)), FEE_DENOMINATOR),
        ),
      };
      context.Analytics_Plugin.set(plugin);
    }

    context.Analytics_Pool.set(pool);

    bundle = {
      id: singletonId(chainId),
      maticPriceUSD: await getEthPriceInUSD(chainId, context),
    };
    context.Analytics_Bundle.set(bundle);

    token0 = {
      ...token0,
      derivedMatic: await findEthPerToken(chainId, token0, context),
    };
    token1 = {
      ...token1,
      derivedMatic: await findEthPerToken(chainId, token1, context),
    };

    pool = {
      ...pool,
      totalValueLockedMatic: plus(
        times(pool.totalValueLockedToken0, token0.derivedMatic),
        times(pool.totalValueLockedToken1, token1.derivedMatic),
      ),
    };
    pool = {
      ...pool,
      totalValueLockedUSD: times(pool.totalValueLockedMatic, bundle.maticPriceUSD),
    };

    factory = {
      ...factory,
      totalValueLockedMatic: plus(
        factory.totalValueLockedMatic,
        pool.totalValueLockedMatic,
      ),
    };
    factory = {
      ...factory,
      totalValueLockedUSD: times(
        factory.totalValueLockedMatic,
        bundle.maticPriceUSD,
      ),
    };

    token0 = {
      ...token0,
      totalValueLockedUSD: times(
        times(token0.totalValueLocked, token0.derivedMatic),
        bundle.maticPriceUSD,
      ),
    };
    token1 = {
      ...token1,
      totalValueLockedUSD: times(
        times(token1.totalValueLocked, token1.derivedMatic),
        bundle.maticPriceUSD,
      ),
    };

    const transaction = await loadTransaction(event, context);
    let swap: Swap = {
      id: `${transaction.id}#${event.logIndex.toString()}`,
      transaction_id: transaction.id,
      timestamp: transaction.timestamp,
      pool_id: pool.id,
      token0_id: pool.token0_id,
      token1_id: pool.token1_id,
      sender: event.params.sender,
      origin: event.transaction.from ?? "0x",
      liquidity: event.params.liquidity,
      recipient: event.params.recipient,
      amount0,
      amount1,
      amountUSD: amountTotalUSDTracked,
      tick: BigInt(event.params.tick),
      price: event.params.price,
      reserves0: pool.totalValueLockedToken0,
      reserves1: pool.totalValueLockedToken1,
      logIndex: BigInt(event.logIndex),
    };

    let algebraDayData = await updateAlgebraDayData(event, context);
    let algebraHourData = await updateAlgebraHourData(event, context);
    let poolDayData = await updatePoolDayData(event, context);
    let poolHourData = await updatePoolHourData(event, context);
    let token0DayData = await updateTokenDayData(token0, event, context);
    let token1DayData = await updateTokenDayData(token1, event, context);
    let token0HourData = await updateTokenHourData(token0, event, context);
    let token1HourData = await updateTokenHourData(token1, event, context);

    const feeAmount0 = div(times(amount0, bdExact(swapFee)), FEE_DENOMINATOR);
    const feeAmount1 = div(times(amount1, bdExact(swapFee)), FEE_DENOMINATOR);

    if (amount0.lt(ZERO_BD)) {
      pool = { ...pool, feesToken1: plus(pool.feesToken1, feeAmount1) };
      poolDayData = {
        ...poolDayData,
        feesToken1: plus(poolDayData.feesToken1, feeAmount1),
      };
    }
    if (amount1.lt(ZERO_BD)) {
      pool = { ...pool, feesToken0: plus(pool.feesToken0, feeAmount0) };
      poolDayData = {
        ...poolDayData,
        feesToken0: plus(poolDayData.feesToken0, feeAmount0),
      };
    }

    algebraDayData = {
      ...algebraDayData,
      volumeMatic: plus(algebraDayData.volumeMatic, amountTotalMaticTracked),
      volumeUSD: plus(algebraDayData.volumeUSD, amountTotalUSDTracked),
      feesUSD: plus(algebraDayData.feesUSD, feesUSD),
    };
    algebraHourData = {
      ...algebraHourData,
      volumeMatic: plus(algebraHourData.volumeMatic, amountTotalMaticTracked),
      volumeUSD: plus(algebraHourData.volumeUSD, amountTotalUSDTracked),
      feesUSD: plus(algebraHourData.feesUSD, feesUSD),
    };
    poolDayData = {
      ...poolDayData,
      volumeUSD: plus(poolDayData.volumeUSD, amountTotalUSDTracked),
      untrackedVolumeUSD: plus(
        poolDayData.untrackedVolumeUSD,
        amountTotalUSDUntracked,
      ),
      volumeToken0: plus(poolDayData.volumeToken0, amount0Abs),
      volumeToken1: plus(poolDayData.volumeToken1, amount1Abs),
      feesUSD: plus(poolDayData.feesUSD, feesUSD),
    };
    poolHourData = {
      ...poolHourData,
      untrackedVolumeUSD: plus(
        poolHourData.untrackedVolumeUSD,
        amountTotalUSDUntracked,
      ),
      volumeUSD: plus(poolHourData.volumeUSD, amountTotalUSDTracked),
      volumeToken0: plus(poolHourData.volumeToken0, amount0Abs),
      volumeToken1: plus(poolHourData.volumeToken1, amount1Abs),
      feesUSD: plus(poolHourData.feesUSD, feesUSD),
    };

    token0DayData = {
      ...token0DayData,
      volume: plus(token0DayData.volume, amount0Abs),
      volumeUSD: plus(token0DayData.volumeUSD, amountTotalUSDTracked),
      untrackedVolumeUSD: plus(
        token0DayData.untrackedVolumeUSD,
        amountTotalUSDTracked,
      ),
      feesUSD: plus(token0DayData.feesUSD, feesUSD),
    };
    token0HourData = {
      ...token0HourData,
      volume: plus(token0HourData.volume, amount0Abs),
      volumeUSD: plus(token0HourData.volumeUSD, amountTotalUSDTracked),
      untrackedVolumeUSD: plus(
        token0HourData.untrackedVolumeUSD,
        amountTotalUSDTracked,
      ),
      feesUSD: plus(token0HourData.feesUSD, feesUSD),
    };
    token1DayData = {
      ...token1DayData,
      volume: plus(token1DayData.volume, amount1Abs),
      volumeUSD: plus(token1DayData.volumeUSD, amountTotalUSDTracked),
      untrackedVolumeUSD: plus(
        token1DayData.untrackedVolumeUSD,
        amountTotalUSDTracked,
      ),
      feesUSD: plus(token1DayData.feesUSD, feesUSD),
    };
    token1HourData = {
      ...token1HourData,
      volume: plus(token1HourData.volume, amount1Abs),
      volumeUSD: plus(token1HourData.volumeUSD, amountTotalUSDTracked),
      untrackedVolumeUSD: plus(
        token1HourData.untrackedVolumeUSD,
        amountTotalUSDTracked,
      ),
      feesUSD: plus(token1HourData.feesUSD, feesUSD),
    };

    context.Analytics_Swap.set(swap);
    context.Analytics_TokenDayData.set(token0DayData);
    context.Analytics_TokenDayData.set(token1DayData);
    context.Analytics_AlgebraDayData.set(algebraDayData);
    context.Analytics_AlgebraHourData.set(algebraHourData);
    context.Analytics_TokenHourData.set(token0HourData);
    context.Analytics_TokenHourData.set(token1HourData);
    context.Analytics_PoolHourData.set(poolHourData);
    context.Analytics_PoolDayData.set(poolDayData);
    context.Analytics_Factory.set(factory);
    context.Analytics_Pool.set(pool);
    context.Analytics_Token.set(token0);
    context.Analytics_Token.set(token1);
  },
);

indexer.onEvent(
  { contract: "Analytics_Pool", event: "CommunityFee" },
  async ({ event, context }) => {
    const pool = await context.Analytics_Pool.get(
      cid(event.chainId, event.srcAddress),
    );
    if (pool) {
      context.Analytics_Pool.set({
        ...pool,
        communityFee: BigInt(event.params.communityFeeNew),
      });
    }
  },
);

indexer.onEvent(
  { contract: "Analytics_Pool", event: "Collect" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    let pool = (await context.Analytics_Pool.get(cid(chainId, event.srcAddress)))!;
    let factory = (await context.Analytics_Factory.get(factoryId(chainId)))!;
    let [token0, token1] = await Promise.all([
      context.Analytics_Token.getOrThrow(pool.token0_id),
      context.Analytics_Token.getOrThrow(pool.token1_id),
    ]);
    factory = { ...factory, txCount: factory.txCount + ONE_BI };
    token0 = { ...token0, txCount: token0.txCount + ONE_BI };
    token1 = { ...token1, txCount: token1.txCount + ONE_BI };
    pool = { ...pool, txCount: pool.txCount + ONE_BI };
    context.Analytics_Token.set(token0);
    context.Analytics_Token.set(token1);
    context.Analytics_Pool.set(pool);
    context.Analytics_Factory.set(factory);
  },
);

indexer.onEvent(
  { contract: "Analytics_Pool", event: "TickSpacing" },
  async ({ event, context }) => {
    const pool = (await context.Analytics_Pool.get(
      cid(event.chainId, event.srcAddress),
    ))!;
    context.Analytics_Pool.set({
      ...pool,
      tickSpacing: BigInt(event.params.newTickSpacing),
    });
  },
);

indexer.onEvent(
  { contract: "Analytics_Pool", event: "Fee" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    let pool = (await context.Analytics_Pool.get(cid(chainId, event.srcAddress)))!;
    pool = { ...pool, fee: BigInt(event.params.fee) };
    context.Analytics_Pool.set(pool);

    const loadKey = cid(
      chainId,
      `${event.srcAddress}${event.block.timestamp.toString()}`,
    );
    let fee = (await context.Analytics_PoolFeeData.get(loadKey)) as PoolFeeData | undefined;
    if (!fee) {
      fee = {
        id: cid(
          chainId,
          `${event.block.timestamp.toString()}${event.srcAddress}`,
        ),
        pool: event.srcAddress, // bare — plain String column
        fee: BigInt(event.params.fee),
        timestamp: BigInt(event.block.timestamp),
      };
    } else {
      fee = { ...fee, fee: BigInt(event.params.fee) };
    }
    await updateFeeHourData(event, BigInt(event.params.fee), context);
    context.Analytics_PoolFeeData.set(fee);
  },
);

indexer.onEvent(
  { contract: "Analytics_Pool", event: "BurnFee" },
  async ({ event, context }) => {
    const burnFeeCache = (await context.Analytics_BurnFeeCache.get(
      singletonId(event.chainId),
    ))!;
    context.Analytics_BurnFeeCache.set({
      ...burnFeeCache,
      pluginFee: BigInt(event.params.pluginFee),
    });
  },
);

indexer.onEvent(
  { contract: "Analytics_Pool", event: "SwapFee" },
  async ({ event, context }) => {
    const swapFeeCache = (await context.Analytics_SwapFeeCache.get(
      singletonId(event.chainId),
    ))!;
    context.Analytics_SwapFeeCache.set({
      ...swapFeeCache,
      overrideFee: BigInt(event.params.overrideFee),
      pluginFee: BigInt(event.params.pluginFee),
    });
  },
);

indexer.onEvent(
  { contract: "Analytics_Pool", event: "Plugin" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pool = await context.Analytics_Pool.get(cid(chainId, event.srcAddress));
    if (pool) {
      context.Analytics_Pool.set({
        ...pool,
        plugin: event.params.newPluginAddress,
      });
    } else {
      stashEarlyPlugin(chainId, event.srcAddress, event.params.newPluginAddress);
    }

    let plugin = (await context.Analytics_Plugin.get(
      cid(chainId, event.params.newPluginAddress),
    )) as Plugin | undefined;
    if (!plugin) {
      plugin = {
        id: cid(chainId, event.params.newPluginAddress),
        pool_id: cid(chainId, event.srcAddress),
        collectedFeesToken0: ZERO_BD,
        collectedFeesToken1: ZERO_BD,
        collectedFeesUSD: ZERO_BD,
      };
    }
    context.Analytics_Plugin.set(plugin);
  },
);

indexer.onEvent(
  { contract: "Analytics_Pool", event: "PluginConfig" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pool = await context.Analytics_Pool.get(cid(chainId, event.srcAddress));
    const cfg = Number(event.params.newPluginConfig);
    if (pool) {
      context.Analytics_Pool.set({ ...pool, pluginConfig: cfg });
    } else {
      stashEarlyPluginConfig(chainId, event.srcAddress, cfg);
    }
  },
);
