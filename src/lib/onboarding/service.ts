import { randomBytes } from "node:crypto";
import { hashApiKey } from "@/lib/crypto";
import { repository } from "@/lib/data";
import { applyDefinition, definitionProblems, type TenantDefinition } from "@/lib/tenants/definition";
import type { OnboardingRecord, TenantSummary } from "@/lib/types";
import { missingRequired, sanitizeAnswers, type OnboardingAnswers } from "./form";
import { draftTenantDefinition, fromFormAnswers, handOverSummary, type TenantDefinitionDraft } from "./questionnaire";

/**
 * The client onboarding lifecycle. An operator creates a private link; the
 * client fills in the form at /onboarding/<token> (answers save as they go)
 * and sends it; the operator reviews the drafted workspace in the console and
 * creates it. The token is shown once and stored only as a SHA-256 hash, the
 * same as API keys. No Next.js imports, so it is tested directly.
 */

/** How long a link stays open for the client. Renewing it starts the clock again. */
export const LINK_DAYS = 60;
/** The most a single save may carry: far more than the whole form needs. */
export const MAX_ANSWER_BYTES = 100_000;

const DAY_MS = 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashToken = (token: string) => hashApiKey(token);
const newToken = () => randomBytes(24).toString("base64url");

/** The client's link. Relative when the deployment has no public URL yet (local development). */
export function onboardingUrl(token: string, base = process.env.NEXT_PUBLIC_APP_URL): string {
  return `${base ? base.replace(/\/$/, "") : ""}/onboarding/${token}`;
}

export async function createOnboardingLink(input: { label: string; contactEmail?: string | null; createdById: string | null; now?: Date }): Promise<{ record: OnboardingRecord; token: string }> {
  const label = input.label.trim();
  if (label.length < 2 || label.length > 120) throw new Error("Give the client's business name (2 to 120 characters).");
  const contactEmail = input.contactEmail?.trim().toLowerCase() || null;
  if (contactEmail && !EMAIL.test(contactEmail)) throw new Error("That contact email doesn't look right.");
  const now = input.now ?? new Date();
  const token = newToken();
  const created = await repository.createOnboarding({ tokenHash: hashToken(token), label, contactEmail, createdById: input.createdById, expiresAt: new Date(now.getTime() + LINK_DAYS * DAY_MS) });
  // Start the client off with what we already know.
  const record = (await repository.updateOnboarding(created.id, { answers: { businessName: label, ...(contactEmail ? { contactEmail } : {}) } })) ?? created;
  return { record, token };
}

export type OpenResult = { ok: true; record: OnboardingRecord } | { ok: false; reason: "not_found" | "expired" | "withdrawn" };

/** What the client's link points at, if it still works. A sent or finished form still opens (read-only). */
export async function openOnboarding(token: string, now = new Date()): Promise<OpenResult> {
  // The token arrives from the browser (a server action argument), so its type is not trusted either.
  if (typeof token !== "string" || !token || token.length > 100) return { ok: false, reason: "not_found" };
  const record = await repository.findOnboardingByTokenHash(hashToken(token));
  if (!record) return { ok: false, reason: "not_found" };
  if (record.status === "CANCELLED") return { ok: false, reason: "withdrawn" };
  if ((record.status === "INVITED" || record.status === "IN_PROGRESS") && record.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, record };
}

export const isEditable = (record: OnboardingRecord) => record.status === "INVITED" || record.status === "IN_PROGRESS";

export type SaveResult = { ok: true; savedAt: Date; answers: OnboardingAnswers } | { ok: false; reason: "not_found" | "expired" | "withdrawn" | "locked" | "too_large" };

/** Saves the client's answers so far. Anything the form does not define is dropped. */
export async function saveOnboardingAnswers(token: string, raw: unknown, now = new Date()): Promise<SaveResult> {
  if (JSON.stringify(raw ?? {}).length > MAX_ANSWER_BYTES) return { ok: false, reason: "too_large" };
  const opened = await openOnboarding(token, now);
  if (!opened.ok) return opened;
  if (!isEditable(opened.record)) return { ok: false, reason: "locked" };
  const answers = sanitizeAnswers(raw);
  await repository.updateOnboarding(opened.record.id, { answers, status: "IN_PROGRESS", ...(opened.record.startedAt ? {} : { startedAt: now }) });
  return { ok: true, savedAt: now, answers };
}

export type SubmitResult = { ok: true } | { ok: false; reason: "not_found" | "expired" | "withdrawn" | "locked" | "too_large" | "incomplete"; missing?: { stepId: string; stepTitle: string; label: string; short: string }[] };

/** Saves and sends the form. Refused, with what is missing, until the required answers are in. */
export async function submitOnboarding(token: string, raw: unknown, now = new Date()): Promise<SubmitResult> {
  const saved = await saveOnboardingAnswers(token, raw, now);
  if (!saved.ok) return saved;
  const missing = missingRequired(saved.answers);
  if (missing.length) return { ok: false, reason: "incomplete", missing };
  const opened = await openOnboarding(token, now);
  if (!opened.ok) return opened;
  await repository.updateOnboarding(opened.record.id, { status: "SUBMITTED", submittedAt: now });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Console side (callers check the operator is a platform admin)
// ---------------------------------------------------------------------------

export interface OnboardingDraft {
  definition: TenantDefinitionDraft;
  review: string[];
  /** Problems that stop the workspace being created as drafted. */
  blockers: string[];
  handOver: string[];
}

export function draftFromOnboarding(record: OnboardingRecord, overrides: { slug?: string } = {}): OnboardingDraft {
  const answers = sanitizeAnswers(record.answers);
  const { definition, review } = draftTenantDefinition(fromFormAnswers(answers));
  if (overrides.slug?.trim()) definition.slug = overrides.slug.trim();
  return { definition, review, blockers: definitionProblems(definition as TenantDefinition), handOver: handOverSummary(answers) };
}

async function mustFind(id: string): Promise<OnboardingRecord> {
  const record = await repository.findOnboardingById(id);
  if (!record) throw new Error("That questionnaire no longer exists.");
  return record;
}

/** A fresh link for the same questionnaire; the old one stops working at once. */
export async function renewOnboardingLink(id: string, now = new Date()): Promise<{ record: OnboardingRecord; token: string }> {
  const record = await mustFind(id);
  if (record.status === "PROVISIONED" || record.status === "CANCELLED") throw new Error("This questionnaire is closed; create a new one instead.");
  const token = newToken();
  const updated = await repository.updateOnboarding(id, { tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + LINK_DAYS * DAY_MS) });
  return { record: updated ?? record, token };
}

/** Lets the client change a form they already sent. */
export async function reopenOnboarding(id: string, now = new Date()): Promise<OnboardingRecord> {
  const record = await mustFind(id);
  if (record.status !== "SUBMITTED") throw new Error("Only a sent questionnaire can be reopened.");
  const expiresAt = record.expiresAt.getTime() < now.getTime() + 7 * DAY_MS ? new Date(now.getTime() + 14 * DAY_MS) : record.expiresAt;
  return (await repository.updateOnboarding(id, { status: "IN_PROGRESS", submittedAt: null, expiresAt })) ?? record;
}

export async function withdrawOnboarding(id: string): Promise<OnboardingRecord> {
  const record = await mustFind(id);
  if (record.status === "PROVISIONED") throw new Error("A workspace was already created from this questionnaire.");
  return (await repository.updateOnboarding(id, { status: "CANCELLED" })) ?? record;
}

/**
 * Creates the client's workspace from a sent questionnaire, exactly as
 * `npm run tenant:provision` would from the same definition, and assigns the
 * operator who pressed the button. Refuses if a workspace was already made
 * from it or the address is taken.
 */
export async function provisionFromOnboarding(id: string, opts: { operatorUserId: string; slug?: string; now?: Date }): Promise<{ tenant: TenantSummary; log: string[]; review: string[] }> {
  const record = await mustFind(id);
  if (record.status !== "SUBMITTED") throw new Error(record.status === "PROVISIONED" ? "A workspace was already created from this questionnaire." : "The client hasn't sent this questionnaire yet.");
  const draft = draftFromOnboarding(record, { slug: opts.slug });
  if (draft.blockers.length) throw new Error(`Fix these first: ${draft.blockers.join("; ")}.`);
  const { tenant, log } = await applyDefinition(draft.definition as TenantDefinition, { refresh: false });
  await repository.assignOperator(tenant.id, opts.operatorUserId);
  await repository.updateOnboarding(id, { status: "PROVISIONED", tenantId: tenant.id, provisionedAt: opts.now ?? new Date() });
  return { tenant, log, review: draft.review };
}
