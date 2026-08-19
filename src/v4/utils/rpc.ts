/** viem clients for the v4 contract reads. */
import { createPublicClient, http, type PublicClient } from "viem";
import {
  INJECTIVE_CHAIN_ID,
  INJECTIVE_TESTNET_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
} from "./chains";

const PUBLIC_RPC: Record<number, string> = {
  [INJECTIVE_CHAIN_ID]: "https://sentry.evm-rpc.injective.network",
  [ROBINHOOD_CHAIN_ID]: "https://rpc.mainnet.chain.robinhood.com",
  [INJECTIVE_TESTNET_CHAIN_ID]: "https://k8s.testnet.json-rpc.injective.network",
};

export function rpcUrl(chainId: number): string {
  const override = process.env[`ENVIO_RPC_URL_${chainId}`];
  if (override !== undefined && override.trim() !== "") return override.trim();
  const fallback = PUBLIC_RPC[chainId];
  if (fallback === undefined) {
    throw new Error(`No RPC endpoint configured for chainId ${chainId}`);
  }
  return fallback;
}

const clients = new Map<number, PublicClient>();

export function client(chainId: number): PublicClient {
  let existing = clients.get(chainId);
  if (existing === undefined) {
    existing = createPublicClient({
      transport: http(rpcUrl(chainId), { batch: true, retryCount: 3 }),
    });
    clients.set(chainId, existing);
  }
  return existing;
}
