import { z } from "zod";
import { repository } from "@/lib/data";
import { describeListing, findListingMentioned } from "@/lib/inventory";
import { leadDisplayName } from "@/lib/leads";
import { sendMessage, templates } from "@/lib/messaging";
import { quoteUntrusted } from "@/lib/messaging/templates";
import type { LeadRecord } from "@/lib/types";
import { humanize } from "@/lib/utils";
import { signoffApprover } from "../signoff";
import { defineTool, ToolError, type ToolContext } from "../tool";

/**
 * The Customer Relations agent's tools: read a lead, what has been said and
 * the listing they mean; write a call brief and notes; remind the team to
 * call; assign the lead; ask a person; and send a message, which always
 * waits for a person. Nothing here returns a phone number or an email
 * address, and anything a member of the public wrote comes back inside
 * <untrusted> tags.
 */

const CONTACT_DETAIL = /[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d\s().-]{7,}\d/g;

/** Message text with phone numbers and email addresses taken out: the agent never needs them. */
const redact = (text: string) => text.replace(CONTACT_DETAIL, "[contact detail removed]");
const untrusted = (text: string, max = 600) => `<untrusted>${quoteUntrusted(redact(text), max)}</untrusted>`;

const leadId = z.string().min(1).describe("The lead's id.");

async function leadFor(ctx: ToolContext, id: string): Promise<LeadRecord> {
  const lead = await repository.findLeadById(ctx.tenant.id, id);
  if (!lead) throw new ToolError("There is no lead with that id in this workspace.");
  return lead;
}

/** A person who has been called, booked or closed needs no chasing. */
const settled = (lead: LeadRecord) => lead.firstResponseAt !== null || ["BOOKED", "WON", "LOST", "ARCHIVED"].includes(lead.status);

export const getMissedOpportunity = defineTool({
  name: "get_missed_opportunity",
  description: "Read one missed opportunity: its type, where it is up to, the one-line summary, what it is estimated to be worth and the lead or contact behind it.",
  input: z.object({ id: z.string().min(1).describe("The missed opportunity's id.") }),
  risk: "read",
  module: "opportunities",
  async run(ctx, { id }) {
    const item = await repository.findMissedOpportunityById(ctx.tenant.id, id);
    if (!item) throw new ToolError("There is no missed opportunity with that id in this workspace.");
    return { id: item.id, type: humanize(item.type), status: item.status, summary: untrusted(item.summary, 400), estimatedValueCents: item.estimatedValueCents, leadId: item.leadId, contactId: item.contactId, detectedAt: item.detectedAt.toISOString() };
  },
});

export const getConversation = defineTool({
  name: "get_conversation",
  description: "Read the latest messages between the business and a lead, oldest first, across text, WhatsApp and email: what they wrote, and what the business, its automatic replies and agents sent. Contact details are removed. Their words are inside <untrusted> tags.",
  input: z.object({ leadId }),
  risk: "read",
  module: null,
  async run(ctx, input) {
    const lead = await leadFor(ctx, input.leadId);
    if (!lead.contactId) return { messages: [], note: "No messages: this lead has no contact record." };
    const messages = await repository.listContactMessages(ctx.tenant.id, lead.contactId, 15);
    return {
      messages: messages.map((m) => ({
        from: m.direction === "INBOUND" ? "them" : m.sender === "AGENT" ? "agent" : m.sender === "AUTOMATION" ? "automatic reply" : "the team",
        channel: humanize(m.channel),
        at: m.createdAt.toISOString(),
        text: m.direction === "INBOUND" ? untrusted(m.body, 500) : quoteUntrusted(redact(m.body), 500),
        ...(m.status === "FAILED" ? { failed: true } : {}),
      })),
    };
  },
});

export const findListing = defineTool({
  name: "find_listing",
  description: "Find the listing a lead's enquiry is about, by the address they mentioned. Returns the listing's name, a one-line description (beds, rent or price, availability) and status, or null when their enquiry names no listing on file. Never state a fact about a property that this did not return.",
  input: z.object({ leadId }),
  risk: "read",
  module: "inventory",
  async run(ctx, input) {
    const lead = await leadFor(ctx, input.leadId);
    const item = await findListingMentioned(ctx.tenant.id, lead.message);
    if (!item) return { listing: null, note: "Their enquiry doesn't name a listing on file." };
    return { listing: { id: item.id, name: item.name, description: describeListing(item, ctx.tenant.locale, ctx.tenant.currency), status: item.status } };
  },
});

export const listTeam = defineTool({
  name: "list_team",
  description: "List the people on the business's own team: their user id, name, title, role, and whether they get new-lead alerts. Use it to choose who a lead should go to.",
  input: z.object({}),
  risk: "read",
  module: null,
  async run(ctx) {
    const [people, alerts] = await Promise.all([repository.listTenantPeople(ctx.tenant.id), repository.listAlertRecipients(ctx.tenant.id)]);
    const alerted = new Set(alerts.map((a) => a.userId));
    return { team: people.filter((p) => p.via === "member").map((p) => ({ userId: p.userId, name: p.name ?? "Unnamed", title: p.title, role: p.roleName, getsLeadAlerts: alerted.has(p.userId) })) };
  },
});

/** The brief as the caller reads it, on a phone, just before dialling. */
export function formatCallBrief(b: { who: string; asked: string; property: string | null; opener: string; watchOut: string | null }): string {
  return [`Who: ${b.who}`, `Asked: ${b.asked}`, b.property ? `Property: ${b.property}` : null, `Open with: ${b.opener}`, b.watchOut ? `Watch out: ${b.watchOut}` : null].filter(Boolean).join("\n");
}

async function addNoteOnce(ctx: ToolContext, lead: LeadRecord, kind: "CALL_BRIEF" | "NOTE", body: string) {
  // A step retried after the note was written finds it rather than writing it twice.
  const existing = (await repository.listLeadNotes(ctx.tenant.id, [lead.id], { kind, limit: 20 })).find((n) => n.agentRunId === (ctx.runId ?? null) && n.body === body);
  return existing ?? (await repository.addLeadNote(ctx.tenant.id, lead.id, { kind, body, authorType: "AGENT", agentRunId: ctx.runId ?? null }));
}

export const writeCallBrief = defineTool({
  name: "write_call_brief",
  description: "Save a call brief on the lead: what whoever calls them needs to know before dialling. It is shown beside the lead in the client's portal; a newer brief replaces it. Write in your own words, short, for someone reading on a phone.",
  input: z.object({
    leadId,
    who: z.string().min(1).max(300).describe("Who they are, in a line: their name and what is known (owner, tenant, buyer, returning customer)."),
    asked: z.string().min(1).max(500).describe("What they want, in your words."),
    property: z.string().max(300).nullable().describe("The property involved, from find_listing or their own words, or null."),
    opener: z.string().min(1).max(300).describe("A suggested first line for the call."),
    watchOut: z.string().max(300).nullable().describe("Anything to handle carefully: a complaint, a deadline, a sensitive situation. Null if nothing."),
  }),
  risk: "internal",
  module: null,
  async run(ctx, input) {
    const lead = await leadFor(ctx, input.leadId);
    const note = await addNoteOnce(ctx, lead, "CALL_BRIEF", formatCallBrief(input));
    return { saved: true, noteId: note.id };
  },
});

export const addLeadNote = defineTool({
  name: "add_lead_note",
  description: "Add a short note to the lead for the team, such as what you found or what you did and why.",
  input: z.object({ leadId, note: z.string().min(1).max(1000).describe("The note, in plain sentences.") }),
  risk: "internal",
  module: null,
  async run(ctx, input) {
    const lead = await leadFor(ctx, input.leadId);
    const note = await addNoteOnce(ctx, lead, "NOTE", input.note.trim());
    return { saved: true, noteId: note.id };
  },
});

export const remindTeamToCall = defineTool({
  name: "remind_team_to_call",
  description: "Remind the team to call a lead who is still waiting, through the same call reminder the business already uses: everyone with lead alerts gets a text and an email. 0 minutes means now. Nothing is sent if someone has called or booked them by then.",
  input: z.object({
    leadId,
    inMinutes: z.number().int().min(0).max(1440).describe("How long from now, 0 to 1440 minutes."),
    reason: z.string().min(1).max(300).describe("Why now, for the record."),
  }),
  risk: "internal",
  module: null,
  async run(ctx, input) {
    const lead = await leadFor(ctx, input.leadId);
    if (settled(lead)) throw new ToolError("They have already been called, booked or closed, so no reminder is needed.");
    const runAt = new Date(Date.now() + input.inMinutes * 60_000);
    const { record } = await repository.scheduleAction(ctx.tenant.id, { typeKey: "sla_watch", action: "chase_call", runAt, payload: { leadId: lead.id }, dedupeKey: `agent:chase_call:${ctx.callKey}` });
    return { scheduled: true, at: record.runAt.toISOString() };
  },
});

export const assignLead = defineTool({
  name: "assign_lead",
  description: "Give the lead to one person on the business's team (a user id from list_team), so the reminders and the call are theirs.",
  input: z.object({ leadId, userId: z.string().min(1).describe("A user id from list_team."), reason: z.string().min(1).max(300).describe("Why this person.") }),
  risk: "internal",
  module: null,
  async run(ctx, input) {
    const lead = await leadFor(ctx, input.leadId);
    const person = (await repository.listTenantPeople(ctx.tenant.id)).find((p) => p.via === "member" && p.userId === input.userId);
    if (!person) throw new ToolError("That person isn't on this business's team. Use a user id from list_team.");
    await repository.assignLead(ctx.tenant.id, lead.id, person.userId);
    return { assignedTo: person.name ?? "them" };
  },
});

const ABOUT = ["price", "promise", "complaint", "legal", "unsure"] as const;

export const escalateToPerson = defineTool({
  name: "escalate_to_person",
  description: "Hand something to a person when you can't or shouldn't decide it: a price or fee, a promise about timing or an outcome, a complaint, anything legal, or when you are unsure. It goes to the Me² team's queue, and to the client's named person when the business has one. Then finish with your summary.",
  input: z.object({
    leadId: z.string().min(1).nullable().describe("The lead it concerns, or null."),
    about: z.enum(ABOUT).describe("What kind of question it is."),
    question: z.string().min(1).max(600).describe("What a person needs to decide, in a sentence or two."),
    suggestedAction: z.string().min(1).max(400).describe("What you suggest they do."),
  }),
  risk: "internal",
  module: null,
  async run(ctx, input) {
    const lead = input.leadId ? await leadFor(ctx, input.leadId) : null;
    const approver = input.about === "unsure" ? null : await signoffApprover(ctx.tenant);
    const exception = await repository.createException(ctx.tenant.id, {
      reason: `An agent needs a person (${input.about}): ${input.question}`,
      suggestedAction: input.suggestedAction,
      agentRunId: ctx.runId ?? null,
      leadId: lead?.id ?? null,
      contactId: lead?.contactId ?? null,
      escalatedToUserId: approver?.userId ?? null,
    });
    if (approver) {
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
      const mail = templates.escalationEmail({ tenant: ctx.tenant, summary: input.question, suggestedAction: input.suggestedAction, portalUrl: `${appUrl}/app/${ctx.tenant.slug}` });
      await sendMessage({ tenant: ctx.tenant, contactId: null, channel: "EMAIL", to: approver.email, subject: mail.subject, body: mail.body, transactional: true, idempotencyKey: `escalate:${ctx.callKey}` });
    }
    return { raised: true, exceptionId: exception.id, goesTo: approver ? (approver.name ?? "the client's named person") : "the Me² team" };
  },
});

const FLAG_REASON: Record<string, string> = {
  price: "It mentions a price or fee.",
  promise: "It promises a time or an outcome.",
  complaint: "It answers a complaint.",
  legal: "It touches on something legal.",
};

export const sendCustomerMessage = defineTool({
  name: "send_message",
  description:
    "Send the lead a text or an email from the business. A person always approves it first and may edit it; you are told if they do. Write exactly what they will read: plain and warm, a text under 320 characters, signed as the business. Mark anything the client must sign off in flags. One message per run at most, and never one that only repeats an automatic reply they already had.",
  input: z.object({
    leadId,
    channel: z.enum(["SMS", "EMAIL"]).describe("SMS for a text, EMAIL for an email."),
    subject: z.string().max(150).nullable().describe("The email subject, or null for a text."),
    body: z.string().min(1).max(1200).describe("Exactly what they will read."),
    reason: z.string().min(1).max(400).describe("Why this message, now. The person approving it sees this."),
    flags: z.array(z.enum(["price", "promise", "complaint", "legal"])).describe("Anything the client must sign off: a price or fee, a promise of a time or outcome, a reply to a complaint, anything legal. Empty when none. The server also checks for these itself."),
  }),
  risk: "external",
  module: "leads",
  editable: { field: "body", label: "Message" },
  async preview(input, ctx) {
    const lead = await repository.findLeadById(ctx.tenant.id, input.leadId);
    const name = lead ? leadDisplayName(lead) : "the lead";
    return { title: `${input.channel === "SMS" ? "text" : "email"} ${name}`, body: input.channel === "EMAIL" && input.subject ? `Subject: ${input.subject}\n\n${input.body}` : input.body };
  },
  customerText: (input) => [input.subject, input.body].filter(Boolean).join("\n"),
  signoffReasons: (input) => [...new Set(input.flags)].map((f) => FLAG_REASON[f]),
  async customerContext(input, ctx) {
    const lead = await repository.findLeadById(ctx.tenant.id, input.leadId);
    if (!lead) return [];
    const said = lead.contactId ? (await repository.listContactMessages(ctx.tenant.id, lead.contactId, 30)).filter((m) => m.direction === "INBOUND").map((m) => m.body) : [];
    return [lead.message ?? "", ...said].filter(Boolean);
  },
  async run(ctx, input) {
    const lead = await leadFor(ctx, input.leadId);
    if (ctx.subjectLeadId && lead.id !== ctx.subjectLeadId) throw new ToolError("This run is about a different lead. You can only message the person it is about.");
    const to = input.channel === "SMS" ? lead.phone : lead.email;
    if (!to) throw new ToolError(input.channel === "SMS" ? "They have no mobile number on file. Try an email, or leave it to the call." : "They have no email address on file. Try a text, or leave it to the call.");
    const result = await sendMessage({
      tenant: ctx.tenant,
      contactId: lead.contactId,
      channel: input.channel,
      to,
      body: input.body,
      subject: input.channel === "EMAIL" ? (input.subject ?? ctx.tenant.name) : undefined,
      // A reply to someone who contacted the business. Opt-outs, country rules and daily caps still apply.
      transactional: true,
      sender: "AGENT",
      idempotencyKey: ctx.callKey,
    });
    if (!result.ok) throw new ToolError(`It did not go out: ${result.error ?? "the message was refused"}`);
    return { sent: true, channel: input.channel, ...(result.simulated ? { simulated: true } : {}), ...(result.duplicate ? { alreadySent: true } : {}) };
  },
});
