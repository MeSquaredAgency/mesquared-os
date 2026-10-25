import type { TenantSummary } from "@/lib/types";
import { readableTextOn } from "@/lib/utils";
import type { MessageCta, MessageSignature } from "./types";

/**
 * Turns the plain-text body every template produces into the workspace's
 * branded HTML email, modelled on a real estate office's own email
 * signature: the logo on white over a bar in the brand colour, the message,
 * one button for the thing we want the reader to do, and a signature block
 * for the person who signed it (photo, name, title, mobile, email) or the
 * business (logo, phone, website), with the offices and the licence line
 * underneath. The text version is still sent alongside, so nothing depends
 * on HTML rendering.
 */
export function renderEmailHtml(tenant: TenantSummary, text: string, opts: { cta?: MessageCta | null; signature?: MessageSignature | null } = {}): string {
  const brand = tenant.branding;
  const name = brand.fromName ?? tenant.name;
  const colour = /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor ?? "") ? brand.primaryColor! : "#0f4c81";
  const onColour = readableTextOn(colour) === "#000000" ? INK : "#ffffff";
  const footerLine = brand.footer?.trim() || null;
  const cta = opts.cta && /^https?:\/\//i.test(opts.cta.url) ? opts.cta : null;

  // The text body is paragraphs separated by blank lines: greeting, message,
  // "Kind regards," + signoff (+ footer line), then the automated note.
  const paragraphs = text.split(/\n{2,}/).map((p) => p.split("\n").filter((l) => l !== footerLine)).filter((p) => p.length);
  const note = paragraphs.length && paragraphs[paragraphs.length - 1][0]?.startsWith("This is an automated") ? paragraphs.pop()!.join(" ") : null;
  const signoffAt = paragraphs.findIndex((p) => p[0] === "Kind regards,");
  const body = signoffAt >= 0 ? paragraphs.slice(0, signoffAt) : paragraphs;

  const bodyHtml = body
    .map((lines, i) => {
      const margin = i === 0 ? 0 : 14;
      if (cta && lines.some((l) => l.includes(cta.url))) {
        // The sentence that carried the link becomes the button; keep any words before the link as a lead-in.
        const lead = lines.map((l) => l.replace(cta.url, "").replace(/[:\s]+$/, "")).filter(Boolean).join(" ").trim();
        return `${lead ? `<p style="margin:${margin}px 0 0;line-height:1.6">${escapeHtml(lead)}.</p>` : ""}${button(cta, colour, onColour)}`;
      }
      const bullets = lines.every((l) => l.startsWith("• "));
      if (bullets) return `<ul style="margin:${margin}px 0 0;padding-left:20px;line-height:1.6">${lines.map((l) => `<li style="margin:4px 0">${linkify(escapeHtml(l.slice(2)))}</li>`).join("")}</ul>`;
      return `<p style="margin:${margin}px 0 0;line-height:1.6">${lines.map((l) => linkify(escapeHtml(l))).join("<br>")}</p>`;
    })
    .join("");

  const logo = brand.logoUrl && /^https:\/\//i.test(brand.logoUrl) ? brand.logoUrl : null;
  const header = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}" height="44" style="display:block;height:44px;width:auto;border:0">`
    : `<span style="font-size:20px;font-weight:bold;color:${INK}">${escapeHtml(name)}</span>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>${escapeHtml(name)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${CREAM}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;${FONT}">
<tr><td style="padding:24px 32px 20px">${header}</td></tr>
<tr><td style="height:4px;background:${colour};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px;font-size:16px;color:${INK}">${bodyHtml}</td></tr>
<tr><td style="padding:20px 32px 28px;font-size:16px;color:${INK}"><p style="margin:0 0 14px;line-height:1.6">Kind regards,</p>${signatureBlock(tenant, name, logo, colour, opts.signature ?? null, footerLine)}</td></tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;${FONT}"><tr><td style="padding:16px 8px 0;font-size:12px;line-height:1.5;color:${MUTED}">${note ? escapeHtml(note) : ""}${note ? " " : ""}Reply to this email to reach a person.</td></tr></table>
</td></tr></table></body></html>`;
}

const INK = "#17171A";
const MUTED = "#6D6E71";
const CREAM = "#F6F4EE";
const FONT = "font-family:Arial,Helvetica,sans-serif";

function button(cta: MessageCta, colour: string, onColour: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0 4px"><tr><td style="background:${colour};border-radius:2px"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:bold;color:${onColour};text-decoration:none">${escapeHtml(cta.label)}</a></td></tr></table>`;
}

/** The signature: the person who signed (photo, name, title, mobile, email) or the business (logo), then phone, website, social, offices, licence line. */
function signatureBlock(tenant: TenantSummary, name: string, logo: string | null, colour: string, person: MessageSignature | null, footerLine: string | null): string {
  const brand = tenant.branding;
  const rows: string[] = [];
  const line = (label: string, html: string) => `<span style="font-weight:bold;color:${INK}">${label}</span>&nbsp;${html}`;
  const link = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="color:${INK};text-decoration:none">${escapeHtml(label)}</a>`;

  if (person) {
    rows.push(`<div style="font-size:16px;line-height:20px;font-weight:bold;color:${INK}">${escapeHtml(person.name)}</div>`);
    if (person.title) rows.push(`<div style="font-size:13px;line-height:18px;color:${MUTED}">${escapeHtml(person.title)}</div>`);
  } else rows.push(`<div style="font-size:16px;line-height:20px;font-weight:bold;color:${INK}">${escapeHtml(name)}</div>`);
  rows.push(`<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0"><tr><td style="width:36px;height:3px;background:${colour};font-size:0;line-height:0">&nbsp;</td></tr></table>`);

  const personal: string[] = [];
  if (person?.phone) personal.push(line("M", link(telHref(person.phone), person.phone)));
  if (person?.email) personal.push(line("E", link(`mailto:${person.email}`, person.email)));
  if (personal.length) rows.push(`<div style="font-size:13px;line-height:20px;color:${INK}">${personal.join("&nbsp;&nbsp;&nbsp;")}</div>`);
  const office: string[] = [];
  if (brand.phone) office.push(line("P", link(telHref(brand.phone), brand.phone)));
  if (brand.website) office.push(line("W", link(/^https?:\/\//i.test(brand.website) ? brand.website : `https://${brand.website}`, brand.website.replace(/^https?:\/\//i, ""))));
  if (office.length) rows.push(`<div style="font-size:13px;line-height:20px;color:${INK}">${office.join("&nbsp;&nbsp;&nbsp;")}</div>`);

  const social = Object.entries(brand.social ?? {}).filter(([, url]) => typeof url === "string" && /^https:\/\//i.test(url)) as [string, string][];
  if (social.length) rows.push(`<div style="font-size:13px;line-height:20px;margin-top:6px">${social.map(([k, url]) => `<a href="${escapeHtml(url)}" style="color:${INK};text-decoration:underline;margin-right:12px">${SOCIAL_NAMES[k] ?? k}</a>`).join("")}</div>`);
  if (brand.addresses?.length) rows.push(`<div style="font-size:11px;line-height:16px;color:${MUTED};padding-top:6px">${brand.addresses.map((a) => escapeHtml(a)).join("<br>")}</div>`);
  if (footerLine) rows.push(`<div style="font-size:11px;line-height:16px;color:${MUTED};padding-top:4px">${escapeHtml(footerLine)}</div>`);

  const photo = person?.photoUrl && /^https:\/\//i.test(person.photoUrl) ? person.photoUrl : null;
  const left = photo
    ? `<img src="${escapeHtml(photo)}" width="72" height="72" alt="" style="display:block;width:72px;height:72px;border:0;border-radius:50%;object-fit:cover">`
    : logo
      ? `<img src="${escapeHtml(logo)}" width="88" alt="${escapeHtml(name)}" style="display:block;width:88px;height:auto;border:0">`
      : null;
  const leftCell = left ? `<td valign="top" style="vertical-align:top;padding-right:16px;border-right:2px solid ${colour}">${left}</td>` : "";
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="${FONT};color:${INK}"><tr>${leftCell}<td valign="top" style="vertical-align:top;${left ? "padding-left:16px" : ""}">${rows.join("")}</td></tr></table>`;
}

const SOCIAL_NAMES: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", linkedin: "LinkedIn" };

function telHref(num: string): string {
  const d = num.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return `tel:${d}`;
  if (/^0[2-578]\d{8}$/.test(d)) return `tel:+61${d.slice(1)}`;
  return `tel:${d}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Bare http(s) URLs become links; the text is already escaped. */
function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" style="color:${INK}">${url}</a>`);
}
