"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { filterCommands, type Command, type CommandGroup } from "@/lib/nav";
import { cn } from "@/lib/utils";

export type { Command, CommandGroup };

const OPEN_EVENT = "me2:command-menu";

/** Opens the menu from anywhere: a sidebar button, a header icon. */
export function openCommandMenu() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function useShortcutLabel() {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K"), []);
  return label;
}

/** The sidebar's "Jump to" field. It only looks like one: it opens the menu. */
export function CommandTrigger({ variant = "field" }: { variant?: "field" | "icon" }) {
  const shortcut = useShortcutLabel();
  if (variant === "icon") {
    return (
      <button type="button" onClick={openCommandMenu} aria-label="Jump to a page or workspace" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sidebar-muted outline-none hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <Search className="size-4" aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={openCommandMenu}
      aria-keyshortcuts="Meta+K Control+K"
      className="flex h-9 w-full items-center gap-2.5 rounded-lg border border-transparent bg-sidebar-hover px-3 text-left text-sm text-sidebar-muted outline-none transition-colors hover:border-sidebar-border hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">Jump to…</span>
      {shortcut && <kbd className="rounded-sm border border-sidebar-border px-1.5 py-0.5 font-sans text-[11px] leading-none tracking-wide">{shortcut}</kbd>}
    </button>
  );
}

/**
 * A quick way to any page or workspace: ⌘K (Ctrl K) anywhere, type a few
 * letters, Enter. A native modal dialog, so focus stays inside while it is open.
 */
export function CommandMenu({ groups }: { groups: CommandGroup[] }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();

  const results = useMemo(() => filterCommands(groups, query), [groups, query]);
  const flat = results.flatMap((g) => g.items);

  useEffect(() => {
    const open = () => {
      const el = dialog.current;
      if (!el || el.open) return;
      setQuery("");
      setActive(0);
      el.showModal();
      input.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else open();
      }
    };
    window.addEventListener(OPEN_EVENT, open);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, open);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (item: Command | undefined) => {
    if (!item) return;
    dialog.current?.close();
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(flat[active]);
    }
  };

  let index = -1;
  return (
    <dialog
      ref={dialog}
      data-theme="paper"
      aria-label="Jump to"
      onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      className="mx-auto mt-[12vh] w-[min(36rem,calc(100%-2rem))] overflow-hidden rounded-xl border bg-popover p-0 text-popover-foreground shadow-pop backdrop:bg-navy/30 backdrop:backdrop-blur-[1px]"
    >
      <div className="flex items-center gap-2.5 border-b px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={flat[active] ? `${id}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder="Jump to a page or workspace…"
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Results" className="max-h-[min(24rem,55vh)] overflow-y-auto p-1.5">
        {results.map((group) => (
          <li key={group.label} role="presentation">
            <p className="px-2.5 pt-2 pb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">{group.label}</p>
            <ul role="group" aria-label={group.label}>
              {group.items.map((item) => {
                index += 1;
                const i = index;
                return (
                  <li
                    key={`${item.href}-${item.label}`}
                    id={`${id}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(item)}
                    className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm", i === active && "bg-accent text-accent-foreground")}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:block">{item.hint}</span>}
                    {i === active && <CornerDownLeft className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {flat.length === 0 && <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</li>}
      </ul>
      <p className="hidden border-t px-4 py-2 text-2xs text-muted-foreground md:block">↑ ↓ to move · Enter to open · Esc to close</p>
    </dialog>
  );
}
