// Auto effort: a member keeps its model for the whole fleet, but works each ticket at the effort the ticket needs. The
// planned effort is the member's base; a ticket moves it — its `Effort:` field when someone set one, else its
// severity (critical one step up, high at the base, medium one down, low two down), never below `low` and never more
// than one step above the base. Only desktop sessions can change effort while they run, and only from another
// session: the lead applies the switch (`set_session_effort`) and records it with `fleet effort <id> <level>`.
//
// A switch is not free: the effort is part of what the API caches, so the member's next call re-writes its context
// to the cache once. The lead switches at ticket boundaries only, and together with a clear when one is due (a
// cleared session starts from an empty context, so the switch then costs nothing).

import fs from "node:fs";
import path from "node:path";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const SEVERITY_STEP = { critical: 1, high: 0, medium: -1, low: -2 };

const at = (effort) => Math.max(0, EFFORTS.indexOf(effort));
const clampTo = (index, top) => EFFORTS[Math.min(Math.max(index, 0), top)];

/** The model a plan's `"model": "auto"` resolves to: the role's own, else by effort (Opus for hard work, Haiku for low). */
export function autoModel(roleModel, effort) {
  if (roleModel === "inherit") return roleModel;
  if (at(effort) >= at("xhigh")) return "opus";
  if (roleModel && roleModel !== "auto") return roleModel;
  return effort === "low" ? "haiku" : effort === "medium" ? "sonnet" : "opus";
}

const field = (text, name) => new RegExp(`^[ \\t]*-[ \\t]*${name}:[ \\t]*(.*)$`, "im").exec(text)?.[1].trim() ?? "";

/** The effort a member works one ticket at, and why: the ticket's `Effort:`, else its severity, around the base. */
export function ticketEffort(text, base) {
  const top = Math.min(at(base) + 1, EFFORTS.length - 1);
  const asked = field(text, "Effort").toLowerCase().split(/\s+/)[0] ?? "";
  if (EFFORTS.includes(asked)) {
    const effort = clampTo(at(asked), top);
    return { effort, why: effort === asked ? `Effort: ${asked}` : `Effort: ${asked}, capped at ${effort} (one step above ${base})` };
  }
  const severity = field(text, "Severity").toLowerCase().split(/\s+/)[0] ?? "";
  const step = SEVERITY_STEP[severity];
  if (step === undefined) return { effort: base, why: "no severity: the planned effort" };
  return { effort: clampTo(at(base) + step, top), why: `severity ${severity}` };
}

/** Appends the effort a member now runs at; one line per switch, so the lead and the dashboard never overwrite. */
export function recordEffort(fleetDir, id, effort, { ticket } = {}) {
  fs.appendFileSync(path.join(fleetDir, "efforts.jsonl"), `${JSON.stringify({ id, effort, ...(ticket ? { ticket } : {}), at: new Date().toISOString() })}\n`);
}

/** The effort each member runs at now: the last one recorded, else the planned one. */
export function currentEfforts(fleet, fleetDir) {
  const now = Object.fromEntries(fleet.agents.map((a) => [a.id, a.effort]));
  let lines = [];
  try {
    lines = fs.readFileSync(path.join(fleetDir, "efforts.jsonl"), "utf8").split("\n");
  } catch {
    return now;
  }
  for (const line of lines) {
    try {
      const entry = line.trim() ? JSON.parse(line) : undefined;
      if (entry && entry.id in now && EFFORTS.includes(entry.effort)) now[entry.id] = entry.effort;
    } catch {
      // A torn last line while another process appends: skip it.
    }
  }
  return now;
}

/**
 * What the lead switches on its check: for each desktop member working a ticket, the effort that ticket wants against
 * the one it runs at. `tickets` is `{ memberId: [{ id, text }] }`, its in-progress tickets. A member with none keeps
 * its effort (its next ticket decides); a member with several works at the highest any of them wants.
 */
export function effortState(fleet, fleetDir, tickets = {}) {
  if (!fleet.autoEffort) return { auto: false, members: [], switch: [] };
  const current = currentEfforts(fleet, fleetDir);
  const members = fleet.agents.map((agent) => {
    const wants = (tickets[agent.id] ?? []).map((t) => ({ ticket: t.id, ...ticketEffort(t.text, agent.effort) }));
    const top = wants.reduce((best, w) => (best === undefined || at(w.effort) > at(best.effort) ? w : best), undefined);
    return { id: agent.id, launch: agent.launch, planned: agent.effort, current: current[agent.id], wanted: top?.effort ?? current[agent.id], ticket: top?.ticket, why: top?.why };
  });
  const switchable = (m) => m.launch === "session" && m.ticket !== undefined && m.wanted !== m.current;
  return {
    auto: true,
    members,
    switch: members.filter(switchable).map((m) => ({ id: m.id, from: m.current, to: m.wanted, ticket: m.ticket, why: m.why })),
  };
}
