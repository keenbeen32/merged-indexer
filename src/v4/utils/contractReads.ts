/**
 * Contract reads for the v4 handlers.
 *
 * All external I/O must go through the Effect API: handlers run twice, in a
 * parallel preload pass and a sequential processing pass, so a bare contract
 * read in a handler would execute twice.
 *
 * Reads are pinned to the block of the event that triggered them, so
 * ENVIO_RPC_URL_<chainId> must be an archive endpoint.
 */
import { S, createEffect } from "envio";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  type Abi,
} from "viem";
import ERC20_ABI from "../../../abis/v4/ERC20.json" with { type: "json" };
import ERC20_NAME_BYTES_ABI from "../../../abis/v4/ERC20NameBytes.json" with { type: "json" };
import ERC20_SYMBOL_BYTES_ABI from "../../../abis/v4/ERC20SymbolBytes.json" with { type: "json" };
import POSITION_MANAGER_ABI from "../../../abis/v4/PositionManager.json" with { type: "json" };
import { client } from "./rpc";
import { BYTES32_ZERO, NULL_NATIVE_HEX_STRING } from "./constants";
import { toPoolId } from "./poolId";

const NULL_NATIVE = NULL_NATIVE_HEX_STRING;

function isContractRevert(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  const cause = error.walk(
    (e) =>
      e instanceof ContractFunctionRevertedError ||
      e instanceof ContractFunctionZeroDataError,
  );
  if (cause !== null) return true;
  return /AbiDecoding|DataSizeTooSmall|SizeExceeds|InvalidBytesBoolean/i.test(error.name);
}

async function tryRead<T>(read: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    if (isContractRevert(error)) return { ok: false };
    throw error; // transport / node failure — must not look like a revert
  }
}

function bytes32ToString(hex: string): string {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export const DECIMALS_NULL = -1n;

export const getTokenMetadata = createEffect(
  {
    name: "v4_getTokenMetadata",
    input: {
      chainId: S.number,
      address: S.string,
      blockNumber: S.number,
    },
    output: {
      symbol: S.string,
      name: S.string,
      totalSupply: S.bigint,
      decimals: S.bigint,
    },
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    const publicClient = client(input.chainId);
    const address = input.address as `0x${string}`;
    const blockNumber = BigInt(input.blockNumber);

    let symbol = "unknown";
    const symbolResult = await tryRead(() =>
      publicClient.readContract({
        address,
        abi: ERC20_ABI as Abi,
        functionName: "symbol",
        blockNumber,
      }),
    );
    if (symbolResult.ok) {
      symbol = symbolResult.value as string;
    } else {
      const symbolBytes = await tryRead(() =>
        publicClient.readContract({
          address,
          abi: ERC20_SYMBOL_BYTES_ABI as Abi,
          functionName: "symbol",
          blockNumber,
        }),
      );
      if (symbolBytes.ok) {
        const hex = symbolBytes.value as string;
        if (hex.toLowerCase() !== NULL_NATIVE) symbol = bytes32ToString(hex);
      }
    }

    let name = "unknown";
    const nameResult = await tryRead(() =>
      publicClient.readContract({
        address,
        abi: ERC20_ABI as Abi,
        functionName: "name",
        blockNumber,
      }),
    );
    if (nameResult.ok) {
      name = nameResult.value as string;
    } else {
      const nameBytes = await tryRead(() =>
        publicClient.readContract({
          address,
          abi: ERC20_NAME_BYTES_ABI as Abi,
          functionName: "name",
          blockNumber,
        }),
      );
      if (nameBytes.ok) {
        const hex = nameBytes.value as string;
        if (hex.toLowerCase() !== NULL_NATIVE) name = bytes32ToString(hex);
      }
    }

    let totalSupply = 0n;
    const totalSupplyResult = await tryRead(() =>
      publicClient.readContract({
        address,
        abi: ERC20_ABI as Abi,
        functionName: "totalSupply",
        blockNumber,
      }),
    );
    if (totalSupplyResult.ok) totalSupply = totalSupplyResult.value as bigint;

    let decimals = DECIMALS_NULL;
    const decimalsResult = await tryRead(() =>
      publicClient.readContract({
        address,
        abi: ERC20_ABI as Abi,
        functionName: "decimals",
        blockNumber,
      }),
    );
    if (decimalsResult.ok) {
      const value = BigInt(decimalsResult.value as number | bigint);
      if (value < 255n) decimals = value;
    }

    return { symbol, name, totalSupply, decimals };
  },
);

export const getPositionInfo = createEffect(
  {
    name: "getPositionInfo",
    input: {
      chainId: S.number,
      positionManager: S.string,
      tokenId: S.bigint,
      blockNumber: S.number,
    },
    output: {
      reverted: S.boolean,
      poolId: S.string,
      tickLower: S.bigint,
      tickUpper: S.bigint,
      liquidity: S.bigint,
    },
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    const publicClient = client(input.chainId);
    const result = await tryRead(() =>
      publicClient.readContract({
        address: input.positionManager as `0x${string}`,
        abi: POSITION_MANAGER_ABI as Abi,
        functionName: "positions",
        args: [input.tokenId],
        blockNumber: BigInt(input.blockNumber),
      }),
    );

    if (!result.ok) {
      return {
        reverted: true,
        poolId: BYTES32_ZERO,
        tickLower: 0n,
        tickUpper: 0n,
        liquidity: 0n,
      };
    }

    const value = result.value as readonly [
      {
        currency0: string;
        currency1: string;
        hooks: string;
        poolManager: string;
        fee: number | bigint;
        parameters: string;
      },
      number,
      number,
      bigint,
      bigint,
      bigint,
      string,
    ];
    const poolKey = value[0];

    return {
      reverted: false,
      poolId: toPoolId(poolKey),
      tickLower: BigInt(value[1]),
      tickUpper: BigInt(value[2]),
      liquidity: value[3],
    };
  },
);
