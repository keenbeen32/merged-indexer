/**
 * ERC20 metadata reads for v1.
 *
 * A contract revert is a real answer from the chain and takes the documented
 * fallback. A transport failure is NOT, and is rethrown: with `cache: true` a
 * substituted value would be written to the durable cache and replayed on every
 * later run.
 */
import { createEffect, S } from "envio";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  parseAbi,
  type Address,
} from "viem";
import { client } from "./client.js";
import { isNullEthValue } from "../utils/helpers.js";

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const erc20BytesAbi = parseAbi([
  "function name() view returns (bytes32)",
  "function symbol() view returns (bytes32)",
]);

function isContractRevert(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  const cause = error.walk(
    (e) =>
      e instanceof ContractFunctionRevertedError ||
      e instanceof ContractFunctionZeroDataError,
  );
  if (cause !== null) return true;
  return /AbiDecoding|DataSizeTooSmall|SizeExceeds|InvalidBytesBoolean/i.test(
    error.name,
  );
}

async function tryRead<T>(
  read: () => Promise<T>,
  onTransportError?: (error: unknown) => void,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    if (isContractRevert(error)) return { ok: false };
    onTransportError?.(error);
    throw error;
  }
}

function bytes32ToString(hex: string): string {
  const bytes = Buffer.from(hex.replace(/^0x/, ""), "hex");
  return new TextDecoder("utf-8").decode(bytes).replace(/\u0000+$/, "");
}

export const getTokenMetadata = createEffect(
  {
    name: "v1_getTokenMetadata",
    input: {
      chainId: S.number,
      address: S.string,
      blockNumber: S.number,
    },
    output: {
      name: S.string,
      symbol: S.string,
      decimals: S.bigint,
      totalSupply: S.bigint,
    },
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    const c = client(input.chainId);
    const address = input.address as Address;
    const blockNumber = BigInt(input.blockNumber);

    const logTransportError = (fn: string) => (error: unknown) =>
      context.log.error(
        `[effect] getTokenMetadata.${fn} transport failure (not a revert): ` +
          `chain=${input.chainId} token=${input.address} ` +
          `block=${input.blockNumber}: ${String(error).split("\n")[0]}`,
      );

    let symbol = "unknown";
    {
      const stringResult = await tryRead(() =>
        c.readContract({
          address,
          abi: erc20Abi,
          functionName: "symbol",
          blockNumber,
        }) as Promise<string>,
        logTransportError("symbol"),
      );
      if (stringResult.ok) {
        symbol = stringResult.value;
      } else {
        const bytesResult = await tryRead(() =>
          c.readContract({
            address,
            abi: erc20BytesAbi,
            functionName: "symbol",
            blockNumber,
          }) as Promise<string>,
          logTransportError("symbol(bytes32)"),
        );
        if (bytesResult.ok && !isNullEthValue(bytesResult.value)) {
          symbol = bytes32ToString(bytesResult.value);
          context.log.warn(
            `bytes32 symbol fallback used for ${input.address} -> "${symbol}"; ` +
              `check this token's metadata before relying on it`,
          );
        }
      }
    }

    let name = "unknown";
    {
      const stringResult = await tryRead(() =>
        c.readContract({
          address,
          abi: erc20Abi,
          functionName: "name",
          blockNumber,
        }) as Promise<string>,
        logTransportError("name"),
      );
      if (stringResult.ok) {
        name = stringResult.value;
      } else {
        const bytesResult = await tryRead(() =>
          c.readContract({
            address,
            abi: erc20BytesAbi,
            functionName: "name",
            blockNumber,
          }) as Promise<string>,
          logTransportError("name(bytes32)"),
        );
        if (bytesResult.ok && !isNullEthValue(bytesResult.value)) {
          name = bytes32ToString(bytesResult.value);
          context.log.warn(
            `bytes32 name fallback used for ${input.address} -> "${name}"; ` +
              `check this token's metadata before relying on it`,
          );
        }
      }
    }

    let totalSupply = 0n;
    {
      const result = await tryRead(() =>
        c.readContract({
          address,
          abi: erc20Abi,
          functionName: "totalSupply",
          blockNumber,
        }) as Promise<bigint>,
        logTransportError("totalSupply"),
      );
      if (result.ok) totalSupply = result.value;
    }

    let decimals = 18n;
    {
      const result = await tryRead(() =>
        c.readContract({
          address,
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber,
        }) as Promise<number | bigint>,
        logTransportError("decimals"),
      );
      if (result.ok) decimals = BigInt(result.value);
    }

    return { name, symbol, decimals, totalSupply };
  },
);
