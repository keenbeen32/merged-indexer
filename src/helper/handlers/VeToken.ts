/** ve lock handlers. */
import { indexer } from "envio";
import type { Helper_VeLock as VeLock, Helper_VeToken as VeToken, Helper_VeTokenSnapshot as VeTokenSnapshot, Helper_VeUser as VeUser, Helper_VeUserLockDelta as VeUserLockDelta, EvmOnEventContext } from "envio";
import { getVeLockStartTime, getVeTokenMetadata } from "../effects.js";
import { cid, features } from "../config/chains.js";
import { ONE_BI, ZERO_ADDRESS, ZERO_BI, concatI32 } from "../helpers.js";

type HandlerContext = EvmOnEventContext;

function unprefix(id: string): string {
  return id.replace(/^\d+-/, "");
}

export async function ensureVeToken(
  context: HandlerContext,
  chainId: number,
  contractAddress: string,
  blockNumber: number,
): Promise<VeToken> {
  const id = cid(chainId, contractAddress);
  const existing = await context.Helper_VeToken.get(id);
  if (existing !== undefined) return existing;

  const meta = await context.effect(getVeTokenMetadata, {
    chainId,
    veToken: contractAddress,
    blockNumber,
  });
  const ve: VeToken = {
    id,
    tokenAddress: contractAddress,
    name: meta.name,
    symbol: meta.symbol,
    decimals: meta.decimals,
    totalSupply: meta.totalSupply,
    totalLocked: ZERO_BI,
  };
  context.Helper_VeToken.set(ve);
  return ve;
}

async function ensureUser(
  context: HandlerContext,
  chainId: number,
  address: string,
): Promise<VeUser> {
  const id = cid(chainId, address);
  const existing = await context.Helper_VeUser.get(id);
  if (existing !== undefined) return existing;

  const user: VeUser = {
    id,
    totalLocked: ZERO_BI,
    totalVotingPower: ZERO_BI,
    lockCount: ZERO_BI,
  };
  context.Helper_VeUser.set(user);
  return user;
}

async function ensureLock(
  context: HandlerContext,
  chainId: number,
  tokenId: bigint,
  contractAddress: string,
  blockNumber: number,
): Promise<VeLock> {
  const id = cid(chainId, tokenId.toString());
  const existing = await context.Helper_VeLock.get(id);
  if (existing !== undefined) return existing;

  const ve = await ensureVeToken(context, chainId, contractAddress, blockNumber);
  const lock: VeLock = {
    id,
    veToken_id: ve.id,
    user_id: cid(chainId, ZERO_ADDRESS),
    owner: ZERO_ADDRESS,
    value: ZERO_BI,
    startTime: ZERO_BI,
    endTime: ZERO_BI,
    isPermanent: false,
    createdAt: ZERO_BI,
    updatedAt: ZERO_BI,
    burned: false,
  };
  context.Helper_VeLock.set(lock);
  return lock;
}

function addUserDelta(
  context: HandlerContext,
  chainId: number,
  userId: string,
  tokenId: bigint,
  delta: bigint,
  reason: string,
  transactionHash: string,
  logIndex: number,
  blockNumber: number,
  blockTimestamp: number,
): void {
  const entity: VeUserLockDelta = {
    id: cid(chainId, concatI32(transactionHash, logIndex)),
    user_id: userId,
    tokenId,
    delta,
    reason,
    blockNumber: BigInt(blockNumber),
    blockTimestamp: BigInt(blockTimestamp),
    transactionHash,
  };
  context.Helper_VeUserLockDelta.set(entity);
}

indexer.onEvent(
  { contract: "VeToken", event: "LockCreated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const ve = await ensureVeToken(context, chainId, event.srcAddress, event.block.number);
    const user = await ensureUser(context, chainId, event.params.to);
    const lock = await ensureLock(
      context,
      chainId,
      event.params.tokenId,
      event.srcAddress,
      event.block.number,
    );

    const { startTime } = await context.effect(getVeLockStartTime, {
      chainId,
      veToken: event.srcAddress,
      tokenId: event.params.tokenId,
      blockNumber: event.block.number,
    });

    context.Helper_VeLock.set({
      ...lock,
      owner: event.params.to,
      user_id: user.id,
      value: event.params.value,
      endTime: event.params.unlockTime,
      isPermanent: event.params.isPermanent,
      createdAt: BigInt(event.block.timestamp),
      updatedAt: BigInt(event.block.timestamp),
      burned: false,
      startTime: startTime ?? lock.startTime,
    });

    context.Helper_VeUser.set({
      ...user,
      lockCount: user.lockCount + ONE_BI,
      totalLocked: user.totalLocked + event.params.value,
    });
    context.Helper_VeToken.set({ ...ve, totalLocked: ve.totalLocked + event.params.value });

    addUserDelta(
      context,
      chainId,
      user.id,
      event.params.tokenId,
      event.params.value,
      "create",
      event.transaction.hash,
      event.logIndex,
      event.block.number,
      event.block.timestamp,
    );
  },
);

indexer.onEvent(
  { contract: "VeToken", event: "LockAmountIncreased" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const ve = await ensureVeToken(context, chainId, event.srcAddress, event.block.number);
    const lock = await ensureLock(
      context,
      chainId,
      event.params.tokenId,
      event.srcAddress,
      event.block.number,
    );
    const user = await ensureUser(context, chainId, unprefix(lock.user_id));

    context.Helper_VeLock.set({
      ...lock,
      value: lock.value + event.params.value,
      updatedAt: BigInt(event.block.timestamp),
    });
    context.Helper_VeUser.set({ ...user, totalLocked: user.totalLocked + event.params.value });
    context.Helper_VeToken.set({ ...ve, totalLocked: ve.totalLocked + event.params.value });

    addUserDelta(
      context,
      chainId,
      user.id,
      event.params.tokenId,
      event.params.value,
      "increaseAmount",
      event.transaction.hash,
      event.logIndex,
      event.block.number,
      event.block.timestamp,
    );
  },
);

indexer.onEvent(
  { contract: "VeToken", event: "LockDurationExtended" },
  async ({ event, context }) => {
    const lock = await ensureLock(
      context,
      event.chainId,
      event.params.tokenId,
      event.srcAddress,
      event.block.number,
    );
    context.Helper_VeLock.set({
      ...lock,
      endTime: event.params.newUnlockTime,
      isPermanent: event.params.isPermanent,
      updatedAt: BigInt(event.block.timestamp),
    });
  },
);

indexer.onEvent(
  { contract: "VeToken", event: "LockUpdated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const ve = await ensureVeToken(context, chainId, event.srcAddress, event.block.number);
    const lock = await ensureLock(
      context,
      chainId,
      event.params.tokenId,
      event.srcAddress,
      event.block.number,
    );
    const user = await ensureUser(context, chainId, unprefix(lock.user_id));

    const delta = event.params.value - lock.value;

    context.Helper_VeLock.set({
      ...lock,
      value: event.params.value,
      endTime: event.params.unlockTime,
      isPermanent: event.params.isPermanent,
      updatedAt: BigInt(event.block.timestamp),
    });

    if (delta !== ZERO_BI) {
      context.Helper_VeUser.set({ ...user, totalLocked: user.totalLocked + delta });
      context.Helper_VeToken.set({ ...ve, totalLocked: ve.totalLocked + delta });
      addUserDelta(
        context,
        chainId,
        user.id,
        event.params.tokenId,
        delta,
        "update",
        event.transaction.hash,
        event.logIndex,
        event.block.number,
        event.block.timestamp,
      );
    }
  },
);

indexer.onEvent(
  { contract: "VeToken", event: "LockMerged" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const ve = await ensureVeToken(context, chainId, event.srcAddress, event.block.number);
    const fromLock = await ensureLock(
      context,
      chainId,
      event.params.fromTokenId,
      event.srcAddress,
      event.block.number,
    );
    const toLock = await ensureLock(
      context,
      chainId,
      event.params.toTokenId,
      event.srcAddress,
      event.block.number,
    );

    context.Helper_VeLock.set({
      ...toLock,
      value: event.params.totalValue,
      endTime: event.params.unlockTime,
      isPermanent: event.params.isPermanent,
      updatedAt: BigInt(event.block.timestamp),
    });

    const fromValue = fromLock.value;
    const fromUser = await ensureUser(context, chainId, unprefix(fromLock.user_id));

    context.Helper_VeLock.set({
      ...fromLock,
      value: ZERO_BI,
      burned: true,
      updatedAt: BigInt(event.block.timestamp),
    });

    const toUser = await ensureUser(context, chainId, unprefix(toLock.user_id));

    if (fromValue > ZERO_BI) {
      context.Helper_VeUser.set({ ...fromUser, totalLocked: fromUser.totalLocked - fromValue });
      addUserDelta(
        context,
        chainId,
        fromUser.id,
        event.params.fromTokenId,
        -fromValue,
        "merge-out",
        event.transaction.hash,
        event.logIndex,
        event.block.number,
        event.block.timestamp,
      );

      context.Helper_VeUser.set({ ...toUser, totalLocked: toUser.totalLocked + fromValue });
      addUserDelta(
        context,
        chainId,
        toUser.id,
        event.params.toTokenId,
        fromValue,
        "merge-in",
        event.transaction.hash,
        event.logIndex,
        event.block.number,
        event.block.timestamp,
      );
    }

    context.Helper_VeToken.set(ve);
  },
);

indexer.onEvent({ contract: "VeToken", event: "LockSplit" }, async () => {});

indexer.onEvent(
  { contract: "VeToken", event: "Transfer" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const from = event.params.from;
    const to = event.params.to;
    const tokenId = event.params.tokenId;

    const lock = await ensureLock(
      context,
      chainId,
      tokenId,
      event.srcAddress,
      event.block.number,
    );
    const value = lock.value;

    if (from === ZERO_ADDRESS) {
      const newUser = await ensureUser(context, chainId, to);
      context.Helper_VeLock.set({
        ...lock,
        owner: to,
        user_id: newUser.id,
        updatedAt: BigInt(event.block.timestamp),
      });
      return;
    }

    if (to === ZERO_ADDRESS) {
      const ve = await ensureVeToken(context, chainId, event.srcAddress, event.block.number);
      const oldUser = await ensureUser(context, chainId, unprefix(lock.user_id));
      context.Helper_VeLock.set({
        ...lock,
        burned: true,
        updatedAt: BigInt(event.block.timestamp),
      });

      if (value > ZERO_BI) {
        context.Helper_VeUser.set({
          ...oldUser,
          totalLocked: oldUser.totalLocked - value,
          lockCount: oldUser.lockCount - ONE_BI,
        });
        context.Helper_VeToken.set({ ...ve, totalLocked: ve.totalLocked - value });
        addUserDelta(
          context,
          chainId,
          oldUser.id,
          tokenId,
          -value,
          "burn",
          event.transaction.hash,
          event.logIndex,
          event.block.number,
          event.block.timestamp,
        );
      }
      return;
    }

    const fromUser = await ensureUser(context, chainId, unprefix(lock.user_id));
    const toUser = await ensureUser(context, chainId, to);

    context.Helper_VeLock.set({
      ...lock,
      owner: to,
      user_id: toUser.id,
      updatedAt: BigInt(event.block.timestamp),
    });

    if (value > ZERO_BI) {
      context.Helper_VeUser.set({ ...fromUser, totalLocked: fromUser.totalLocked - value });
      addUserDelta(
        context,
        chainId,
        fromUser.id,
        tokenId,
        -value,
        "transfer-out",
        event.transaction.hash,
        event.logIndex,
        event.block.number,
        event.block.timestamp,
      );

      context.Helper_VeUser.set({ ...toUser, totalLocked: toUser.totalLocked + value });
      addUserDelta(
        context,
        chainId,
        toUser.id,
        tokenId,
        value,
        "transfer-in",
        event.transaction.hash,
        event.logIndex,
        event.block.number,
        event.block.timestamp,
      );
    }
  },
);

indexer.onEvent(
  { contract: "VeToken", event: "SupplyUpdated" },
  async ({ event, context }) => {
    const ve = await ensureVeToken(
      context,
      event.chainId,
      event.srcAddress,
      event.block.number,
    );
    context.Helper_VeToken.set({ ...ve, totalSupply: event.params.newSupply });
  },
);

indexer.onEvent({ contract: "VeToken", event: "PayoutClaimed" }, async () => {});

indexer.onEvent(
  { contract: "VeToken", event: "UnlockPermanent" },
  async ({ event, context }) => {
    const lock = await ensureLock(
      context,
      event.chainId,
      event.params.tokenId,
      event.srcAddress,
      event.block.number,
    );
    context.Helper_VeLock.set({
      ...lock,
      endTime: event.params.unlockTime,
      isPermanent: false,
      updatedAt: BigInt(event.block.timestamp),
    });
  },
);

export async function handleVeBlock(
  context: HandlerContext,
  chainId: number,
  blockNumber: number,
  blockTimestamp: number,
): Promise<void> {
  const polling = features(chainId).veTokenPolling;
  if (polling === undefined) return;

  const ve = await ensureVeToken(context, chainId, polling.veToken, blockNumber);
  const snapshot: VeTokenSnapshot = {
    id: `${ve.id}-${blockTimestamp}`,
    veToken_id: ve.id,
    blockNumber: BigInt(blockNumber),
    blockTimestamp: BigInt(blockTimestamp),
    totalSupply: ve.totalSupply,
    totalLocked: ve.totalLocked,
  };
  context.Helper_VeTokenSnapshot.set(snapshot);
}
