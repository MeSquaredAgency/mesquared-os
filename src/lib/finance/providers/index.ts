import type { FinanceProvider } from "@/lib/types";
import type { FinanceConnector } from "./types";

export * from "./types";

const registry = new Map<FinanceProvider, FinanceConnector>();

/** Pulls nothing; used when FINANCE_MODE=log or a provider has no connector. Webhook-driven rows still arrive. */
export const logFinanceConnector: FinanceConnector = {
  name: "log",
  provider: "MANUAL",
  async fetchTransactions() {
    return { ok: true, data: [] };
  },
  async fetchInvoices() {
    return { ok: true, data: [] };
  },
};

export function registerFinanceConnector(connector: FinanceConnector) {
  registry.set(connector.provider, connector);
}

export function financeConnectorFor(provider: FinanceProvider): FinanceConnector {
  if (process.env.FINANCE_MODE === "log") return { ...logFinanceConnector, provider };
  return registry.get(provider) ?? { ...logFinanceConnector, provider };
}

export function hasRealFinanceConnector(provider: FinanceProvider): boolean {
  return process.env.FINANCE_MODE !== "log" && registry.has(provider);
}
