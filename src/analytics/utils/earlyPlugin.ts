/** Holds Plugin/PluginConfig values emitted before the Pool row exists. */
import { cid } from "../config/chain.js";

const earlyPluginByPool = new Map<string, string>();
const earlyPluginConfigByPool = new Map<string, number>();

export function stashEarlyPlugin(
  chainId: number,
  poolAddress: string,
  plugin: string,
): void {
  earlyPluginByPool.set(cid(chainId, poolAddress), plugin);
}

export function stashEarlyPluginConfig(
  chainId: number,
  poolAddress: string,
  config: number,
): void {
  earlyPluginConfigByPool.set(cid(chainId, poolAddress), config);
}

export function takeEarlyPlugin(
  chainId: number,
  poolAddress: string,
): string | undefined {
  const key = cid(chainId, poolAddress);
  const v = earlyPluginByPool.get(key);
  earlyPluginByPool.delete(key);
  return v;
}

export function takeEarlyPluginConfig(
  chainId: number,
  poolAddress: string,
): number | undefined {
  const key = cid(chainId, poolAddress);
  const v = earlyPluginConfigByPool.get(key);
  earlyPluginConfigByPool.delete(key);
  return v;
}
