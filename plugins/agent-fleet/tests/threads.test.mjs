import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseThread, readBoard } from "../scripts/server/board.mjs";

const THREAD = `# Retry policy for the export client

- Status: open
- Ticket: DA-003
- Owner: architect
- Members: dev-api, dev-web, test-api
- Decide by: 14:30
- Decision:

## Context
Question: retry on 429 or not?

## Posts
### 14:05 architect · proposal
Options A and B. Recommendation: B.

### 14:12 dev-web · agree
B works for the portal.

### 14:15 test-api · concern
B breaks \`tests/client.test.ts:88\`.
Blocking: no.

### 14:16 someone-else
A post without a kind.
`;

test("a thread: header fields, typed posts with their text, the deadline on the mission's clock", () => {
  const stat = { mtime: new Date("2026-11-01T07:20:00Z") };
  const th = parseThread("DA-003", THREAD, stat, "2026-11-01T05:00:00Z");
  assert.equal(th.title, "Retry policy for the export client");
  assert.equal(th.status, "open");
  assert.equal(th.ticket, "DA-003");
  assert.equal(th.owner, "architect");
  assert.deepEqual(th.members, ["dev-api", "dev-web", "test-api"]);
  assert.equal(th.decideBy, "14:30");
  assert.ok(th.decideAt?.endsWith("Z"));
  assert.equal(th.decision, "");
  assert.deepEqual(th.posts.map((p) => [p.time, p.who, p.kind]), [
    ["14:05", "architect", "proposal"],
    ["14:12", "dev-web", "agree"],
    ["14:15", "test-api", "concern"],
    ["14:16", "someone-else", "post"],
  ]);
  assert.equal(th.posts[2].text, "B breaks `tests/client.test.ts:88`.\nBlocking: no.");
});

test("the board lists its threads, newest first, and a ticket's crew", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-threads-"));
  try {
    for (const sub of ["tickets", "threads"]) fs.mkdirSync(path.join(dir, sub));
    fs.writeFileSync(path.join(dir, "tickets", "DA-003.md"), "# DA-003: Export\n\n- Status: in-progress\n- Owner: dev-api\n- Crew: dev-web, test-api\n- Verifier: qa\n");
    fs.writeFileSync(path.join(dir, "threads", "DA-003.md"), THREAD);
    fs.writeFileSync(path.join(dir, "threads", "naming.md"), "# Naming\n\n- Status: decided\n- Owner: architect\n- Decision: kebab-case\n");
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(dir, "threads", "naming.md"), later, later);
    const board = await readBoard({ board: { dir }, mission: { startAt: new Date().toISOString() } });
    assert.equal(board.tickets[0].crew, "dev-web, test-api");
    assert.deepEqual(board.threads.map((t) => [t.name, t.status]), [["naming", "decided"], ["DA-003", "open"]]);
    assert.equal(board.threads[0].decision, "kebab-case");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
