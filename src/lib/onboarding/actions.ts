"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getConsoleContext } from "@/lib/auth/access";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { hashApiKey } from "@/lib/crypto";
import { takeIntakeTokens } from "@/lib/intake/rate-limit";
import { createOnboardingLink, onboardingUrl, provisionFromOnboarding, renewOnboardingLink, reopenOnboarding, saveCallSheet, saveOnboardingAnswers, submitOnboarding, withdrawOnboarding } from "./service";

/**
 * Server actions for the onboarding form. The client-facing two are public
 * endpoints: the link's token is the only credential, every call is rate
 * limited per link and per IP, and answers are never logged. The console ones
 * are for platform admins, who are the only people who create workspaces.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
}

const CLIENT_MESSAGES: Record<string, string> = {
  not_found: "This link isn't valid any more. Ask your Me² onboarding lead for a new one.",
  expired: "This link has expired. Ask your Me² onboarding lead for a new one.",
  withdrawn: "This questionnaire has been withdrawn. Ask your Me² onboarding lead if that's a surprise.",
  locked: "This questionnaire has already been sent. Ask your Me² onboarding lead if you need to change something.",
  too_large: "That's more than the form can hold. Shorten your longest answers and try again.",
  incomplete: "A few answers are still needed before you can send it.",
  busy: "Too many saves at once. Wait a moment and try again.",
};

async function allowed(token: string): Promise<boolean> {
  const h = await headers();
  const ip = clientIpFromHeaders((n) => h.get(n));
  const limit = await takeIntakeTokens([`onboarding:${hashApiKey(token).slice(0, 24)}`, `onboarding:ip:${ip}`]);
  return limit.allowed;
}

export async function saveOnboardingAction(token: string, answers: unknown): Promise<{ ok: boolean; message: string; savedAt?: string }> {
  try {
    if (!(await allowed(token))) return { ok: false, message: CLIENT_MESSAGES.busy };
    const result = await saveOnboardingAnswers(token, answers);
    return result.ok ? { ok: true, message: "Saved", savedAt: result.savedAt.toISOString() } : { ok: false, message: CLIENT_MESSAGES[result.reason] };
  } catch (error) {
    console.error("[onboarding] save failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, message: "We couldn't save just now. Your answers are still on this page; we'll try again." };
  }
}

export async function submitOnboardingAction(token: string, answers: unknown): Promise<{ ok: boolean; message: string; missing?: { stepId: string; stepTitle: string; label: string; short: string }[] }> {
  try {
    if (!(await allowed(token))) return { ok: false, message: CLIENT_MESSAGES.busy };
    const result = await submitOnboarding(token, answers);
    if (result.ok) {
      revalidatePath("/console/onboarding");
      return { ok: true, message: "Sent" };
    }
    return { ok: false, message: CLIENT_MESSAGES[result.reason], missing: result.missing };
  } catch (error) {
    console.error("[onboarding] submit failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, message: "We couldn't send it just now. Your answers are saved; please try again in a minute." };
  }
}

// ---------------------------------------------------------------------------
// Console (platform admins)
// ---------------------------------------------------------------------------

async function adminId(): Promise<string> {
  const { user } = await getConsoleContext();
  if (!user.isPlatformAdmin) throw new Error("Only a platform admin can manage onboarding questionnaires.");
  return user.id;
}

const refresh = (id?: string) => {
  revalidatePath("/console/onboarding");
  if (id) revalidatePath(`/console/onboarding/${id}`);
};

const failure = (error: unknown): ActionResult => ({ ok: false, message: error instanceof Error ? error.message : "Something went wrong. Please try again." });

export async function createOnboardingLinkAction(input: { label: string; contactEmail?: string }): Promise<ActionResult & { url?: string; id?: string }> {
  try {
    const userId = await adminId();
    const { record, token } = await createOnboardingLink({ label: input.label, contactEmail: input.contactEmail, createdById: userId });
    refresh();
    return { ok: true, message: `Link created for ${record.label}. Copy it now: it is shown once.`, url: onboardingUrl(token), id: record.id };
  } catch (error) {
    return failure(error);
  }
}

export async function saveCallSheetAction(id: string, changed: unknown): Promise<ActionResult & { savedAt?: string }> {
  try {
    await adminId();
    await saveCallSheet(id, changed);
    revalidatePath(`/console/onboarding/${id}`);
    return { ok: true, message: "Saved", savedAt: new Date().toISOString() };
  } catch (error) {
    return failure(error);
  }
}

export async function renewOnboardingLinkAction(id: string): Promise<ActionResult & { url?: string }> {
  try {
    await adminId();
    const { token } = await renewOnboardingLink(id);
    refresh(id);
    return { ok: true, message: "New link created; the old one no longer works. Copy it now: it is shown once.", url: onboardingUrl(token) };
  } catch (error) {
    return failure(error);
  }
}

export async function reopenOnboardingAction(id: string): Promise<ActionResult> {
  try {
    await adminId();
    await reopenOnboarding(id);
    refresh(id);
    return { ok: true, message: "Reopened. The client can change their answers with the same link and send it again." };
  } catch (error) {
    return failure(error);
  }
}

export async function withdrawOnboardingAction(id: string): Promise<ActionResult> {
  try {
    await adminId();
    await withdrawOnboarding(id);
    refresh(id);
    return { ok: true, message: "Withdrawn. The link no longer opens." };
  } catch (error) {
    return failure(error);
  }
}

export async function provisionFromOnboardingAction(id: string, input: { slug?: string }): Promise<ActionResult & { slug?: string }> {
  try {
    const userId = await adminId();
    const { tenant } = await provisionFromOnboarding(id, { operatorUserId: userId, slug: input.slug });
    refresh(id);
    revalidatePath("/console");
    return { ok: true, message: `${tenant.name} is set up.`, slug: tenant.slug };
  } catch (error) {
    return failure(error);
  }
}
