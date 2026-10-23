import { z } from "zod";

const LEAD_SOURCES = [
  "WEB_FORM",
  "LANDING_PAGE",
  "META_LEAD_FORM",
  "TIKTOK_LEAD_FORM",
  "LINKEDIN_LEAD_FORM",
  "YOUTUBE",
  "REFERRAL",
  "PHONE",
  "EMAIL",
  "MANUAL",
  "OTHER",
] as const;

/** Maximum accepted request body for intake, in bytes. */
export const INTAKE_MAX_BODY_BYTES = 64 * 1024;
/** Limits on the free-form `fields` object so it can't be used to stuff the classifier or the database. */
export const FIELDS_MAX_KEYS = 30;
export const FIELDS_MAX_VALUE_CHARS = 500;

const optionalTrimmed = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/**
 * Normalises a phone number for storage and dedupe: drops a "(0)" trunk
 * marker, keeps a leading "+", strips everything that isn't a digit. Returns
 * null when fewer than 6 or more than 15 digits remain, which rules out
 * placeholders like "n/a" or "0".
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\(\s*0\s*\)/g, "");
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return null;
  return `${plus}${digits}`;
}

/** Scalars only, bounded count and length; anything else is dropped rather than rejected. */
const fieldsSchema = z
  .record(z.string().max(64), z.unknown())
  .default({})
  .transform((input) => {
    const out: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(input)) {
      if (Object.keys(out).length >= FIELDS_MAX_KEYS) break;
      if (typeof value === "string") out[key] = value.trim().slice(0, FIELDS_MAX_VALUE_CHARS);
      else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
      else if (typeof value === "boolean") out[key] = value;
    }
    return out;
  });

/**
 * Body accepted by POST /api/v1/intake.
 *
 * `fields` carries any extra form answers (budget, timeline, service…). The
 * classifier reads from it, and the redacted raw body is stored for audit.
 */
export const intakeSchema = z
  .object({
    source: z.enum(LEAD_SOURCES).default("WEB_FORM"),
    externalId: optionalTrimmed,
    firstName: optionalTrimmed,
    lastName: optionalTrimmed,
    name: optionalTrimmed,
    email: z
      .string()
      .trim()
      .max(320)
      .optional()
      .nullable()
      .transform((v, ctx) => {
        if (!v) return null;
        const r = z.email().safeParse(v);
        if (!r.success) {
          ctx.addIssue({ code: "custom", message: "Email address looks invalid." });
          return z.NEVER;
        }
        return r.data.toLowerCase();
      }),
    phone: z
      .string()
      .trim()
      .max(40)
      .optional()
      .nullable()
      .transform((v, ctx) => {
        if (!v) return null;
        const n = normalizePhone(v);
        if (!n) {
          ctx.addIssue({ code: "custom", message: "Phone number looks invalid (6–15 digits expected)." });
          return z.NEVER;
        }
        return n;
      }),
    company: optionalTrimmed,
    message: z
      .string()
      .trim()
      .max(5000)
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
    fields: fieldsSchema,
    /** Set true to classify without persisting (for form integration testing). */
    dryRun: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (!v.email && !v.phone) {
      ctx.addIssue({ code: "custom", message: "Provide at least one of email or phone.", path: ["email"] });
    }
  });

export type IntakeBody = z.infer<typeof intakeSchema>;

/** Splits a single "name" field when first/last were not sent separately. */
export function splitName(body: IntakeBody): { firstName: string | null; lastName: string | null } {
  if (body.firstName || body.lastName) return { firstName: body.firstName, lastName: body.lastName };
  if (!body.name) return { firstName: null, lastName: null };
  const [first, ...rest] = body.name.split(/\s+/);
  return { firstName: first || null, lastName: rest.join(" ") || null };
}

const SENSITIVE_KEY = /(pass(word)?|secret|token|card|cvv|cvc|ssn|tax.?file|tfn|licen[cs]e|passport|iban|account.?number|routing)/i;

/** Removes values under keys that look like credentials or financial identifiers before a payload is stored or logged. */
export function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactPayload(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redactPayload(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}
