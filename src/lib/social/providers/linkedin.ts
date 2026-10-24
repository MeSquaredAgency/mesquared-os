import type { ChannelRecord } from "@/lib/types";
import { asNumber, failureFrom, fetchBytes, networkErrorText, publishFailure, publishSuccess, requestJson } from "./http";
import { isRetryableStatus, type ChannelCredentials, type MetricsSnapshot, type PublishInput, type PublishResult, type SocialProvider } from "./types";

/**
 * LinkedIn organisation pages (Community Management API, versioned REST).
 *
 * Auth:    `creds.accessToken` is a member token for an admin of the page;
 *          scopes w_organization_social (post), r_organization_social and
 *          rw_organization_admin (follower counts).
 * Headers: Authorization: Bearer, LinkedIn-Version (env LINKEDIN_API_VERSION,
 *          default 202409), X-Restli-Protocol-Version: 2.0.0.
 * Ids:     channel.externalAccountId is the organisation URN "urn:li:organization:123".
 *
 * Endpoints:
 *   publish   POST https://api.linkedin.com/rest/posts                     (post id in the x-restli-id response header)
 *   image     POST https://api.linkedin.com/rest/images?action=initializeUpload, then PUT the bytes to uploadUrl
 *   metrics   GET  https://api.linkedin.com/rest/networkSizes/{orgUrn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER
 *
 * One image per post (the first image URL); no inbox or reviews.
 */

const API = "https://api.linkedin.com/rest";
const DEFAULT_VERSION = "202409";
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

function headers(creds: ChannelCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.accessToken}`,
    "LinkedIn-Version": process.env.LINKEDIN_API_VERSION || DEFAULT_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

function orgUrn(channel: ChannelRecord): string {
  const id = channel.externalAccountId.trim();
  return id.startsWith("urn:") ? id : `urn:li:organization:${id}`;
}

interface InitializeUploadResponse {
  value?: { uploadUrl?: string; image?: string };
}

type UploadOutcome = { ok: true; imageUrn: string } | { ok: false; error: string; retryable: boolean };

async function uploadImage(mediaUrl: string, owner: string, creds: ChannelCredentials): Promise<UploadOutcome> {
  const init = await requestJson<InitializeUploadResponse>(`${API}/images?action=initializeUpload`, {
    method: "POST",
    headers: headers(creds),
    body: { initializeUploadRequest: { owner } },
    fallback: "LinkedIn image upload could not be initialised",
  });
  if (!init.ok) return { ok: false, error: init.error, retryable: init.retryable };
  const uploadUrl = init.body.value?.uploadUrl;
  const imageUrn = init.body.value?.image;
  if (!uploadUrl || !imageUrn) return { ok: false, error: "LinkedIn returned no upload URL for the image", retryable: false };

  const bytes = await fetchBytes(mediaUrl, IMAGE_MAX_BYTES);
  if (!bytes.ok) return bytes;
  try {
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": bytes.contentType || "application/octet-stream" },
      body: bytes.bytes as unknown as BodyInit,
    });
    if (!put.ok) return { ok: false, error: `LinkedIn image upload failed (HTTP ${put.status})`, retryable: isRetryableStatus(put.status) };
  } catch (err) {
    return { ok: false, error: networkErrorText(err), retryable: true };
  }
  return { ok: true, imageUrn };
}

export function createLinkedInProvider(): SocialProvider {
  async function publish(input: PublishInput, creds: ChannelCredentials): Promise<PublishResult> {
    const author = orgUrn(input.channel);
    const body: Record<string, unknown> = {
      author,
      commentary: input.caption,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    const image = input.mediaUrls.find(Boolean);
    if (image) {
      const uploaded = await uploadImage(image, author, creds);
      if (!uploaded.ok) return publishFailure(uploaded.error, uploaded.retryable);
      body.content = { media: { id: uploaded.imageUrn, title: input.title ?? undefined } };
    }
    const r = await requestJson<Record<string, unknown>>(`${API}/posts`, { method: "POST", headers: headers(creds), body, fallback: "LinkedIn post failed" });
    if (!r.ok) return failureFrom(r);
    const id = r.headers.get("x-restli-id") ?? r.headers.get("x-linkedin-id") ?? (typeof r.body.id === "string" ? r.body.id : null);
    if (!id) return publishFailure("LinkedIn accepted the post but returned no id", false);
    return publishSuccess(id, `https://www.linkedin.com/feed/update/${id}`);
  }

  async function fetchMetrics(channel: ChannelRecord, creds: ChannelCredentials): Promise<MetricsSnapshot> {
    const urn = orgUrn(channel);
    const url = new URL(`${API}/networkSizes/${encodeURIComponent(urn)}`);
    url.searchParams.set("edgeType", "COMPANY_FOLLOWED_BY_MEMBER");
    const r = await requestJson<{ firstDegreeSize?: number }>(url, { headers: headers(creds), fallback: "LinkedIn follower count failed" });
    if (!r.ok) {
      console.warn(`[social:linkedin] follower count failed: ${r.error}`);
      return {};
    }
    const followers = asNumber(r.body.firstDegreeSize);
    return followers === null ? {} : { followers, raw: { networkSize: r.body } };
  }

  return {
    name: "linkedin",
    platforms: ["LINKEDIN"],
    publish,
    fetchMetrics,
  };
}

export const linkedInSocialProvider: SocialProvider = createLinkedInProvider();
