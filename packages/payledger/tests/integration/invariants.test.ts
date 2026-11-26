import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPayledgerApp,
  createPayledgerDb,
  getGlobalLedgerTotals,
  getGroupLedgerTotals,
  ledgerEntries,
  signWebhookPayload,
  type PayledgerDbHandle
} from "../../src/index.js";

const WEBHOOK_SECRET = "payledger-local-test-secret";

describe("PayLedger Mini financial & security invariants (S1-S7)", () => {
  let dbHandle: PayledgerDbHandle;
  let nowSeconds: number;
  let webhookLogs: Array<{ event: string; reason: string }>;

  beforeEach(() => {
    dbHandle = createPayledgerDb(":memory:");
    nowSeconds = 1_700_000_000;
    webhookLogs = [];
  });

  afterEach(() => {
    dbHandle.close();
  });

  function buildApp() {
    return createPayledgerApp({
      db: dbHandle.db,
      webhookSecret: WEBHOOK_SECRET,
      nowSeconds: () => nowSeconds,
      webhookLogger: (entry) => webhookLogs.push(entry)
    });
  }

  async function seedMerchant(app: ReturnType<typeof buildApp>) {
    const res = await app.request("/merchants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Acme Coffee Roasters",
        email: "finance@acmeroasters.example",
        bankAccountNumber: "9876543210",
        routingNumber: "021000021",
        taxId: "99-1234567",
        feeBps: 250,
        taxRateBps: 1100
      })
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { merchant: { id: string } };
    return json.merchant;
  }

  it("enforces S1 integer cents & S3 double-entry balance on invoice capture", async () => {
    const app = buildApp();
    const merchant = await seedMerchant(app);

    const invRes = await app.request("/invoices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "inv-create-1"
      },
      body: JSON.stringify({
        merchantId: merchant.id,
        lineItems: [
          { description: "Espresso Blend", quantity: 2, unitAmountCents: 2_500 },
          { description: "Filter Roast", quantity: 1, unitAmountCents: 5_000 }
        ]
      })
    });
    expect(invRes.status).toBe(201);
    const { invoice } = (await invRes.json()) as {
      invoice: {
        id: string;
        subtotalCents: number;
        taxCents: number;
        feeCents: number;
        totalCents: number;
      };
    };

    expect(invoice.subtotalCents).toBe(10_000);
    expect(invoice.taxCents).toBe(1_100);
    expect(invoice.feeCents).toBe(250);
    expect(invoice.totalCents).toBe(11_100);

    const capRes = await app.request(`/invoices/${invoice.id}/capture`, {
      method: "POST",
      headers: { "Idempotency-Key": "inv-cap-1" }
    });
    expect(capRes.status).toBe(200);
    const capBody = (await capRes.json()) as { txGroupId: string };

    expect(getGroupLedgerTotals(dbHandle.db, capBody.txGroupId)).toEqual({
      debitCents: 11_100,
      creditCents: 11_100,
      balanced: true
    });
    expect(getGlobalLedgerTotals(dbHandle.db)).toEqual({
      debitCents: 11_100,
      creditCents: 11_100,
      balanced: true
    });

    const stmtRes = await app.request(`/merchants/${merchant.id}/statement`);
    expect(stmtRes.status).toBe(200);
    const stmt = (await stmtRes.json()) as { availableBalanceCents: number };
    expect(stmt.availableBalanceCents).toBe(9_750);
  });

  it("enforces S2 idempotency replay and 409 payload conflict on money mutations", async () => {
    const app = buildApp();
    const merchant = await seedMerchant(app);

    const invRes = await app.request("/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "inv-2" },
      body: JSON.stringify({
        merchantId: merchant.id,
        lineItems: [{ description: "Subscription", quantity: 1, unitAmountCents: 10_000 }]
      })
    });
    const { invoice } = (await invRes.json()) as { invoice: { id: string } };
    await app.request(`/invoices/${invoice.id}/capture`, {
      method: "POST",
      headers: { "Idempotency-Key": "cap-2" }
    });

    // Missing Idempotency-Key -> 400
    const missingKeyRes = await app.request("/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchantId: merchant.id, amountCents: 5_000 })
    });
    expect(missingKeyRes.status).toBe(400);

    // First payout -> 201
    const firstPayout = await app.request("/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "po-key-1" },
      body: JSON.stringify({ merchantId: merchant.id, amountCents: 5_000 })
    });
    expect(firstPayout.status).toBe(201);
    const firstJson = (await firstPayout.json()) as { payoutId: string };

    // Replay with reordered JSON keys -> 201 + X-Idempotent-Replayed: true, no duplicate ledger rows
    const replayPayout = await app.request("/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "po-key-1" },
      body: JSON.stringify({ amountCents: 5_000, merchantId: merchant.id })
    });
    expect(replayPayout.status).toBe(201);
    expect(replayPayout.headers.get("X-Idempotent-Replayed")).toBe("true");
    const replayJson = (await replayPayout.json()) as { payoutId: string };
    expect(replayJson.payoutId).toBe(firstJson.payoutId);

    // Conflicting payload under same key -> 409
    const conflictPayout = await app.request("/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "po-key-1" },
      body: JSON.stringify({ merchantId: merchant.id, amountCents: 4_000 })
    });
    expect(conflictPayout.status).toBe(409);
  });

  it("enforces S3 append-only reversal without mutating original ledger rows", async () => {
    const app = buildApp();
    const merchant = await seedMerchant(app);

    const invRes = await app.request("/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "inv-3" },
      body: JSON.stringify({
        merchantId: merchant.id,
        lineItems: [{ description: "Order", quantity: 1, unitAmountCents: 10_000 }]
      })
    });
    const { invoice } = (await invRes.json()) as { invoice: { id: string } };
    await app.request(`/invoices/${invoice.id}/capture`, {
      method: "POST",
      headers: { "Idempotency-Key": "cap-3" }
    });

    const payoutRes = await app.request("/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "po-3" },
      body: JSON.stringify({ merchantId: merchant.id, amountCents: 5_000 })
    });
    const { payoutId } = (await payoutRes.json()) as { payoutId: string };

    const countBefore = dbHandle.db.select().from(ledgerEntries).all().length;

    const revRes = await app.request(`/payouts/${payoutId}/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "rev-3" },
      body: JSON.stringify({ reason: "Bank return R01" })
    });
    expect(revRes.status).toBe(201);
    const revJson = (await revRes.json()) as { reversedTxGroupId: string };
    expect(revJson.reversedTxGroupId).toBe(payoutId);

    const allRows = dbHandle.db.select().from(ledgerEntries).all();
    expect(allRows.length).toBe(countBefore + 2);
    expect(getGlobalLedgerTotals(dbHandle.db).balanced).toBe(true);

    const stmtRes = await app.request(`/merchants/${merchant.id}/statement`);
    const stmt = (await stmtRes.json()) as { availableBalanceCents: number };
    expect(stmt.availableBalanceCents).toBe(9_750);

    // Second reversal of same payout -> 409
    const secondRev = await app.request(`/payouts/${payoutId}/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "rev-3b" },
      body: JSON.stringify({ reason: "Duplicate attempt" })
    });
    expect(secondRev.status).toBe(409);
  });

  it("enforces S4 zero financial PII leakage across merchant endpoints", async () => {
    const app = buildApp();
    const createRes = await app.request("/merchants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "PII Check Merchant",
        email: "pii@example.com",
        bankAccountNumber: "9876543210",
        routingNumber: "021000021",
        taxId: "99-1234567",
        feeBps: 250,
        taxRateBps: 1100
      })
    });
    const createText = await createRes.text();
    const { merchant } = JSON.parse(createText) as { merchant: { id: string } };

    const getText = await (await app.request(`/merchants/${merchant.id}`)).text();
    const patchText = await (
      await app.request(`/merchants/${merchant.id}/rates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeBps: 300 })
      })
    ).text();
    const stmtText = await (await app.request(`/merchants/${merchant.id}/statement`)).text();

    for (const bodyText of [createText, getText, patchText, stmtText]) {
      expect(bodyText).not.toContain("bankAccountNumber");
      expect(bodyText).not.toContain("bank_account_number");
      expect(bodyText).not.toContain("routingNumber");
      expect(bodyText).not.toContain("routing_number");
      expect(bodyText).not.toContain("taxId");
      expect(bodyText).not.toContain("tax_id");
      expect(bodyText).not.toContain("9876543210");
      expect(bodyText).not.toContain("021000021");
      expect(bodyText).not.toContain("99-1234567");
    }
  });

  it("enforces S5 atomic payout balance lock preventing concurrent overdraft", async () => {
    const app = buildApp();
    const merchant = await seedMerchant(app);

    const invRes = await app.request("/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "inv-5" },
      body: JSON.stringify({
        merchantId: merchant.id,
        lineItems: [{ description: "Order", quantity: 1, unitAmountCents: 10_000 }]
      })
    });
    const { invoice } = (await invRes.json()) as { invoice: { id: string } };
    await app.request(`/invoices/${invoice.id}/capture`, {
      method: "POST",
      headers: { "Idempotency-Key": "cap-5" }
    });

    // Available balance is 9750; two concurrent requests for 7800 (80%)
    const [resA, resB] = await Promise.all([
      app.request("/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "po-race-a" },
        body: JSON.stringify({ merchantId: merchant.id, amountCents: 7_800 })
      }),
      app.request("/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "po-race-b" },
        body: JSON.stringify({ merchantId: merchant.id, amountCents: 7_800 })
      })
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 422]);

    const stmtRes = await app.request(`/merchants/${merchant.id}/statement`);
    const stmt = (await stmtRes.json()) as { availableBalanceCents: number };
    expect(stmt.availableBalanceCents).toBe(1_950);
    expect(getGlobalLedgerTotals(dbHandle.db).balanced).toBe(true);
  });

  it("enforces S6 HMAC verification before JSON.parse, replay window, and PII-free logging", async () => {
    const app = buildApp();
    const merchant = await seedMerchant(app);

    const invRes = await app.request("/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "inv-6" },
      body: JSON.stringify({
        merchantId: merchant.id,
        lineItems: [{ description: "Webhook Item", quantity: 1, unitAmountCents: 10_000 }]
      })
    });
    const { invoice } = (await invRes.json()) as { invoice: { id: string } };

    // Malformed JSON with invalid signature MUST return 401 (verified before JSON.parse)
    const malformedUnsigned = await app.request("/webhooks/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": "deadbeef",
        "X-Timestamp": String(nowSeconds)
      },
      body: "{not-valid-json-taxId-99-1234567"
    });
    expect(malformedUnsigned.status).toBe(401);
    expect(webhookLogs).toEqual([{ event: "webhook_rejected", reason: "signature_mismatch" }]);
    expect(JSON.stringify(webhookLogs)).not.toContain("99-1234567");

    // Malformed JSON with VALID signature reaches JSON.parse and returns 400
    const badJsonBody = "{not-valid-json";
    const badJsonSig = signWebhookPayload(badJsonBody, nowSeconds, WEBHOOK_SECRET);
    const malformedSigned = await app.request("/webhooks/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": badJsonSig,
        "X-Timestamp": String(nowSeconds)
      },
      body: badJsonBody
    });
    expect(malformedSigned.status).toBe(400);

    // Expired timestamp -> 401
    const validBody = JSON.stringify({
      eventId: "evt_paid_1",
      type: "invoice.paid",
      data: { invoiceId: invoice.id }
    });
    const oldTs = nowSeconds - 301;
    const expiredSig = signWebhookPayload(validBody, oldTs, WEBHOOK_SECRET);
    const expiredRes = await app.request("/webhooks/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": expiredSig,
        "X-Timestamp": String(oldTs)
      },
      body: validBody
    });
    expect(expiredRes.status).toBe(401);

    // Valid webhook captures invoice
    const validSig = signWebhookPayload(validBody, nowSeconds, WEBHOOK_SECRET);
    const okRes = await app.request("/webhooks/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": validSig,
        "X-Timestamp": String(nowSeconds)
      },
      body: validBody
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ received: true, duplicate: false, invoiceId: invoice.id });

    // Duplicate webhook event returns duplicate: true without re-capturing
    const dupRes = await app.request("/webhooks/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": validSig,
        "X-Timestamp": String(nowSeconds)
      },
      body: validBody
    });
    expect(dupRes.status).toBe(200);
    expect(await dupRes.json()).toEqual({ received: true, duplicate: true, invoiceId: invoice.id });
  });

  it("enforces S7 immutable invoice snapshots when merchant rates change later", async () => {
    const app = buildApp();
    const merchant = await seedMerchant(app);

    const invRes = await app.request("/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "inv-7" },
      body: JSON.stringify({
        merchantId: merchant.id,
        lineItems: [{ description: "Snapshotted Service", quantity: 1, unitAmountCents: 10_000 }]
      })
    });
    const { invoice: created } = (await invRes.json()) as {
      invoice: {
        id: string;
        feeBps: number;
        feeCents: number;
        taxRateBps: number;
        taxCents: number;
        totalCents: number;
      };
    };

    expect(created.feeBps).toBe(250);
    expect(created.feeCents).toBe(250);
    expect(created.taxRateBps).toBe(1100);
    expect(created.taxCents).toBe(1_100);
    expect(created.totalCents).toBe(11_100);

    const patchRes = await app.request(`/merchants/${merchant.id}/rates`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeBps: 500, taxRateBps: 2000 })
    });
    expect(patchRes.status).toBe(200);

    const fetchedRes = await app.request(`/invoices/${created.id}`);
    expect(fetchedRes.status).toBe(200);
    const { invoice: fetched } = (await fetchedRes.json()) as {
      invoice: typeof created;
    };

    expect(fetched.feeBps).toBe(250);
    expect(fetched.feeCents).toBe(250);
    expect(fetched.taxRateBps).toBe(1100);
    expect(fetched.taxCents).toBe(1_100);
    expect(fetched.totalCents).toBe(11_100);
  });
});
