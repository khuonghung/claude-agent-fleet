import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
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

test("a member in a worktree gets the board's absolute paths and records its row from outside the main checkout", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-wt-"));
  try {
    const p = normalizePlan(plan(), { cwd: dir });
    const { boardDir } = writeBoard(p);
    const board = boardDir.replaceAll("\\", "/");
    const fleetDir = path.dirname(boardDir).replaceAll("\\", "/");
    const protocol = fs.readFileSync(path.join(boardDir, "README.md"), "utf8");
    assert.match(protocol, /## Writing to the board from a worktree/);
    assert.ok(protocol.includes(`grep -l <your id> ${board}/threads/*.md`));
    assert.ok(protocol.includes(`roster <your id> worktree="$(git rev-parse --show-toplevel)" branch="$(git branch --show-current)" --fleet "${fleetDir}"`));
    const dev = p.agents.find((a) => a.id === "dev-api");
    assert.ok(briefOf(p, dev).includes(`roster dev-api worktree=`));
    assert.ok(agentFileOf(p, dev).includes(`read and write it only at \`${board}\``));
    // The worktree has no .fleet above it: `--fleet` (after the pairs, as the protocol writes it) finds the board.
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "fleet.mjs");
    const run = spawnSync(process.execPath, [cli, "roster", "dev-api", `worktree=${worktree}`, "branch=night-team-dev-api", "--fleet", fleetDir], { cwd: worktree, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const row = fs.readFileSync(path.join(boardDir, "ROSTER.md"), "utf8").split("\n").find((l) => l.startsWith("| dev-api "));
    assert.ok(row.includes(` ${worktree} | night-team-dev-api |`), row);
    assert.ok(!fs.existsSync(path.join(worktree, ".fleet")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test("statuses: every member is told to set in-progress when they start, and fleet status reads it as the dashboard does", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    const p = normalizePlan(plan(), { cwd: dir });
    const { boardDir } = writeBoard(p);
    const protocol = fs.readFileSync(path.join(boardDir, "README.md"), "utf8");
    assert.match(protocol, /\| `in-progress` \| the owner \| they start the ticket/);
    assert.match(protocol, /never skip a status/);
    for (const status of [...p.board.flow, ...p.board.parked, ...p.board.attention]) assert.ok(protocol.includes(`\n| \`${status}\` |`), `the protocol says who sets ${status}`);
    assert.match(protocol, /holds the status word and nothing else/);
    assert.match(protocol, /date \+%H:%M/);
    const dev = p.agents.find((a) => a.id === "dev-api");
    assert.match(agentFileOf(p, dev), /never jump from `assigned` to `fixed`/);
    assert.match(agentFileOf(p, dev), /set the ticket to `in-progress` with a Log line when you start it/);
    assert.match(briefOf(p, dev), /`in-progress` when you start it/);
    for (const [id, status] of [["DA-001", "In progress"], ["DA-002", "in_progress"], ["DA-003", "assigned"]]) fs.writeFileSync(path.join(boardDir, "tickets", `${id}.md`), `# ${id}: x\n\n- Status: ${status}\n`);
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "fleet.mjs");
    const run = spawnSync(process.execPath, [cli, "status", "--json", "--fleet", path.dirname(boardDir)], { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout).statuses, { "in-progress": 2, assigned: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a Windows checkout (CRLF templates and skills) still writes LF agents, briefs and protocol", async () => {
  const pluginRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-crlf-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    // The plugin as core.autocrlf checks it out: every text file with CRLF line ends.
    for (const sub of ["scripts", "assets", "skills"]) fs.cpSync(path.join(pluginRoot, sub), path.join(copy, sub), { recursive: true });
    for (const file of fs.readdirSync(copy, { recursive: true }).map((f) => path.join(copy, f))) {
      if (/\.(md|mjs|json)$/.test(file)) fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\r?\n/g, "\r\n"));
    }
    const { normalizePlan: normalize } = await import(pathToFileURL(path.join(copy, "scripts", "lib", "plan.mjs")).href);
    const { agentFileOf: agentOf, briefOf: briefFor, writeBoard: write } = await import(pathToFileURL(path.join(copy, "scripts", "lib", "board-init.mjs")).href);
    const p = normalize(plan(), { cwd: dir });
    const dev = p.agents.find((a) => a.id === "dev-api");
    const agent = agentOf(p, dev);
    assert.ok(agent.startsWith("---\nname: fleet-night-team-dev-api\n"), JSON.stringify(agent.slice(0, 60)));
    assert.ok(!agent.includes("\r"), "the agent file has no CR");
    assert.ok(!briefFor(p, dev).includes("\r"), "the brief has no CR");
    const { boardDir } = write(p);
    assert.ok(!fs.readFileSync(path.join(boardDir, "README.md"), "utf8").includes("\r"), "the protocol has no CR");
    const help = spawnSync(process.execPath, [path.join(copy, "scripts", "fleet.mjs")], { encoding: "utf8" });
    assert.match(help.stdout, /^ +fleet catalog +the roles/m);
    assert.ok(!help.stdout.includes("\r"), "the help has no CR");
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("team channel: init creates it, the protocol and briefs explain it, and fleet say appends one clock-timed line per post", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    const p = normalizePlan(plan(), { cwd: dir });
    const { boardDir } = writeBoard(p);
    const fleetDir = path.dirname(boardDir);
    const channel = path.join(boardDir, "CHANNEL.md");
    assert.match(fs.readFileSync(channel, "utf8"), /^# Team channel\n/);
    const protocol = fs.readFileSync(path.join(boardDir, "README.md"), "utf8");
    assert.match(protocol, /## Team channel/);
    assert.ok(protocol.includes(`say <your id> fyi '<one line>' --fleet "${fleetDir.replaceAll("\\", "/")}"`));
    assert.match(protocol, /\| `CHANNEL.md` \| every member and the owner/);
    const dev = p.agents.find((a) => a.id === "dev-api");
    assert.ok(briefOf(p, dev).includes("say dev-api fyi '<one line>'"));
    assert.ok(agentFileOf(p, dev).includes(`tail -n 30 ${boardDir.replaceAll("\\", "/")}/CHANNEL.md`));

    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "fleet.mjs");
    const say = (...words) => spawnSync(process.execPath, [cli, "say", ...words, "--fleet", fleetDir], { cwd: dir, encoding: "utf8" });
    const before = new Date();
    const ok = say("dev-api", "heads-up", "touching src/contracts/items.ts\nuntil   12:30");
    assert.equal(ok.status, 0, ok.stderr);
    const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const line = fs.readFileSync(channel, "utf8").trimEnd().split("\n").at(-1);
    assert.ok([hhmm(before), hhmm(new Date())].some((t) => line === `- ${t} dev-api · heads-up: touching src/contracts/items.ts until 12:30`), line);
    assert.equal(say("owner", "fyi", "the owner can post too").status, 0);
    assert.notEqual(say("dev-api", "shout", "x").status, 0, "an unknown kind is refused");
    assert.notEqual(say("stranger", "fyi", "x").status, 0, "someone outside the fleet is refused");
    assert.notEqual(say("dev-api", "fyi", "   ").status, 0, "an empty post is refused");

    // Eight members posting at the same moment: every post lands, none is torn or lost.
    const runs = Array.from({ length: 8 }, (_, i) => new Promise((done) => spawn(process.execPath, [cli, "say", "test-api", "fyi", `post ${i}`, "--fleet", fleetDir], { cwd: dir }).on("exit", done)));
    await Promise.all(runs);
    const posts = fs.readFileSync(channel, "utf8").split("\n").filter((l) => / test-api · fyi: post \d$/.test(l));
    assert.deepEqual(posts.map((l) => l.at(-1)).sort(), ["0", "1", "2", "3", "4", "5", "6", "7"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fleet dashboard prints its URL on a line of its own, says when it was already running, and keeps --json", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "fleet.mjs");
  const port = await new Promise((done) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port: p } = probe.address();
      probe.close(() => done(p));
    });
  });
  const run = (...extra) => spawnSync(process.execPath, [cli, "dashboard", "--port", String(port), "--fleet", path.join(dir, ".fleet", "night-team"), ...extra], { cwd: dir, encoding: "utf8", timeout: 20_000 });
  try {
    writeBoard(normalizePlan(plan(), { cwd: dir }));
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.ok(first.stdout.split("\n").includes(`  http://localhost:${port}`), first.stdout);
    assert.match(first.stdout, /^Started \(pid \d+\)\.$/m);
    const again = run();
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /^It was already running\.$/m);
    assert.ok(again.stdout.includes(`  http://localhost:${port}\n`));
    const json = run("--json");
    assert.equal(json.status, 0, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout), { url: `http://localhost:${port}`, port, running: true, reused: true });
  } finally {
    spawnSync(process.execPath, [cli, "stop", "--fleet", path.join(dir, ".fleet", "night-team")], { cwd: dir });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
