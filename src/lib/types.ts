/**
 * Domain types shared by the data layer and the UI.
 *
 * They mirror the Prisma models closely but are kept independent of the
 * generated client so the dashboard can render against in-memory fixtures
 * before a database exists.
 */

export type TicketType = "GREEN" | "RED";

export type LeadSource =
  | "WEB_FORM"
  | "LANDING_PAGE"
  | "META_LEAD_FORM"
  | "TIKTOK_LEAD_FORM"
  | "LINKEDIN_LEAD_FORM"
  | "YOUTUBE"
  | "REFERRAL"
  | "PHONE"
  | "EMAIL"
  | "MANUAL"
  | "OTHER";

export type LeadStatus =
  | "NEW"
  | "QUALIFIED"
  | "BOOKING_SENT"
  | "BOOKED"
  | "NURTURING"
  | "WON"
  | "LOST"
  | "ARCHIVED";

export type TaskStatus = "OPEN" | "IN_PROGRESS" | "WAITING" | "DONE" | "CANCELLED";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type SocialPlatform = "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "YOUTUBE" | "LINKEDIN";
export const SOCIAL_PLATFORMS: SocialPlatform[] = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE", "LINKEDIN"];

export type ContentStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "SCHEDULED" | "PUBLISHED";
export type PostStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED";

export type TransactionKind = "CONSULTATION_FEE" | "RETAINER_DEPOSIT" | "PAYMENT" | "REFUND" | "OTHER";
export type TransactionStatus = "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED";

export interface TenantBranding {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  fromName?: string;
  replyTo?: string;
}

/** Tenant-configured rules consumed by the qualification engine. */
export interface QualificationRules {
  /** Phrases that signal revenue intent (e.g. "ready to book", "quote"). */
  greenKeywords?: string[];
  /** Phrases that signal admin / support traffic (e.g. "invoice", "unsubscribe"). */
  redKeywords?: string[];
  /** Budget at or above this (in the tenant currency's major units) is a strong green signal. */
  minBudget?: number;
  /** Services/products that are high-value for this tenant. */
  highIntentServices?: string[];
  /** Free text passed to the LLM as business context. */
  notes?: string;
}

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  branding: TenantBranding;
  qualificationRules: QualificationRules;
}

export interface LeadRecord {
  id: string;
  tenantId: string;
  source: LeadSource;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  message: string | null;
  attributes: Record<string, unknown>;
  status: LeadStatus;
  ticketType: TicketType | null;
  intentScore: number | null;
  qualificationReason: string | null;
  qualifiedBy: string | null;
  createdAt: Date;
}

export interface TaskRecord {
  id: string;
  tenantId: string;
  leadId: string | null;
  type: TicketType;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  automationKey: string | null;
  createdAt: Date;
}

export interface TransactionRecord {
  id: string;
  tenantId: string;
  leadId: string | null;
  squarePaymentId: string;
  kind: TransactionKind;
  status: TransactionStatus;
  amountCents: number;
  currency: string;
  note: string | null;
  occurredAt: Date;
}

export interface ContentAssetRecord {
  id: string;
  tenantId: string;
  kind: string;
  title: string | null;
  body: string | null;
  targetPlatform: SocialPlatform | null;
  status: ContentStatus;
  createdAt: Date;
}

export interface SocialPostRecord {
  id: string;
  tenantId: string;
  platform: SocialPlatform;
  caption: string;
  tags: string[];
  status: PostStatus;
  scheduledFor: Date | null;
  batchId: string | null;
}

export interface TicketBoardStats {
  greenOpen: number;
  redOpen: number;
  greenLeadsToday: number;
  redLeadsToday: number;
  bookingsPending: number;
  revenueTodayCents: number;
}
