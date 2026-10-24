import type { SocialProvider } from "./types";

/**
 * Publishes nothing and says so. Used when SOCIAL_MODE=log (tests, demos)
 * and whenever a platform adapter is missing, so the pipeline runs end to
 * end and every run is logged as simulated rather than sent.
 */
export const logSocialProvider: SocialProvider = {
  name: "log",
  platforms: ["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE", "LINKEDIN", "GOOGLE_BUSINESS"],
  async publish(input) {
    const redact = process.env.NODE_ENV === "production";
    console.info(`[social:log] ${input.channel.platform} → ${input.channel.displayName ?? input.channel.externalAccountId}: ${redact ? "[caption redacted]" : input.caption.slice(0, 100)}`);
    return { ok: true, externalPostId: `log_${Date.now()}`, permalink: null, error: null, simulated: true };
  },
  async fetchInbox() {
    return [];
  },
  async reply(_channel, _creds, target, text) {
    console.info(`[social:log] reply to ${target.kind} ${target.externalId}: ${text.slice(0, 80)}`);
    return { ok: true, externalId: `log_reply_${Date.now()}`, error: null, simulated: true };
  },
  async fetchMetrics() {
    return {};
  },
  async fetchReviews() {
    return [];
  },
  async replyToReview(_channel, _creds, reviewExternalId, text) {
    console.info(`[social:log] review reply ${reviewExternalId}: ${text.slice(0, 80)}`);
    return { ok: true, externalId: `log_review_reply_${Date.now()}`, error: null, simulated: true };
  },
};
