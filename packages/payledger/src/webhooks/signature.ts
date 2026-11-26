import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_MAX_AGE_SECONDS = 300;

export function signWebhookPayload(
  rawBody: string,
  timestampSeconds: number,
  secret: string
): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex");
}

export type WebhookVerificationResult =
  | { valid: true; timestampSeconds: number }
  | { valid: false; reason: string };

export function verifyWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  secret: string;
  nowSeconds?: number;
  maxAgeSeconds?: number;
}): WebhookVerificationResult {
  const signature = params.signatureHeader?.trim();
  const timestampRaw = params.timestampHeader?.trim();

  if (!signature || !timestampRaw) {
    return { valid: false, reason: "missing_signature_or_timestamp" };
  }

  if (!/^\d+$/.test(timestampRaw)) {
    return { valid: false, reason: "invalid_timestamp_format" };
  }

  const timestampSeconds = Number(timestampRaw);
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = params.maxAgeSeconds ?? WEBHOOK_MAX_AGE_SECONDS;

  if (Math.abs(nowSeconds - timestampSeconds) > maxAgeSeconds) {
    return { valid: false, reason: "timestamp_expired" };
  }

  const expectedHex = signWebhookPayload(params.rawBody, timestampSeconds, params.secret);
  const expectedBuf = Buffer.from(expectedHex, "utf8");
  const providedBuf = Buffer.from(signature, "utf8");

  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true, timestampSeconds };
}
