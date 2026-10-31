import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isReadOperation, isTransientDbError, withTransientRetry } from "@/lib/data/transient";

describe("isTransientDbError", () => {
  it("recognises connection failures by code, kind and message, through causes", () => {
    assert.equal(isTransientDbError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
    assert.equal(isTransientDbError(Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" })), true);
    assert.equal(isTransientDbError(Object.assign(new Error("Can't reach database server"), { code: "P1001" })), true);
    assert.equal(isTransientDbError(new Error("Connection terminated unexpectedly")), true);
    assert.equal(isTransientDbError(new Error("Cannot perform I/O on behalf of a different request")), true);
    assert.equal(isTransientDbError(new Error("timeout exceeded when trying to connect")), true);
    assert.equal(isTransientDbError(new Error("Hyperdrive: connection limit reached")), true);
    assert.equal(isTransientDbError(new Error("Invalid `prisma.lead.findMany()` invocation"), 0), false);
    assert.equal(isTransientDbError(new Error("Query failed", { cause: { kind: "SocketTimeout" } })), true);
    assert.equal(isTransientDbError(Object.assign(new Error("wrapped"), { meta: { driverAdapterError: { cause: { code: "08006" } } } })), true);
  });

  it("leaves real query errors alone", () => {
    assert.equal(isTransientDbError(Object.assign(new Error("Unique constraint failed"), { code: "P2002" })), false);
    assert.equal(isTransientDbError(Object.assign(new Error("relation does not exist"), { code: "42P01" })), false);
    assert.equal(isTransientDbError(new TypeError("Cannot read properties of undefined")), false);
    assert.equal(isTransientDbError(null), false);
    assert.equal(isTransientDbError("ECONNRESET"), false);
  });

  it("only treats reads as retryable operations", () => {
    for (const op of ["findMany", "findUnique", "findFirst", "count", "aggregate", "groupBy"]) assert.equal(isReadOperation(op), true, op);
    // Raw SQL can write (the rate-limit bucket is a $queryRaw upsert), so it is never retried.
    for (const op of ["create", "update", "upsert", "delete", "updateMany", "deleteMany", "createMany", "executeRaw", "queryRaw"]) assert.equal(isReadOperation(op), false, op);
  });
});

describe("withTransientRetry", () => {
  const noSleep = async () => {};

  it("retries a transient failure and returns the eventual result", async () => {
    let calls = 0;
    const retries: number[] = [];
    const result = await withTransientRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" });
        return "ok";
      },
      { sleep: noSleep, onRetry: (_e, attempt) => retries.push(attempt) },
    );
    assert.equal(result, "ok");
    assert.equal(calls, 3);
    assert.deepEqual(retries, [1, 2]);
  });

  it("gives up after the configured attempts and throws the last error", async () => {
    let calls = 0;
    await assert.rejects(
      withTransientRetry(
        async () => {
          calls += 1;
          throw new Error(`Connection terminated unexpectedly #${calls}`);
        },
        { attempts: 3, sleep: noSleep },
      ),
      /#3/,
    );
    assert.equal(calls, 3);
  });

  it("does not retry errors that a new connection would not fix", async () => {
    let calls = 0;
    await assert.rejects(
      withTransientRetry(async () => {
        calls += 1;
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }, { sleep: noSleep }),
      /Unique constraint/,
    );
    assert.equal(calls, 1);
  });

  it("backs off between attempts", async () => {
    const delays: number[] = [];
    let calls = 0;
    await withTransientRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("socket hang up");
        return calls;
      },
      { baseDelayMs: 100, sleep: async (ms) => void delays.push(ms) },
    );
    assert.equal(delays.length, 2);
    assert.ok(delays[0] >= 100 && delays[0] < 150, `first delay ${delays[0]}`);
    assert.ok(delays[1] >= 200 && delays[1] < 250, `second delay ${delays[1]}`);
  });
});
