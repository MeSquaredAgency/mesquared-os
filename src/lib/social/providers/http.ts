import type { ChannelRecord } from "@/lib/types";
import { isRetryableStatus, providerError, type PublishResult, type ReplyResult } from "./types";

/**
 * Small HTTP toolkit shared by the platform adapters. Everything here returns
 * failures as values: a provider error, a timeout and a network failure all
 * come back as `{ ok: false, error, retryable }` so adapters never throw for
 * anything that happened on the wire. Nothing in this file logs; error
 * strings carry the HTTP status and the provider's message only, never the
 * request URL or headers (which may hold a token).
 */

export type HttpOk<T> = { ok: true; status: number; body: T; headers: Headers; /** Raw response text, for ids that JSON.parse would round. */ text: string };
export type HttpErr = { ok: false; status: number; body: unknown; error: string; retryable: boolean };
export type HttpResult<T> = HttpOk<T> | HttpErr;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  /** Objects are JSON-encoded; strings, URLSearchParams and byte arrays are sent as-is. */
  body?: unknown;
  timeoutMs?: number;
  /** Operator-facing text used when the provider sends no error message of its own. */
  fallback?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function requestJson<T = Record<string, unknown>>(url: string | URL, opts: RequestOptions = {}): Promise<HttpResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.body !== undefined && opts.body !== null) {
    if (typeof opts.body === "string" || opts.body instanceof URLSearchParams || opts.body instanceof Uint8Array) {
      body = opts.body as BodyInit;
    } else {
      body = JSON.stringify(opts.body);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: opts.method ?? "GET", headers, body, signal: controller.signal });
    const text = await res.text();
    const parsed = parseBody(text);
    if (!res.ok) {
      return { ok: false, status: res.status, body: parsed, error: providerError(res.status, parsed, opts.fallback ?? "Request failed"), retryable: isRetryableStatus(res.status) };
    }
    return { ok: true, status: res.status, body: (parsed ?? {}) as T, headers: res.headers, text };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: networkErrorText(err), retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Non-JSON error pages: keep a short excerpt so the operator sees something useful.
    return { message: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) };
  }
}

export function networkErrorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return "Request timed out";
    return `Network error: ${err.message}`.slice(0, 300);
  }
  return "Network error";
}

export type BytesResult = { ok: true; bytes: Uint8Array; contentType: string } | { ok: false; error: string; retryable: boolean };

/** Downloads a media file so it can be re-uploaded to a platform that does not pull from URLs. */
export async function fetchBytes(url: string, maxBytes: number, timeoutMs = 120_000): Promise<BytesResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: `Media download failed (HTTP ${res.status})`, retryable: isRetryableStatus(res.status) };
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) return { ok: false, error: `Media is ${formatBytes(declared)}; the limit is ${formatBytes(maxBytes)}`, retryable: false };
    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.byteLength > maxBytes) return { ok: false, error: `Media is ${formatBytes(buffer.byteLength)}; the limit is ${formatBytes(maxBytes)}`, retryable: false };
    const contentType = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    return { ok: true, bytes: buffer, contentType };
  } catch (err) {
    return { ok: false, error: networkErrorText(err), retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export type PollStep<T> = { status: "pending" } | { status: "done"; value: T } | { status: "failed"; error: string; retryable: boolean };
export type PollOutcome<T> = { ok: true; value: T } | { ok: false; error: string; retryable: boolean };

export interface PollOptions {
  intervalMs: number;
  maxMs: number;
  /** Whether giving up on the poll is worth retrying later (false when the platform may still complete the publish). */
  timeoutRetryable: boolean;
  what: string;
}

/** Runs `step` until it reports done or failed, sleeping between attempts, and gives up after `maxMs`. */
export async function poll<T>(opts: PollOptions, step: () => Promise<PollStep<T>>): Promise<PollOutcome<T>> {
  const deadline = Date.now() + opts.maxMs;
  const maxAttempts = Math.max(1, Math.ceil(opts.maxMs / Math.max(1, opts.intervalMs)) + 1);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const r = await step();
    if (r.status === "done") return { ok: true, value: r.value };
    if (r.status === "failed") return { ok: false, error: r.error, retryable: r.retryable };
    if (Date.now() >= deadline) break;
    await sleep(opts.intervalMs);
  }
  return { ok: false, error: `${opts.what} did not finish within ${Math.round(opts.maxMs / 1000)} s`, retryable: opts.timeoutRetryable };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function publishFailure(error: string, retryable = false): PublishResult {
  return { ok: false, externalPostId: null, permalink: null, error, simulated: false, retryable };
}

export function publishSuccess(externalPostId: string, permalink: string | null): PublishResult {
  return { ok: true, externalPostId, permalink, error: null, simulated: false };
}

export function replyFailure(error: string): ReplyResult {
  return { ok: false, externalId: null, error, simulated: false };
}

export function replySuccess(externalId: string | null): ReplyResult {
  return { ok: true, externalId, error: null, simulated: false };
}

export function failureFrom(err: HttpErr): PublishResult {
  return publishFailure(err.error, err.retryable);
}

/** A string setting from the channel's settings bag, or null. */
export function settingString(channel: ChannelRecord, key: string): string | null {
  const v = channel.settings?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i;

/** Guesses from the URL path whether a media URL is a video; presigned URLs keep their extension before the query string. */
export function looksLikeVideo(url: string): boolean {
  return VIDEO_EXT.test(url);
}

export function toDate(value: unknown): Date | null {
  if (typeof value === "number") return new Date(value < 1e12 ? value * 1000 : value);
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
