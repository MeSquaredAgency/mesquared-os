import type { ChannelRecord } from "@/lib/types";
import { freshGoogleCredentials, refreshGoogleCredentials } from "./google-oauth";
import { asNumber, failureFrom, publishFailure, publishSuccess, replyFailure, replySuccess, requestJson, settingString, toDate, truncate } from "./http";
import type { ChannelCredentials, MetricsSnapshot, ProviderReview, PublishInput, PublishResult, ReplyResult, SocialProvider } from "./types";

/**
 * Google Business Profile.
 *
 * Auth:   `creds.accessToken` is a Google OAuth2 user token (scope
 *         https://www.googleapis.com/auth/business.manage); refreshed with
 *         creds.refreshToken via ./google-oauth when `expiresAt` is past.
 * Ids:    channel.externalAccountId (or settings.locationName) is the location
 *         resource name, e.g. "accounts/123/locations/456".
 *
 * Endpoints:
 *   publish        POST https://mybusiness.googleapis.com/v4/{location}/localPosts
 *   reviews        GET  https://mybusiness.googleapis.com/v4/{location}/reviews?pageSize=50
 *   reply          PUT  https://mybusiness.googleapis.com/v4/{location}/reviews/{reviewId}/reply
 *   metrics        GET  https://businessprofileperformance.googleapis.com/v1/{locations/456}:fetchMultiDailyMetricsTimeSeries
 *
 * No inbox: GBP has no comments or DMs (Q&A is out of scope).
 */

const GBP_V4 = "https://mybusiness.googleapis.com/v4";
const PERFORMANCE_V1 = "https://businessprofileperformance.googleapis.com/v1";
const SUMMARY_MAX = 1500;

const STAR_RATINGS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

function locationName(channel: ChannelRecord): string {
  return (settingString(channel, "locationName") ?? channel.externalAccountId).replace(/^\/+|\/+$/g, "");
}

/** The Performance API addresses locations without the account prefix. */
function performanceLocation(location: string): string {
  const m = location.match(/locations\/[^/]+/);
  return m ? m[0] : location;
}

function bearer(creds: ChannelCredentials): Record<string, string> {
  return { Authorization: `Bearer ${creds.accessToken}` };
}

interface LocalPostResponse {
  name?: string;
  searchUrl?: string;
  state?: string;
}

interface ReviewsResponse {
  reviews?: {
    name?: string;
    reviewId?: string;
    reviewer?: { displayName?: string; profilePhotoUrl?: string };
    starRating?: string;
    comment?: string;
    createTime?: string;
    updateTime?: string;
  }[];
  nextPageToken?: string;
  averageRating?: number;
  totalReviewCount?: number;
}

interface PerformanceResponse {
  multiDailyMetricTimeSeries?: {
    dailyMetricTimeSeries?: {
      dailyMetric?: string;
      timeSeries?: { datedValues?: { date?: { year?: number; month?: number; day?: number }; value?: string | number }[] };
    }[];
  }[];
}

export function createGoogleBusinessProvider(): SocialProvider {
  async function publish(input: PublishInput, given: ChannelCredentials): Promise<PublishResult> {
    const fresh = await freshGoogleCredentials(given);
    if (!fresh.ok) return publishFailure(fresh.error, fresh.retryable);
    const creds = fresh.creds;
    const location = locationName(input.channel);
    const body: Record<string, unknown> = {
      languageCode: "en",
      summary: truncate(input.caption, SUMMARY_MAX),
      topicType: "STANDARD",
    };
    const image = input.mediaUrls.find(Boolean);
    if (image) body.media = [{ mediaFormat: "PHOTO", sourceUrl: image }];
    if (input.link) body.callToAction = { actionType: "LEARN_MORE", url: input.link };
    const r = await requestJson<LocalPostResponse>(`${GBP_V4}/${location}/localPosts`, { method: "POST", headers: bearer(creds), body, fallback: "Google Business Profile post failed" });
    if (!r.ok) return failureFrom(r);
    const name = r.body.name;
    if (!name) return publishFailure("Google Business Profile returned no post name", false);
    return publishSuccess(name, r.body.searchUrl ?? null);
  }

  async function fetchReviews(channel: ChannelRecord, given: ChannelCredentials, since: Date): Promise<ProviderReview[]> {
    const fresh = await freshGoogleCredentials(given);
    if (!fresh.ok) {
      console.warn(`[social:gbp] reviews skipped: ${fresh.error}`);
      return [];
    }
    const location = locationName(channel);
    const url = new URL(`${GBP_V4}/${location}/reviews`);
    url.searchParams.set("pageSize", "50");
    const r = await requestJson<ReviewsResponse>(url, { headers: bearer(fresh.creds), fallback: "Google Business Profile reviews fetch failed" });
    if (!r.ok) {
      console.warn(`[social:gbp] reviews fetch failed: ${r.error}`);
      return [];
    }
    const out: ProviderReview[] = [];
    for (const review of r.body.reviews ?? []) {
      const at = toDate(review.createTime);
      if (!at || at < since) continue;
      const reviewId = review.reviewId ?? review.name?.split("/").pop() ?? null;
      if (!reviewId) continue;
      out.push({
        externalId: reviewId,
        authorName: review.reviewer?.displayName ?? null,
        rating: review.starRating ? STAR_RATINGS[review.starRating] ?? null : null,
        body: review.comment ?? null,
        url: null,
        receivedAt: at,
      });
    }
    return out.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  async function replyToReview(channel: ChannelRecord, given: ChannelCredentials, reviewExternalId: string, text: string): Promise<ReplyResult> {
    const fresh = await freshGoogleCredentials(given);
    if (!fresh.ok) return replyFailure(fresh.error);
    const location = locationName(channel);
    const r = await requestJson<{ comment?: string; updateTime?: string }>(`${GBP_V4}/${location}/reviews/${encodeURIComponent(reviewExternalId)}/reply`, {
      method: "PUT",
      headers: bearer(fresh.creds),
      body: { comment: text },
      fallback: "Google Business Profile review reply failed",
    });
    return r.ok ? replySuccess(reviewExternalId) : replyFailure(r.error);
  }

  async function fetchMetrics(channel: ChannelRecord, given: ChannelCredentials): Promise<MetricsSnapshot> {
    const fresh = await freshGoogleCredentials(given);
    if (!fresh.ok) {
      console.warn(`[social:gbp] metrics skipped: ${fresh.error}`);
      return {};
    }
    const location = performanceLocation(locationName(channel));
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const url = new URL(`${PERFORMANCE_V1}/${location}:fetchMultiDailyMetricsTimeSeries`);
    for (const m of ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "WEBSITE_CLICKS"]) {
      url.searchParams.append("dailyMetrics", m);
    }
    for (const edge of ["startDate", "endDate"]) {
      url.searchParams.set(`dailyRange.${edge}.year`, String(yesterday.getUTCFullYear()));
      url.searchParams.set(`dailyRange.${edge}.month`, String(yesterday.getUTCMonth() + 1));
      url.searchParams.set(`dailyRange.${edge}.day`, String(yesterday.getUTCDate()));
    }
    const r = await requestJson<PerformanceResponse>(url, { headers: bearer(fresh.creds), fallback: "Business Profile Performance fetch failed" });
    if (!r.ok) {
      console.warn(`[social:gbp] performance fetch failed: ${r.error}`);
      return {};
    }
    let impressions = 0;
    let clicks = 0;
    let sawAny = false;
    for (const group of r.body.multiDailyMetricTimeSeries ?? []) {
      for (const series of group.dailyMetricTimeSeries ?? []) {
        const total = (series.timeSeries?.datedValues ?? []).reduce((sum, v) => sum + (asNumber(v.value) ?? 0), 0);
        if (!series.dailyMetric) continue;
        sawAny = true;
        if (series.dailyMetric.startsWith("BUSINESS_IMPRESSIONS_")) impressions += total;
        else if (series.dailyMetric === "WEBSITE_CLICKS") clicks += total;
      }
    }
    if (!sawAny) return {};
    return { impressions, clicks, raw: r.body as unknown as Record<string, unknown> };
  }

  return {
    name: "google-business",
    platforms: ["GOOGLE_BUSINESS"],
    publish,
    fetchReviews,
    replyToReview,
    fetchMetrics,
    refreshCredentials: refreshGoogleCredentials,
  };
}

export const googleBusinessSocialProvider: SocialProvider = createGoogleBusinessProvider();
