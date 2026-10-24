// Starts an embedded PostgreSQL (no admin rights needed) for local parity checks.
// Usage: node scripts/local-postgres.mjs start|stop   (data lives in .pg/)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";

const dir = ".pg";
const port = Number(process.env.PG_PORT ?? 54329);
const cmd = process.argv[2] ?? "start";
const pg = new EmbeddedPostgres({ databaseDir: `${dir}/data`, user: "postgres", password: "postgres", port, persistent: true, onLog: () => {}, onError: () => {} });

if (cmd === "start") {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(`${dir}/data/PG_VERSION`)) await pg.initialise();
  await pg.start();
  await pg.createDatabase("mesquared_os").catch(() => {});
  writeFileSync(`${dir}/url`, `postgresql://postgres:postgres@localhost:${port}/mesquared_os`);
  console.log(`postgresql://postgres:postgres@localhost:${port}/mesquared_os`);
  // keep running until killed
  process.stdin.resume();
  const stop = async () => { await pg.stop().catch(() => {}); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
} else if (cmd === "stop") {
  await pg.stop().catch(() => {});
  console.log("stopped");
} else if (cmd === "reset") {
  await pg.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
  console.log("reset");
} else {
  console.log(existsSync(`${dir}/url`) ? readFileSync(`${dir}/url`, "utf8") : "not started");
}
