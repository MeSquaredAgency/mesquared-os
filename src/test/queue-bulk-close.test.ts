import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { registerAutomations } from "@/lib/automations/handlers";
import { closeExceptionsInBulk } from "@/lib/console/resolve";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { raiseMissedOpportunity } from "@/lib/opportunities/raise";

const harbor = demoTenants[0];
const summit = demoTenants[1];

before(() => {
  process.env.MESSAGING_MODE = "log";
  registerAutomations();
});

describe("bulk close from the operator queue", () => {
  it("closes the chosen items, writes off their missed opportunities and leaves other workspaces alone", async () => {
    const plain = await repository.createException(harbor.id, { reason: "Bulk close test: plain item" });
    const mo = await raiseMissedOpportunity(harbor, { type: "NOT_BOOKED", leadId: "lead_1", contactId: "ct_1", subjectId: "lead_1:bulk-close", summary: "Bulk close test", suggestedAction: "none" });
    assert.ok(mo, "missed opportunity raised");
    const linked = (await repository.listExceptions([harbor.id])).find((e) => e.missedOpportunityId === mo!.id);
    assert.ok(linked, "exception attached to the missed opportunity");
    const elsewhere = await repository.createException(summit.id, { reason: "Bulk close test: another portfolio" });

    const result = await closeExceptionsInBulk(
      new Set([harbor.id]),
      [
        { tenantId: harbor.id, exceptionId: plain.id },
        { tenantId: harbor.id, exceptionId: linked!.id },
        { tenantId: harbor.id, exceptionId: plain.id },
        { tenantId: summit.id, exceptionId: elsewhere.id },
      ],
      "Duplicates of an earlier enquiry",
      "user_test",
    );

    assert.deepEqual(result.closedIds.sort(), [plain.id, linked!.id].sort());
    assert.equal(result.outsidePortfolio, 1);
    assert.equal(result.alreadyResolved, 0, "a repeated id is closed once, not counted twice");
    const openHarbor = await repository.listExceptions([harbor.id]);
    assert.ok(!openHarbor.some((e) => e.id === plain.id || e.id === linked!.id), "both harbor items closed");
    assert.ok((await repository.listExceptions([summit.id])).some((e) => e.id === elsewhere.id), "the other workspace's item is untouched");
    const settled = (await repository.listMissedOpportunities(harbor.id, { limit: 500 })).find((m) => m.id === mo!.id);
    assert.equal(settled?.status, "EXPIRED", "written off, not recovered");
    const runs = await repository.listAutomationRuns(harbor.id, 100);
    assert.ok(runs.some((r) => r.summary === "Closed by the Me² team: Duplicates of an earlier enquiry."), "the note is logged");

    const again = await closeExceptionsInBulk(new Set([harbor.id]), [{ tenantId: harbor.id, exceptionId: plain.id }], "", "user_test");
    assert.deepEqual(again.closedIds, []);
    assert.equal(again.alreadyResolved, 1);
  });
});
