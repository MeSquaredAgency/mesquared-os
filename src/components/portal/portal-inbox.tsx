"use client";

import { portalReplyAction } from "@/lib/content/actions";
import { SocialInbox, type InboxThread } from "./social-inbox";

/** The client's view of the inbox. Replies are sent as the business by members allowed to approve content. */
export function PortalInbox({ tenantSlug, threads, canReply }: { tenantSlug: string; threads: InboxThread[]; canReply: boolean }) {
  return <SocialInbox threads={threads} canReply={canReply} onReply={(id, text) => portalReplyAction(tenantSlug, id, text)} description={canReply ? "Comments and messages waiting for a reply. Send the suggested answer or write your own; Me² handles the rest." : "Comments and messages waiting for a reply. Me² replies for you unless someone with content approval steps in."} />;
}
