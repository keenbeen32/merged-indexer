/** Per-chain constants for the v1 indexer, keyed by chain ID. */
export type RefPair = {
  readonly address: string;
  readonly wethIsToken0: boolean;
};

export type ChainConfig = {
  readonly name: string;
  readonly factoryAddress: string;
  readonly wethAddress: string;
  readonly usdtWethPair: RefPair | undefined;
  readonly usdcWethPair: RefPair | undefined;
  readonly preSwitchPair?: RefPair;
  readonly switchBlock?: number;
  readonly whitelistVerbatim: readonly string[];
  readonly whitelistLookup: readonly string[];
};

function whitelist(...addresses: string[]): {
  whitelistVerbatim: readonly string[];
  whitelistLookup: readonly string[];
} {
  return {
    whitelistVerbatim: addresses,
    whitelistLookup: addresses.map((a) => a.toLowerCase()),
  };
}

export const CHAIN_CONFIG: Record<number, ChainConfig> = {
  59144: {
    name: "lynex",
    factoryAddress: "0xBc7695Fd00E3b32D08124b7a4287493aEE99f9ee",
    wethAddress: "0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f",
    usdtWethPair: {
      address: "0x94769abfbeb114cf7ba2e7b9cef242ac70da20d6",
      wethIsToken0: false,
    },
    usdcWethPair: {
      address: "0x6fb44889a9aa69f7290258d3716bffcb33cde184",
      wethIsToken0: false,
    },
    ...whitelist(
      "0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f", // WETH
      "0x7d43aabc515c356145049227cee54b608342c0ad", // BUSD
      "0xa219439258ca9da29e9cc4ce5596924745e12b93", // USDT
      "0x176211869ca2b568f2a7d4ee941e073a821ee1ff", // USDC
      "0x4af15ec2a0bd43db75dd04e62faa3b8ef36b00d5", // DAI
      "0x3aab2285ddcddad8edf438c1bab47e1a9d05a9b4", // WBTC
      "0x0e076aafd86a71dceac65508daf975425c9d0cb6", // LDO
      "0x5b16228b94b68c7ce33af2acc5663ebde4dcfa2d", // LINK
      "0x636b22bc471c955a8db60f28d4795066a8201fa3", // UNI
      "0x1a51b19ce03dbe0cb44c1528e34a7edd7771e9af", // LYNX
      "0x93f4d0ab6a8b4271f4a28db399b5e30612d21116", // STONE
      "0xf3b001d64c656e30a62fbaaca003b1336b4ce12a", // MAI
      "0xb5bedd42000b71fdde22d3ee8a79bd49a568fc8f", // wstETH
    ),
  },

  4663: {
    name: "orvex",
    factoryAddress: "0x5c98b2d892b37c9a1D3b69472bdDc172A64CdC09",
    wethAddress: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    usdtWethPair: undefined,
    usdcWethPair: undefined,
    ...whitelist("0x0bd7d308f8e1639fab988df18a8011f41eacad73"),
  },

  48900: {
    name: "ocelex",
    factoryAddress: "0xDd018347C29a27088eb2d0BF0637d9A05b30666c",
    wethAddress: "0x4200000000000000000000000000000000000006",
    usdtWethPair: {
      address: "0x951184b8adcf92d6e3594abe0cdcf21b46704412",
      wethIsToken0: true,
    },
    usdcWethPair: {
      address: "0x907e0035661bf239a2c9b9cbf7cc87e3d240c848",
      wethIsToken0: false,
    },
    preSwitchPair: {
      address: "0x506bab07ddbe5c1d81889a42f43ed87bc1b0b1ee", // USDe/WETH
      wethIsToken0: true,
    },
    switchBlock: 8127750, // "the block we added USDC and USDT liquidity"
    ...whitelist(
      "0x4200000000000000000000000000000000000006", // WETH
      "0x3b952c8c9c44e8fe201e2b26f6b2200203214cff", // USDC
      "0x46dda6a5a559d861c06ec9a95fb395f5c3db0742", // USDT
      "0x58024021fe3ef613fa76e2f36a3da97eb1454c36", // OCX
      "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34", // USDe
      "0x19df5689cfce64bc2a55f7220b0cd522659955ef", // wBTC
      "0xfd418e42783382e86ae91e445406600ba144d162", // ZRC
      "0x2416092f143378750bb29b79ed961ab195cceea5", // ezETH
    ),
  },

  9745: {
    name: "ionex",
    factoryAddress: "0xbf05db69176e47bf89a6b19f7492d50751d20452",
    wethAddress: "0x6100e367285b01f48d07953803a2d8dca5d19873",
    usdtWethPair: {
      address: "0xc07aa78e87eef280b0b19abfe8965ac46ce8ec14", // WXPL/USDT
      wethIsToken0: true,
    },
    usdcWethPair: {
      address: "0x697f96f54c862ca8f5a1cb95b9c1cf5d1b04091b", // USDe/WXPL
      wethIsToken0: false,
    },
    ...whitelist(
      "0x9895d81bb462a195b4922ed7de0e3acd007c32cb", // WETH
      "0x6100e367285b01f48d07953803a2d8dca5d19873", // WXPL
      "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb", // USDT0
      "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34", // USDe
      "0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2", // sUSDe
      "0x0b2b2b2076d95dda7817e785989fe353fe955ef9", // sUSDai
      "0x0a1a1a107e45b7ced86833863f482bc5f4ed82ef", // USDai
      "0x1b64b9025eebb9a6239575df9ea4b9ac46d4d193", // XAUT0
      "0xc4374775489cb9c56003bf2c9b12495fc64f0771", // syrupUSDT
      "0x5e494e8912319cefb1d4fa516807bb65a8cb9e40", // fWETH
      "0xa3d68b74bf0528fdd07263c60d6488749044914b", // weETH
    ),
  },

  239: {
    name: "snap",
    factoryAddress: "0x2e9eb1dd1f0462336a71df52a6e387d207b6190f",
    wethAddress: "0xb63b9f0eb4a6e6f191529d71d4d88cc8900df2c9",
    usdtWethPair: {
      address: "0xd5960e35963e74a73e5e30c2fc7185b39814083d", // USDT/WTAC
      wethIsToken0: false,
    },
    usdcWethPair: {
      address: "0x08b29752976933a618467c699f7cd1321ae10f76", // USR/WTAC
      wethIsToken0: false,
    },
    ...whitelist(
      "0x61D66bC21fED820938021B06e9b2291f3FB91945", // WETH
      "0xB63B9f0eb4A6E6f191529D71d4D88cc8900Df2C9", // WTAC
      "0xAF988C3f7CB2AceAbB15f96b19388a259b6C438f", // USDT
      "0xb1b385542B6E80F77B94393Ba8342c3Af699f15c", // USR
      "0xb76d91340F5CE3577f0a056D29f6e3Eb4E88B140", // TON
      "0x7048c9e4aBD0cf0219E95a17A8C6908dfC4f0Ee4", // cbBTC
      "0xecAc9C5F704e954931349Da37F60E39f515c11c1", // LBTC
      "0xaE4EFbc7736f963982aACb17EFA37fCBAb924cB3", // SolvBTC
      "0xc99F5c922DAE05B6e2ff83463ce705eF7C91F077", // xSolvBTC
      "0xF9775085d726E782E83585033B58606f7731AB18", // uniBTC
      "0x4CBE838E2BD3B46247f80519B6aC79363298aa09", // satUniBTC
      "0xAf368c91793CB22739386DFCbBb2F1A9e4bCBeBf", // wstETH
      "0x37D6382B6889cCeF8d6871A8b60E667115eDDBcF", // pufETH
    ),
  },

  1776: {
    name: "pumex",
    factoryAddress: "0x105A0A9c1D9e29e0D68B746538895c94468108d2",
    wethAddress: "0x0000000088827d2d103ee2d9a6b781773ae03ffb",
    usdtWethPair: {
      address: "0x7626f823ef60bb454516da57b8c25ce0ff74463f", // WINJ/USDT
      wethIsToken0: true,
    },
    usdcWethPair: undefined,
    ...whitelist(
      "0x0000000088827d2d103ee2d9a6b781773ae03ffb", // WINJ
      "0x88f7f2b685f9692caf8c478f5badf09ee9b1cc13", // USDT
      "0x2a25fbd67b3ae485e461fe55d9dbef302b7d3989", // UUSDC
      "0xa00c59ff5a080d2b954d0c75e46e22a0c371235a", // USDC
    ),
  },
};

export function chainConfig(chainId: number): ChainConfig {
  const cfg = CHAIN_CONFIG[chainId];
  if (!cfg) throw new Error(`No chain config for chainId ${chainId}`);
  return cfg;
}

export const RPC_URL: Record<number, string> = {
  59144: process.env.ENVIO_RPC_URL_59144 || "https://rpc.linea.build",
  4663:
    process.env.ENVIO_RPC_URL_4663 || "https://rpc.mainnet.chain.robinhood.com",
  48900: process.env.ENVIO_RPC_URL_48900 || "https://mainnet.zircuit.com",
  9745: process.env.ENVIO_RPC_URL_9745 || "https://rpc.plasma.to",
  239: process.env.ENVIO_RPC_URL_239 || "https://rpc.ankr.com/tac",
  1776:
    process.env.ENVIO_RPC_URL_1776 ||
    "https://sentry.evm-rpc.injective.network",
};

export function cid(chainId: number, id: string): string {
  return `${chainId}-${id}`;
}

export function stripCid(id: string): string {
  return id.replace(/^\d+-/, "");
}

export function bundleId(chainId: number): string {
  return cid(chainId, "1");
}

export function factoryId(chainId: number): string {
  return cid(chainId, chainConfig(chainId).factoryAddress);
}

const whitelistIdCache = new Map<number, ReadonlySet<string>>();
export function whitelistIds(chainId: number): ReadonlySet<string> {
  let set = whitelistIdCache.get(chainId);
  if (set === undefined) {
    set = new Set(
      chainConfig(chainId).whitelistVerbatim.map((a) => cid(chainId, a)),
    );
    whitelistIdCache.set(chainId, set);
  }
  return set;
}
