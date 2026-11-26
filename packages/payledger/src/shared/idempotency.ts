import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { PayledgerDb } from "../db/index.js";
import { idempotencyKeys } from "../db/schema.js";
import { ValidationError, type AppEnv } from "./types.js";

export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys
    .filter((key) => obj[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(obj[key])}`);
  return `{${entries.join(",")}}`;
}

export function hashRequestPayload(rawBody: string): string {
  let normalized = rawBody;
  if (rawBody.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      normalized = canonicalizeJson(parsed);
    } catch {
      normalized = rawBody;
    }
  }
  return createHash("sha256").update(normalized).digest("hex");
}

export function requireIdempotency(db: PayledgerDb): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const keyHeader = c.req.header("Idempotency-Key");
    const idempotencyKey = keyHeader?.trim();
    if (!idempotencyKey) {
      throw new ValidationError("Missing required Idempotency-Key header", "MISSING_IDEMPOTENCY_KEY");
    }

    const rawBody = await c.req.text();
    c.set("rawBody", rawBody);
    c.set("idempotencyKey", idempotencyKey);

    const endpoint = `${c.req.method} ${c.req.path}`;
    const requestHash = hashRequestPayload(rawBody);

    const existing = db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, idempotencyKey), eq(idempotencyKeys.endpoint, endpoint)))
      .get();

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return c.json(
          { error: "Idempotency-Key conflict: payload mismatch", code: "IDEMPOTENCY_CONFLICT" },
          409
        );
      }

      c.header("X-Idempotent-Replayed", "true");
      return c.body(existing.responseJson, existing.statusCode as ContentfulStatusCode, {
        "Content-Type": "application/json; charset=UTF-8"
      });
    }

    await next();

    if (c.res.status === 200 || c.res.status === 201) {
      const responseJson = await c.res.clone().text();
      db.insert(idempotencyKeys)
        .values({
          key: idempotencyKey,
          endpoint,
          requestHash,
          statusCode: c.res.status,
          responseJson,
          createdAt: new Date().toISOString()
        })
        .onConflictDoNothing()
        .run();
    }
  };
}
