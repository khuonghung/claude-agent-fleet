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
function withFleet(fn, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-"));
  try {
    const { fleetFile, boardDir } = writeBoard(normalizePlan(plan(extra), { cwd: dir }));
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8" });
    return fn({ dir, fleetFile, boardDir, run });
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
