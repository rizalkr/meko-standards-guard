import { ValidationError } from "./types.js";

export const BPS_DENOMINATOR = 10_000n;

export function assertSafeCents(value: number, fieldName = "amountCents"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ValidationError(`${fieldName} must be a safe integer in minor units`);
  }
  return value;
}

export function assertPositiveCents(value: number, fieldName = "amountCents"): number {
  assertSafeCents(value, fieldName);
  if (value <= 0) {
    throw new ValidationError(`${fieldName} must be greater than zero`);
  }
  return value;
}

export function assertNonNegativeCents(value: number, fieldName = "amountCents"): number {
  assertSafeCents(value, fieldName);
  if (value < 0) {
    throw new ValidationError(`${fieldName} must be non-negative`);
  }
  return value;
}

export function assertValidBps(bps: number, fieldName = "bps"): number {
  if (typeof bps !== "number" || !Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) {
    throw new ValidationError(`${fieldName} must be an integer between 0 and 10000`);
  }
  return bps;
}

/**
 * Computes (amountCents * bps) / 10_000 using exact BigInt arithmetic
 * and half-to-even (banker's) rounding to prevent penny drift.
 */
export function multiplyBpsBankers(amountCents: number, bps: number): number {
  assertNonNegativeCents(amountCents, "amountCents");
  assertValidBps(bps, "bps");

  const num = BigInt(amountCents) * BigInt(bps);
  const q = num / BPS_DENOMINATOR;
  const r = num % BPS_DENOMINATOR;
  const twiceR = r * 2n;

  const shouldRoundUp =
    twiceR > BPS_DENOMINATOR || (twiceR === BPS_DENOMINATOR && q % 2n !== 0n);

  const result = Number(shouldRoundUp ? q + 1n : q);
  if (!Number.isSafeInteger(result)) {
    throw new ValidationError("Calculated monetary amount exceeds safe integer range");
  }
  return result;
}

export function sumCents(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    assertSafeCents(amount, "amount");
    total += amount;
    if (!Number.isSafeInteger(total)) {
      throw new ValidationError("Summed monetary amount exceeds safe integer range");
    }
  }
  return total;
}
