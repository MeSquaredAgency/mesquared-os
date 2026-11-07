import type { Side } from "@/lib/types";

/** Who a task waits on, mid-sentence and from the reader's side: a client reads "your team", Me² reads "the client". */
export function ownerLabel(owner: Side, viewer: Side): string {
  if (owner === "ME2") return "Me²";
  return viewer === "CLIENT" ? "your team" : "the client";
}

/** How a person's side is shown next to their name. */
export function sideTag(side: Side | "SYSTEM", viewer: Side): string | null {
  if (side === "SYSTEM") return null;
  if (side === "ME2") return "Me²";
  return viewer === "ME2" ? "Client" : null;
}
