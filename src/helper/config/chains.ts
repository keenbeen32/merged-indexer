/** Per-chain configuration for the helper indexer. */
export const LINEA = 59144;
export const ZIRCUIT = 48900;
export const PLASMA = 9745;
export const INJECTIVE = 1776;
export const ROBINHOOD = 4663;

/**
 * Public endpoints, used only as a last-resort fallback. There is no Zircuit
 * default on purpose: rpcUrl() should throw up front naming the variable to
 * set, rather than failing mid-sync.
 */
const DEFAULT_RPC: Record<number, string> = {
  [LINEA]: "https://rpc.linea.build",
  [PLASMA]: "https://rpc.plasma.to",
  [INJECTIVE]: "https://sentry.evm-rpc.injective.network",
  [ROBINHOOD]: "https://rpc.mainnet.chain.robinhood.com",
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
    `[effects] ENVIO_RPC_URL_${chainId} is not set — falling back to ${fallback}, ` +
      `which may be rate limited or pruned and may not serve historical eth_call.`,
  );
  return fallback;
}

export type Polling = { startBlock: number; every: number };

export type VeTokenPolling = Polling & { veToken: string };

export type ChainFeatures = {
  vePoints: boolean;
  preMining: boolean;
  divideByZero: "throw" | "guard";
  gaugePolling?: Polling;
  veTokenPolling?: VeTokenPolling;
};

const FEATURES: Record<number, ChainFeatures> = {
  [LINEA]: { vePoints: false, preMining: false, divideByZero: "throw" },
  [ZIRCUIT]: { vePoints: false, preMining: true, divideByZero: "throw" },
  [PLASMA]: {
    vePoints: true,
    preMining: false,
    divideByZero: "guard",
    gaugePolling: { startBlock: 2074397, every: 86400 },
    veTokenPolling: {
      startBlock: 2074210,
      every: 86400,
      veToken: "0xdd9c7aad00fed3b49c3ebf95f1e3b75c305f5580",
    },
  },
  [INJECTIVE]: {
    vePoints: true,
    preMining: false,
    divideByZero: "guard",
    gaugePolling: { startBlock: 141332762, every: 32727 },
    veTokenPolling: {
      startBlock: 167370589,
      every: 32727,
      veToken: "0xdaedd5358398b9693a6a5770db1bd50bc4cbb654",
    },
  },
  [ROBINHOOD]: {
    vePoints: true,
    preMining: false,
    divideByZero: "guard",
    gaugePolling: { startBlock: 1966166, every: 69000 },
    veTokenPolling: {
      startBlock: 1964611,
      every: 69000,
      veToken: "0x18657ff9943faa5d16c6ea1bc13dd8767984c30e",
    },
  },
};

export function features(chainId: number): ChainFeatures {
  const f = FEATURES[chainId];
  if (!f) {
    throw new Error(
      `Chain ${chainId} is not configured in src/config/chains.ts. Add it to ` +
        `FEATURES before adding it to config.yaml.`,
    );
  }
  return f;
}

export function cid(chainId: number, id: string): string {
  return `${chainId}-${id}`;
}

export function stripCid(id: string): string {
  return id.replace(/^\d+-/, "");
}

export const STATE_ID = "IONEX";
export function gaugeStateId(chainId: number): string {
  return cid(chainId, STATE_ID);
}

export function isHelperChain(chainId: number): boolean {
  return FEATURES[chainId] !== undefined;
}
