import { z } from "zod";
import type { TenantSummary } from "@/lib/types";
import type { ToolRisk } from "./policy";

/**
 * An agent can do what its tools allow and nothing else. A tool is a small
 * typed wrapper around a service a person's button already calls: it never
 * opens the database or calls a provider itself, and it never takes a tenant
 * id, because the tenant comes from the run.
 */

export interface ToolContext {
  tenant: TenantSummary;
  /** `${runId}:${toolUseId}`, the idempotency key for anything this call sends or creates. */
  callKey: string;
}

/** A failure the agent should read and adapt to ("no such lead"); anything else is a fault the runtime retries. */
export class ToolError extends Error {}

export interface AgentTool<I extends z.ZodType = z.ZodType> {
  name: string;
  /** What it does and when to use it, written for the model. */
  description: string;
  input: I;
  risk: ToolRisk;
  /** The module that must be on for the tool to be offered, or null. */
  module: string | null;
  /** What a person approving the call sees: the exact effect. */
  preview?: (input: z.infer<I>) => { title: string; body: string };
  /**
   * The one text field a person approving the call may change before it runs, such as a message's wording. The
   * edited input is checked against `input` again, and the agent is told what changed.
   */
  editable?: { field: Extract<keyof z.infer<I>, string>; label: string };
  run(ctx: ToolContext, input: z.infer<I>): Promise<unknown>;
}

export function defineTool<I extends z.ZodType>(tool: AgentTool<I>): AgentTool<I> {
  return tool;
}

/** JSON Schema keywords a strict tool definition keeps. Range and length limits are enforced by zod when the tool runs. */
const KEEP = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "description"]);

function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!KEEP.has(key)) continue;
    out[key] = key === "properties" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, strictSchema(v)])) : strictSchema(value);
  }
  return out;
}

/** The tool as the Messages API takes it, with strict input checking. */
export function claudeToolDefinition(tool: AgentTool): { name: string; description: string; input_schema: Record<string, unknown>; strict: true } {
  return { name: tool.name, description: tool.description, input_schema: strictSchema(z.toJSONSchema(tool.input)) as Record<string, unknown>, strict: true };
}

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };

/** Validates the model's input and runs the tool. A ToolError or invalid input comes back as an error for the agent. */
export async function runTool(tool: AgentTool, ctx: ToolContext, input: unknown): Promise<ToolOutcome> {
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Invalid input for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}` };
  try {
    return { ok: true, result: await tool.run(ctx, parsed.data) };
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, error: error.message };
    throw error;
  }
}
