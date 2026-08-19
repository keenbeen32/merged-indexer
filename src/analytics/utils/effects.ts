/**
 * Contract reads for the analytics handlers.
 *
 * All external I/O must go through the Effect API: handlers run twice, in a
 * parallel preload pass and a sequential processing pass, so a bare contract
 * read in a handler would execute twice.
 *
 * Reads are pinned to the block of the event that triggered them, so
 * ENVIO_RPC_URL_<chainId> must be an archive endpoint.
 */
import { S, createEffect } from "envio";
import { createPublicClient, http, type Abi } from "viem";
import { TAC, rpcUrl } from "../config/chain.js";
import { TOKEN_FALLBACK_BI, UNKNOWN_STRING, NULL_ETH_VALUE } from "./constants.js";

const clients = new Map<number, ReturnType<typeof createPublicClient>>();

function client(chainId: number) {
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({
      transport: http(rpcUrl(chainId), { batch: true }),
      batch: { multicall: true },
    });
    clients.set(chainId, c);
  }
  return c;
}

const RATE_LIMIT = {
  calls: Number(process.env.ENVIO_EFFECT_RATE_LIMIT) || 500,
  per: "second",
} as const;

const ERC20_ABI = [
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const satisfies Abi;

const ERC20_BYTES32_ABI = [
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const satisfies Abi;

/**
 * Fallback metadata for chain 239 only, used when the block-pinned read cannot
 * be served. The keys are bare TAC addresses, so consulting them on another
 * chain could match an unrelated token that shares an address — gated at the
 * call site by `chainId === TAC`.
 */
const STATIC_TOKEN_METADATA: Record<
  string,
  { symbol: string; name: string; decimals: bigint; totalSupply: bigint }
> = {
  "0x0087ce62c90f00667bd47c7da531762e929d4291": { symbol: "TTA", name: "Test Token A", decimals: 18n, totalSupply: 10000000000000000000000000n },
  "0x2ba06eca1352566a6108dd3c7010b773e9568627": { symbol: "mUSD", name: "MOCK USD Coin", decimals: 6n, totalSupply: 1010000000000n },
  "0x343af6b37b6083eb44d050b3dccf4627913cc209": { symbol: "USDD", name: "Debt Token", decimals: 18n, totalSupply: 26931980000000000000000n },
  "0x37d6382b6889ccef8d6871a8b60e667115eddbcf": { symbol: "pufETH", name: "pufETH", decimals: 18n, totalSupply: 643189617000000000000n },
  "0x48a5818e578d0af4215f493c74d5e63c7ff38395": { symbol: "TTA", name: "Test Token A", decimals: 18n, totalSupply: 10000000000000000000000000n },
  "0x61d66bc21fed820938021b06e9b2291f3fb91945": { symbol: "WETH", name: "Wrapped Ether", decimals: 18n, totalSupply: 2267103745000000000000n },
  "0x6bede1c6009a78c222d9bdb7974bb67847fdb68c": { symbol: "USBD", name: "US Bitcoin Dollar", decimals: 18n, totalSupply: 22466980010000000000000n },
  "0x7048c9e4abd0cf0219e95a17a8c6908dfc4f0ee4": { symbol: "cbBTC", name: "Coinbase Wrapped BTC", decimals: 8n, totalSupply: 94378230604n },
  "0x85a4dd4ed356a7976a8302b1b690202d58583c55": { symbol: "TTA", name: "Test Token A", decimals: 18n, totalSupply: 10000000000000000000000000000n },
  "0xa730caa84b6e72bb51ed5b2a1b08bc6031a95294": { symbol: "TTB", name: "Test Token B", decimals: 18n, totalSupply: 10000000000000000000000000000n },
  "0xaf368c91793cb22739386dfcbbb2f1a9e4bcbebf": { symbol: "wstETH", name: "Wrapped liquid staked Ether 2.0", decimals: 18n, totalSupply: 1649850237000000000000n },
  "0xaf988c3f7cb2aceabb15f96b19388a259b6c438f": { symbol: "USD₮", name: "Tether USD", decimals: 6n, totalSupply: 26044852354909n },
  "0xb1b385542b6e80f77b94393ba8342c3af699f15c": { symbol: "USR", name: "Resolv USD", decimals: 18n, totalSupply: 612900516091000000000000n },
  "0xb63b9f0eb4a6e6f191529d71d4d88cc8900df2c9": { symbol: "WTAC", name: "Wrapped TAC", decimals: 18n, totalSupply: 305928864874063896774684121n },
  "0xb76d91340f5ce3577f0a056d29f6e3eb4e88b140": { symbol: "TON", name: "TON Token", decimals: 9n, totalSupply: 491228901965296n },
  "0xc1639cfaa3915f1560a88bd66a175544ddce4967": { symbol: "AAPLx", name: "Apple xStock", decimals: 8n, totalSupply: 9990736n },
  "0xd44f691aed69fe43180b95b6f82f89c18fb93094": { symbol: "tsTON", name: "Tonstakers TON", decimals: 9n, totalSupply: 581010709673871n },
  "0xe3709ab08457c8edb0c0ee4c4f9193b39efc0769": { symbol: "TTB", name: "Test Token B", decimals: 18n, totalSupply: 10000000000000000000000000n },
  "0xecac9c5f704e954931349da37f60e39f515c11c1": { symbol: "LBTC", name: "Lombard Staked Bitcoin", decimals: 8n, totalSupply: 91693463200n },
  "0xf87475b6a5b052faf7d4240cd0f561d5857ec53b": { symbol: "TTB", name: "Test Token B", decimals: 18n, totalSupply: 10000000000000000000000000n },
  "0xf9775085d726e782e83585033b58606f7731ab18": { symbol: "uniBTC", name: "uniBTC", decimals: 8n, totalSupply: 44065805700n },
};

const addr = (a: string) => a as `0x${string}`;

function isNullEthValue(hex: string): boolean {
  return hex.toLowerCase() === NULL_ETH_VALUE;
}

function bytes32ToString(hex: string): string {
  const buf = Buffer.from(hex.replace(/^0x/, ""), "hex");
  return buf.toString("utf8").replace(/\0+$/, "");
}

async function readMetadata(
  c: ReturnType<typeof createPublicClient>,
  address: string,
  blockNumber: bigint | undefined,
) {
  const at = {
    address: addr(address),
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  };

  const [symbolR, nameR, decimalsR, totalSupplyR] = await Promise.allSettled([
    c.readContract({ ...at, abi: ERC20_ABI, functionName: "symbol" }),
    c.readContract({ ...at, abi: ERC20_ABI, functionName: "name" }),
    c.readContract({ ...at, abi: ERC20_ABI, functionName: "decimals" }),
    c.readContract({ ...at, abi: ERC20_ABI, functionName: "totalSupply" }),
  ]);

  const allFailed =
    symbolR.status === "rejected" &&
    nameR.status === "rejected" &&
    decimalsR.status === "rejected" &&
    totalSupplyR.status === "rejected";
  if (allFailed) return null;

  let symbol = UNKNOWN_STRING;
  if (symbolR.status === "fulfilled") {
    symbol = symbolR.value as string;
  } else {
    try {
      const raw = (await c.readContract({
        ...at,
        abi: ERC20_BYTES32_ABI,
        functionName: "symbol",
      })) as string;
      if (!isNullEthValue(raw)) symbol = bytes32ToString(raw);
    } catch {
    }
  }

  let name = UNKNOWN_STRING;
  if (nameR.status === "fulfilled") {
    name = nameR.value as string;
  } else {
    try {
      const raw = (await c.readContract({
        ...at,
        abi: ERC20_BYTES32_ABI,
        functionName: "name",
      })) as string;
      if (!isNullEthValue(raw)) name = bytes32ToString(raw);
    } catch {
    }
  }

  const decimals =
    decimalsR.status === "fulfilled"
      ? BigInt(decimalsR.value as number)
      : TOKEN_FALLBACK_BI;
  const totalSupply =
    totalSupplyR.status === "fulfilled"
      ? (totalSupplyR.value as bigint)
      : TOKEN_FALLBACK_BI;

  return { symbol, name, decimals, totalSupply };
}

export const getTokenMetadata = createEffect(
  {
    name: "analytics_getTokenMetadata",
    input: { chainId: S.number, address: S.string, blockNumber: S.bigint },
    output: {
      symbol: S.string,
      name: S.string,
      decimals: S.bigint,
      totalSupply: S.bigint,
    },
    cache: true,
    rateLimit: RATE_LIMIT,
  },
  async ({ input }) => {
    const c = client(input.chainId);
    const address = input.address.toLowerCase();

    const pinned = await readMetadata(c, address, input.blockNumber);
    if (pinned) return pinned;

    const staticHit =
      input.chainId === TAC ? STATIC_TOKEN_METADATA[address] : undefined;
    if (staticHit) return staticHit;

    const latest = await readMetadata(c, address, undefined);
    if (latest) return latest;

    return {
      symbol: UNKNOWN_STRING,
      name: UNKNOWN_STRING,
      decimals: TOKEN_FALLBACK_BI,
      totalSupply: TOKEN_FALLBACK_BI,
    };
  },
);
