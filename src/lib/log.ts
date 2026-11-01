/**
 * One line of JSON per event, so Cloudflare and Neon log queries can filter
 * by tenant, step or action id instead of grepping prose. Fields are a flat
 * bag of ids, counts and short messages; never a payload, a key or a phone
 * number. `[request-error]` style text markers stay where they are; this is
 * for the scheduler and event paths that run with nobody watching.
 */
export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Error text trimmed to one line so a stack trace never ends up in a field. */
export function errorText(error: unknown, max = 300): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0].slice(0, max);
}

export function log(level: LogLevel, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({ level, event, ...compact(fields), at: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function compact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  return out;
}
