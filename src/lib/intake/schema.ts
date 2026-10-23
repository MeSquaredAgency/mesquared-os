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

const optionalTrimmed = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/**
 * Body accepted by POST /api/v1/intake.
 *
 * `fields` carries any extra form answers (budget, timeline, service…). The
 * classifier reads from it, and the raw body is always stored for audit.
 */
export const intakeSchema = z
  .object({
    source: z.enum(LEAD_SOURCES).default("WEB_FORM"),
    externalId: optionalTrimmed,
    firstName: optionalTrimmed,
    lastName: optionalTrimmed,
    name: optionalTrimmed,
    email: z.string().trim().email().max(320).optional().nullable().transform((v) => (v ? v.toLowerCase() : null)),
    phone: optionalTrimmed,
    company: optionalTrimmed,
    message: z.string().trim().max(5000).optional().nullable().transform((v) => (v ? v : null)),
    fields: z.record(z.string(), z.unknown()).default({}),
    /** Set true to classify without persisting (for form integration testing). */
    dryRun: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (!v.email && !v.phone) {
      ctx.addIssue({
        code: "custom",
        message: "Provide at least one of email or phone.",
        path: ["email"],
      });
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
