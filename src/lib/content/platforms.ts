import type { ContentAssetKind, SocialPlatform } from "@/lib/types";

/**
 * What each channel wants from the engine. Limits are the platforms' hard
 * caps minus room for the compliance footer; the kind decides how the draft
 * is shaped (a caption, a short-form script, YouTube title + description).
 */
export interface PlatformSpec {
  platform: SocialPlatform;
  label: string;
  kind: ContentAssetKind;
  /** Character cap for the body the engine produces (footer included). */
  maxChars: number;
  maxHashtags: number;
  /** One line the generator follows for this channel. */
  guidance: string;
  /** Whether the channel needs an image or video to publish at all. */
  mediaRequired: "none" | "image" | "video";
}

export const PLATFORM_SPECS: Record<SocialPlatform, PlatformSpec> = {
  FACEBOOK: { platform: "FACEBOOK", label: "Facebook", kind: "POST_COPY", maxChars: 1200, maxHashtags: 3, guidance: "Conversational, 2–4 short paragraphs, speak to one local reader, end with a plain next step (message us, call, link).", mediaRequired: "none" },
  INSTAGRAM: { platform: "INSTAGRAM", label: "Instagram", kind: "POST_COPY", maxChars: 1800, maxHashtags: 8, guidance: "A strong first line (it is all people see before 'more'), short lines, hashtags at the end, no links in the body.", mediaRequired: "image" },
  TIKTOK: { platform: "TIKTOK", label: "TikTok", kind: "SHORT_FORM_SCRIPT", maxChars: 1500, maxHashtags: 5, guidance: "A 20–40 second spoken script with timestamps (0–3s hook, 3–20s substance, close), plus a one-line caption. Plain speech, no reading from a brochure.", mediaRequired: "video" },
  YOUTUBE: { platform: "YOUTUBE", label: "YouTube", kind: "YOUTUBE_META", maxChars: 2500, maxHashtags: 5, guidance: "First line is the video title (under 70 characters, no clickbait). Then a two-paragraph description in plain words, then tags.", mediaRequired: "video" },
  LINKEDIN: { platform: "LINKEDIN", label: "LinkedIn", kind: "POST_COPY", maxChars: 2000, maxHashtags: 3, guidance: "Professional but human. One insight, one short example, one takeaway. No emojis stacked, no engagement bait.", mediaRequired: "none" },
  GOOGLE_BUSINESS: { platform: "GOOGLE_BUSINESS", label: "Google Business", kind: "POST_COPY", maxChars: 1400, maxHashtags: 0, guidance: "Local and factual: what, where, when, how to get in touch. No hashtags. Reads like a notice on the door.", mediaRequired: "none" },
};

export function specFor(platform: SocialPlatform): PlatformSpec {
  return PLATFORM_SPECS[platform];
}
