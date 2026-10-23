import type { IndustryTemplate } from "./types";
import { genericTemplate } from "./generic";
import { healthFitnessTemplate } from "./health-fitness";
import { realEstateTemplate } from "./real-estate";

export type { IndustryTemplate } from "./types";

export const TEMPLATES: IndustryTemplate[] = [realEstateTemplate, healthFitnessTemplate, genericTemplate];
export const TEMPLATE_BY_KEY: Record<string, IndustryTemplate> = Object.fromEntries(TEMPLATES.map((t) => [t.key, t]));

export function getTemplate(key: string | null | undefined): IndustryTemplate {
  return (key && TEMPLATE_BY_KEY[key]) || genericTemplate;
}
