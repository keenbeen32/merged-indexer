/** Farm position manager handlers. */
import { indexer } from "envio";

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "IncreaseLiquidity" },
  async ({ event, context }) => {
    const id = event.params.tokenId.toString();
    const existing = await context.Farm_Deposit.get(id);
    const deposit =
      existing ??
      ({
        id,
        owner: event.transaction.from!,
        pool: event.params.pool,
        eternalFarming: undefined,
        liquidity: 0n,
      } as const);

    context.Farm_Deposit.set({
      ...deposit,
      liquidity: deposit.liquidity + event.params.actualLiquidity,
    });
  },
);

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "DecreaseLiquidity" },
  async ({ event, context }) => {
    const deposit = await context.Farm_Deposit.get(event.params.tokenId.toString());
    if (deposit === undefined) return;

    context.Farm_Deposit.set({
      ...deposit,
      liquidity: deposit.liquidity - event.params.liquidity,
    });
  },
);

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "Transfer" },
  async ({ event, context }) => {
    const deposit = await context.Farm_Deposit.get(event.params.tokenId.toString());
    if (deposit === undefined) return;

    context.Farm_Deposit.set({
      ...deposit,
      owner: event.params.to,
    });
  },
);
