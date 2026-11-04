/** Navigation rules shared by the sidebar, the phone tab bar and the "Jump to" menu. No `next/*` imports, so they are testable. */

export interface NavMatch {
  href: string;
  /** Match only the exact path (for a section's home) instead of any sub-path. */
  exact?: boolean;
  /** Also active on any sub-path no other item claims, e.g. a workspace page under the portfolio. */
  catchAll?: boolean;
}

/** Whether `item` is the current section for `pathname`, given every item in the same nav. */
export function isNavActive(pathname: string, item: NavMatch, items: NavMatch[]): boolean {
  const matches = (i: NavMatch) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`));
  if (matches(item)) return true;
  if (!item.catchAll || !pathname.startsWith(`${item.href}/`)) return false;
  return !items.some((i) => !i.catchAll && matches(i));
}

export interface Command {
  href: string;
  label: string;
  hint?: string;
  /** Extra words it should match, e.g. "people keys" on a settings page. */
  keywords?: string;
  /** Only listed once something is typed, so the empty menu stays short. */
  secondary?: boolean;
}

export interface CommandGroup {
  label: string;
  items: Command[];
}

/** Every typed word must appear somewhere in the label, hint, keywords or group name; empty groups drop out. */
export function filterCommands(groups: CommandGroup[], query: string): CommandGroup[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return groups
    .map((g) => ({
      label: g.label,
      items: g.items.filter((item) => {
        if (!terms.length) return !item.secondary;
        const haystack = `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""} ${g.label}`.toLowerCase();
        return terms.every((t) => haystack.includes(t));
      }),
    }))
    .filter((g) => g.items.length > 0);
}
