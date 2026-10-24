import type { FinanceProvider, InvoiceStatus, TransactionKind, TransactionStatus } from "@/lib/types";

/**
 * Finance connectors. Read-only against the provider: they pull payments,
 * expenses and invoices so the Money panel and the reminders can work from
 * real numbers. Webhooks (Square, Stripe) are parsed here too so the route
 * stays thin. Credentials are decrypted per call and never logged.
 */
export interface FinanceCredentials {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  /** Xero: the connected organisation's tenant id (xero-tenant-id header). */
  xeroTenantId?: string | null;
  /** Square: restrict to one location when set. */
  locationId?: string | null;
  /** Webhook signature secret (Square signature key, Stripe endpoint secret). */
  webhookSecret?: string | null;
  [key: string]: unknown;
}

export interface ProviderTransaction {
  externalId: string;
  kind: TransactionKind;
  status: TransactionStatus;
  amountCents: number;
  currency: string;
  occurredAt: Date;
  note: string | null;
  customerName: string | null;
  customerEmail: string | null;
  /** The invoice this payment settles, when the provider says so. */
  invoiceExternalId: string | null;
}

export interface ProviderInvoice {
  externalId: string;
  number: string | null;
  amountCents: number;
  amountDueCents: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  url: string | null;
  customerName: string | null;
  customerEmail: string | null;
}

export type FinanceResult<T> = { ok: true; data: T } | { ok: false; error: string; retryable: boolean };

export interface FinanceConnector {
  readonly name: string;
  readonly provider: FinanceProvider;
  /** Payments, refunds and (where the provider has them) expenses since `since`. */
  fetchTransactions(creds: FinanceCredentials, since: Date): Promise<FinanceResult<ProviderTransaction[]>>;
  /** Invoices changed since `since`. Omit on providers without invoicing. */
  fetchInvoices?(creds: FinanceCredentials, since: Date): Promise<FinanceResult<ProviderInvoice[]>>;
  refreshCredentials?(creds: FinanceCredentials): Promise<FinanceCredentials | null>;
  /** True when the raw webhook body carries a valid signature for this secret. */
  verifyWebhook?(rawBody: string, headers: Record<string, string | null>, secret: string, url?: string): boolean;
  /** Turns a verified webhook body into transactions and invoices (either may be empty). */
  parseWebhook?(body: unknown): { transactions: ProviderTransaction[]; invoices: ProviderInvoice[]; merchantId: string | null };
}

export function financeError(status: number, body: unknown, fallback: string): string {
  const b = body as { error?: { message?: string } | string; message?: string; errors?: { detail?: string }[]; Detail?: string } | null;
  const msg = (typeof b?.error === "object" && b.error?.message) || (typeof b?.error === "string" ? b.error : null) || b?.message || b?.errors?.[0]?.detail || b?.Detail || fallback;
  return `${msg} (HTTP ${status})`.slice(0, 300);
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
