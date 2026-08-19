/** Per-chain constants for the analytics indexer, keyed by chain ID. */
export const TAC = 239;
export const PLASMA = 9745;

export type AnalyticsChainConfig = {
  readonly name: string;
  readonly factoryAddress: string;
  readonly nonfungiblePositionManager: string;
  readonly referenceToken: string;
  readonly stableTokenPool: string;
  readonly minimumNativeLocked: string;
  readonly whitelistTokens: readonly string[];
  readonly stableCoins: readonly string[];
};

const CHAIN_CONFIG: Record<number, AnalyticsChainConfig> = {
  [TAC]: {
    name: "lynex-tac",
    factoryAddress: "0x10253594a832f967994b44f33411940533302acb",
    nonfungiblePositionManager: "0x69d57b9d705ead73a5d2f2476c30c55bd755cc2f",
    referenceToken: "0xb63b9f0eb4a6e6f191529d71d4d88cc8900df2c9",
    stableTokenPool: "0xdd571223f8605805154b3f0c154fc0e1ddad5eb6",
    minimumNativeLocked: "40000",
    whitelistTokens: [
      "0xb63b9f0eb4a6e6f191529d71d4d88cc8900df2c9", // WTAC
      "0xaf988c3f7cb2aceabb15f96b19388a259b6c438f", // USD₮
      "0x61d66bc21fed820938021b06e9b2291f3fb91945", // WETH
      "0xaf368c91793cb22739386dfcbbb2f1a9e4bcbebf", // wstETH
      "0xb76d91340f5ce3577f0a056d29f6e3eb4e88b140", // TON
      "0xb1b385542b6e80f77b94393ba8342c3af699f15c", // USR
      "0xae4efbc7736f963982aacb17efa37fcbab924cb3",
      "0xf9775085d726e782e83585033b58606f7731ab18", // uniBTC
      "0xecac9c5f704e954931349da37f60e39f515c11c1", // LBTC
      "0x7048c9e4abd0cf0219e95a17a8c6908dfc4f0ee4", // cbBTC
    ],
    stableCoins: [
      "0xaf988c3f7cb2aceabb15f96b19388a259b6c438f", // USD₮
    ],
  },

  [PLASMA]: {
    name: "lynex-plasma",
    factoryAddress: "0x51f563c1b2885da02f0eef2367574e6bc567d151",
    nonfungiblePositionManager: "0xb02d6225814af67efdac5e307fe30c8f12a2a988",
    referenceToken: "0x6100e367285b01f48d07953803a2d8dca5d19873",
    stableTokenPool: "0x2d9966906b8091809789ee5c079ee9b20df62d88",
    minimumNativeLocked: "400",
    whitelistTokens: [
      "0x6100e367285b01f48d07953803a2d8dca5d19873", // WXPL
      "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb", // USDT
      "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34", // USDe
      "0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2", // sUSDe
      "0x9895d81bb462a195b4922ed7de0e3acd007c32cb", // WETH
      "0xa3d68b74bf0528fdd07263c60d6488749044914b", // weETH
      "0x0a1a1a107e45b7ced86833863f482bc5f4ed82ef", // USDai
      "0x1b64b9025eebb9a6239575df9ea4b9ac46d4d193", // XAUt0
      "0x0b2b2b2076d95dda7817e785989fe353fe955ef9", // sUSDai
      "0xd1074e0ae85610ddba0147e29ebe0d8e5873a000", // PlasmaUSD
      "0x5e494e8912319cefb1d4fa516807bb65a8cb9e40", // fWETH
      "0xc4374775489cb9c56003bf2c9b12495fc64f0771", // syrupUSDT
      "0x58538e6a46e07434d7e7375bc268d3cb839c0133", // ENA
      "0x17bac5f906c9a0282ac06a59958d85796c831f24", // PENDLE
      "0x133a09dd6169f6f0509658a911f2a82fc8ab6a0d", // INX
      "0xf94451f19294da68a40e4dd52cfac7c8bd66b93c", // oINX
      "0xa5df3ba1e6ceacd92700af088c565d4f85591342", // bveINX
      "0xe561fe05c39075312aa9bc6af79ddae981461359", // wrsETH
      "0x6eaf19b2fc24552925db245f9ff613157a7dbb4c", // xUSD
    ],
    stableCoins: [
      "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb", // USDT
      "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34", // USDe
      "0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2", // sUSDe
      "0x1b64b9025eebb9a6239575df9ea4b9ac46d4d193", // XAUt0
      "0x0a1a1a107e45b7ced86833863f482bc5f4ed82ef", // USDai
      "0x0b2b2b2076d95dda7817e785989fe353fe955ef9", // sUSDai
      "0x6eaf19b2fc24552925db245f9ff613157a7dbb4c", // xUSD
      "0xd1074e0ae85610ddba0147e29ebe0d8e5873a000", // PlasmaUSD
      "0xc4374775489cb9c56003bf2c9b12495fc64f0771", // syrupUSDT
    ],
  },
};

export function chainConfig(chainId: number): AnalyticsChainConfig {
  const cfg = CHAIN_CONFIG[chainId];
  if (!cfg) {
    throw new Error(
      `Chain ${chainId} is not configured in src/analytics/config/chain.ts. ` +
        `Add it to CHAIN_CONFIG before binding Analytics_* contracts to it in ` +
        `config.yaml.`,
    );
  }
  return cfg;
}

export function isAnalyticsChain(chainId: number): boolean {
  return CHAIN_CONFIG[chainId] !== undefined;
}

const DEFAULT_RPC: Record<number, string> = {
  [TAC]: "https://rpc.ankr.com/tac",
  [PLASMA]: "https://rpc.plasma.to",
};

export function rpcUrl(chainId: number): string {
  const configured = process.env[`ENVIO_RPC_URL_${chainId}`];
  if (configured) return configured;

  const fallback = DEFAULT_RPC[chainId];
  if (!fallback) {
    throw new Error(
      `No RPC configured for chain ${chainId}. Set ENVIO_RPC_URL_${chainId} ` +
        `to an archive node — the mappings make historical eth_calls.`,
    );
  }
  console.warn(
    `[analytics/effects] ENVIO_RPC_URL_${chainId} is not set — falling back to ` +
      `${fallback}, which may be rate limited or pruned and may not serve ` +
      `historical eth_call.`,
  );
  return fallback;
}

export function cid(chainId: number, id: string): string {
  return `${chainId}-${id}`;
}

export function stripCid(id: string): string {
  return id.replace(/^\d+-/, "");
}

export function singletonId(chainId: number): string {
  return cid(chainId, "1");
}

export function factoryId(chainId: number): string {
  return cid(chainId, chainConfig(chainId).factoryAddress);
}

export function referenceTokenId(chainId: number): string {
  return cid(chainId, chainConfig(chainId).referenceToken);
}

export function stableTokenPoolId(chainId: number): string {
  return cid(chainId, chainConfig(chainId).stableTokenPool);
}

const whitelistIdCache = new Map<number, ReadonlySet<string>>();
export function whitelistTokenIds(chainId: number): ReadonlySet<string> {
  let set = whitelistIdCache.get(chainId);
  if (set === undefined) {
    set = new Set(
      chainConfig(chainId).whitelistTokens.map((a) => cid(chainId, a)),
    );
    whitelistIdCache.set(chainId, set);
  }
  return set;
}

const stableCoinIdCache = new Map<number, ReadonlySet<string>>();
export function stableCoinIds(chainId: number): ReadonlySet<string> {
  let set = stableCoinIdCache.get(chainId);
  if (set === undefined) {
    set = new Set(chainConfig(chainId).stableCoins.map((a) => cid(chainId, a)));
    stableCoinIdCache.set(chainId, set);
  }
  return set;
}
