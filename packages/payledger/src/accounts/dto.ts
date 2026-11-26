import type { MerchantRow } from "../db/schema.js";

export interface PublicMerchantDto {
  id: string;
  name: string;
  email: string;
  feeBps: number;
  taxRateBps: number;
  createdAt: string;
}

/**
 * Strips sensitive financial PII (bankAccountNumber, routingNumber, taxId)
 * before returning merchant data in HTTP responses or logs.
 */
export function toPublicMerchantDto(row: MerchantRow): PublicMerchantDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    feeBps: row.feeBps,
    taxRateBps: row.taxRateBps,
    createdAt: row.createdAt
  };
}
