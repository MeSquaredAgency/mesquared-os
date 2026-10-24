import { registerFinanceConnector } from "./index";
import { squareConnector } from "./square";
import { stripeConnector } from "./stripe";
import type { FinanceConnector } from "./types";
import { xeroConnector } from "./xero";

/**
 * Registers every real finance connector with the registry in ./index. Safe to
 * call more than once; only the first call does any work. The registry still
 * answers with the log connector when FINANCE_MODE=log, so demo mode and CI
 * are unaffected by registering these.
 */

export const builtInFinanceConnectors: readonly FinanceConnector[] = [squareConnector, stripeConnector, xeroConnector];

let registered = false;

export function registerBuiltInFinanceConnectors(): void {
  if (registered) return;
  registered = true;
  for (const connector of builtInFinanceConnectors) registerFinanceConnector(connector);
}
