/** Per-chain configuration for v4, keyed by chain ID. */
import { BigDecimal, bd } from "./bigDecimal";

export interface StaticTokenDefinition {
  address: string;
  symbol: string;
  name: string;
  decimals: bigint;
}

export interface NativeTokenDetails {
  symbol: string;
  name: string;
  decimals: bigint;
}

export interface ChainConfig {
  network: string;
  poolManagerAddress: string;
  stablecoinWrappedNativePoolId: string;
  stablecoinIsToken0: boolean;
  wrappedNativeAddress: string;
  minimumNativeLocked: BigDecimal;
  stablecoinAddresses: string[];
  whitelistTokens: string[];
  tokenOverrides: StaticTokenDefinition[];
  poolsToSkip: string[];
  poolMappings: string[][];
  nativeTokenDetails: NativeTokenDetails;
}

export const INJECTIVE_CHAIN_ID = 1776;
export const ROBINHOOD_CHAIN_ID = 4663;
export const INJECTIVE_TESTNET_CHAIN_ID = 1439;

const INJECTIVE: ChainConfig = {
  network: "injective",
  poolManagerAddress: "0xd79cb76f783c332cee7656243e136f94f43b6913",
  stablecoinWrappedNativePoolId:
    "0x5f2b2a109a34b062f5adedd8c73e42e71cd3605d21b2246324b59665518540a2",
  stablecoinIsToken0: false,
  wrappedNativeAddress: "0x0000000088827d2d103ee2d9a6b781773ae03ffb", // WINJ
  minimumNativeLocked: bd("1"),
  stablecoinAddresses: [
    "0x2a25fbd67b3ae485e461fe55d9dbef302b7d3989", // USDC
    "0x8367cc5b351183f486e007dfea712b909eddcc12", // USDT
  ],
  whitelistTokens: [
    "0x0000000000000000000000000000000000000000", // INJ
    "0x0000000088827d2d103ee2d9a6b781773ae03ffb", // WINJ
    "0x2a25fbd67b3ae485e461fe55d9dbef302b7d3989", // USDC
    "0x8367cc5b351183f486e007dfea712b909eddcc12", // USDT
    "0x83a15000b753ac0eee06d2cb41a69e76d0d5c7f7", // WETH
    "0x2d6e0e0c209d79b43f5d3d62e93d6a9f1e9317bd", // yINJ
  ],
  tokenOverrides: [],
  poolsToSkip: [],
  poolMappings: [],
  nativeTokenDetails: { symbol: "INJ", name: "Injective", decimals: 18n },
};

const ROBINHOOD: ChainConfig = {
  network: "robinhood-mainnet",
  poolManagerAddress: "0xd01c774d4a66408326bc65728ac5ae5aaf004032",
  stablecoinWrappedNativePoolId:
    "0x8068ab043efd411b87506c41be1add38faaf18c0af0016c663ca92feff0b8159", // WETH/USDG
  stablecoinIsToken0: false,
  wrappedNativeAddress: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", // WETH
  minimumNativeLocked: bd("0.025"),
  stablecoinAddresses: [
    "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // USD stable
  ],
  whitelistTokens: [
    "0x0bd7d308f8e1639fab988df18a8011f41eacad73", // WETH
    "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // USDG
  ],
  tokenOverrides: [],
  poolsToSkip: [],
  poolMappings: [],
  nativeTokenDetails: { symbol: "ETH", name: "Ether", decimals: 18n },
};

const INJECTIVE_TESTNET: ChainConfig = {
  network: "injective-evm-testnet",
  poolManagerAddress: "",
  stablecoinWrappedNativePoolId: "",
  stablecoinIsToken0: false,
  wrappedNativeAddress: "",
  minimumNativeLocked: bd("1"),
  stablecoinAddresses: [],
  whitelistTokens: [],
  tokenOverrides: [],
  poolsToSkip: [],
  poolMappings: [],
  nativeTokenDetails: { symbol: "INJ", name: "Injective", decimals: 18n },
};

export const STATUS_TESTNET: ChainConfig = {
  network: "status-testnet",
  poolManagerAddress: "0x087a61ee8b6ee5037665e32fda24e670ad716d4d",
  stablecoinWrappedNativePoolId: "",
  stablecoinIsToken0: false,
  wrappedNativeAddress: "0x9fabf891694454e17e687baf4575aa1396811085", // WETH
  minimumNativeLocked: bd("1"),
  stablecoinAddresses: [
    "0x3d3fa1954dabd9862d60269b8b28684e7cb8ad32", // FUSDT
  ],
  whitelistTokens: [
    "0x9fabf891694454e17e687baf4575aa1396811085", // WETH
    "0x3d3fa1954dabd9862d60269b8b28684e7cb8ad32", // FUSDT
  ],
  tokenOverrides: [],
  poolsToSkip: [],
  poolMappings: [],
  nativeTokenDetails: { symbol: "ETH", name: "Ethereum", decimals: 18n },
};

const CONFIG_BY_CHAIN_ID: Record<number, ChainConfig> = {
  [INJECTIVE_CHAIN_ID]: INJECTIVE,
  [ROBINHOOD_CHAIN_ID]: ROBINHOOD,
  [INJECTIVE_TESTNET_CHAIN_ID]: INJECTIVE_TESTNET,
};

export function getChainConfig(chainId: number): ChainConfig {
  const config = CONFIG_BY_CHAIN_ID[chainId];
  if (config === undefined) {
    throw new Error(`Unsupported Network: chainId ${chainId}`);
  }
  return config;
}

export function getStaticDefinition(
  tokenAddress: string,
  staticDefinitions: StaticTokenDefinition[],
): StaticTokenDefinition | null {
  const lower = tokenAddress.toLowerCase();
  for (const definition of staticDefinitions) {
    if (definition.address.toLowerCase() === lower) return definition;
  }
  return null;
}
