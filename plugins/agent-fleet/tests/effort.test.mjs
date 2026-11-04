import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { writeBoard } from "../scripts/lib/board-init.mjs";
import { autoModel, currentEfforts, effortState, recordEffort, ticketEffort } from "../scripts/lib/effort.mjs";
import { normalizePlan } from "../scripts/lib/plan.mjs";

const cli = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "scripts", "fleet.mjs");
const ticket = (fields) => `# T-1: x\n\n${Object.entries(fields).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n## Log\n`;

test("ticket effort: an Effort field wins, else the severity moves the planned effort, at most one step up", () => {
  assert.deepEqual(ticketEffort(ticket({ Severity: "critical" }), "high"), { effort: "xhigh", why: "severity critical" });
  assert.equal(ticketEffort(ticket({ Severity: "high" }), "high").effort, "high");
  assert.equal(ticketEffort(ticket({ Severity: "medium" }), "high").effort, "medium");
  assert.equal(ticketEffort(ticket({ Severity: "low" }), "high").effort, "low");
  assert.equal(ticketEffort(ticket({ Severity: "low" }), "medium").effort, "low", "never below low");
  assert.equal(ticketEffort(ticket({ Severity: "critical" }), "max").effort, "max", "never above max");
  assert.equal(ticketEffort(ticket({ Severity: "" }), "high").effort, "high", "no severity: the planned effort");
  assert.deepEqual(ticketEffort(ticket({ Severity: "critical", Effort: "low" }), "high"), { effort: "low", why: "Effort: low" });
  assert.match(ticketEffort(ticket({ Effort: "max" }), "medium").why, /capped at high/);
});

test("auto model: the role's model, Opus for xhigh and max, the lead keeps inherit; a plan resolves auto", () => {
  assert.equal(autoModel("sonnet", "medium"), "sonnet");
  assert.equal(autoModel("sonnet", "xhigh"), "opus");
  assert.equal(autoModel("inherit", "max"), "inherit");
  assert.equal(autoModel(undefined, "low"), "haiku");
  const plan = normalizePlan({
    mission: { name: "N", goal: "g", hours: 2 },
    agents: [
      { id: "lead", role: "lead" },
      { id: "dev", role: "developer", reportsTo: "lead", model: "auto", effort: "auto" },
      { id: "doc", role: "tech-writer", title: "Writer", squad: "build", duties: "docs", reportsTo: "lead", model: "auto", effort: "low" },
    ],
  }, { cwd: os.tmpdir() });
  assert.equal(plan.autoEffort, true, "new plans switch effort per ticket");
  const dev = plan.agents.find((a) => a.id === "dev");
  assert.ok(["opus", "sonnet", "haiku"].includes(dev.model) && dev.effort !== "auto");
  assert.equal(plan.agents.find((a) => a.id === "doc").model, "haiku");
});

test("effort state: a desktop member is switched to what its in-progress ticket wants, then compared to what was recorded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-effort-"));
  try {
    const fleet = {
      autoEffort: true,
      agents: [
        { id: "dev", launch: "session", effort: "high" },
        { id: "bg", launch: "headless", effort: "high" },
        { id: "idle", launch: "session", effort: "high" },
      ],
    };
    const working = { dev: [{ id: "T-1", text: ticket({ Severity: "medium" }) }, { id: "T-2", text: ticket({ Severity: "low" }) }], bg: [{ id: "T-3", text: ticket({ Severity: "low" }) }] };
    let state = effortState(fleet, dir, working);
    assert.deepEqual(state.switch, [{ id: "dev", from: "high", to: "medium", ticket: "T-1", why: "severity medium" }], "the highest its tickets want; headless and idle members are not switched");
    recordEffort(dir, "dev", "medium", { ticket: "T-1" });
    assert.equal(currentEfforts(fleet, dir).dev, "medium");
    state = effortState(fleet, dir, working);
    assert.deepEqual(state.switch, [], "already there");
    assert.deepEqual(effortState({ ...fleet, autoEffort: false }, dir, working), { auto: false, members: [], switch: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: ticket set takes --effort and says the owner's effort; fleet status lists the switch; fleet effort records it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    writeBoard(normalizePlan({
      mission: { name: "Night team", goal: "g", hours: 4 },
      agents: [
        { id: "lead", role: "lead" },
        { id: "po", role: "product-owner", reportsTo: "lead" },
        { id: "dev-api", role: "developer", reportsTo: "po", effort: "high" },
        { id: "test-api", role: "tester", reportsTo: "po" },
      ],
    }, { cwd: dir }));
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8" });
    const boardDir = path.join(dir, ".fleet", "night-team", "board");
    fs.writeFileSync(path.join(boardDir, "tickets", "TA-001.md"), "# TA-001: typo\n\n- Status: new\n- Severity: low\n- Owner:\n- Verifier:\n- Decision:\n\n## Acceptance criteria\n- Given x, then y\n\n## Log\n");
    const set = (...a) => run("ticket", "set", "TA-001", ...a);
    assert.match(set("triaged", "--by", "po", "--decision", "do now", "--effort", "huge").stderr, /effort must be one of low/);
    assert.equal(set("triaged", "--by", "po", "--decision", "do now").status, 0);
    const assigned = JSON.parse(set("assigned", "--by", "po", "--owner", "dev-api", "--verifier", "test-api").stdout);
    assert.deepEqual(assigned.effort, { member: "dev-api", effort: "low", why: "severity low" });
    assert.equal(set("in-progress", "--by", "dev-api").status, 0);
    let status = JSON.parse(run("status", "--json").stdout);
    assert.deepEqual(status.effort.switch, [{ id: "dev-api", from: "high", to: "low", ticket: "TA-001", why: "severity low" }]);
    assert.match(run("status").stdout, /effort to switch: dev-api high→low \(TA-001\)/);
    assert.equal(run("effort", "dev-api", "low", "--ticket", "TA-001").status, 0);
    status = JSON.parse(run("status", "--json").stdout);
    assert.deepEqual(status.effort.switch, []);
    assert.equal(status.effort.members.find((m) => m.id === "dev-api").current, "low");
    assert.match(run("effort", "dev-api", "huge").stderr, /usage: fleet effort/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
