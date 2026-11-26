import { describe, expect, it } from "vitest";
import { signWebhookPayload, verifyWebhookSignature } from "../../src/webhooks/signature.js";

describe("webhook HMAC signature verification (Rule S6)", () => {
  const secret = "test-webhook-secret";
  const rawBody = JSON.stringify({ eventId: "evt_1", type: "invoice.paid", data: { invoiceId: "inv_1" } });
  const now = 1_700_000_000;

  it("accepts a valid signature within the 300s replay window", () => {
    const sig = signWebhookPayload(rawBody, now - 10, secret);
    const result = verifyWebhookSignature({
      rawBody,
      signatureHeader: sig,
      timestampHeader: String(now - 10),
      secret,
      nowSeconds: now
    });

    expect(result).toEqual({ valid: true, timestampSeconds: now - 10 });
  });

  it("rejects tampered payloads and mismatched signature lengths without throwing", () => {
    const sig = signWebhookPayload(rawBody, now, secret);

    const tampered = verifyWebhookSignature({
      rawBody: rawBody.replace("inv_1", "inv_2"),
      signatureHeader: sig,
      timestampHeader: String(now),
      secret,
      nowSeconds: now
    });
    expect(tampered).toEqual({ valid: false, reason: "signature_mismatch" });

    const shortSig = verifyWebhookSignature({
      rawBody,
      signatureHeader: "abc",
      timestampHeader: String(now),
      secret,
      nowSeconds: now
    });
    expect(shortSig).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("rejects timestamps older or newer than 300 seconds", () => {
    const expiredTs = now - 301;
    const expiredSig = signWebhookPayload(rawBody, expiredTs, secret);
    expect(
      verifyWebhookSignature({
        rawBody,
        signatureHeader: expiredSig,
        timestampHeader: String(expiredTs),
        secret,
        nowSeconds: now
      })
    ).toEqual({ valid: false, reason: "timestamp_expired" });

    const futureTs = now + 301;
    const futureSig = signWebhookPayload(rawBody, futureTs, secret);
    expect(
      verifyWebhookSignature({
        rawBody,
        signatureHeader: futureSig,
        timestampHeader: String(futureTs),
        secret,
        nowSeconds: now
      })
    ).toEqual({ valid: false, reason: "timestamp_expired" });
  });
});
