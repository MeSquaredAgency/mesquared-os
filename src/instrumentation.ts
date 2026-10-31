import type { Instrumentation } from "next";

/**
 * Every server-side error that reaches an error boundary is logged here with
 * the route, the digest the user sees under "Reference" and the real message,
 * which Next.js strips from the browser in production. Search the Worker log
 * (or the Node log) for `[request-error]` or the digest. Headers and bodies
 * are never logged: they carry session cookies and lead payloads.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const e = error as { name?: unknown; message?: unknown; code?: unknown; digest?: unknown; cause?: unknown } | null;
  const describe = (value: unknown, depth = 0): string => {
    if (!value || typeof value !== "object" || depth > 4) return String(value ?? "");
    const v = value as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    const head = [v.name, v.code].filter((x) => typeof x === "string" && x).join(" ");
    const text = `${head ? `${head}: ` : ""}${typeof v.message === "string" ? v.message : ""}`.slice(0, 500);
    return v.cause ? `${text} <- ${describe(v.cause, depth + 1)}` : text;
  };
  console.error(`[request-error] ${request.method} ${request.path} (${context.routeType} ${context.routePath}${context.renderSource ? `, ${context.renderSource}` : ""}) digest=${typeof e?.digest === "string" ? e.digest : "-"} ${describe(error)}`);
};
