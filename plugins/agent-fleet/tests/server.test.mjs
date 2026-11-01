import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { clockToIso, normStatus, readBoard } from "../scripts/server/board.mjs";
import { createTranscripts, redactHome } from "../scripts/server/transcripts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const line = (o) => `${JSON.stringify(o)}\n`;

test("transcripts: a desktop session by its title and a subagent by its description, both read whole", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-tx-"));
  try {
    const project = path.join(dir, "C--repo");
    fs.mkdirSync(path.join(project, "lead-session", "subagents"), { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(project, "sess-po.jsonl"),
      line({ type: "custom-title", customTitle: "NT · po" }) +
        line({ type: "assistant", timestamp: now, message: { model: "claude-opus-5-5", usage: { output_tokens: 40, input_tokens: 10 }, content: [{ type: "tool_use", name: "Read", input: { file_path: "/repo/README.md" } }] } }),
    );
    fs.writeFileSync(
      path.join(project, "lead-session", "subagents", "agent-1.jsonl"),
      line({ type: "user", timestamp: now, message: { content: "You are dev-api" } }) +
        line({ type: "assistant", timestamp: now, message: { model: "claude-sonnet-5-5", usage: { output_tokens: 7 }, content: [{ type: "text", text: "Starting on DA-001" }], stop_reason: "end_turn" } }),
    );
    fs.writeFileSync(path.join(project, "lead-session", "subagents", "agent-1.meta.json"), JSON.stringify({ agentType: "agent-fleet:developer", description: "night-team/dev-api" }));
    const cfg = {
      mission: { startAt: new Date(Date.now() - 3600_000).toISOString() },
      transcripts: { root: dir, dirPrefix: "C--repo" },
      agents: [
        { id: "po", match: { title: "NT · po" } },
        { id: "dev-api", match: { title: "NT · dev-api", description: "night-team/dev-api" } },
      ],
    };
    const tx = createTranscripts(cfg, { sessionNames: (id) => id });
    await tx.discover();
    assert.equal(await tx.poll(), true);
    const snap = tx.snapshot();
    assert.equal(snap.po.kind, "session");
    assert.equal(snap.po.pendingTool.name, "Read");
    assert.equal(snap.po.model, "claude-opus-5-5");
    assert.equal(snap["dev-api"].kind, "subagent");
    assert.equal(snap["dev-api"].lastText, "Starting on DA-001");
    assert.equal(snap["dev-api"].phase, "replied");
    assert.equal(snap["dev-api"].prompts, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("transcripts: with privacy.readText false, no words of the agents are kept", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-tx-"));
  try {
    const project = path.join(dir, "C--repo");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, "s.jsonl"),
      line({ type: "custom-title", customTitle: "NT · po" }) + line({ type: "assistant", timestamp: new Date().toISOString(), message: { content: [{ type: "text", text: "secret plan" }], stop_reason: "end_turn" } }),
    );
    const tx = createTranscripts({ mission: { startAt: new Date().toISOString() }, privacy: { readText: false }, transcripts: { root: dir, dirPrefix: "C--repo" }, agents: [{ id: "po", match: { title: "NT · po" } }] }, { sessionNames: (id) => id });
    await tx.discover();
    await tx.poll();
    assert.equal(tx.snapshot().po.lastText, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("board: tickets, log times on the mission's clock, done and verified times", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-board-"));
  try {
    fs.mkdirSync(path.join(dir, "tickets"));
    fs.writeFileSync(
      path.join(dir, "tickets", "DA-001.md"),
      "# DA-001: Login fails\n\n- Status: verified\n- Severity: high\n- Owner: dev-api\n- Verifier: test-api\n- Fix:\n\n## Log\n- 23:55 test-api: created\n- 00:40 dev-api: fixed in abc\n- 01:10 test-api: verified on def\n",
    );
    const startAt = new Date(2026, 9, 31, 23, 50).toISOString();
    const board = await readBoard({ board: { dir }, mission: { startAt } });
    const [t] = board.tickets;
    assert.equal(t.status, "verified");
    assert.equal(t.fix, "");
    assert.equal(t.log.length, 3);
    assert.equal(t.log[1].at, new Date(2026, 10, 1, 0, 40).toISOString());
    assert.equal(t.doneAt, t.log[1].at);
    assert.equal(t.verifiedAt, t.log[2].at);
    assert.equal(clockToIso(startAt, "23:59"), new Date(2026, 9, 31, 23, 59).toISOString());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hook: the prompt that plans a fleet records its lead; a member session gets the board's path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-hook-"));
  try {
    const hook = path.join(root, "hooks", "fleet-context.mjs");
    const run = (mode, input) => spawnSync(process.execPath, [hook, mode], { input: JSON.stringify(input), encoding: "utf8" });
    assert.equal(run("prompt", { cwd: dir, prompt: "/agent-fleet:new fix the login", session_id: "s-9", transcript_path: "/t/s-9.jsonl" }).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".fleet", "lead.json"), "utf8")).sessionId, "s-9");
    assert.equal(run("prompt", { cwd: dir, prompt: "hello" }).stdout, "");
    fs.mkdirSync(path.join(dir, ".fleet", "nt"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".fleet", "current"), "nt\n");
    fs.writeFileSync(path.join(dir, ".fleet", "nt", "fleet.json"), JSON.stringify({ mission: { name: "NT", goal: "g", endAt: new Date(Date.now() + 3600_000).toISOString() }, board: { dir: "/b" } }));
    const worktree = path.join(dir, ".claude", "worktrees", "x");
    fs.mkdirSync(worktree, { recursive: true });
    const out = run("session-start", { cwd: worktree }).stdout;
    assert.match(out, /Agent fleet "NT" is active/);
    assert.match(out, /\/b\/README\.md/);
    assert.equal(run("session-start", { cwd: os.tmpdir() }).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("transcripts: the user's home folder shows as ~ in every spelling, and only as a whole folder", () => {
  const home = os.homedir();
  const forward = home.replaceAll("\\", "/");
  assert.equal(redactHome(`cd ${forward}/Workspace/app`), "cd ~/Workspace/app");
  assert.equal(redactHome(`${home}${path.sep}notes.md`), `~${path.sep}notes.md`);
  assert.equal(redactHome(`open "${forward}"`), 'open "~"');
  assert.equal(redactHome(`${forward}x/other`), `${forward}x/other`);
  assert.equal(redactHome("no path here"), "no path here");
  if (/^[A-Za-z]:/.test(forward)) assert.equal(redactHome(`${forward.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`)}/AppData`), "~/AppData");
});

test("transcripts: Claude Code's dashed transcript-folder spelling of the home folder is redacted too", () => {
  const dashed = os.homedir().replace(/[^A-Za-z0-9]/g, "-");
  assert.equal(redactHome(`projects/${dashed}-Workspace-app/abc.jsonl`), "projects/~-Workspace-app/abc.jsonl");
});

test("server: the dashboard re-reads fleet.json when it changes, and keeps the last good one while it does not parse", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-srv-"));
  const port = await new Promise((done) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port: p } = probe.address();
      probe.close(() => done(p));
    });
  });
  const fleetFile = path.join(dir, "fleet.json");
  const fleet = {
    mission: { name: "Night team", slug: "night-team", goal: "g", startAt: new Date(Date.now() - 3600_000).toISOString(), endAt: new Date(Date.now() + 3600_000).toISOString() },
    repo: { dir, base: "main" },
    board: { dir: path.join(dir, "board"), flow: ["new", "fixed"] },
    transcripts: { root: path.join(dir, "projects"), dirPrefix: "none" },
    squads: [{ id: "build" }],
    agents: [{ id: "lead", squad: "build", match: { title: "NT · lead" } }],
  };
  fs.mkdirSync(path.join(dir, "board", "tickets"), { recursive: true });
  fs.writeFileSync(fleetFile, JSON.stringify(fleet));
  const server = spawn(process.execPath, [path.join(root, "scripts", "server", "index.mjs"), fleetFile], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const state = async () => (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const until = async (check) => {
    for (let i = 0; i < 80; i++) {
      try {
        const s = await state();
        if (check(s)) return s;
      } catch {
        // Not listening yet.
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("timed out");
  };
  try {
    await until((s) => s.agents?.length === 1);
    fs.writeFileSync(fleetFile, "{ half written");
    await new Promise((r) => setTimeout(r, 2000));
    assert.deepEqual((await state()).agents.map((a) => a.id), ["lead"]);
    fleet.mission.name = "Night team 2";
    fleet.agents.push({ id: "dev-api", squad: "build", match: { title: "NT · dev-api" } });
    fs.writeFileSync(fleetFile, JSON.stringify(fleet));
    const s = await until((x) => x.agents.length === 2);
    assert.equal(s.mission.name, "Night team 2");
    assert.ok(!("match" in s.agents[1]), "how members are matched stays on the server");
    assert.ok("dev-api" in s.telemetry);
  } finally {
    server.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("board: only the status word counts, whatever follows it", () => {
  const cases = {
    "duplicate → N-019": "duplicate",
    "duplicate of N-017": "duplicate",
    "Fixed — dev-api @ 7f3a2540": "fixed",
    "`verified`": "verified",
    "**integrated**": "integrated",
    "In progress": "in-progress",
    "in_progress": "in-progress",
    "inprogress": "in-progress",
    "in-progress (dev-api)": "in-progress",
    "won't fix": "wont-fix",
    "Won't-fix": "wont-fix",
    "deferred to next sweep": "deferred",
    "on hold": "on-hold",
    done: "fixed",
    "": "new",
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(normStatus(raw), want, raw);
});
