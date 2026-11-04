// `fleet clone`: the next round of a fleet — the same team (roles, specialties, areas, models, efforts, reporting
// lines, budget) with a new name, a fresh board and new times, carrying over the tickets the last round left open.

import fs from "node:fs";
import path from "node:path";
import { branchOf, hhmm, prefixes } from "./board-init.mjs";
import { normStatus } from "../server/board.mjs";

/** What a member is in the plan, without what the last round recorded about it (sessions, transcripts, its window). */
const PLAN_FIELDS = ["id", "name", "role", "title", "squad", "reportsTo", "model", "effort", "launch", "worktree", "readOnly", "duties", "skills", "specialty", "owns", "mascot"];

/** The statuses carried over by default: the work not done, not the work done or dropped. */
export const CARRY = ["new", "triaged", "assigned", "in-progress", "reopened", "deferred"];

/**
 * The plan of the next round: the source's team and settings under a new name, from now for `hours` (by default as long
 * as the source ran), its phases at the same shares of the window. A named integration branch gets the new fleet's.
 */
export function clonePlan(source, { name, goal, hours, now = new Date() }) {
  if (!name) throw new Error("the new fleet needs a name (--name)");
  const span = Date.parse(source.mission.endAt) - Date.parse(source.mission.startAt);
  const length = hours === undefined ? span : Number(hours) * 3_600_000;
  if (!(length > 0 && length <= 72 * 3_600_000)) throw new Error("--hours must be between 0 and 72");
  const start = Math.floor(now.getTime() / 60_000) * 60_000;
  const at = (iso) => new Date(start + Math.round(((Date.parse(iso) - Date.parse(source.mission.startAt)) / span) * length / 60_000) * 60_000).toISOString();
  const phases = (source.mission.phases ?? []).map((p) => ({ name: p.name, from: at(p.from), to: at(p.to) }));
  const endAt = new Date(start + length).toISOString();
  if (phases.length > 0) phases.at(-1).to = endAt;
  const agents = source.agents.map((a) => Object.fromEntries(PLAN_FIELDS.filter((k) => a[k] !== undefined).map((k) => [k, structuredClone(a[k])])));
  const plan = {
    mission: { name, goal: goal ?? source.mission.goal, startAt: new Date(start).toISOString(), endAt, phases, language: source.mission.language },
    repo: { dir: source.repo.dir, base: source.repo.base },
    launch: source.launch,
    budget: structuredClone(source.budget ?? {}),
    context: structuredClone(source.context ?? {}),
    ...(source.autoEffort === undefined ? {} : { autoEffort: source.autoEffort }),
    privacy: structuredClone(source.privacy ?? {}),
    port: source.port,
    agents,
  };
  if (plan.port === undefined) delete plan.port;
  return plan;
}

/** After normalizing: the named integration branch, renamed after the new fleet the way member branches are. */
export function renameIntegration(source, plan) {
  if (source.repo.integration) plan.repo.integration = branchOf(plan, { id: "integration" }, 40);
  return plan;
}

const field = (text, name) => new RegExp(`^[ \\t]*-[ \\t]*${name}:[ \\t]*(.*)$`, "im").exec(text)?.[1].trim() ?? "";

/**
 * Copies the source's open tickets onto the new board under new ids (`CO-001`…, a prefix no member uses), so they
 * never collide with the ids members number from 001 again. Each one goes back to `new` for the product owner to
 * triage, keeps its text, owner and verifier, and says in its Log where it came from. Returns what was carried.
 */
export function carryTickets(source, plan, { statuses = CARRY, by = "lead", now = new Date() } = {}) {
  const from = path.join(source.board.dir, "tickets");
  const to = path.join(plan.board.dir, "tickets");
  if (!fs.existsSync(from)) return [];
  fs.mkdirSync(to, { recursive: true });
  const used = new Set(prefixes(plan.agents).values());
  let prefix = "CO";
  for (let n = 2; used.has(prefix); n++) prefix = `CO${n}`;
  const carried = [];
  for (const file of fs.readdirSync(from).filter((f) => f.endsWith(".md")).sort()) {
    const text = fs.readFileSync(path.join(from, file), "utf8").replace(/\r\n?/g, "\n");
    const status = normStatus(field(text, "Status"));
    if (!statuses.includes(status)) continue;
    const old = file.replace(/\.md$/, "");
    const id = `${prefix}-${String(carried.length + 1).padStart(3, "0")}`;
    let next = text.replace(/^#\s*[^:\n]+:/m, `# ${id}:`).replace(/^([ \t]*-[ \t]*Status:[ \t]*).*$/im, "$1new");
    if (!next.includes("## Log")) next = `${next.trimEnd()}\n\n## Log\n`;
    next = `${next.trimEnd()}\n- ${hhmm(now)} ${by}: carried over from ${source.mission.slug}/${old} (was ${status}); back to new for triage.\n`;
    fs.writeFileSync(path.join(to, `${id}.md`), next);
    carried.push({ id, from: old, status });
  }
  return carried;
}
