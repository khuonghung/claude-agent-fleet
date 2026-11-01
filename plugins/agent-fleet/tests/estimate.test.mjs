import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { agentFileOf } from "../scripts/lib/board-init.mjs";
import { estimateFleet, familyOf, memberEstimate, rates } from "../scripts/lib/estimate.mjs";
import { budgetState, catalog, normalizePlan, skills } from "../scripts/lib/plan.mjs";
import { createTranscripts } from "../scripts/server/transcripts.mjs";

const line = (o) => `${JSON.stringify(o)}\n`;
const fleet = (agents, hours = 2) =>
  normalizePlan({ mission: { name: "Estimate", goal: "Check the numbers", hours }, repo: { dir: ".", base: "main" }, agents }, { cwd: "/repo", now: new Date("2026-11-01T00:00:00Z") });

test("a member's estimate: its model's measured rate for its squad, scaled by effort and the active share of its window", () => {
  const f = fleet([
    { id: "lead", role: "lead" },
    { id: "dev-api", role: "developer", reportsTo: "lead", model: "opus", effort: "high" },
    { id: "dev-web", role: "developer", reportsTo: "lead", model: "opus", effort: "medium" },
  ]);
  const high = memberEstimate(f, f.agents[1]);
  assert.equal(high.perHour, rates.perActiveHour.opus.build);
  assert.equal(high.expected, Math.round(rates.perActiveHour.opus.build * 2 * rates.activeShare.build));
  const medium = memberEstimate(f, f.agents[2]);
  assert.ok(medium.expected < high.expected, "a lower effort writes less");
  assert.equal(medium.low, Math.round(medium.expected * (1 - rates.spread)));
});

test("the fleet total sums its members and the budget rounds the top of the range up to 100k", () => {
  const f = fleet([
    { id: "lead", role: "lead" },
    { id: "po", role: "product-owner", reportsTo: "lead", model: "sonnet", effort: "medium" },
    { id: "test-api", role: "tester", reportsTo: "po", model: "haiku", effort: "low" },
  ]);
  const e = estimateFleet(f);
  assert.equal(e.total.expected, e.members.reduce((n, m) => n + m.expected, 0));
  assert.equal(e.suggestedBudget % 100_000, 0);
  assert.ok(e.suggestedBudget >= e.total.high && e.suggestedBudget - e.total.high < 100_000);
  assert.deepEqual(e.members.map((m) => m.family), ["opus", "sonnet", "haiku"]);
});

test("a token limit: none, or a positive amount with what happens at it (warn by default, a warning at 80%)", () => {
  const withBudget = (budget) => normalizePlan({ mission: { name: "x", goal: "y", hours: 1 }, repo: { dir: ".", base: "main" }, budget, agents: [{ id: "lead", role: "lead" }] }, { cwd: "/repo" });
  assert.deepEqual(withBudget(undefined).budget, {});
  assert.deepEqual(withBudget({ outputTokens: 1_000_000 }).budget, { outputTokens: 1_000_000, onLimit: "warn", warnAt: 0.8 });
  assert.equal(withBudget({ outputTokens: 500_000, onLimit: "stop" }).budget.onLimit, "stop");
  assert.throws(() => withBudget({ outputTokens: 500_000, onLimit: "panic" }), /onLimit must be one of warn, wrap-up, stop/);
  assert.throws(() => withBudget({ outputTokens: -5 }), /positive number/);
  assert.throws(() => withBudget({ onLimit: "stop" }), /needs budget.outputTokens/);

  const budget = { outputTokens: 1000, onLimit: "wrap-up", warnAt: 0.8 };
  assert.equal(budgetState({}, 5000).state, "none");
  assert.equal(budgetState(budget, 500).state, "ok");
  assert.equal(budgetState(budget, 800).state, "near");
  assert.deepEqual(budgetState(budget, 1200), { state: "over", used: 1200, limit: 1000, share: 1.2, onLimit: "wrap-up" });
});

test("model families: ids and aliases; inherit counts as the strongest", () => {
  assert.equal(familyOf("claude-sonnet-5-5"), "sonnet");
  assert.equal(familyOf("haiku"), "haiku");
  assert.equal(familyOf("inherit"), "opus");
});

test("every role's skills exist, and a member's agent file lists them", () => {
  for (const [name, role] of Object.entries(catalog.roles)) for (const s of role.skills) assert.ok(s in skills, `${name}: ${s}`);
  for (const [name, description] of Object.entries(skills)) assert.match(description, /Use /, `${name} says when to use it`);
  const f = fleet([
    { id: "lead", role: "lead" },
    { id: "qa", role: "tester", reportsTo: "lead" },
  ]);
  const text = agentFileOf(f, f.agents[1]);
  for (const s of catalog.roles.tester.skills) assert.ok(text.includes(`agent-fleet:${s}`), s);
  const bad = normalizePlan.bind(null, { mission: { name: "x", goal: "y", hours: 1 }, repo: { dir: ".", base: "main" }, agents: [{ id: "lead", role: "lead", skills: ["mind-reading"] }] }, { cwd: "/repo" });
  assert.throws(bad, /skill mind-reading/);
});

test("transcripts: a message written as several lines with the same id counts its output tokens once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-dedupe-"));
  try {
    const project = path.join(dir, "C--repo");
    fs.mkdirSync(project, { recursive: true });
    const now = new Date().toISOString();
    const part = (id, output, content) => line({ type: "assistant", timestamp: now, message: { id, model: "claude-opus-5-5", usage: { output_tokens: output, input_tokens: 5 }, content: [content] } });
    // Claude Code writes one line per content block, each repeating the message's usage so far.
    fs.writeFileSync(
      path.join(project, "sess.jsonl"),
      line({ type: "custom-title", customTitle: "E · po" }) +
        part("msg-1", 30, { type: "text", text: "Looking" }) +
        part("msg-1", 120, { type: "tool_use", name: "Read", input: { file_path: "/a" } }) +
        part("msg-1", 120, { type: "tool_use", name: "Read", input: { file_path: "/b" } }) +
        part("msg-2", 50, { type: "text", text: "Done" }),
    );
    const cfg = { mission: { startAt: new Date(Date.now() - 3600_000).toISOString() }, transcripts: { root: dir, dirPrefix: "C--repo" }, agents: [{ id: "po", match: { title: "E · po" } }] };
    const tx = createTranscripts(cfg, { sessionNames: (id) => id });
    await tx.discover();
    await tx.poll();
    const po = tx.snapshot().po;
    assert.equal(po.outputTokens, 170);
    assert.equal(po.messages, 2);
    assert.equal(po.toolCalls, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
