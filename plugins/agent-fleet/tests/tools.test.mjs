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

test("ticket set: one step at a time, by the member whose step it is, with the evidence it needs, and a Log line", async () => {
  await withFleet(async ({ boardDir, run }) => {
    const file = path.join(boardDir, "tickets", "TA-001.md");
    fs.writeFileSync(file, "# TA-001: login fails\n\n- Status: new\n- Severity: high\n- Area: apps/api\n- Owner:\n- Verifier:\n- Decision:\n\n## Problem\nx\n\n## Acceptance criteria\n\n## Log\n- 10:00 test-api: filed\n");
    const set = (...a) => run("ticket", "set", "TA-001", ...a);
    const status = () => /^- Status: (.*)$/m.exec(fs.readFileSync(file, "utf8"))[1];
    let r = set("fixed", "--by", "dev-api", "--note", "x");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /new → fixed skips a step/);
    r = set("triaged", "--by", "po", "--decision", "do now");
    assert.match(r.stderr, /needs acceptance criteria/);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("## Acceptance criteria\n", "## Acceptance criteria\n- Given a user, when they log in, then 200\n"));
    assert.equal(set("triaged", "--by", "dev-api", "--decision", "do now").status, 1, "triage is the product owner's");
    assert.equal(set("triaged", "--by", "po", "--decision", "do now").status, 0);
    assert.match(set("assigned", "--by", "po").stderr, /needs an owner and a verifier/);
    assert.equal(set("assigned", "--by", "po", "--owner", "dev-api", "--verifier", "test-api").status, 0);
    assert.match(set("in-progress", "--by", "dev-web").stderr, /dev-web may not set in-progress: that is its owner \(dev-api\) or crew/);
    assert.equal(set("in-progress", "--by", "dev-api").status, 0);
    assert.match(set("fixed", "--by", "dev-api", "--note", "pnpm test → 12 passed").stderr, /needs the branch and commit in --fix/);
    assert.equal(set("fixed", "--by", "dev-api", "--fix", "nt-dev-api @ 3f2a1c9", "--note", "pnpm --filter api test → 12 passed, 0 failed, 0 skipped").status, 0);
    assert.equal(set("integrated", "--by", "dev-api", "--note", "merged").status, 1, "integration is the release manager's");
    assert.equal(set("integrated", "--by", "rm", "--note", "merge abc1234; api 214/0/3 (baseline 3)").status, 0);
    assert.match(set("verified", "--by", "lead", "--note", "ok").stderr, /that is its verifier \(test-api\), never its owner or crew/);
    assert.equal(set("verified", "--by", "test-api", "--note", "criterion 1: curl → 200").status, 0);
    assert.equal(status(), "verified");
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /^- Owner: dev-api$/m);
    assert.match(text, /^- Fix: nt-dev-api @ 3f2a1c9$/m);
    assert.match(text, /^- \d\d:\d\d dev-api: fixed — pnpm --filter api test → 12 passed, 0 failed, 0 skipped$/m);
    assert.match(text, /^- \d\d:\d\d test-api: verified — criterion 1: curl → 200\n$/m, "the Log line is the last line");
    assert.equal(set("reopened", "--by", "dev-web", "--note", "x").status, 1);
    assert.equal(set("reopened", "--by", "po", "--note", "criterion 1 fails on staging data").status, 0);
    assert.equal(set("verified", "--by", "test-api", "--note", "x", "--force").status, 0, "the lead's escape hatch");
    assert.match(fs.readFileSync(file, "utf8"), /test-api: verified — x \(forced\)/);
    const list = JSON.parse(run("ticket", "list", "--owner", "dev-api", "--json").stdout);
    assert.deepEqual(list.map((t) => [t.id, t.status]), [["TA-001", "verified"]]);
  });
});
