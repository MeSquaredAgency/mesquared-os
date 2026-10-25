import type { TenantSummary } from "@/lib/types";
import { readableTextOn } from "@/lib/utils";

/**
 * Turns the plain-text body every template produces into a branded HTML
 * email: a banner in the workspace's colour carrying its logo or name, the
 * paragraphs in a white card, the signature, and the licence line plus the
 * "automated message" note in a muted footer. The text version is still sent
 * alongside, so nothing depends on HTML rendering.
 */
export function renderEmailHtml(tenant: TenantSummary, text: string): string {
  const brand = tenant.branding;
  const name = brand.fromName ?? tenant.name;
  const colour = /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor ?? "") ? brand.primaryColor! : "#0f4c81";
  const onColour = readableTextOn(colour) === "#000000" ? "#111827" : "#ffffff";
  const footerLine = brand.footer?.trim();

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.split("\n").filter((l) => l !== footerLine))
    .filter((lines) => lines.length);
  const note = paragraphs.length && paragraphs[paragraphs.length - 1][0]?.startsWith("This is an automated message") ? paragraphs.pop()!.join(" ") : null;

  const bodyHtml = paragraphs
    .map((lines, i) => {
      const signature = lines[0] === "Kind regards,";
      const style = signature ? "margin:24px 0 0;line-height:1.5" : `margin:${i === 0 ? 0 : 14}px 0 0;line-height:1.55`;
      return `<p style="${style}">${lines.map((l) => linkify(escapeHtml(l))).join("<br>")}</p>`;
    })
    .join("");

  const banner = brand.logoUrl
    ? `<img src="${escapeAttr(brand.logoUrl)}" alt="${escapeAttr(name)}" height="40" style="display:block;max-height:40px;height:40px;width:auto;border:0">`
    : `<span style="font-size:18px;font-weight:600;letter-spacing:0.2px;color:${onColour}">${escapeHtml(name)}</span>`;

  const footerParts = [footerLine ? escapeHtml(footerLine) : null, note ? escapeHtml(note) : null].filter(Boolean);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(name)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%">
<tr><td style="background:${colour};border-radius:12px 12px 0 0;padding:22px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">${banner}</td></tr>
<tr><td style="background:#ffffff;padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:#1f2937">${bodyHtml}</td></tr>
<tr><td style="background:#ffffff;border-top:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:16px 28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b7280">${footerParts.join("<br>")}</td></tr>
</table></td></tr></table></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const escapeAttr = escapeHtml;

/** Bare http(s) URLs become links; the text is already escaped. */
function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" style="color:#0f4c81">${url}</a>`);
}
