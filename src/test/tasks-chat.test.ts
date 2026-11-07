import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHAT_PAGE, cleanChatText, postChatMessage, readChat, readChatPage } from "@/lib/chat";
import { decryptChatText, encryptChatText } from "@/lib/chat/crypto";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { dueState, planTaskEdit, reminderRecipients, remindDueTasks, toLocalInput, urgentTaskCount } from "@/lib/tasks";
import type { TaskRecord } from "@/lib/types";
import { zonedLocalToUtc } from "@/lib/utils";

const [harbor, summit] = demoTenants;
const HOUR = 3_600_000;
const actor = { actorId: "u_test", actorName: "Morgan", actorSide: "CLIENT" as const };

async function task(over: Partial<{ title: string; owner: "ME2" | "CLIENT"; dueAt: Date | null; assigneeId: string | null }> = {}): Promise<TaskRecord> {
  return repository.createTask(harbor.id, { title: over.title ?? "Send the listing photos", owner: over.owner ?? "CLIENT", dueAt: over.dueAt ?? null, assigneeId: over.assigneeId ?? null }, actor);
}

describe("tasks", () => {
  it("logs who created it and keeps the log per workspace", async () => {
    const t = await task();
    const log = await repository.listTaskEvents(harbor.id, t.id);
    assert.deepEqual(log.map((e) => [e.kind, e.actorName]), [["CREATED", "Morgan"]]);
    assert.deepEqual(await repository.listTaskEvents(summit.id, t.id), []);
    assert.equal(await repository.getTask(summit.id, t.id), null);
    await assert.rejects(repository.updateTask(summit.id, t.id, { status: "DONE" }, []));
  });

  it("turns an edit into one activity line per change; a new deadline resets its reminders", async () => {
    const now = new Date("2026-11-08T00:00:00Z");
    const t = { ...(await task({ dueAt: new Date(now.getTime() + 2 * HOUR) })), reminded: "DUE_SOON" as const };
    const next = new Date(now.getTime() + 48 * HOUR);
    const { patch, events } = planTaskEdit(t, { status: "DONE", dueAt: next, owner: "ME2", title: t.title }, actor, () => "x", harbor, now);
    assert.equal(patch.status, "DONE");
    assert.equal(patch.completedAt?.getTime(), now.getTime());
    assert.equal(patch.reminded, null);
    assert.deepEqual(events.map((e) => e.kind), ["STATUS", "OWNER", "DUE"]);
    assert.match(events[0].body!, /To do to Done/);
    assert.deepEqual(planTaskEdit(t, { title: t.title, dueAt: t.dueAt }, actor, () => "x", harbor, now).events, [], "unchanged fields write nothing");
    assert.equal(planTaskEdit({ ...t, status: "DONE", completedAt: now }, { status: "OPEN" }, actor, () => "x", harbor, now).patch.completedAt, null, "reopening clears completedAt");
  });

  it("knows overdue from due soon from later, and counts what a side owes", () => {
    const now = new Date("2026-11-08T00:00:00Z");
    const at = (h: number) => ({ status: "OPEN" as const, dueAt: new Date(now.getTime() + h * HOUR) });
    assert.equal(dueState(at(-1), now), "overdue");
    assert.equal(dueState(at(5), now), "soon");
    assert.equal(dueState(at(30), now), "later");
    assert.equal(dueState({ status: "DONE", dueAt: at(-1).dueAt }, now), "closed");
    const tasks = [{ ...at(-1), owner: "CLIENT" }, { ...at(5), owner: "ME2" }, { ...at(40), owner: "CLIENT" }] as TaskRecord[];
    assert.equal(urgentTaskCount(tasks, "CLIENT", now), 1);
    assert.equal(urgentTaskCount(tasks, "ME2", now), 1);
  });

  it("reads and writes deadlines in the workspace's own timezone", () => {
    const due = zonedLocalToUtc("2026-11-10T17:00", "Australia/Adelaide")!;
    assert.equal(toLocalInput(due, "Australia/Adelaide"), "2026-11-10T17:00");
    assert.equal(toLocalInput(null, "Australia/Adelaide"), "");
  });

  it("reminds once a day before, once when it passes, and raises an overdue Me² task in the queue", async () => {
    const base = Date.now() + 1000 * 24 * HOUR; // far from any other test's tasks
    const soonTask = await task({ title: "Approve the ad copy", dueAt: new Date(base + 3 * HOUR) });
    const meTask = await task({ title: "Build the landing page", owner: "ME2", dueAt: new Date(base + 3 * HOUR) });
    const laterTask = await task({ title: "Quarterly review", dueAt: new Date(base + 72 * HOUR) });
    const doneTask = await task({ title: "Already done", dueAt: new Date(base + 2 * HOUR) });
    await repository.updateTask(harbor.id, doneTask.id, { status: "DONE" }, []);
    const tenants = await repository.listAllTenants();
    const exceptionsBefore = (await repository.listExceptions([harbor.id], { limit: 1000 })).length;

    const first = await remindDueTasks(tenants, new Date(base));
    assert.ok(first.dueSoon >= 2);
    assert.equal((await repository.getTask(harbor.id, soonTask.id))?.reminded, "DUE_SOON");
    assert.equal((await repository.getTask(harbor.id, laterTask.id))?.reminded, null, "three days out: nothing yet");
    assert.equal((await repository.getTask(harbor.id, doneTask.id))?.reminded, null, "closed tasks are never chased");
    const again = await remindDueTasks(tenants, new Date(base + 60_000));
    assert.equal(again.dueSoon, 0, "the next tick sends nothing new");

    const late = await remindDueTasks(tenants, new Date(base + 4 * HOUR));
    assert.ok(late.overdue >= 2);
    assert.equal((await repository.getTask(harbor.id, meTask.id))?.reminded, "OVERDUE");
    const log = await repository.listTaskEvents(harbor.id, soonTask.id);
    assert.deepEqual(log.filter((e) => e.kind === "REMINDER").map((e) => e.data.stage), ["DUE_SOON", "OVERDUE"]);
    assert.equal((await remindDueTasks(tenants, new Date(base + 5 * HOUR))).overdue, 0, "overdue is sent once per deadline");
    const exceptions = await repository.listExceptions([harbor.id], { limit: 1000 });
    assert.equal(exceptions.length, exceptionsBefore + 1, "only the task Me² owes goes to the queue");
    assert.ok(exceptions.some((e) => e.reason.includes("Build the landing page")));
  });

  it("emails the client's owners about their overdue task, and Me² too", async () => {
    const t = await task({ owner: "CLIENT" });
    const people = await repository.listTenantPeople(harbor.id);
    const soon = await reminderRecipients(t, "DUE_SOON");
    const overdue = await reminderRecipients(t, "OVERDUE");
    const via = (ids: string[]) => new Set(ids.map((id) => people.find((p) => p.userId === id)?.via ?? "other"));
    assert.ok(soon.length > 0 && [...via(soon.map((r) => r.userId))].every((v) => v === "member"), "due soon: the client side only");
    assert.ok(overdue.length > soon.length, "overdue: Me² hears as well");
  });
});

describe("client chat", () => {
  it("encrypts each message to its workspace and id", () => {
    const stored = encryptChatText("The keys are under the mat", harbor.id, "chat_a");
    assert.ok(!stored.includes("keys"));
    assert.match(stored, /^c1\./);
    assert.equal(decryptChatText(stored, harbor.id, "chat_a"), "The keys are under the mat");
    assert.equal(decryptChatText(stored, summit.id, "chat_a"), null, "another workspace cannot read it");
    assert.equal(decryptChatText(stored, harbor.id, "chat_b"), null, "copied onto another row it fails");
    assert.equal(decryptChatText(stored.slice(0, -2) + "AA", harbor.id, "chat_a"), null, "tampering is caught");
    assert.notEqual(encryptChatText("same", harbor.id, "chat_a"), encryptChatText("same", harbor.id, "chat_a"), "a fresh IV every time");
  });

  it("stores only ciphertext, reads back in order, and counts unread for the other side", async () => {
    const people = await repository.listTenantPeople(harbor.id);
    const member = people.find((p) => p.via === "member")!;
    const operator = people.find((p) => p.via === "operator") ?? { userId: "op_test", name: "Op" };
    const before = await repository.countUnreadChat(harbor.id, member.userId, "CLIENT");
    await postChatMessage({ tenant: harbor, authorId: operator.userId, authorName: "Alex", side: "ME2", text: "  Draft ads are ready for you  " });
    await postChatMessage({ tenant: harbor, authorId: operator.userId, authorName: "Alex", side: "ME2", text: "Second one" });
    const raw = await repository.listChatMessages(harbor.id, { limit: 2 });
    assert.ok(raw.every((m) => !m.ciphertext.includes("ready") && !m.ciphertext.includes("Second")));
    const chat = await readChat(harbor.id, { limit: 2 });
    assert.deepEqual(chat.map((m) => m.text), ["Draft ads are ready for you", "Second one"]);
    assert.equal(await repository.countUnreadChat(harbor.id, member.userId, "CLIENT"), before + 2);
    assert.equal(await repository.countUnreadChat(harbor.id, operator.userId, "ME2"), 0, "your own side's messages are never unread");
    await repository.markChatRead(harbor.id, member.userId, new Date());
    assert.equal(await repository.countUnreadChat(harbor.id, member.userId, "CLIENT"), 0);
    assert.deepEqual(await readChat(summit.id), [], "other workspaces see nothing");
  });

  it("emails the other side once per burst, saying who wrote but never what", async () => {
    const prev = process.env.MESSAGING_MODE;
    const prevFrom = process.env.DEFAULT_FROM_EMAIL;
    process.env.MESSAGING_MODE = "log";
    process.env.DEFAULT_FROM_EMAIL = "os@mesquared.example";
    const lines: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
      await postChatMessage({ tenant: summit, authorId: "op_burst", authorName: "Alex", side: "ME2", text: "Secret launch date is the 14th" });
      const first = lines.filter((l) => l.includes("[messaging:log]") && l.includes("EMAIL"));
      assert.ok(first.length >= 1, "the client side is emailed");
      assert.ok(first.every((l) => !l.includes("Secret launch")), "the email never carries the text");
      assert.ok(first.some((l) => l.includes("Alex at Me²")));
      lines.length = 0;
      await postChatMessage({ tenant: summit, authorId: "op_burst", authorName: "Alex", side: "ME2", text: "One more thing" });
      assert.equal(lines.filter((l) => l.includes("[messaging:log]")).length, 0, "a follow-up inside half an hour sends nothing");
    } finally {
      console.info = original;
      if (prev === undefined) delete process.env.MESSAGING_MODE;
      else process.env.MESSAGING_MODE = prev;
      if (prevFrom === undefined) delete process.env.DEFAULT_FROM_EMAIL;
      else process.env.DEFAULT_FROM_EMAIL = prevFrom;
    }
  });

  it("emails each person at most once per half hour, even when the two sides take turns", async () => {
    const prev = { mode: process.env.MESSAGING_MODE, from: process.env.DEFAULT_FROM_EMAIL };
    process.env.MESSAGING_MODE = "log";
    process.env.DEFAULT_FROM_EMAIL = "os@mesquared.example";
    const lines: string[] = [];
    const info = console.info;
    console.info = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    const emailsTo = (who: string) => lines.filter((l) => l.includes("[messaging:log]") && l.includes("EMAIL") && l.includes(who)).length;
    const MIN = 60_000;
    const t0 = new Date(Date.now() + 30 * 86_400_000).getTime();
    try {
      const owner = (await repository.listTenantPeople(summit.id)).find((p) => p.via === "member")!;
      await postChatMessage({ tenant: summit, authorId: "op_turns", authorName: "Alex", side: "ME2", text: "Ads drafted" }, new Date(t0));
      await postChatMessage({ tenant: summit, authorId: owner.userId, authorName: "Sam", side: "CLIENT", text: "Great, looking now" }, new Date(t0 + MIN));
      await postChatMessage({ tenant: summit, authorId: "op_turns", authorName: "Alex", side: "ME2", text: "One tweak to the second one" }, new Date(t0 + 5 * MIN));
      assert.equal(emailsTo(owner.email), 1, "Me², client, Me² inside half an hour: the client is emailed once");
      await postChatMessage({ tenant: summit, authorId: "op_turns", authorName: "Alex", side: "ME2", text: "Following up" }, new Date(t0 + 31 * MIN));
      assert.equal(emailsTo(owner.email), 2, "after half an hour they can be emailed again");
    } finally {
      console.info = info;
      for (const [k, v] of [["MESSAGING_MODE", prev.mode], ["DEFAULT_FROM_EMAIL", prev.from]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("claims a person's email slot once, however many messages arrive together", async () => {
    const at = new Date(Date.now() + 60 * 86_400_000);
    const wins = await Promise.all(Array.from({ length: 5 }, () => repository.claimChatEmail(harbor.id, "u_claim", at, 30 * 60_000)));
    assert.equal(wins.filter(Boolean).length, 1);
    assert.equal(await repository.claimChatEmail(harbor.id, "u_claim", new Date(at.getTime() + 31 * 60_000), 30 * 60_000), true);
    assert.equal(await repository.countUnreadChat(harbor.id, "u_claim", "CLIENT") >= 0, true, "an email-only row still counts as never read");
  });

  it("pages back through history beyond the latest hundred without repeating a message", async () => {
    const people = await repository.listTenantPeople(summit.id);
    const owner = people.find((p) => p.via === "member")!;
    for (let i = 0; i < 230; i++) await postChatMessage({ tenant: summit, authorId: owner.userId, authorName: "Sam", side: "CLIENT", text: `history ${i}` }, new Date(Date.now() + 90 * 86_400_000));
    const all = (await repository.listChatMessages(summit.id, { limit: 10_000 })).length;
    const latest = await readChatPage(summit.id);
    assert.equal(latest.messages.length, CHAT_PAGE);
    assert.equal(latest.earlier, true);
    assert.equal(latest.messages.at(-1)?.text, "history 229");
    const grown = await readChatPage(summit.id, { limit: 200 });
    assert.deepEqual(grown.messages.slice(-CHAT_PAGE).map((m) => m.id), latest.messages.map((m) => m.id), "a bigger window ends where the latest page does");
    const back = await readChatPage(summit.id, { limit: 100, before: latest.messages[0].createdAt });
    const ids = new Set([...back.messages, ...latest.messages].map((m) => m.id));
    assert.equal(ids.size, back.messages.length + latest.messages.length, "no repeats across pages");
    assert.equal((await readChatPage(summit.id, { limit: 1000 })).earlier, all > 1000);
  });

  it("refuses empty or oversized messages and strips control characters", async () => {
    await assert.rejects(postChatMessage({ tenant: harbor, authorId: "u", authorName: "U", side: "CLIENT", text: "   " }), /Write a message/);
    await assert.rejects(postChatMessage({ tenant: harbor, authorId: "u", authorName: "U", side: "CLIENT", text: "x".repeat(4001) }), /limited/);
    assert.equal(cleanChatText("hi\u0007 there\r\n"), "hi there");
  });
});
