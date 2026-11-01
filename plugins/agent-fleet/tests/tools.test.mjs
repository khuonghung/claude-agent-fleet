import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { writeBoard } from "../scripts/lib/board-init.mjs";
import { compareVersions, normalizePlan, PLUGIN_VERSION, readFleet, versionNote } from "../scripts/lib/plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "scripts", "fleet.mjs");
const hook = path.join(root, "hooks", "fleet-context.mjs");

const plan = (extra = {}) => ({
  mission: { name: "Night team", goal: "Fix what the QA found", hours: 4 },
  repo: { dir: ".", base: "main" },
  agents: [
    { id: "lead", role: "lead" },
    { id: "po", role: "product-owner", reportsTo: "lead" },
    { id: "rm", role: "release-manager", reportsTo: "lead" },
    { id: "dev-api", role: "developer", reportsTo: "po", owns: ["apps/api"] },
    { id: "dev-web", role: "developer", reportsTo: "po", owns: ["apps/web"] },
    { id: "test-api", role: "tester", reportsTo: "po" },
  ],
  ...extra,
});

/** A temporary project with a fleet written as `fleet init` leaves it; `fn` gets its folder, board and a CLI runner. */
async function withFleet(fn, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    const { fleetFile, boardDir } = writeBoard(normalizePlan(plan(extra), { cwd: dir }));
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8" });
    return await fn({ dir, fleetFile, boardDir, run });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("version: every write stamps the plugin's version; an older session is told to update, a newer one is not", () => {
  assert.ok(compareVersions("0.6.0", "0.10.0") < 0);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.ok(compareVersions("1.0.0", "0.99.9") > 0);
  withFleet(({ dir, fleetFile, run }) => {
    assert.equal(readFleet(fleetFile).plugin.version, PLUGIN_VERSION);
    assert.equal(versionNote(readFleet(fleetFile)), undefined, "the same version says nothing");
    const fleet = readFleet(fleetFile);
    fleet.plugin.version = "99.0.0";
    fs.writeFileSync(fleetFile, JSON.stringify(fleet));
    assert.match(versionNote(fleet), new RegExp(`runs agent-fleet ${PLUGIN_VERSION.replaceAll(".", "\\.")}, but the fleet "night-team" was written by 99\\.0\\.0`));
    const status = run("status", "--json");
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stderr, /^warning: This session runs agent-fleet/m);
    assert.deepEqual(JSON.parse(run("version").stdout).fleet, "99.0.0");
    const started = spawnSync(process.execPath, [hook, "session-start"], { input: JSON.stringify({ cwd: dir, session_id: "s-1", source: "startup" }), encoding: "utf8" });
    assert.match(started.stdout, /was written by 99\.0\.0[\s\S]*Agent fleet "Night team" is active/);
  });
});

/** Runs git in a test repository, with an identity of its own. */
const gitIn = (dir, ...args) => {
  const r = spawnSync("git", ["-C", dir, "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

test("doctor: env files a worktree lacks, variables turbo drops, a dirty checkout and a missing base are named before launch", async () => {
  const { doctor, envKeys } = await import("../scripts/lib/doctor.mjs");
  assert.deepEqual(envKeys("# c\nDATABASE_URL=x\nexport API_KEY = y\n\nnot a line\n"), ["DATABASE_URL", "API_KEY"]);
  await withFleet(async ({ dir, fleetFile, run }) => {
    gitIn(dir, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, ".gitignore"), ".env\n.fleet/\n.claude/\n");
    fs.writeFileSync(path.join(dir, "turbo.json"), JSON.stringify({ globalPassThroughEnv: ["NODE_*"], tasks: { test: { env: ["CI"] } } }));
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "init");
    fs.writeFileSync(path.join(dir, ".env"), "DATABASE_URL=postgres://x\nNODE_ENV=test\nCI=1\n");
    fs.writeFileSync(path.join(dir, "draft.txt"), "uncommitted\n");
    const fleet = readFleet(fleetFile);
    const checks = await doctor(fleet, { fleetDir: path.dirname(fleetFile), probe: async () => "free" });
    const of = (name) => checks.find((c) => c.name === name);
    assert.equal(of("base branch").state, "ok");
    assert.equal(of("env files").state, "warn");
    assert.match(of("env files").detail, /worktrees will not have \.env/);
    assert.equal(of("turbo env").state, "warn");
    assert.match(of("turbo env").detail, /drops DATABASE_URL:/, "NODE_ENV matches NODE_*, CI is the test task's");
    assert.equal(of("working tree").state, "warn");
    assert.equal(of("briefs").state, "ok");
    fleet.repo.base = "develop";
    const noBase = await doctor(fleet, { fleetDir: path.dirname(fleetFile), probe: async () => "other" });
    assert.equal(noBase.find((c) => c.name === "base branch").state, "fail");
    assert.equal(noBase.find((c) => c.name === "dashboard port").state, "warn");
    const cli = run("doctor", "--json");
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).ok, true);
  });
});

test("clone: the next round keeps the team, starts a fresh board and carries the open tickets over as new, under ids no member uses", async () => {
  await withFleet(async ({ dir, fleetFile, boardDir, run }) => {
    const ticket = (id, status) => fs.writeFileSync(path.join(boardDir, "tickets", `${id}.md`), `# ${id}: thing ${id}\n\n- Status: ${status}\n- Owner: dev-api\n- Verifier: test-api\n\n## Problem\nx\n\n## Log\n- 10:00 po: filed\n`);
    ticket("DA-001", "verified");
    ticket("DA-002", "deferred");
    ticket("DA-003", "In progress");
    ticket("DA-004", "wont-fix");
    const source = readFleet(fleetFile);
    source.agents.find((a) => a.id === "dev-api").match.sessionId = "s-old";
    fs.writeFileSync(fleetFile, JSON.stringify(source));
    const refused = run("clone", "--name", "Night team 2");
    assert.equal(refused.status, 1, "the source still runs");
    assert.match(refused.stderr, /"night-team" is still running/);
    const dry = JSON.parse(run("clone", "--name", "Night team 2", "--hours", "2", "--dry-run").stdout);
    assert.equal(dry.slug, "night-team-2");
    assert.equal(Date.parse(dry.endAt) - Date.parse(dry.startAt), 2 * 3_600_000);
    const done = run("clone", "--name", "Night team 2", "--hours", "2", "--force");
    assert.equal(done.status, 0, done.stderr);
    const result = JSON.parse(done.stdout);
    assert.deepEqual(result.carried, [
      { id: "CO-001", from: "DA-002", status: "deferred" },
      { id: "CO-002", from: "DA-003", status: "in-progress" },
    ]);
    assert.equal(fs.readFileSync(path.join(dir, ".fleet", "current"), "utf8").trim(), "night-team-2");
    const next = readFleet(path.join(dir, ".fleet", "night-team-2", "fleet.json"));
    assert.deepEqual(next.agents.map((a) => a.id), source.agents.map((a) => a.id));
    assert.equal(next.agents.find((a) => a.id === "dev-api").match.sessionId, undefined, "no session of the last round");
    assert.equal(next.agents.find((a) => a.id === "dev-api").match.title, "NT2 · dev-api");
    assert.deepEqual(next.mission.phases.map((p) => p.name), source.mission.phases.map((p) => p.name));
    assert.equal(next.mission.phases.at(-1).to, next.mission.endAt);
    const carried = fs.readFileSync(path.join(dir, ".fleet", "night-team-2", "board", "tickets", "CO-002.md"), "utf8");
    assert.match(carried, /^# CO-002: thing DA-003$/m);
    assert.match(carried, /^- Status: new$/m);
    assert.match(carried, /^- Owner: dev-api$/m);
    assert.match(carried, /carried over from night-team\/DA-003 \(was in-progress\); back to new for triage\.$/m);
    assert.ok(fs.existsSync(path.join(boardDir, "tickets", "DA-002.md")), "the last round's board is left as it was");
  });
});
