/** Pool ID derivation. */
import { encodeAbiParameters, keccak256 } from "viem";

export interface PoolKey {
  currency0: string;
  currency1: string;
  hooks: string;
  poolManager: string;
  fee: number | bigint;
  parameters: string;
}

const POOL_KEY_ABI = [
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "uint24" },
  { type: "bytes32" },
] as const;

export function toPoolId(poolKey: PoolKey): string {
  const encoded = encodeAbiParameters(POOL_KEY_ABI, [
    poolKey.currency0 as `0x${string}`,
    poolKey.currency1 as `0x${string}`,
    poolKey.hooks as `0x${string}`,
    poolKey.poolManager as `0x${string}`,
    Number(poolKey.fee),
    poolKey.parameters as `0x${string}`,
  ]);
  return keccak256(encoded).toLowerCase();
}

export function toPoolIdManual(poolKey: PoolKey): string {
  const buffer = new Uint8Array(192);

  const writeAddress = (offset: number, addr: string): void => {
    const body = addr.startsWith("0x") ? addr.slice(2) : addr;
    for (let i = 0; i < 20; i++) {
      buffer[offset + 12 + i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
    }
  };
  const writeUint24 = (offset: number, value: number): void => {
    buffer[offset + 29] = (value >> 16) & 0xff;
    buffer[offset + 30] = (value >> 8) & 0xff;
    buffer[offset + 31] = value & 0xff;
  };
  const writeBytes32 = (offset: number, data: string): void => {
    const body = data.startsWith("0x") ? data.slice(2) : data;
    for (let i = 0; i < 32; i++) {
      buffer[offset + i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
    }
  };

  writeAddress(0, poolKey.currency0);
  writeAddress(32, poolKey.currency1);
  writeAddress(64, poolKey.hooks);
  writeAddress(96, poolKey.poolManager);
  writeUint24(128, Number(poolKey.fee));
  writeBytes32(160, poolKey.parameters);

  const hex = ("0x" +
    Array.from(buffer)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as `0x${string}`;
  return keccak256(hex).toLowerCase();
}

export function getTickSpacing(parameters: string): number {
  const body = parameters.startsWith("0x") ? parameters.slice(2) : parameters;
  if (body.length < (16 + 3) * 2) return 0;
  const byteAt = (i: number): number => parseInt(body.slice(i * 2, i * 2 + 2), 16);
  let tickSpacing = (byteAt(16) << 16) | (byteAt(17) << 8) | byteAt(18);
  if (tickSpacing > 0x7fffff) tickSpacing = tickSpacing - 0x1000000;
  return tickSpacing;
}
