import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { briefOf, launchPlan, writeBoard } from "../scripts/lib/board-init.mjs";
import { argsOf, listHarnesses, profileProblems, readTurn, transcriptLines, valuesOf } from "../scripts/lib/harness.mjs";
import { send } from "../scripts/lib/inbox.mjs";
import { normalizePlan } from "../scripts/lib/plan.mjs";
import { reasonsOf, runMember, stampOf } from "../scripts/lib/runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const plan = (extra = {}, member = {}) => ({
  mission: { name: "Night team", goal: "Fix what the QA found", hours: 4 },
  repo: { dir: ".", base: "main" },
  agents: [
    { id: "lead", role: "lead" },
    { id: "po", role: "product-owner", reportsTo: "lead" },
    { id: "rev-x", role: "reviewer", reportsTo: "po", harness: "codex", ...member },
  ],
  ...extra,
});

test("profile arguments: values filled in, a group dropped whole when one of its values is empty", () => {
  const template = ["exec", ["--model", "{model}"], ["-c", "effort={effort}"], "--add-dir", "{boardDir}", "-"];
  assert.deepEqual(argsOf(template, { model: "gpt-x", effort: "high", boardDir: "/b" }), ["exec", "--model", "gpt-x", "-c", "effort=high", "--add-dir", "/b", "-"]);
  assert.deepEqual(argsOf(template, { model: "", effort: undefined, boardDir: "/b" }), ["exec", "--add-dir", "/b", "-"]);
  // Claude's aliases mean nothing to another CLI: they become its default; efforts go through the profile's map.
  assert.deepEqual(valuesOf({ efforts: { high: "hi" } }, { model: "opus", effort: "high" }), { model: "", effort: "hi" });
  assert.deepEqual(valuesOf({ model: "m1" }, { model: "", effort: "low" }), { model: "m1", effort: "low" });
});

test("profiles: the plugin's starting points are complete; a half-written one says what it lacks", () => {
  const shipped = listHarnesses(fs.mkdtempSync(path.join(os.tmpdir(), "fleet-")));
  assert.deepEqual(shipped.map((h) => h.id).sort(), ["codex", "copilot", "gemini"]);
  for (const h of shipped) assert.deepEqual(profileProblems(h.profile), [], h.id);
  const problems = profileProblems({ id: "x", command: "x", run: ["go"], resume: ["again"], sessionId: { key: "sid" }, output: "text" });
  assert.ok(problems.some((p) => p.includes("resume must name {sessionId}")));
  assert.ok(problems.some((p) => p.includes("needs output jsonl or json")));
  assert.ok(profileProblems({ id: "claude", command: "claude", run: [], resume: [] }).some((p) => p.includes("needs no profile")));
});

test("a turn's output: the session id from any depth, output tokens per turn or cumulative, the reply, the event types", () => {
  const out = [
    "banner line",
    JSON.stringify({ type: "thread.started", thread_id: "T-1" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }),
    JSON.stringify({ type: "turn.completed", usage: { output_tokens: 120 } }),
    JSON.stringify({ type: "turn.completed", usage: { output_tokens: 30 } }),
  ].join("\n");
  const profile = { output: "jsonl", sessionId: { key: "thread_id" }, usage: { match: { type: "turn.completed" }, output: "usage.output_tokens" }, reply: { match: { type: "item.completed", "item.type": "agent_message" }, text: "item.text" } };
  assert.deepEqual(readTurn(profile, out), { sessionId: "T-1", outputTokens: 150, reply: "done", types: ["thread.started", "item.completed", "turn.completed"], events: 4 });
  // A running total, read from the CLI's own session file: the last one counts.
  const file = [10, 25].map((n) => JSON.stringify({ type: "session.shutdown", data: { tokens: { output: n } } })).join("\n");
  const cumulative = { output: "jsonl", sessionId: "set", usage: { match: { type: "session.shutdown" }, output: "data.tokens.output", cumulative: true } };
  assert.equal(readTurn(cumulative, "", { usageText: file }).outputTokens, 25);
  // A turn is two transcript lines in Claude Code's shape, so the dashboard counts it.
  const [user, assistant] = transcriptLines({ turn: 3, at: "t0", end: "t1", prompt: "go", reply: "ok", outputTokens: 9, model: "m" });
  assert.equal(user.type, "user");
  assert.deepEqual(assistant.message.usage, { output_tokens: 9 });
  assert.equal(assistant.message.stop_reason, "end_turn");
});

test("plan: a member with a harness runs through its runner, with the profile copied into the fleet", () => {
  const p = normalizePlan(plan(), { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "fleet-")) });
  const rev = p.agents.find((a) => a.id === "rev-x");
  assert.equal(rev.launch, "runner");
  assert.equal(rev.model, "");
  assert.equal(p.harnesses.codex.command, "codex");
  assert.equal(p.agents.find((a) => a.id === "po").harness, "claude");
  assert.throws(() => normalizePlan(plan({}, { harness: "nope" })), /no profile for harness nope/);
  assert.throws(() => normalizePlan(plan({}, { launch: "session" })), /runs with launch runner, not session/);
  assert.throws(() => normalizePlan({ ...plan(), agents: [{ id: "lead", role: "lead", harness: "codex" }] }), /the lead is this session/);
});

test("brief: a member in another CLI reads skills as files, rings with fleet send, and ends its turn instead of waiting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    const fleet = normalizePlan(plan(), { cwd: dir });
    const { boardDir } = writeBoard(fleet);
    const text = briefOf(fleet, fleet.agents.find((a) => a.id === "rev-x"));
    assert.match(text, /You run in \*\*OpenAI Codex CLI\*\*, not Claude Code/);
    assert.match(text, /skills\/review-change\/SKILL\.md/);
    assert.match(text, /send rev-x <to>/);
    assert.match(text, /never wait or sleep in a loop/);
    assert.doesNotMatch(briefOf(fleet, fleet.agents.find((a) => a.id === "po")), /You run in/);
    assert.match(fs.readFileSync(path.join(boardDir, "README.md"), "utf8"), /\| rev-x \| .* \| OpenAI Codex CLI: default · /);
    assert.equal(launchPlan(fleet).find((e) => e.id === "rev-x").harness, "codex");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("wake: a new inbox message, a changed ticket, a thread or a channel mention is a reason; the member's own post is not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    const fleet = normalizePlan(plan(), { cwd: dir });
    const { boardDir } = writeBoard(fleet);
    const before = stampOf(fleet, "rev-x");
    assert.deepEqual(reasonsOf(before, stampOf(fleet, "rev-x")), []);
    send(boardDir, { from: "po", to: "rev-x", text: "review PO-001 please" });
    fs.writeFileSync(path.join(boardDir, "tickets", "PO-001.md"), "# PO-001: x\n\n- Status: integrated\n- Owner: dev\n- Verifier: rev-x\n");
    fs.writeFileSync(path.join(boardDir, "threads", "retry.md"), "# Retry?\n\n- Members: rev-x\n");
    fs.appendFileSync(path.join(boardDir, "CHANNEL.md"), "- 10:00 rev-x · fyi: @rev-x talking to myself\n- 10:01 po · ask: @rev-x a look at PO-001?\n");
    const reasons = reasonsOf(before, stampOf(fleet, "rev-x"));
    assert.equal(reasons.length, 4);
    assert.match(reasons.join("; "), /1 new message.*ticket PO-001.*threads\/retry\.md.*channel mentions you/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runner: starts with the brief, resumes the same session when woken, gives a last turn at the window's end, counts tokens", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    // A stand-in CLI: answers in JSON lines, records each call, and on its first turn gets a message from po.
    const fake = path.join(dir, "fake-cli.mjs");
    fs.writeFileSync(
      fake,
      `import fs from "node:fs";
const prompt = fs.readFileSync(0, "utf8");
const [mode, sid] = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(dir, "calls.jsonl"))}, JSON.stringify({ mode, sid, prompt: prompt.slice(0, 300) }) + "\\n");
if (mode === "start") fs.appendFileSync(${JSON.stringify(path.join(dir, ".fleet", "night-team", "board", "inbox", "rev-x.md"))}, "- #1 10:00 po: please review PO-001\\n");
console.log(JSON.stringify({ type: "init", session_id: "S-1" }));
console.log(JSON.stringify({ type: "msg", text: "turn " + mode }));
console.log(JSON.stringify({ type: "done", usage: { out: 5 } }));
`,
    );
    const profile = { id: "fake", title: "Fake CLI", command: process.execPath, prompt: "stdin", sessionId: { key: "session_id" }, run: [fake, "start"], resume: [fake, "resume", "{sessionId}"], output: "jsonl", usage: { match: { type: "done" }, output: "usage.out" }, reply: { match: { type: "msg" }, text: "text" } };
    const now = Date.now();
    const fleet = normalizePlan(plan({ harnesses: { fake: profile } }, { harness: "fake", worktree: false, window: { from: new Date(now).toISOString(), to: new Date(now + 2500).toISOString() } }), { cwd: dir });
    const { fleetFile, boardDir } = writeBoard(fleet);
    const state = await runMember(fleetFile, "rev-x", { pollMs: 50 });
    const calls = fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(calls.map((c) => c.mode), ["start", "resume", "resume"]);
    assert.match(calls[0].prompt, /^Fleet member: night-team\/rev-x/);
    assert.equal(calls[1].sid, "S-1");
    assert.match(calls[1].prompt, /1 new message\(s\) in your inbox[\s\S]*#1 10:00 po: please review PO-001/);
    assert.match(calls[2].prompt, /Your window has ended/);
    assert.equal(state.phase, "stopped");
    assert.equal(state.outputTokens, 15);
    const transcript = fs.readFileSync(path.join(dir, ".fleet", "night-team", "runner", "rev-x.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(transcript.filter((l) => l.type === "assistant").length, 3);
    assert.match(fs.readFileSync(path.join(boardDir, "ROSTER.md"), "utf8"), /\| rev-x \| .* \| S-1 \|/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
