/** Shared viem clients, one per chain. */
import { createPublicClient, http, type PublicClient } from "viem";
import { RPC_URL } from "../config/chains.js";

const cache = new Map<number, PublicClient>();

export function client(chainId: number): PublicClient {
  let c = cache.get(chainId);
  if (c) return c;
  const url = RPC_URL[chainId];
  if (!url) throw new Error(`No RPC URL configured for chainId ${chainId}`);
  const envKey = `ENVIO_RPC_URL_${chainId}`;
  if (!process.env[envKey]) {
    console.warn(
      `[effects] ${envKey} is not set — falling back to ${url}, which may be ` +
        `rate limited or pruned and may not serve historical eth_call. ` +
        `Set it in .env for a full sync.`,
    );
  }
  c = createPublicClient({
    transport: http(url, {
      batch: { batchSize: Number(process.env.ENVIO_RPC_BATCH_SIZE ?? 50), wait: 20 },
      retryCount: 5,
      retryDelay: 250,
      timeout: 30_000,
    }),
  }) as PublicClient;
  cache.set(chainId, c);
  return c;
}
