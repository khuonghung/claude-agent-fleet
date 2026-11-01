import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { agentFileOf, briefOf, writeBoard } from "../scripts/lib/board-init.mjs";
import { contextState, normalizePlan } from "../scripts/lib/plan.mjs";
import { memberOfPrompt, memberOfSession, openTicketsOf, recordSession, resumeNote } from "../scripts/lib/sessions.mjs";
import { createTranscripts } from "../scripts/server/transcripts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "scripts", "fleet.mjs");
const line = (o) => `${JSON.stringify(o)}\n`;

const plan = (extra = {}) => ({
  mission: { name: "Night team", goal: "Fix what the QA found", hours: 4 },
  repo: { dir: ".", base: "main" },
  agents: [
    { id: "lead", role: "lead" },
    { id: "dev-api", role: "developer", reportsTo: "lead", owns: ["apps/api"] },
    { id: "test-api", role: "tester", reportsTo: "lead" },
  ],
  ...extra,
});

/** A fleet written to a temporary project, with fleet.json and `current` as `fleet init` leaves them. */
function fleetIn(dir, extra) {
  const p = normalizePlan(plan(extra), { cwd: dir });
  const { boardDir } = writeBoard(p);
  const fleetDir = path.dirname(boardDir);
  fs.writeFileSync(path.join(fleetDir, "fleet.json"), JSON.stringify(p));
  fs.writeFileSync(path.join(dir, ".fleet", "current"), `${p.mission.slug}\n`);
  return { p, boardDir, fleetDir };
}

test("context: kept under 100k tokens by default, 100k to 1M or 0 to turn it off; idle desktop members past it are the ones to clear", () => {
  assert.deepEqual(normalizePlan(plan(), { cwd: "/repo" }).context, { compactAt: 100_000 });
  assert.equal(normalizePlan(plan({ context: { compactAt: 0 } }), { cwd: "/repo" }).context.compactAt, 0);
  assert.throws(() => normalizePlan(plan({ context: { compactAt: 50_000 } }), { cwd: "/repo" }), /from 100000 to 1000000, or 0/);

  const fleet = { context: { compactAt: 100_000 }, agents: [{ id: "lead", launch: "self" }, { id: "a", launch: "session" }, { id: "b", launch: "session" }, { id: "c", launch: "session" }, { id: "d", launch: "subagent" }] };
  const telemetry = { lead: { contextTokens: 400_000, phase: "replied" }, a: { contextTokens: 140_000, phase: "replied" }, b: { contextTokens: 140_000, phase: "tool" }, c: { contextTokens: 60_000, phase: "replied" }, d: { contextTokens: 140_000, phase: "replied" } };
  const state = contextState(fleet, telemetry, { inProgress: { a: ["DA-001"] } });
  assert.deepEqual(state.clear, ["a"], "only an idle desktop member over the limit: not the lead, not one mid-turn, not a subagent (it compacts itself)");
  assert.deepEqual(state.members.find((m) => m.id === "a"), { id: "a", launch: "session", tokens: 140_000, idle: true, inProgress: ["DA-001"] });
  assert.deepEqual(contextState({ ...fleet, context: { compactAt: 0 } }, telemetry).clear, []);
});

test("context: briefs carry the member's marker, agents their compact window, and the protocol says the board is the memory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-ctx-"));
  try {
    const { p, boardDir } = fleetIn(dir);
    const dev = p.agents.find((a) => a.id === "dev-api");
    assert.ok(briefOf(p, dev).startsWith("Fleet member: night-team/dev-api\n"));
    assert.deepEqual(memberOfPrompt(`Fleet "Night team": start\n\n${briefOf(p, dev)}`), { slug: "night-team", id: "dev-api" });
    assert.equal(memberOfPrompt("see `Fleet member: night-team/dev-api` in the brief"), undefined, "a mention inside a line is not a marker");
    assert.match(agentFileOf(p, dev), /^autoCompactWindow: 100000$/m);
    assert.match(agentFileOf(p, dev), /it is compacted or cleared between tickets to save tokens/);
    assert.match(fs.readFileSync(path.join(boardDir, "README.md"), "utf8"), /8\. The board is your memory, not your context\. .* under 100k tokens/);

    const off = normalizePlan(plan({ context: { compactAt: 0 } }), { cwd: dir });
    assert.doesNotMatch(agentFileOf(off, off.agents[1]), /autoCompactWindow/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("context: the resume note names the member's open tickets, the one in progress first; fleet resume prints it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-ctx-"));
  try {
    const { p, boardDir, fleetDir } = fleetIn(dir);
    const ticket = (id, fields) => fs.writeFileSync(path.join(boardDir, "tickets", `${id}.md`), `# ${id}: x\n\n${Object.entries(fields).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`);
    ticket("DA-001", { Status: "fixed", Owner: "dev-api" });
    ticket("DA-002", { Status: "In progress", Owner: "dev-api" });
    ticket("DA-003", { Status: "verified", Owner: "dev-api" });
    ticket("TA-001", { Status: "integrated", Owner: "test-api", Verifier: "dev-api" });
    ticket("TA-002", { Status: "assigned", Owner: "dev-api-2" });
    assert.deepEqual(openTicketsOf(boardDir, "dev-api"), [
      { id: "DA-001", status: "fixed", part: "owner" },
      { id: "DA-002", status: "in-progress", part: "owner" },
      { id: "TA-001", status: "integrated", part: "verifier" },
    ]);
    const note = resumeNote(p, "dev-api");
    assert.ok(note.startsWith("Fleet member: night-team/dev-api\n"));
    assert.match(note, /Your context was cleared to save tokens/);
    assert.match(note, /DA-002 \(in-progress, owner\), DA-001 \(fixed, owner\), TA-001 \(integrated, verifier\)\. Pick the one in progress back up/);
    assert.match(note, /briefs\/dev-api\.md/);
    const run = spawnSync(process.execPath, [cli, "resume", "dev-api", "--fleet", fleetDir], { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, `${note}\n`);
    assert.notEqual(spawnSync(process.execPath, [cli, "resume", "nobody", "--fleet", fleetDir], { cwd: dir, encoding: "utf8" }).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hook: a prompt with a member's marker records its session; after a compaction that member gets its resume note", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-ctx-"));
  try {
    const { p, fleetDir } = fleetIn(dir);
    const hook = path.join(root, "hooks", "fleet-context.mjs");
    const run = (mode, input) => spawnSync(process.execPath, [hook, mode], { input: JSON.stringify(input), encoding: "utf8" });
    const worktree = path.join(dir, ".claude", "worktrees", "dev-api");
    fs.mkdirSync(worktree, { recursive: true });
    assert.equal(run("prompt", { cwd: worktree, session_id: "s-1", transcript_path: "/t/s-1.jsonl", prompt: briefOf(p, p.agents[1]) }).status, 0);
    assert.equal(run("prompt", { cwd: worktree, session_id: "s-2", transcript_path: "/t/s-2.jsonl", prompt: resumeNote(p, "dev-api") }).status, 0);
    assert.equal(run("prompt", { cwd: worktree, session_id: "s-3", prompt: "Fleet member: other-fleet/dev-api" }).status, 0);
    assert.equal(memberOfSession(p, fleetDir, "s-2"), "dev-api");
    assert.equal(memberOfSession(p, fleetDir, "s-3"), undefined, "a marker of a fleet that is not here records nothing");
    const records = fs.readFileSync(path.join(fleetDir, "sessions", "dev-api.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(records.map((r) => r.transcriptPath), ["/t/s-1.jsonl", "/t/s-2.jsonl"]);

    const compacted = run("session-start", { cwd: worktree, session_id: "s-2", source: "compact" }).stdout;
    assert.ok(compacted.startsWith("Fleet member: night-team/dev-api\n"), compacted);
    assert.match(compacted, /Your context was compacted to save tokens/);
    assert.match(run("session-start", { cwd: worktree, session_id: "s-2", source: "startup" }).stdout, /Agent fleet "Night team" is active/);
    assert.match(run("session-start", { cwd: worktree, session_id: "s-9", source: "compact" }).stdout, /Agent fleet "Night team" is active/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("transcripts: a member cleared to save tokens is followed into its new transcript, and its tokens are summed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-ctx-"));
  try {
    const project = path.join(dir, "C--repo");
    fs.mkdirSync(project, { recursive: true });
    const at = (min) => new Date(Date.now() - min * 60_000).toISOString();
    const before = path.join(project, "s-1.jsonl");
    const after = path.join(project, "s-2.jsonl");
    fs.writeFileSync(
      before,
      line({ type: "custom-title", customTitle: "NT · dev-api" }) +
        line({ type: "assistant", timestamp: at(30), message: { id: "m1", model: "claude-opus-5-5", usage: { output_tokens: 900, input_tokens: 10, cache_read_input_tokens: 150_000 }, content: [{ type: "text", text: "DA-001 fixed" }], stop_reason: "end_turn" } }),
    );
    fs.utimesSync(before, new Date(Date.now() - 20 * 60_000), new Date(Date.now() - 20 * 60_000));
    // The cleared session's new transcript has no title: only the hook's record ties it to the member.
    fs.writeFileSync(after, line({ type: "assistant", timestamp: at(1), message: { id: "m2", model: "claude-opus-5-5", usage: { output_tokens: 100, input_tokens: 8_000 }, content: [{ type: "tool_use", name: "Read", input: { file_path: "/repo/x.ts" } }] } }));
    const fleetDir = path.join(dir, "fleet");
    const cfg = { mission: { startAt: at(60) }, transcripts: { root: dir, dirPrefix: "C--repo" }, agents: [{ id: "dev-api", match: { title: "NT · dev-api" } }] };

    const tx = createTranscripts(cfg, { sessionNames: (id) => id, fleetDir });
    await tx.discover();
    await tx.poll();
    assert.equal(tx.snapshot()["dev-api"].outputTokens, 900, "before the record, only the titled transcript");
    recordSession(fleetDir, "dev-api", { sessionId: "s-2", transcriptPath: after });
    await tx.discover();
    await tx.poll();
    const s = tx.snapshot()["dev-api"];
    assert.equal(s.outputTokens, 1000, "both transcripts count toward the budget");
    assert.equal(s.contextTokens, 8_000, "the context is the new transcript's");
    assert.equal(s.phase, "tool");
    assert.equal(s.sessionId, "s-2");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fleet status reports each member's context and the idle ones to clear", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-ctx-"));
  try {
    const { fleetDir, boardDir } = fleetIn(dir);
    fs.writeFileSync(path.join(boardDir, "tickets", "DA-001.md"), "# DA-001: x\n\n- Status: in-progress\n- Owner: dev-api\n");
    const run = spawnSync(process.execPath, [cli, "status", "--json", "--fleet", fleetDir], { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const { context } = JSON.parse(run.stdout);
    assert.equal(context.compactAt, 100_000);
    assert.deepEqual(context.clear, []);
    assert.deepEqual(context.members.find((m) => m.id === "dev-api").inProgress, ["DA-001"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
