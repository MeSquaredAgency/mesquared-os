import { repository } from "@/lib/data";
import type { Side, TenantAccess, TenantPersonRecord, UserRecord } from "@/lib/types";

/** Which side someone is on in a workspace: its own members are the client; operators and admins are Me². */
export function sideOf(access: Pick<TenantAccess, "via">): Side {
  return access.via === "member" ? "CLIENT" : "ME2";
}

export const SIDE_LABEL: Record<Side, string> = { ME2: "Me²", CLIENT: "your team" };

/** How a person is named in activity and chat: their name, else the part of their email before the @. */
export function displayName(user: Pick<UserRecord, "name" | "email">): string {
  return user.name?.trim() || user.email.split("@")[0];
}

export interface Recipient {
  userId: string;
  email: string;
  name: string | null;
}

const toRecipient = (p: { userId?: string; id?: string; email: string; name: string | null }): Recipient => ({ userId: (p.userId ?? p.id)!, email: p.email, name: p.name });

/**
 * Who hears about something on one side of a workspace. The client side is its
 * owners and managers (anyone who may see finances or manage people), or every
 * member when nobody holds those. Me² is the operators assigned to the
 * workspace, or every operator when none is assigned, so nothing goes unheard.
 */
export async function peopleOnSide(tenantId: string, side: Side, people?: TenantPersonRecord[]): Promise<Recipient[]> {
  const all = people ?? (await repository.listTenantPeople(tenantId));
  if (side === "CLIENT") {
    const members = all.filter((p) => p.via === "member");
    const leads = members.filter((p) => p.permissions.includes("MANAGE_USERS") || p.permissions.includes("VIEW_FINANCES"));
    return (leads.length ? leads : members).map(toRecipient);
  }
  const operators = all.filter((p) => p.via === "operator");
  if (operators.length) return operators.map(toRecipient);
  return (await repository.listOperators()).map(toRecipient);
}

export function appUrl(path: string): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
}
