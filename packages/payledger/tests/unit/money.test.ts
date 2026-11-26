import { describe, expect, it } from "vitest";
import {
  assertPositiveCents,
  assertSafeCents,
  assertValidBps,
  multiplyBpsBankers,
  sumCents
} from "../../src/shared/money.js";

describe("money helpers (Rule S1)", () => {
  it("accepts safe integers and rejects floats, NaN, and Infinity", () => {
    expect(assertSafeCents(0)).toBe(0);
    expect(assertSafeCents(125_00)).toBe(125_00);
    expect(assertPositiveCents(1)).toBe(1);

    expect(() => assertSafeCents(10.5)).toThrow();
    expect(() => assertSafeCents(Number.NaN)).toThrow();
    expect(() => assertSafeCents(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => assertPositiveCents(0)).toThrow();
    expect(() => assertValidBps(10_001)).toThrow();
  });

  it("applies exact half-to-even banker's rounding on bps ties", () => {
    // 100 * 250 / 10000 = 2.5 -> rounds to even 2
    expect(multiplyBpsBankers(100, 250)).toBe(2);
    // 300 * 250 / 10000 = 7.5 -> rounds to even 8
    expect(multiplyBpsBankers(300, 250)).toBe(8);
    // 500 * 250 / 10000 = 12.5 -> rounds to even 12
    expect(multiplyBpsBankers(500, 250)).toBe(12);
    // 700 * 250 / 10000 = 17.5 -> rounds to even 18
    expect(multiplyBpsBankers(700, 250)).toBe(18);
    // 101 * 250 / 10000 = 2.525 -> rounds to 3
    expect(multiplyBpsBankers(101, 250)).toBe(3);
    // 11% of $100.00 (10000 cents) = 1100 cents exact
    expect(multiplyBpsBankers(10_000, 1100)).toBe(1_100);
  });

  it("maintains zero rounding drift across repeated equal splits", () => {
    const fees = [100, 300, 500, 700].map((amount) => multiplyBpsBankers(amount, 250));
    expect(sumCents(fees)).toBe(2 + 8 + 12 + 18);
    expect(sumCents(fees)).toBe(40);
  });
});
