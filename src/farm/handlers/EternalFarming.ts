/** Eternal farming handlers. */
import { indexer } from "envio";
import { computeIncentiveId } from "../utils/incentiveId.js";

indexer.onEvent(
  { contract: "EternalFarming", event: "EternalFarmingCreated" },
  async ({ event, context }) => {
    const id = computeIncentiveId(
      event.params.rewardToken,
      event.params.bonusRewardToken,
      event.params.pool,
      event.params.nonce,
    );

    let farming = await context.Farm_EternalFarming.get(id);
    if (farming === undefined) {
      farming = {
        id,
        rewardToken: event.params.rewardToken,
        bonusRewardToken: event.params.bonusRewardToken,
        virtualPool: event.params.virtualPool,
        pool: event.params.pool,
        nonce: event.params.nonce,
        reward: 0n,
        bonusReward: 0n,
        rewardRate: 0n,
        bonusRewardRate: 0n,
        isDeactivated: false,
        minRangeLength: event.params.minimalAllowedPositionWidth,
      };
    }

    context.Farm_EternalFarming.set({
      ...farming,
      rewardToken: event.params.rewardToken,
      bonusRewardToken: event.params.bonusRewardToken,
      pool: event.params.pool,
      nonce: event.params.nonce,
      virtualPool: event.params.virtualPool,
      isDeactivated: false,
      minRangeLength: event.params.minimalAllowedPositionWidth,
    });
  },
);

indexer.onEvent(
  { contract: "EternalFarming", event: "FarmEntered" },
  async ({ event, context }) => {
    const deposit = await context.Farm_Deposit.get(event.params.tokenId.toString());
    if (deposit === undefined) return;

    context.Farm_Deposit.set({
      ...deposit,
      eternalFarming: event.params.incentiveId,
    });
  },
);

indexer.onEvent(
  { contract: "EternalFarming", event: "FarmEnded" },
  async ({ event, context }) => {
    const deposit = await context.Farm_Deposit.get(event.params.tokenId.toString());

    if (deposit?.eternalFarming !== undefined) {
      const farming = await context.Farm_EternalFarming.get(deposit.eternalFarming);
      if (farming !== undefined) {
        context.Farm_EternalFarming.set({
          ...farming,
          reward: farming.reward - event.params.reward,
          bonusReward: farming.bonusReward - event.params.bonusReward,
        });
      }
    }

    if (deposit !== undefined) {
      context.Farm_Deposit.set({
        ...deposit,
        eternalFarming: undefined,
      });
    }

    {
      const id = `${event.params.rewardAddress}${event.params.owner}`;
      const existing = await context.Farm_Reward.get(id);
      context.Farm_Reward.set({
        id,
        owner: event.params.owner,
        rewardAddress: event.params.rewardAddress,
        amount: (existing?.amount ?? 0n) + event.params.reward,
      });
    }

    {
      const id = `${event.params.bonusRewardToken}${event.params.owner}`;
      const existing = await context.Farm_Reward.get(id);
      context.Farm_Reward.set({
        id,
        owner: event.params.owner,
        rewardAddress: event.params.bonusRewardToken,
        amount: (existing?.amount ?? 0n) + event.params.bonusReward,
      });
    }
  },
);

indexer.onEvent(
  { contract: "EternalFarming", event: "RewardClaimed" },
  async ({ event, context }) => {
    const id = `${event.params.rewardAddress}${event.params.owner}`;
    const reward = await context.Farm_Reward.get(id);
    if (reward === undefined) return;

    context.Farm_Reward.set({
      ...reward,
      owner: event.params.owner,
      rewardAddress: event.params.rewardAddress,
      amount: reward.amount - event.params.reward,
    });
  },
);

indexer.onEvent(
  { contract: "EternalFarming", event: "IncentiveDeactivated" },
  async ({ event, context }) => {
    const farming = await context.Farm_EternalFarming.get(event.params.incentiveId);
    if (farming === undefined) return;

    context.Farm_EternalFarming.set({
      ...farming,
      isDeactivated: true,
    });
  },
);

indexer.onEvent(
  { contract: "EternalFarming", event: "RewardsRatesChanged" },
  async ({ event, context }) => {
    const farming = await context.Farm_EternalFarming.get(event.params.incentiveId);
    if (farming === undefined) return;

    context.Farm_EternalFarming.set({
      ...farming,
      rewardRate: event.params.rewardRate,
      bonusRewardRate: event.params.bonusRewardRate,
    });
  },
);

indexer.onEvent(
  { contract: "EternalFarming", event: "RewardsAdded" },
  async ({ event, context }) => {
    const farming = await context.Farm_EternalFarming.get(event.params.incentiveId);
    if (farming === undefined) return;

    context.Farm_EternalFarming.set({
      ...farming,
      reward: farming.reward + event.params.rewardAmount,
      bonusReward: farming.bonusReward + event.params.bonusRewardAmount,
    });
  },
);

indexer.onEvent(
  { contract: "EternalFarming", event: "RewardAmountsDecreased" },
  async ({ event, context }) => {
    const farming = await context.Farm_EternalFarming.get(event.params.incentiveId);
    if (farming === undefined) return;

    context.Farm_EternalFarming.set({
      ...farming,
      reward: farming.reward - event.params.rewardAmount,
      bonusReward: farming.bonusReward - event.params.bonusRewardAmount,
    });
  },
);

indexer.onEvent(
  { contract: "EternalFarming", event: "RewardsCollected" },
  async ({ event, context }) => {
    const deposit = await context.Farm_Deposit.get(event.params.tokenId.toString());
    if (deposit?.eternalFarming === undefined) return;

    const farming = await context.Farm_EternalFarming.get(deposit.eternalFarming);
    if (farming === undefined) return;

    context.Farm_EternalFarming.set({
      ...farming,
      reward: farming.reward - event.params.rewardAmount,
      bonusReward: farming.bonusReward - event.params.bonusRewardAmount,
    });

    {
      const id = `${farming.rewardToken}${deposit.owner}`;
      const existing = await context.Farm_Reward.get(id);
      context.Farm_Reward.set({
        id,
        owner: deposit.owner,
        rewardAddress: farming.rewardToken,
        amount: (existing?.amount ?? 0n) + event.params.rewardAmount,
      });
    }

    {
      const id = `${farming.bonusRewardToken}${deposit.owner}`;
      const existing = await context.Farm_Reward.get(id);
      context.Farm_Reward.set({
        id,
        owner: deposit.owner,
        rewardAddress: farming.bonusRewardToken,
        amount: (existing?.amount ?? 0n) + event.params.bonusRewardAmount,
      });
    }
  },
);
