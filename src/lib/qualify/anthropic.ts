import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { QualificationRules } from "@/lib/types";
import type { QualificationInput, QualificationResult, Qualifier } from "./types";
import { GREEN_THRESHOLD, scoreLead } from "./rules";

const DEFAULT_MODEL = "claude-opus-5-5";

const Verdict = z.object({
  ticket_type: z.enum(["GREEN", "RED"]),
  intent_score: z.number().int().min(0).max(100),
  reason: z.string(),
  signals: z.array(z.string()),
});

const SYSTEM_PROMPT = `You qualify inbound business leads for a B2B operations platform.

Classify each lead as:
- GREEN: a high revenue-intent opportunity — someone who wants to buy, book, get a quote, check stock, or start work. These get an instant booking link and an account manager notification.
- RED: administrative or operational traffic — invoices, support, vendor pitches, job seekers, newsletter requests, vague research. These go to an automated nurture sequence or a secondary task queue.

Score intent from 0 to 100. Scores of ${GREEN_THRESHOLD} or above are GREEN. Be conservative: when the message is ambiguous and the lead gave no contact details, prefer RED. Use the tenant's rules as the primary guide and your own judgement to fill gaps. Keep "reason" to two sentences an account manager can read at a glance.`;

/**
 * LLM-backed qualifier. Falls back to the rule-based stub on any API failure
 * so intake never blocks on the model.
 */
export function createAnthropicQualifier(opts: { apiKey?: string; model?: string } = {}): Qualifier {
  const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : undefined);
  const model = opts.model ?? process.env.QUALIFIER_MODEL ?? DEFAULT_MODEL;

  return {
    name: `anthropic:${model}`,
    async qualify(input: QualificationInput, rules: QualificationRules): Promise<QualificationResult> {
      const baseline = scoreLead(input, rules);
      try {
        const response = await client.messages.parse({
          model,
          max_tokens: 1024,
          output_config: { effort: "low", format: zodOutputFormat(Verdict) },
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          messages: [
            {
              role: "user",
              content: JSON.stringify(
                {
                  tenant_rules: rules,
                  lead: {
                    source: input.source,
                    name: [input.firstName, input.lastName].filter(Boolean).join(" ") || null,
                    has_email: Boolean(input.email),
                    has_phone: Boolean(input.phone),
                    company: input.company ?? null,
                    message: input.message ?? null,
                    attributes: input.attributes,
                  },
                  rule_engine_baseline: { score: baseline.intentScore, signals: baseline.signals },
                },
                null,
                2,
              ),
            },
          ],
        });

        if (response.stop_reason === "refusal" || !response.parsed_output) {
          return { ...baseline, classifier: `${baseline.classifier} (llm fallback)` };
        }
        const v = response.parsed_output;
        return {
          ticketType: v.ticket_type,
          intentScore: v.intent_score,
          reason: v.reason,
          classifier: `anthropic:${model}`,
          signals: v.signals,
        };
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          console.error(`[qualify] Anthropic API error ${error.status}: ${error.message}`);
        } else {
          console.error("[qualify] unexpected qualifier error", error);
        }
        return { ...baseline, classifier: `${baseline.classifier} (llm fallback)` };
      }
    },
  };
}
