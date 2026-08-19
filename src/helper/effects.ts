/**
 * Contract reads for the helper handlers.
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
  CallExecutionError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  HttpRequestError,
  InternalRpcError,
  RawContractError,
  TimeoutError,
  createPublicClient,
  decodeAbiParameters,
  http,
  parseAbi,
  hexToString,
  type Address,
} from "viem";
import { rpcUrl } from "./config/chains.js";
import { TRANSFER_TOPIC, ZERO_ADDRESS, ZERO_BI } from "./helpers.js";

const clients = new Map<number, ReturnType<typeof createPublicClient>>();
function client(chainId: number) {
  let c = clients.get(chainId);
  if (c === undefined) {
    c = createPublicClient({ transport: http(rpcUrl(chainId)) });
    clients.set(chainId, c);
  }
  return c;
}

const pairAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)",
  "function totalSupply() view returns (uint256)",
]);
const hypervisorAbi = parseAbi([
  "function getTotalAmounts() view returns (uint256 total0, uint256 total1)",
  "function totalSupply() view returns (uint256)",
]);
const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const erc20Bytes32Abi = parseAbi([
  "function symbol() view returns (bytes32)",
  "function name() view returns (bytes32)",
]);
const preMiningAbi = parseAbi([
  "function poolInfo(uint256) view returns (address stakeToken, uint256 allocPoint, uint256 totalStaked, uint256 lastRewardTime, uint256 accRewardPerShare, uint16 depositFeeBP)",
]);
const veTokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function lockDetails(uint256) view returns ((uint256 amount, uint256 startTime, uint256 endTime, bool isPermanent))",
]);

const NULL_ETH_VALUE =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

function bytes32ToString(hex: `0x${string}`): string {
  const decoded = hexToString(hex);
  let end = decoded.length;
  while (end > 0 && decoded.charCodeAt(end - 1) === 0) {
    end--;
  }
  return decoded.slice(0, end);
}

type CallInput = { chainId: number; pool: string; blockNumber: number };

/**
 * A node saying it cannot serve state at a historical block. NOT a contract
 * revert: viem wraps it in a CallExecutionError, structurally identical to a
 * real revert, so without this check a non-archive endpoint would take the
 * revert path and cache its defaults instead of being retried.
 */
const NODE_CANNOT_SERVE_HISTORY =
  /block not found|header not found|missing block|missing trie node|no state found|state (is )?not available|resource not found|pruned|unsupported block|Requested resource not found/i;

const HISTORY_RETRIES = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tryCall<T>(fn: () => Promise<T>, attempt = 0): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BaseError) {
      const text = [err.shortMessage, err.details, err.message]
        .filter(Boolean)
        .join(" ");
      if (NODE_CANNOT_SERVE_HISTORY.test(text)) {
        if (attempt < HISTORY_RETRIES) {
          await sleep(250 * 2 ** attempt);
          return tryCall(fn, attempt + 1);
        }
        throw new Error(
          `RPC cannot serve state at this historical block after ` +
            `${HISTORY_RETRIES + 1} attempts — the node answered ` +
            `"${(err.details ?? err.shortMessage ?? "").toString().trim()}". ` +
            `This is NOT a contract revert. Every eth_call in this indexer is ` +
            `block-pinned, so ENVIO_RPC_URL_<chainId> must be a full archive node ` +
            `(and, if load balanced, archive on EVERY backend). ` +
            `Fix the endpoint rather than the handler.`,
          { cause: err },
        );
      }

      const transport = err.walk(
        (e) =>
          e instanceof HttpRequestError ||
          e instanceof TimeoutError ||
          e instanceof InternalRpcError,
      );
      if (transport) throw err;

      const execution = err.walk(
        (e) =>
          e instanceof ContractFunctionRevertedError ||
          e instanceof ContractFunctionZeroDataError ||
          e instanceof RawContractError ||
          e instanceof CallExecutionError ||
          e instanceof ContractFunctionExecutionError,
      );
      if (execution) return undefined;
    }
    throw err;
  }
}

export const getPairTokens = createEffect(
  {
    name: "getPairTokens",
    input: { chainId: S.number, pool: S.string, blockNumber: S.number },
    output: { token0: S.string, token1: S.string },
    cache: true,
    rateLimit: false,
  },
  async ({ input }: { input: CallInput }) => {
    const blockNumber = BigInt(input.blockNumber);
    const address = input.pool as Address;

    const c = client(input.chainId);
    const [token0, token1] = await Promise.all([
      tryCall(() =>
        c.readContract({ address, abi: pairAbi, functionName: "token0", blockNumber }),
      ),
      tryCall(() =>
        c.readContract({ address, abi: pairAbi, functionName: "token1", blockNumber }),
      ),
    ]);

    if (token0 === undefined || token1 === undefined) {
      throw new Error(
        `Pair.token0()/token1() reverted for pool ${input.pool} at block ${input.blockNumber}; ` +
          `this aborts the handler deliberately`,
      );
    }

    return {
      token0: (token0 as string).toLowerCase(),
      token1: (token1 as string).toLowerCase(),
    };
  },
);

export const getTokenMetadata = createEffect(
  {
    name: "helper_getTokenMetadata",
    input: { chainId: S.number, token: S.string, blockNumber: S.number },
    output: {
      symbol: S.string,
      name: S.string,
      totalSupply: S.bigint,
      decimals: S.bigint,
    },
    cache: true,
    rateLimit: false,
  },
  async ({ input }: { input: { chainId: number; token: string; blockNumber: number } }) => {
    const blockNumber = BigInt(input.blockNumber);
    const address = input.token as Address;

    const c = client(input.chainId);
    const [symbolRes, nameRes, decimalsRes, totalSupplyRes] = await Promise.all([
      tryCall(() =>
        c.readContract({ address, abi: erc20Abi, functionName: "symbol", blockNumber }),
      ),
      tryCall(() =>
        c.readContract({ address, abi: erc20Abi, functionName: "name", blockNumber }),
      ),
      tryCall(() =>
        c.readContract({ address, abi: erc20Abi, functionName: "decimals", blockNumber }),
      ),
      tryCall(() =>
        c.readContract({ address, abi: erc20Abi, functionName: "totalSupply", blockNumber }),
      ),
    ]);

    let symbol = "unknown";
    if (symbolRes !== undefined) {
      symbol = symbolRes as string;
    } else {
      const r = await tryCall(() =>
        c.readContract({ address, abi: erc20Bytes32Abi, functionName: "symbol", blockNumber }),
      );
      if (r !== undefined && (r as string) !== NULL_ETH_VALUE) {
        symbol = bytes32ToString(r as `0x${string}`);
      }
    }

    let name = "unknown";
    if (nameRes !== undefined) {
      name = nameRes as string;
    } else {
      const r = await tryCall(() =>
        c.readContract({ address, abi: erc20Bytes32Abi, functionName: "name", blockNumber }),
      );
      if (r !== undefined && (r as string) !== NULL_ETH_VALUE) {
        name = bytes32ToString(r as `0x${string}`);
      }
    }

    return {
      symbol,
      name,
      totalSupply: totalSupplyRes !== undefined ? (totalSupplyRes as bigint) : 0n,
      decimals: decimalsRes !== undefined ? BigInt(decimalsRes as number) : 18n,
    };
  },
);

export const getPairReserves = createEffect(
  {
    name: "getPairReserves",
    input: { chainId: S.number, pool: S.string, blockNumber: S.number },
    output: {
      reserve0: S.bigint,
      reserve1: S.bigint,
      liquidityTokenTotalSupply: S.bigint,
    },
    cache: true,
    rateLimit: false,
  },
  async ({ input }: { input: CallInput }) => {
    const blockNumber = BigInt(input.blockNumber);
    const address = input.pool as Address;

    const c = client(input.chainId);
    const [reserves, pairSupply] = await Promise.all([
      tryCall(() =>
        c.readContract({ address, abi: pairAbi, functionName: "getReserves", blockNumber }),
      ),
      tryCall(() =>
        c.readContract({ address, abi: pairAbi, functionName: "totalSupply", blockNumber }),
      ),
    ]);

    if (reserves !== undefined) {
      const [reserve0, reserve1] = reserves as readonly [bigint, bigint, bigint];
      if (pairSupply === undefined) {
        throw new Error(
          `Pair.totalSupply() reverted for pool ${input.pool} at block ${input.blockNumber}; ` +
            `this aborts the handler deliberately`,
        );
      }
      return {
        reserve0,
        reserve1,
        liquidityTokenTotalSupply: pairSupply as bigint,
      };
    }

    const [totals, hyperSupply] = await Promise.all([
      tryCall(() =>
        c.readContract({
          address,
          abi: hypervisorAbi,
          functionName: "getTotalAmounts",
          blockNumber,
        }),
      ),
      tryCall(() =>
        c.readContract({
          address,
          abi: hypervisorAbi,
          functionName: "totalSupply",
          blockNumber,
        }),
      ),
    ]);

    if (totals === undefined) {
      return {
        reserve0: ZERO_BI,
        reserve1: ZERO_BI,
        liquidityTokenTotalSupply: ZERO_BI,
      };
    }
    if (hyperSupply === undefined) {
      throw new Error(
        `Hypervisor.totalSupply() reverted for pool ${input.pool} at block ` +
          `${input.blockNumber}; this aborts the handler deliberately`,
      );
    }

    const [total0, total1] = totals as readonly [bigint, bigint];
    return {
      reserve0: total0,
      reserve1: total1,
      liquidityTokenTotalSupply: hyperSupply as bigint,
    };
  },
);

export const getBlockMeta = createEffect(
  {
    name: "getBlockMeta",
    input: { chainId: S.number, blockNumber: S.number },
    output: { hash: S.string, timestamp: S.number },
    cache: true,
    rateLimit: false,
  },
  async ({ input }: { input: { chainId: number; blockNumber: number } }) => {
    const block = await client(input.chainId).getBlock({
      blockNumber: BigInt(input.blockNumber),
      includeTransactions: false,
    });
    return {
      hash: (block.hash as string).toLowerCase(),
      timestamp: Number(block.timestamp),
    };
  },
);

export const getHarvestRewardToken = createEffect(
  {
    name: "getHarvestRewardToken",
    input: {
      chainId: S.number,
      transactionHash: S.string,
      gauge: S.string,
      user: S.string,
      reward: S.bigint,
    },
    output: { tokenAddress: S.string },
    cache: true,
    rateLimit: false,
  },
  async ({
    input,
  }: {
    input: {
      chainId: number;
      transactionHash: string;
      gauge: string;
      user: string;
      reward: bigint;
    };
  }) => {
    const receipt = await client(input.chainId).getTransactionReceipt({
      hash: input.transactionHash as `0x${string}`,
    });

    let tokenAddress = ZERO_ADDRESS;
    for (const eventLog of receipt.logs) {
      const topic = eventLog.topics[0];
      if (topic?.toLowerCase() !== TRANSFER_TOPIC) continue;

      if (eventLog.topics.length < 3) {
        throw new Error(
          `Transfer-topic log with only ${eventLog.topics.length} topics in ` +
            `${input.transactionHash} (log ${eventLog.logIndex}); topics[1] and ` +
            `topics[2] are read unguarded, so this aborts the handler`,
        );
      }

      const [value] = decodeAbiParameters(
        [{ type: "uint256" }],
        eventLog.data as `0x${string}`,
      );
      const [from] = decodeAbiParameters(
        [{ type: "address" }],
        eventLog.topics[1] as `0x${string}`,
      );
      const [to] = decodeAbiParameters(
        [{ type: "address" }],
        eventLog.topics[2] as `0x${string}`,
      );

      if (
        (from as string).toLowerCase() === input.gauge.toLowerCase() &&
        (to as string).toLowerCase() === input.user.toLowerCase() &&
        (value as bigint) === input.reward
      ) {
        tokenAddress = (eventLog.address as string).toLowerCase();
      }
    }

    return { tokenAddress };
  },
);

export const getVeTokenMetadata = createEffect(
  {
    name: "getVeTokenMetadata",
    input: { chainId: S.number, veToken: S.string, blockNumber: S.number },
    output: {
      name: S.string,
      symbol: S.string,
      decimals: S.bigint,
      totalSupply: S.bigint,
    },
    cache: true,
    rateLimit: false,
  },
  async ({
    input,
  }: {
    input: { chainId: number; veToken: string; blockNumber: number };
  }) => {
    const blockNumber = BigInt(input.blockNumber);
    const address = input.veToken as Address;

    const c = client(input.chainId);
    const [nameRes, symbolRes, decimalsRes, supplyRes] = await Promise.all([
      tryCall(() =>
        c.readContract({ address, abi: veTokenAbi, functionName: "name", blockNumber }),
      ),
      tryCall(() =>
        c.readContract({ address, abi: veTokenAbi, functionName: "symbol", blockNumber }),
      ),
      tryCall(() =>
        c.readContract({ address, abi: veTokenAbi, functionName: "decimals", blockNumber }),
      ),
      tryCall(() =>
        c.readContract({ address, abi: veTokenAbi, functionName: "totalSupply", blockNumber }),
      ),
    ]);

    return {
      name: nameRes !== undefined ? (nameRes as string) : "veToken",
      symbol: symbolRes !== undefined ? (symbolRes as string) : "ve",
      decimals: decimalsRes !== undefined ? BigInt(decimalsRes as number) : 18n,
      totalSupply: supplyRes !== undefined ? (supplyRes as bigint) : 0n,
    };
  },
);

export const getVeLockStartTime = createEffect(
  {
    name: "getVeLockStartTime",
    input: { chainId: S.number, veToken: S.string, tokenId: S.bigint, blockNumber: S.number },
    output: { startTime: S.nullable(S.bigint) },
    cache: true,
    rateLimit: false,
  },
  async ({
    input,
  }: {
    input: { chainId: number; veToken: string; tokenId: bigint; blockNumber: number };
  }) => {
    const details = await tryCall(() =>
      client(input.chainId).readContract({
        address: input.veToken as Address,
        abi: veTokenAbi,
        functionName: "lockDetails",
        args: [input.tokenId],
        blockNumber: BigInt(input.blockNumber),
      }),
    );

    if (details === undefined) return { startTime: null };
    return { startTime: (details as { startTime: bigint }).startTime };
  },
);

export const getPreMiningPoolAddress = createEffect(
  {
    name: "getPreMiningPoolAddress",
    input: { chainId: S.number, premining: S.string, pid: S.bigint, blockNumber: S.number },
    output: { pool: S.string },
    cache: true,
    rateLimit: false,
  },
  async ({
    input,
  }: {
    input: { chainId: number; premining: string; pid: bigint; blockNumber: number };
  }) => {
    const result = await client(input.chainId).readContract({
      address: input.premining as Address,
      abi: preMiningAbi,
      functionName: "poolInfo",
      args: [input.pid],
      blockNumber: BigInt(input.blockNumber),
    });
    const stakeToken = (result as readonly unknown[])[0] as string;
    return { pool: stakeToken.toLowerCase() };
  },
);
