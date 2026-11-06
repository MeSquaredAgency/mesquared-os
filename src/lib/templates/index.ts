import type { IndustryTemplate } from "./types";
import { genericTemplate } from "./generic";
import { healthFitnessTemplate } from "./health-fitness";
import { beautyTemplate, clinicTemplate } from "./health-beauty";
import { constructionTemplate, tradesTemplate } from "./home-building";
import { financeTemplate, professionalTemplate } from "./professional";
import { realEstateTemplate } from "./real-estate";
import { automotiveTemplate, hospitalityTemplate, retailTemplate } from "./retail-food-motoring";
import { educationTemplate } from "./education";

export type { IndustryTemplate, TemplateGroup } from "./types";

/** In picker order: grouped, and the general template last. */
export const TEMPLATES: IndustryTemplate[] = [
  realEstateTemplate,
  tradesTemplate,
  constructionTemplate,
  clinicTemplate,
  healthFitnessTemplate,
  beautyTemplate,
  professionalTemplate,
  financeTemplate,
  hospitalityTemplate,
  retailTemplate,
  automotiveTemplate,
  educationTemplate,
  genericTemplate,
];
export const TEMPLATE_BY_KEY: Record<string, IndustryTemplate> = Object.fromEntries(TEMPLATES.map((t) => [t.key, t]));

export function getTemplate(key: string | null | undefined): IndustryTemplate {
  return (key && TEMPLATE_BY_KEY[key]) || genericTemplate;
}

/** The template's name for a tenant, for display: "Trades & home services" rather than the coarse industry. */
export function templateName(key: string | null | undefined): string {
  return getTemplate(key).name;
}
