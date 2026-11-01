import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { agentFileOf, briefOf, launchPlan, prefixes, writeAgents, writeBoard } from "../scripts/lib/board-init.mjs";
import { codeOf, defaultPhases, normalizePlan, readFleet, slugOf, transcriptFolderOf } from "../scripts/lib/plan.mjs";

const plan = (extra = {}) => ({
  mission: { name: "Night team", goal: "Fix what the QA found", hours: 4 },
  repo: { dir: ".", base: "main" },
  agents: [
    { id: "lead", role: "lead" },
    { id: "po", role: "product-owner", reportsTo: "lead" },
    { id: "dev-api", role: "developer", reportsTo: "po", owns: ["apps/api"] },
    { id: "test-api", role: "tester", reportsTo: "po", model: "sonnet", effort: "medium" },
  ],
  ...extra,
});

test("a plan gets the catalog's defaults, the timeline and how each member is found", () => {
  const p = normalizePlan(plan(), { cwd: "/repo", now: new Date("2026-11-01T00:00:00Z"), lead: { transcriptPath: "/t/lead.jsonl", sessionId: "s-1" } });
  assert.equal(p.mission.slug, "night-team");
  assert.equal(p.mission.code, "NT");
  assert.equal(p.mission.endAt, "2026-11-01T04:00:00.000Z");
  assert.deepEqual(p.mission.phases.map((x) => x.name), ["Start-up", "Build & verify", "Code freeze", "Reports"]);
  const dev = p.agents.find((a) => a.id === "dev-api");
  assert.equal(dev.model, "opus");
  assert.equal(dev.effort, "high");
  assert.equal(dev.worktree, true);
  assert.equal(dev.match.title, "NT · dev-api");
  assert.equal(dev.match.description, "night-team/dev-api");
  assert.equal(p.agents.find((a) => a.id === "test-api").model, "sonnet");
  const lead = p.agents.find((a) => a.id === "lead");
  assert.equal(lead.launch, "self");
  assert.equal(lead.match.transcript, "/t/lead.jsonl");
});

test("every problem of a plan is listed at once", () => {
  const bad = plan({ launch: "teleport" });
  bad.mission.goal = "";
  bad.agents.push({ id: "Bad Id", role: "developer" }, { id: "x", role: "wizard" }, { id: "y", role: "tester", model: "gpt", effort: "huge", reportsTo: "nobody" });
  assert.throws(() => normalizePlan(bad), (error) => {
    for (const part of ["mission.goal", "launch must be", "lowercase kebab-case", "role wizard", "model gpt", "effort must be", "reportsTo nobody"]) assert.match(error.message, new RegExp(part));
    return true;
  });
});

test("a reportsTo loop is refused", () => {
  const p = plan();
  p.agents[0].reportsTo = "dev-api";
  assert.throws(() => normalizePlan(p), /loops/);
});

test("names: slug, code and Claude Code's transcript folder", () => {
  assert.equal(slugOf("Đakovo night crew: Ünïcode!"), "dakovo-night-crew-unicode");
  assert.equal(codeOf("kintsugi-night-team"), "KNT");
  assert.equal(transcriptFolderOf("C:\\Users\\me\\Work\\LM\\kintsugi\\.claude\\worktrees\\x"), "C--Users-me-Work-LM-kintsugi--claude-worktrees-x");
  const [a, b, c, d] = defaultPhases("2026-11-01T00:00:00Z", "2026-11-01T10:00:00Z");
  assert.equal(a.to, "2026-11-01T01:00:00.000Z");
  assert.equal(b.to, "2026-11-01T07:30:00.000Z");
  assert.equal(c.to, "2026-11-01T08:30:00.000Z");
  assert.equal(d.to, "2026-11-01T10:00:00.000Z");
});

test("init writes the board, one brief per member and the current pointer; tickets survive a second init", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    const p = normalizePlan(plan(), { cwd: dir });
    const { fleetFile, boardDir } = writeBoard(p);
    for (const file of ["README.md", "ROSTER.md", "BOARD.md", "NOTICES.md", "briefs/dev-api.md", "briefs/lead.md"]) assert.ok(fs.existsSync(path.join(boardDir, file)), file);
    assert.equal(fs.readFileSync(path.join(dir, ".fleet", "current"), "utf8").trim(), "night-team");
    assert.match(fs.readFileSync(path.join(boardDir, "README.md"), "utf8"), /Fix what the QA found/);
    const brief = briefOf(p, p.agents.find((a) => a.id === "dev-api"));
    assert.match(brief, /You are \*\*dev-api\*\* \(Developer\)/);
    assert.match(brief, /You report to \*\*po\*\*/);
    assert.match(brief, /`apps\/api`/);
    fs.writeFileSync(path.join(boardDir, "tickets", "DA-001.md"), "# DA-001: x\n");
    writeBoard(p);
    assert.ok(fs.existsSync(path.join(boardDir, "tickets", "DA-001.md")));
    const read = readFleet(fleetFile);
    assert.equal(read.agents.length, 4);
    const launch = launchPlan(read);
    assert.deepEqual(launch.find((x) => x.id === "dev-api"), {
      id: "dev-api",
      launch: "session",
      title: "NT · dev-api",
      description: "night-team/dev-api",
      subagentType: "fleet-night-team-dev-api",
      agentFile: path.join(path.dirname(boardDir), "agents", "dev-api.md"),
      model: "opus",
      modelId: "claude-opus-5-5",
      effort: "high",
      worktree: true,
      readOnly: false,
      branch: "night-team-dev-api",
      brief: path.join(boardDir, "briefs", "dev-api.md"),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ticket prefixes are unique initials", () => {
  const pre = prefixes([{ id: "dev-api" }, { id: "dev-app" }, { id: "test-api" }]);
  assert.deepEqual([...pre.values()], ["DA", "DA2", "TA"]);
});

test("an older night-team config (date + HH:MM) is read as ISO times", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    const file = path.join(dir, "old.json");
    fs.writeFileSync(file, JSON.stringify({ mission: { name: "Old", date: "2026-11-01", start: "23:50", end: "04:45", phases: [{ name: "a", from: "23:50", to: "04:45" }] }, agents: [] }));
    const f = readFleet(file);
    assert.ok(Date.parse(f.mission.endAt) - Date.parse(f.mission.startAt) === (4 * 60 + 55) * 60_000);
    assert.equal(f.mission.phases[0].from, f.mission.startAt);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init generates one agent per member from the plan, and installs them as project agents for subagent launches", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    const p = normalizePlan({ ...plan(), launch: "subagent" }, { cwd: dir });
    p.agents.find((a) => a.id === "dev-api").specialty = "Auth and the member API";
    writeBoard(p);
    const { dir: agentsDir, installed, members } = writeAgents(p);
    assert.deepEqual(members, ["po", "dev-api", "test-api"]);
    const text = fs.readFileSync(path.join(agentsDir, "dev-api.md"), "utf8");
    assert.ok(
      text.startsWith(
        ["---", "name: fleet-night-team-dev-api", 'description: Developer of the "Night team" fleet — Auth and the member API. Use for member dev-api of this fleet.', "model: opus", "---"].join("\n"),
      ),
    );
    assert.match(text, /You are \*\*dev-api\*\*, the Developer/);
    assert.match(text, /- `apps\/api`/);
    assert.match(text, /effort high/);
    assert.equal(fs.readFileSync(path.join(installed, "fleet-night-team-test-api.md"), "utf8"), agentFileOf(p, p.agents.find((a) => a.id === "test-api")));
    assert.match(fs.readFileSync(path.join(installed, "fleet-night-team-test-api.md"), "utf8"), /model: sonnet/);
    assert.ok(!fs.existsSync(path.join(installed, "fleet-night-team-lead.md")), "the lead is this session, not an agent");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
