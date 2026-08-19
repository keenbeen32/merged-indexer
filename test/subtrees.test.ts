import { describe, expect, it } from "vitest";
import { BigDecimal } from "envio";
import pairs from "../src/v1/utils/__fixtures__/bigdecimal-pairs.json" with { type: "json" };

import {
  ZERO_BD as V1_ZERO_BD,
  norm as v1Norm,
  plus as v1Plus,
  minus as v1Minus,
  times as v1Times,
  div as v1Div,
  toBigDecimal as v1ToBigDecimal,
  exponentToBigDecimal as v1Exponent,
} from "../src/v1/utils/math.js";
import { convertTokenToDecimal, isNullEthValue } from "../src/v1/utils/helpers.js";
import { cid as v1Cid, bundleId, stripCid as v1StripCid } from "../src/v1/config/chains.js";

import {
  cid as helperCid,
  stripCid as helperStripCid,
  gaugeStateId,
  isHelperChain,
  features,
} from "../src/helper/config/chains.js";

import {
  cid as analyticsCid,
  stripCid as analyticsStripCid,
  singletonId,
  chainConfig,
  isAnalyticsChain,
  whitelistTokenIds,
  referenceTokenId,
} from "../src/analytics/config/chain.js";

type Pair = {
  id: string;
  reserve0: string;
  reserve1: string;
  token0Price: string;
  token1Price: string;
};
const fixture = pairs as Pair[];

/** The significant-digit budget every stored BigDecimal is normalised to. */
const V1_SIGNIFICANT_DIGITS = 34;

describe("v1 BigDecimal precision against the reference fixture", () => {
  const usable = fixture.filter(
    (p) => Number(p.reserve0) !== 0 && Number(p.reserve1) !== 0,
  );

  it("has pairs to check", () => {
    expect(usable.length).toBeGreaterThan(0);
  });

  it("reproduces token0Price as reserve0 / reserve1", () => {
    for (const p of usable) {
      const got = v1Div(new BigDecimal(p.reserve0), new BigDecimal(p.reserve1));
      expect(got.toString(), `token0Price for ${p.id}`).toBe(p.token0Price);
    }
  });

  it("reproduces token1Price as reserve1 / reserve0", () => {
    for (const p of usable) {
      const got = v1Div(new BigDecimal(p.reserve1), new BigDecimal(p.reserve0));
      expect(got.toString(), `token1Price for ${p.id}`).toBe(p.token1Price);
    }
  });

  it("keeps every reference price within the significant-digit budget", () => {
    for (const p of usable) {
      expect(new BigDecimal(p.token0Price).precision()).toBeLessThanOrEqual(
        V1_SIGNIFICANT_DIGITS,
      );
    }
  });
});

describe("v1 math helpers", () => {
  it("normalises to 34 significant digits", () => {
    expect(v1Norm(new BigDecimal("1." + "1".repeat(60))).precision()).toBe(
      V1_SIGNIFICANT_DIGITS,
    );
  });

  it("never returns the shared ZERO_BD from arithmetic", () => {
    const computedZero = v1Times(new BigDecimal(0), new BigDecimal(5));
    expect(computedZero.isZero()).toBe(true);
    expect(computedZero).not.toBe(V1_ZERO_BD);
  });

  it("adds, subtracts and multiplies", () => {
    expect(v1Plus(new BigDecimal(2), new BigDecimal(3)).toString()).toBe("5");
    expect(v1Minus(new BigDecimal(5), new BigDecimal(3)).toString()).toBe("2");
    expect(v1Times(new BigDecimal(4), new BigDecimal(3)).toString()).toBe("12");
  });

  it("throws rather than yielding Infinity on a zero divisor", () => {
    expect(() => v1Div(new BigDecimal(1), new BigDecimal(0))).toThrow();
  });

  it("converts BigInt and builds 10^n", () => {
    expect(v1ToBigDecimal(42n).toString()).toBe("42");
    expect(v1Exponent(6n).toString()).toBe("1000000");
  });

  it("scales token amounts by decimals", () => {
    expect(convertTokenToDecimal(1_500_000n, 6n).toString()).toBe("1.5");
    expect(convertTokenToDecimal(42n, 0n).toString()).toBe("42");
  });

  it("detects the null sentinel", () => {
    expect(
      isNullEthValue(
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ),
    ).toBe(true);
    expect(isNullEthValue("0x0")).toBe(false);
  });
});

describe("chain-prefixed ids", () => {
  it("round-trips in every subtree", () => {
    for (const [prefix, strip] of [
      [v1Cid, v1StripCid],
      [helperCid, helperStripCid],
      [analyticsCid, analyticsStripCid],
    ] as const) {
      expect(strip(prefix(239, "abc"))).toBe("abc");
      expect(prefix(239, "abc")).toBe("239-abc");
    }
  });

  it("gives the same singleton a different id per chain", () => {
    expect(bundleId(239)).not.toBe(bundleId(9745));
    expect(singletonId(239)).not.toBe(singletonId(9745));
    expect(gaugeStateId(9745)).not.toBe(gaugeStateId(1776));
  });
});

describe("helper chain features", () => {
  it("recognises the chains it covers and rejects the rest", () => {
    expect(isHelperChain(59144)).toBe(true);
    expect(isHelperChain(239)).toBe(false);
    expect(() => features(239)).toThrow();
  });

  it("pairs a polling anchor with a ve token on every ve chain", () => {
    for (const chainId of [9745, 1776, 4663]) {
      const f = features(chainId);
      expect(f.vePoints).toBe(true);
      expect(f.veTokenPolling?.veToken).toMatch(/^0x[0-9a-f]{40}$/);
      expect(f.veTokenPolling!.every).toBeGreaterThan(0);
      expect(f.gaugePolling!.every).toBeGreaterThan(0);
    }
  });

  it("enables PreMining on Zircuit only", () => {
    expect(features(48900).preMining).toBe(true);
    for (const chainId of [59144, 9745, 1776, 4663]) {
      expect(features(chainId).preMining).toBe(false);
    }
  });
});

describe("analytics chain config", () => {
  it("recognises the chains it covers", () => {
    expect(isAnalyticsChain(239)).toBe(true);
    expect(isAnalyticsChain(59144)).toBe(false);
    expect(() => chainConfig(59144)).toThrow();
  });

  it("keeps every configured address lowercase", () => {
    for (const chainId of [239, 9745]) {
      const cfg = chainConfig(chainId);
      expect(cfg.factoryAddress).toBe(cfg.factoryAddress.toLowerCase());
      expect(cfg.referenceToken).toBe(cfg.referenceToken.toLowerCase());
      for (const t of cfg.whitelistTokens) expect(t).toBe(t.toLowerCase());
    }
  });

  it("prefixes the whitelist lookup so it matches prefixed token ids", () => {
    const ids = whitelistTokenIds(239);
    const cfg = chainConfig(239);
    for (const t of cfg.whitelistTokens) {
      expect(ids.has(analyticsCid(239, t))).toBe(true);
      expect(ids.has(t)).toBe(false);
    }
  });

  it("derives the reference token id from the configured address", () => {
    expect(referenceTokenId(239)).toBe(analyticsCid(239, chainConfig(239).referenceToken));
  });
});
