import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterCommands, isNavActive, type CommandGroup, type NavMatch } from "@/lib/nav";

const consoleNav: NavMatch[] = [{ href: "/console", exact: true, catchAll: true }, { href: "/console/queue" }, { href: "/console/onboarding" }, { href: "/console/new" }];
const activeIn = (pathname: string, items: NavMatch[]) => items.filter((i) => isNavActive(pathname, i, items)).map((i) => i.href);

describe("isNavActive", () => {
  it("keeps Portfolio lit inside a workspace and its settings", () => {
    assert.deepEqual(activeIn("/console", consoleNav), ["/console"]);
    assert.deepEqual(activeIn("/console/harbour-realty", consoleNav), ["/console"]);
    assert.deepEqual(activeIn("/console/harbour-realty/settings", consoleNav), ["/console"]);
  });

  it("gives a page another item claims to that item alone", () => {
    assert.deepEqual(activeIn("/console/queue", consoleNav), ["/console/queue"]);
    assert.deepEqual(activeIn("/console/onboarding/abc/call", consoleNav), ["/console/onboarding"]);
    assert.deepEqual(activeIn("/console/new", consoleNav), ["/console/new"]);
  });

  it("does not let a prefix match a longer sibling segment", () => {
    assert.deepEqual(activeIn("/console/queued", [{ href: "/console/queue" }]), []);
  });

  it("keeps an exact home exact without catchAll", () => {
    const portal: NavMatch[] = [{ href: "/app/a", exact: true }, { href: "/app/a/leads" }];
    assert.deepEqual(activeIn("/app/a/leads", portal), ["/app/a/leads"]);
    assert.deepEqual(activeIn("/app/a/unknown", portal), []);
  });
});

describe("filterCommands", () => {
  const groups: CommandGroup[] = [
    { label: "Go to", items: [{ href: "/console", label: "Portfolio" }, { href: "/console/queue", label: "Queue", hint: "Needs an operator" }] },
    {
      label: "Workspaces",
      items: [
        { href: "/console/harbour", label: "Harbour Realty" },
        { href: "/console/harbour/settings", label: "Harbour Realty · Settings", keywords: "people keys", secondary: true },
        { href: "/console/cobalt", label: "Cobalt Dental" },
      ],
    },
  ];

  it("hides secondary commands until something is typed", () => {
    const all = filterCommands(groups, "  ");
    assert.deepEqual(
      all.flatMap((g) => g.items.map((i) => i.href)),
      ["/console", "/console/queue", "/console/harbour", "/console/cobalt"],
    );
  });

  it("needs every word to match, across label, hint, keywords and group", () => {
    assert.deepEqual(
      filterCommands(groups, "harb people").flatMap((g) => g.items.map((i) => i.href)),
      ["/console/harbour/settings"],
    );
    assert.deepEqual(
      filterCommands(groups, "OPERATOR").flatMap((g) => g.items.map((i) => i.href)),
      ["/console/queue"],
    );
    assert.equal(filterCommands(groups, "workspaces").flatMap((g) => g.items).length, 3);
  });

  it("drops groups with nothing left", () => {
    assert.deepEqual(
      filterCommands(groups, "cobalt").map((g) => g.label),
      ["Workspaces"],
    );
    assert.deepEqual(filterCommands(groups, "nothing here"), []);
  });
});
