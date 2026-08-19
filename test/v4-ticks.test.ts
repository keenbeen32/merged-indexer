import { describe, expect, it } from "vitest";
import liveTicks from "../src/v4/__fixtures__/live-ticks-4663.json" with { type: "json" };
import saltSamples from "../src/v4/__fixtures__/salt-tokenid-samples.json" with { type: "json" };
import { createTick } from "../src/v4/utils/entities.js";
import { tokenIdToSaltHex } from "../src/v4/handlers/PositionManager.js";
import { entityId, stripChainPrefix, positionId, eventId, toLowerHex } from "../src/v4/utils/id.js";
import {
  MAX_SIGNIFICANT_DIGITS,
  ZERO_BD,
  ONE_BD,
  bd,
  normalize,
  bdTimes,
  bdDiv,
} from "../src/v4/utils/bigDecimal.js";
import { fastExponentiation, safeDiv, exponentToBigDecimal } from "../src/v4/utils/index.js";

type LiveTick = { id: string; tickIdx: string; price0: string; price1: string };
const ticks = (liveTicks as { data: { ticks: LiveTick[] } }).data.ticks;

describe("v4 tick prices against the reference fixture", () => {
  it("has ticks to check", () => {
    expect(ticks.length).toBeGreaterThan(0);
  });

  it("reproduces price0 for every reference tick", () => {
    for (const t of ticks) {
      const computed = fastExponentiation(bd("1.0001"), Number(t.tickIdx));
      expect(computed.toString(), `price0 at tickIdx ${t.tickIdx}`).toBe(t.price0);
    }
  });

  it("reproduces price1 for every reference tick", () => {
    for (const t of ticks) {
      const price0 = fastExponentiation(bd("1.0001"), Number(t.tickIdx));
      expect(safeDiv(ONE_BD, price0).toString(), `price1 at tickIdx ${t.tickIdx}`).toBe(
        t.price1,
      );
    }
  });

  it("createTick carries those same prices", () => {
    const t = ticks[0]!;
    const tickIdx = Number(t.tickIdx);
    const tick = createTick(entityId(4663, `pool#${tickIdx}`), tickIdx, "4663-0xpool", 1, 2);
    expect(tick.price0.toString()).toBe(t.price0);
    expect(tick.price1.toString()).toBe(t.price1);
  });

  it("createTick strips the chain prefix for poolAddress but not pool_id", () => {
    const tick = createTick("4663-x", 0, "4663-0xpool", 1, 2);
    expect(tick.pool_id).toBe("4663-0xpool");
    expect(tick.poolAddress).toBe("0xpool");
  });
});

describe("tokenIdToSaltHex against the reference fixture", () => {
  it("matches the recorded 32-byte salt for every sample", () => {
    for (const s of saltSamples as { tokenId: string; tokenIdHex32: string }[]) {
      expect(tokenIdToSaltHex(BigInt(s.tokenId)).toLowerCase()).toBe(
        s.tokenIdHex32.toLowerCase(),
      );
    }
  });

  it("left-pads to 32 bytes", () => {
    const hex = tokenIdToSaltHex(1n);
    expect(hex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(BigInt(hex)).toBe(1n);
  });
});

describe("v4 id helpers", () => {
  it("round-trips the chain prefix", () => {
    expect(entityId(4663, "1")).toBe("4663-1");
    expect(stripChainPrefix(entityId(4663, "1"))).toBe("1");
  });

  it("strips only a leading numeric prefix", () => {
    expect(stripChainPrefix("4663-0xabc")).toBe("0xabc");
    expect(stripChainPrefix("0xabc")).toBe("0xabc");
  });

  it("renders tokenIds in decimal, not hex", () => {
    expect(positionId(255n)).toBe("255");
  });

  it("builds event ids as hash-logIndex", () => {
    expect(eventId("0xAbC", 3)).toBe("0xabc-3");
  });

  it("lowercases hex", () => {
    expect(toLowerHex("0xDEADBEEF")).toBe("0xdeadbeef");
  });
});

describe("v4 BigDecimal helpers", () => {
  it("normalises to 34 significant digits", () => {
    expect(normalize(bd("1." + "1".repeat(60))).precision()).toBe(MAX_SIGNIFICANT_DIGITS);
  });

  it("normalises per operation", () => {
    const a = bd("1e-10");
    const b = bd(3);
    const c = bd(7);
    expect(bdTimes(bdDiv(a, b), c).toString()).toBe(
      normalize(normalize(a.div(b)).times(c)).toString(),
    );
  });

  it("safeDiv yields zero on a zero denominator", () => {
    expect(safeDiv(ONE_BD, ZERO_BD).isZero()).toBe(true);
  });

  it("builds 10^n", () => {
    expect(exponentToBigDecimal(0n).toString()).toBe("1");
    expect(exponentToBigDecimal(18n).toString()).toBe("1000000000000000000");
  });

  it("fastExponentiation returns one for a zero exponent", () => {
    expect(fastExponentiation(bd("1.0001"), 0).toString()).toBe("1");
  });
});
