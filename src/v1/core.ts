/** v1 pair handlers: Transfer, Sync, Mint, Burn, Swap. */
import { indexer } from "envio";
import type { EvmOnEventContext, BigDecimal } from "envio";
import { getLpBalance } from "./effects/lpBalance.js";
import { effectOrDefault } from "./effects/safe.js";
import {
  updatePairDayData,
  updateTokenDayData,
  updateDayData,
  updatePairHourData,
} from "./utils/dayUpdates.js";
import {
  getEthPriceInUSD,
  findEthPerToken,
  getTrackedVolumeUSD,
  getTrackedLiquidityUSD,
} from "./utils/pricing.js";
import {
  convertTokenToDecimal,
  ADDRESS_ZERO,
  ONE_BI,
  createUser,
  createLiquidityPosition,
  createLiquiditySnapshot,
  BI_18,
} from "./utils/helpers.js";
import { ZERO_BD, plus, minus, times, div } from "./utils/math.js";
import { BigDecimal as BD } from "envio";
import { bundleId, cid, factoryId } from "./config/chains.js";

const TWO_BD = new BD("2");

async function isCompleteMint(
  context: EvmOnEventContext,
  mintId: string,
): Promise<boolean> {
  const mint = await context.V1_Mint.get(mintId);
  return mint ? mint.sender !== undefined : false;
}

indexer.onEvent(
  { contract: "V1_Pair", event: "Transfer" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pairAddress = event.srcAddress;

    if (event.params.to === ADDRESS_ZERO && event.params.value === 1000n) {
      return;
    }

    const transactionHash = event.transaction.hash;
    const from = event.params.from;
    const to = event.params.to;

    await createUser(context, chainId, from);
    await createUser(context, chainId, to);

    let pair = await context.V1_Pair.get(cid(chainId, pairAddress));
    if (pair === undefined) return;

    const value = convertTokenToDecimal(event.params.value, BI_18);

    const txId = cid(chainId, transactionHash);
    let transaction = await context.V1_Transaction.get(txId);
    if (transaction === undefined) {
      transaction = {
        id: txId,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
        mints: [],
        burns: [],
        swaps: [],
      };
    }

    const mints = [...transaction.mints];

    if (from === ADDRESS_ZERO) {
      pair = { ...pair, totalSupply: plus(pair.totalSupply, value) };
      context.V1_Pair.set(pair);

      if (
        mints.length === 0 ||
        (await isCompleteMint(context, mints[mints.length - 1]!))
      ) {
        const mintId = `${transaction.id}-${mints.length}`;
        context.V1_Mint.set({
          id: mintId,
          transaction_id: transaction.id,
          pair_id: pair.id,
          to,
          liquidity: value,
          timestamp: transaction.timestamp,
          sender: undefined,
          amount0: undefined,
          amount1: undefined,
          logIndex: undefined,
          amountUSD: undefined,
          feeTo: undefined,
          feeLiquidity: undefined,
        });

        transaction = { ...transaction, mints: mints.concat([mintId]) };
        context.V1_Transaction.set(transaction);
      }
    }

    if (to === pairAddress) {
      const burns = [...transaction.burns];
      const burnId = `${transaction.id}-${burns.length}`;
      context.V1_Burn.set({
        id: burnId,
        transaction_id: transaction.id,
        pair_id: pair.id,
        liquidity: value,
        timestamp: transaction.timestamp,
        to,
        sender: from,
        needsComplete: true,
        amount0: undefined,
        amount1: undefined,
        logIndex: undefined,
        amountUSD: undefined,
        feeTo: undefined,
        feeLiquidity: undefined,
      });
      burns.push(burnId);
      transaction = { ...transaction, burns };
      context.V1_Transaction.set(transaction);
    }

    if (to === ADDRESS_ZERO && from === pairAddress) {
      pair = { ...pair, totalSupply: minus(pair.totalSupply, value) };
      context.V1_Pair.set(pair);

      const burns = [...transaction.burns];
      let burn: {
        id: string;
        transaction_id: string;
        pair_id: string;
        liquidity: BigDecimal;
        timestamp: bigint;
        needsComplete: boolean;
        sender: string | undefined;
        amount0: BigDecimal | undefined;
        amount1: BigDecimal | undefined;
        to: string | undefined;
        logIndex: bigint | undefined;
        amountUSD: BigDecimal | undefined;
        feeTo: string | undefined;
        feeLiquidity: BigDecimal | undefined;
      };

      const newBurn = () => ({
        id: `${transaction!.id}-${burns.length}`,
        transaction_id: transaction!.id,
        needsComplete: false,
        pair_id: pair!.id,
        liquidity: value,
        timestamp: transaction!.timestamp,
        sender: undefined,
        amount0: undefined,
        amount1: undefined,
        to: undefined,
        logIndex: undefined,
        amountUSD: undefined,
        feeTo: undefined,
        feeLiquidity: undefined,
      });

      if (burns.length > 0) {
        const currentBurn = await context.V1_Burn.get(burns[burns.length - 1]!);
        if (currentBurn !== undefined && currentBurn.needsComplete) {
          burn = { ...currentBurn };
        } else {
          burn = newBurn();
        }
      } else {
        burn = newBurn();
      }

      if (
        mints.length !== 0 &&
        (await isCompleteMint(context, mints[mints.length - 1]!))
      ) {
        const mintId = mints[mints.length - 1]!;
        const mint = await context.V1_Mint.get(mintId);
        if (mint !== undefined) {
          burn = { ...burn, feeTo: mint.to, feeLiquidity: mint.liquidity };
        }
        context.V1_Mint.deleteUnsafe(mintId);
        mints.pop();
        transaction = { ...transaction, mints };
        context.V1_Transaction.set(transaction);
      }

      context.V1_Burn.set(burn);
      if (burn.needsComplete) {
        burns[burns.length - 1] = burn.id;
      } else {
        burns.push(burn.id);
      }
      transaction = { ...transaction, burns };
      context.V1_Transaction.set(transaction);
    }

    if (from !== ADDRESS_ZERO && from !== pairAddress) {
      const created = await createLiquidityPosition(
        context,
        chainId,
        pairAddress,
        from,
        pair,
      );
      pair = created.pair; // keep any liquidityProviderCount increment
      const liquidityTokenBalance = await effectOrDefault(
        context,
        "getLpBalance(from)",
        {
          chain: chainId,
          pair: pairAddress,
          account: from,
          block: event.block.number,
        },
        created.position.liquidityTokenBalance,
        async () =>
          convertTokenToDecimal(
            await context.effect(getLpBalance, {
              chainId,
              pair: pairAddress,
              account: from,
              blockNumber: event.block.number,
            }),
            BI_18,
          ),
      );
      const updated = { ...created.position, liquidityTokenBalance };
      context.V1_LiquidityPosition.set(updated);
      await createLiquiditySnapshot(
        context,
        chainId,
        updated,
        event.block.number,
        event.block.timestamp,
        pair,
      );
    }

    if (to !== ADDRESS_ZERO && to !== pairAddress) {
      const created = await createLiquidityPosition(
        context,
        chainId,
        pairAddress,
        to,
        pair,
      );
      pair = created.pair;
      const liquidityTokenBalance = await effectOrDefault(
        context,
        "getLpBalance(to)",
        {
          chain: chainId,
          pair: pairAddress,
          account: to,
          block: event.block.number,
        },
        created.position.liquidityTokenBalance,
        async () =>
          convertTokenToDecimal(
            await context.effect(getLpBalance, {
              chainId,
              pair: pairAddress,
              account: to,
              blockNumber: event.block.number,
            }),
            BI_18,
          ),
      );
      const updated = { ...created.position, liquidityTokenBalance };
      context.V1_LiquidityPosition.set(updated);
      await createLiquiditySnapshot(
        context,
        chainId,
        updated,
        event.block.number,
        event.block.timestamp,
        pair,
      );
    }

    context.V1_Transaction.set(transaction);
  },
);

indexer.onEvent({ contract: "V1_Pair", event: "Sync" }, async ({ event, context }) => {
  const chainId = event.chainId;
  const pair0 = await context.V1_Pair.get(cid(chainId, event.srcAddress));
  if (pair0 === undefined) return;
  const token0_0 = await context.V1_Token.get(pair0.token0_id);
  const token1_0 = await context.V1_Token.get(pair0.token1_id);
  const factory0 = await context.V1_Factory.get(factoryId(chainId));
  if (token0_0 === undefined || token1_0 === undefined || factory0 === undefined) return;

  let factoryTotalLiquidityETH = minus(
    factory0.totalLiquidityETH,
    pair0.trackedReserveETH,
  );

  let t0TotalLiquidity = minus(token0_0.totalLiquidity, pair0.reserve0);
  let t1TotalLiquidity = minus(token1_0.totalLiquidity, pair0.reserve1);

  const reserve0 = convertTokenToDecimal(event.params.reserve0, token0_0.decimals);
  const reserve1 = convertTokenToDecimal(event.params.reserve1, token1_0.decimals);

  const token0Price = !reserve1.isZero() ? div(reserve0, reserve1) : ZERO_BD;
  const token1Price = !reserve0.isZero() ? div(reserve1, reserve0) : ZERO_BD;

  let pair = { ...pair0, reserve0, reserve1, token0Price, token1Price };
  context.V1_Pair.set(pair);

  const ethPrice = await getEthPriceInUSD(
    context,
    chainId,
    Number(event.block.number),
    pair,
  );
  context.V1_Bundle.set({ id: bundleId(chainId), ethPrice });

  const derived0 = await findEthPerToken(context, chainId, token0_0, pair);
  const derived1 = await findEthPerToken(context, chainId, token1_0, pair);

  let token0 = { ...token0_0, derivedETH: derived0 };
  let token1 = { ...token1_0, derivedETH: derived1 };
  context.V1_Token.set(token0);
  context.V1_Token.set(token1);

  const trackedLiquidityETH = !ethPrice.isZero()
    ? div(
        getTrackedLiquidityUSD(chainId, ethPrice, reserve0, token0, reserve1, token1),
        ethPrice,
      )
    : ZERO_BD;

  const reserveETH = plus(times(reserve0, derived0), times(reserve1, derived1));
  pair = {
    ...pair,
    trackedReserveETH: trackedLiquidityETH,
    reserveETH,
    reserveUSD: times(reserveETH, ethPrice),
  };

  factoryTotalLiquidityETH = plus(factoryTotalLiquidityETH, trackedLiquidityETH);
  const factory = {
    ...factory0,
    totalLiquidityETH: factoryTotalLiquidityETH,
    totalLiquidityUSD: times(factoryTotalLiquidityETH, ethPrice),
  };

  t0TotalLiquidity = plus(t0TotalLiquidity, reserve0);
  t1TotalLiquidity = plus(t1TotalLiquidity, reserve1);
  token0 = { ...token0, totalLiquidity: t0TotalLiquidity };
  token1 = { ...token1, totalLiquidity: t1TotalLiquidity };

  context.V1_Pair.set(pair);
  context.V1_Factory.set(factory);
  context.V1_Token.set(token0);
  context.V1_Token.set(token1);
});

indexer.onEvent({ contract: "V1_Pair", event: "Mint" }, async ({ event, context }) => {
  const chainId = event.chainId;
  const transaction = await context.V1_Transaction.get(cid(chainId, event.transaction.hash));
  if (transaction === undefined) return;
  const mints = transaction.mints;
  if (mints.length === 0) return;
  const mint0 = await context.V1_Mint.get(mints[mints.length - 1]!);
  if (mint0 === undefined) return;

  const pair0 = await context.V1_Pair.get(cid(chainId, event.srcAddress));
  const factory0 = await context.V1_Factory.get(factoryId(chainId));
  if (pair0 === undefined || factory0 === undefined) return;

  const token0_0 = await context.V1_Token.get(pair0.token0_id);
  const token1_0 = await context.V1_Token.get(pair0.token1_id);
  if (token0_0 === undefined || token1_0 === undefined) return;

  const token0Amount = convertTokenToDecimal(event.params.amount0, token0_0.decimals);
  const token1Amount = convertTokenToDecimal(event.params.amount1, token1_0.decimals);

  const token0 = { ...token0_0, txCount: token0_0.txCount + ONE_BI };
  const token1 = { ...token1_0, txCount: token1_0.txCount + ONE_BI };

  const bundle = await context.V1_Bundle.get(bundleId(chainId));
  const ethPrice = bundle?.ethPrice ?? ZERO_BD;
  let amountTotalUSD = ZERO_BD;
  if (token1.derivedETH != null && token0.derivedETH != null) {
    amountTotalUSD = times(
      plus(
        times(token1.derivedETH, token1Amount),
        times(token0.derivedETH, token0Amount),
      ),
      ethPrice,
    );
  }

  const pair = { ...pair0, txCount: pair0.txCount + ONE_BI };
  const factory = { ...factory0, txCount: factory0.txCount + ONE_BI };

  context.V1_Token.set(token0);
  context.V1_Token.set(token1);
  context.V1_Pair.set(pair);
  context.V1_Factory.set(factory);

  const mint = {
    ...mint0,
    sender: event.params.sender,
    amount0: token0Amount,
    amount1: token1Amount,
    logIndex: BigInt(event.logIndex),
    amountUSD: amountTotalUSD,
  };
  context.V1_Mint.set(mint);

  const created = await createLiquidityPosition(
    context,
    chainId,
    event.srcAddress,
    mint.to,
    pair,
  );
  await createLiquiditySnapshot(
    context,
    chainId,
    created.position,
    event.block.number,
    event.block.timestamp,
    created.pair,
  );

  await updatePairDayData(context, event);
  await updatePairHourData(context, event);
  await updateDayData(context, event, factory);
  await updateTokenDayData(context, token0, event);
  await updateTokenDayData(context, token1, event);
});

indexer.onEvent({ contract: "V1_Pair", event: "Burn" }, async ({ event, context }) => {
  const chainId = event.chainId;
  const transaction = await context.V1_Transaction.get(cid(chainId, event.transaction.hash));
  if (transaction === undefined) {
    return;
  }

  const burns = transaction.burns;
  if (burns.length === 0) return;
  const burn0 = await context.V1_Burn.get(burns[burns.length - 1]!);
  if (burn0 === undefined) return;

  const pair0 = await context.V1_Pair.get(cid(chainId, event.srcAddress));
  const factory0 = await context.V1_Factory.get(factoryId(chainId));
  if (pair0 === undefined || factory0 === undefined) return;

  const token0_0 = await context.V1_Token.get(pair0.token0_id);
  const token1_0 = await context.V1_Token.get(pair0.token1_id);
  if (token0_0 === undefined || token1_0 === undefined) return;

  const token0Amount = convertTokenToDecimal(event.params.amount0, token0_0.decimals);
  const token1Amount = convertTokenToDecimal(event.params.amount1, token1_0.decimals);

  const token0 = { ...token0_0, txCount: token0_0.txCount + ONE_BI };
  const token1 = { ...token1_0, txCount: token1_0.txCount + ONE_BI };

  const bundle = await context.V1_Bundle.get(bundleId(chainId));
  const ethPrice = bundle?.ethPrice ?? ZERO_BD;
  let amountTotalUSD = ZERO_BD;
  if (token1.derivedETH != null && token0.derivedETH != null) {
    amountTotalUSD = times(
      plus(
        times(token1.derivedETH, token1Amount),
        times(token0.derivedETH, token0Amount),
      ),
      ethPrice,
    );
  }

  const factory = { ...factory0, txCount: factory0.txCount + ONE_BI };
  const pair = { ...pair0, txCount: pair0.txCount + ONE_BI };

  context.V1_Token.set(token0);
  context.V1_Token.set(token1);
  context.V1_Pair.set(pair);
  context.V1_Factory.set(factory);

  const burn = {
    ...burn0,
    sender: event.params.sender,
    amount0: token0Amount,
    amount1: token1Amount,
    logIndex: BigInt(event.logIndex),
    amountUSD: amountTotalUSD,
  };
  context.V1_Burn.set(burn);

  const created = await createLiquidityPosition(
    context,
    chainId,
    event.srcAddress,
    burn.sender!,
    pair,
  );
  await createLiquiditySnapshot(
    context,
    chainId,
    created.position,
    event.block.number,
    event.block.timestamp,
    created.pair,
  );

  await updatePairDayData(context, event);
  await updatePairHourData(context, event);
  await updateDayData(context, event, factory);
  await updateTokenDayData(context, token0, event);
  await updateTokenDayData(context, token1, event);
});

indexer.onEvent({ contract: "V1_Pair", event: "Swap" }, async ({ event, context }) => {
  const chainId = event.chainId;
  const pair0 = await context.V1_Pair.get(cid(chainId, event.srcAddress));
  if (pair0 === undefined) return;
  const token0_0 = await context.V1_Token.get(pair0.token0_id);
  const token1_0 = await context.V1_Token.get(pair0.token1_id);
  if (token0_0 === undefined || token1_0 === undefined) return;

  const amount0In = convertTokenToDecimal(event.params.amount0In, token0_0.decimals);
  const amount1In = convertTokenToDecimal(event.params.amount1In, token1_0.decimals);
  const amount0Out = convertTokenToDecimal(event.params.amount0Out, token0_0.decimals);
  const amount1Out = convertTokenToDecimal(event.params.amount1Out, token1_0.decimals);

  const amount0Total = plus(amount0Out, amount0In);
  const amount1Total = plus(amount1Out, amount1In);

  const bundle = await context.V1_Bundle.get(bundleId(chainId));
  const ethPrice = bundle?.ethPrice ?? ZERO_BD;

  let derivedAmountETH = ZERO_BD;
  if (token1_0.derivedETH != null && token0_0.derivedETH != null) {
    derivedAmountETH = div(
      plus(
        times(token1_0.derivedETH, amount1Total),
        times(token0_0.derivedETH, amount0Total),
      ),
      TWO_BD,
    );
  }
  const derivedAmountUSD = times(derivedAmountETH, ethPrice);

  const trackedAmountUSD = getTrackedVolumeUSD(
    chainId,
    ethPrice,
    amount0Total,
    token0_0,
    amount1Total,
    token1_0,
    pair0,
  );

  const trackedAmountETH = ethPrice.isZero()
    ? ZERO_BD
    : div(trackedAmountUSD, ethPrice);

  const token0 = {
    ...token0_0,
    tradeVolume: plus(token0_0.tradeVolume, plus(amount0In, amount0Out)),
    tradeVolumeUSD: plus(token0_0.tradeVolumeUSD, trackedAmountUSD),
    untrackedVolumeUSD: plus(token0_0.untrackedVolumeUSD, derivedAmountUSD),
    txCount: token0_0.txCount + ONE_BI,
  };
  const token1 = {
    ...token1_0,
    tradeVolume: plus(token1_0.tradeVolume, plus(amount1In, amount1Out)),
    tradeVolumeUSD: plus(token1_0.tradeVolumeUSD, trackedAmountUSD),
    untrackedVolumeUSD: plus(token1_0.untrackedVolumeUSD, derivedAmountUSD),
    txCount: token1_0.txCount + ONE_BI,
  };

  const pair = {
    ...pair0,
    volumeUSD: plus(pair0.volumeUSD, trackedAmountUSD),
    volumeToken0: plus(pair0.volumeToken0, amount0Total),
    volumeToken1: plus(pair0.volumeToken1, amount1Total),
    untrackedVolumeUSD: plus(pair0.untrackedVolumeUSD, derivedAmountUSD),
    txCount: pair0.txCount + ONE_BI,
  };
  context.V1_Pair.set(pair);

  const factory0 = await context.V1_Factory.get(factoryId(chainId));
  if (factory0 === undefined) return;
  const factory = {
    ...factory0,
    totalVolumeUSD: plus(factory0.totalVolumeUSD, trackedAmountUSD),
    totalVolumeETH: plus(factory0.totalVolumeETH, trackedAmountETH),
    untrackedVolumeUSD: plus(factory0.untrackedVolumeUSD, derivedAmountUSD),
    txCount: factory0.txCount + ONE_BI,
  };

  context.V1_Pair.set(pair);
  context.V1_Token.set(token0);
  context.V1_Token.set(token1);
  context.V1_Factory.set(factory);

  const txId = cid(chainId, event.transaction.hash);
  let transaction = await context.V1_Transaction.get(txId);
  if (transaction === undefined) {
    transaction = {
      id: txId,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      mints: [],
      swaps: [],
      burns: [],
    };
  }
  const swaps = [...transaction.swaps];
  const swapId = `${transaction.id}-${swaps.length}`;

  context.V1_Swap.set({
    id: swapId,
    transaction_id: transaction.id,
    pair_id: pair.id,
    timestamp: transaction.timestamp,
    sender: event.params.sender,
    amount0In,
    amount1In,
    amount0Out,
    amount1Out,
    to: event.params.to,
    from: event.transaction.from!,
    logIndex: BigInt(event.logIndex),
    amountUSD: trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD,
  });

  swaps.push(swapId);
  transaction = { ...transaction, swaps };
  context.V1_Transaction.set(transaction);

  const pairDayData = await updatePairDayData(context, event);
  const pairHourData = await updatePairHourData(context, event);
  const dayData = await updateDayData(context, event, factory);
  const token0DayData = await updateTokenDayData(context, token0, event);
  const token1DayData = await updateTokenDayData(context, token1, event);

  context.V1_DayData.set({
    ...dayData,
    dailyVolumeUSD: plus(dayData.dailyVolumeUSD, trackedAmountUSD),
    dailyVolumeETH: plus(dayData.dailyVolumeETH, trackedAmountETH),
    dailyVolumeUntracked: plus(dayData.dailyVolumeUntracked, derivedAmountUSD),
  });

  context.V1_PairDayData.set({
    ...pairDayData,
    dailyVolumeToken0: plus(pairDayData.dailyVolumeToken0, amount0Total),
    dailyVolumeToken1: plus(pairDayData.dailyVolumeToken1, amount1Total),
    dailyVolumeUSD: plus(pairDayData.dailyVolumeUSD, trackedAmountUSD),
  });

  context.V1_PairHourData.set({
    ...pairHourData,
    hourlyVolumeToken0: plus(pairHourData.hourlyVolumeToken0, amount0Total),
    hourlyVolumeToken1: plus(pairHourData.hourlyVolumeToken1, amount1Total),
    hourlyVolumeUSD: plus(pairHourData.hourlyVolumeUSD, trackedAmountUSD),
  });

  context.V1_TokenDayData.set({
    ...token0DayData,
    dailyVolumeToken: plus(token0DayData.dailyVolumeToken, amount0Total),
    dailyVolumeETH: plus(
      token0DayData.dailyVolumeETH,
      times(amount0Total, token0.derivedETH ?? ZERO_BD),
    ),
    dailyVolumeUSD: plus(
      token0DayData.dailyVolumeUSD,
      times(times(amount0Total, token0.derivedETH ?? ZERO_BD), ethPrice),
    ),
  });

  context.V1_TokenDayData.set({
    ...token1DayData,
    dailyVolumeToken: plus(token1DayData.dailyVolumeToken, amount1Total),
    dailyVolumeETH: plus(
      token1DayData.dailyVolumeETH,
      times(amount1Total, token1.derivedETH ?? ZERO_BD),
    ),
    dailyVolumeUSD: plus(
      token1DayData.dailyVolumeUSD,
      times(times(amount1Total, token1.derivedETH ?? ZERO_BD), ethPrice),
    ),
  });
});
