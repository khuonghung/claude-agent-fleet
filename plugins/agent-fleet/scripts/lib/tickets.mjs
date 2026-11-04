// `fleet ticket`: moves a ticket's status the way the protocol says — only to a status that may follow, only by the
// member whose step it is, only with the evidence the move needs — and writes the Log line, so members stop
// hand-editing `- Status:` lines (and the dashboard stops guessing at "fixed — dev-api @ 7f3a").

import fs from "node:fs";
import path from "node:path";
import { hhmm } from "./board-init.mjs";
import { EFFORTS } from "./effort.mjs";
import { normStatus } from "../server/board.mjs";

/** Which status may follow which. "Never skip a status": the flow goes one step at a time, parked ones come back via triage. */
export const NEXT = {
  new: ["triaged", "deferred", "wont-fix", "duplicate"],
  triaged: ["assigned", "deferred", "wont-fix", "duplicate"],
  assigned: ["in-progress", "deferred", "wont-fix", "duplicate"],
  "in-progress": ["fixed", "assigned", "deferred"],
  fixed: ["integrated", "in-progress", "reopened"],
  integrated: ["verified", "reopened"],
  verified: ["reopened"],
  reopened: ["in-progress", "assigned", "deferred"],
  deferred: ["triaged"],
  "wont-fix": ["triaged"],
  duplicate: ["triaged"],
};

export const STATUSES = Object.keys(NEXT);

export const fieldOf = (text, name) => new RegExp(`^[ \\t]*-[ \\t]*${name}:[ \\t]*(.*)$`, "im").exec(text)?.[1].trim() ?? "";
const names = (value) => value.split(/[,\s]+/).map((w) => w.replace(/[`*@]/g, "")).filter(Boolean);
const empty = (value) => value === "" || /^[—-]+$/.test(value) || /^<.*>$/.test(value);

/** Sets a `- Name: value` header field: in place when it is there, else after the last header field. */
export function setField(text, name, value) {
  const re = new RegExp(`^([ \\t]*-[ \\t]*${name}:)[ \\t]*.*$`, "im");
  if (re.test(text)) return text.replace(re, `$1 ${value}`);
  const lines = text.split("\n");
  const firstSection = lines.findIndex((l, i) => i > 0 && l.startsWith("## "));
  const head = firstSection < 0 ? lines.length : firstSection;
  const last = lines.slice(0, head).findLastIndex((l) => /^[ \t]*-[ \t]*[A-Z][\w ]*:/.test(l));
  lines.splice(last < 0 ? 1 : last + 1, 0, `- ${name}: ${value}`);
  return lines.join("\n");
}

/** Appends a Log line at the end of the ticket (the Log is its last section), making the section when it is missing. */
export function appendLog(text, line) {
  const body = text.replace(/\s+$/, "");
  return `${body.includes("## Log") ? body : `${body}\n\n## Log`}\n${line}\n`;
}

/** Whose step a move is, as roles; the lead may make any move but `verified`, and the owner (the person) any. */
const BY_ROLE = {
  triaged: ["product-owner"],
  assigned: ["delivery-lead", "product-owner"],
  integrated: ["release-manager"],
  deferred: ["product-owner", "delivery-lead"],
  "wont-fix": ["product-owner"],
  duplicate: ["product-owner"],
  reopened: ["product-owner", "release-manager", "reviewer", "architect"],
};

/**
 * Checks a move and returns the ticket's new text, or the problems that stop it. `changes` holds `note`, `fix`,
 * `owner`, `verifier`, `decision`; `force` skips every check (the Log says it was forced).
 */
export function moveTicket(fleet, text, { to, by, now = new Date(), force = false, ...changes }) {
  const problems = [];
  const warnings = [];
  const from = normStatus(fieldOf(text, "Status"));
  if (!STATUSES.includes(to)) problems.push(`${to} is not a status: ${STATUSES.join(", ")}`);
  const member = fleet.agents.find((a) => a.id === by);
  if (by !== "owner" && member === undefined) problems.push(`${by} is not a member of the fleet (or "owner")`);
  let next = text;
  if (changes.effort !== undefined && !EFFORTS.includes(changes.effort)) problems.push(`effort must be one of ${EFFORTS.join(", ")}, not ${changes.effort}`);
  for (const [key, name] of [["owner", "Owner"], ["verifier", "Verifier"], ["decision", "Decision"], ["fix", "Fix"], ["effort", "Effort"]]) {
    if (changes[key] !== undefined) next = setField(next, name, changes[key]);
  }
  const owner = names(fieldOf(next, "Owner").replace(/\(proposed\)/i, ""));
  const crew = names(fieldOf(next, "Crew"));
  const verifier = names(fieldOf(next, "Verifier"));
  const note = (changes.note ?? "").replace(/\s+/g, " ").trim();
  if (problems.length === 0 && !force) {
    if (NEXT[from] !== undefined && !NEXT[from].includes(to)) problems.push(`${from} → ${to} skips a step: from ${from} the next status is ${NEXT[from].join(", ")}`);
    const role = member?.role;
    const lead = member?.launch === "self" || role === "lead";
    const allowed =
      by === "owner" ||
      (to === "verified"
        ? verifier.includes(by) && !owner.includes(by) && !crew.includes(by)
        : lead ||
          (BY_ROLE[to] ?? []).includes(role) ||
          (to === "in-progress" && (owner.includes(by) || crew.includes(by))) ||
          (to === "fixed" && owner.includes(by)) ||
          (to === "assigned" && from === "in-progress" && owner.includes(by)) ||
          (to === "reopened" && verifier.includes(by)));
    if (!allowed) {
      const who =
        to === "verified" ? `its verifier (${verifier.join(", ") || "none set"}), never its owner or crew`
        : to === "in-progress" ? `its owner (${owner.join(", ") || "none set"}) or crew`
        : to === "fixed" ? `its owner (${owner.join(", ") || "none set"})`
        : [...(BY_ROLE[to] ?? []), ...(to === "reopened" ? ["its verifier"] : []), "the lead"].join(", ");
      problems.push(`${by} may not set ${to}: that is ${who}`);
    }
    if (["fixed", "integrated", "verified", "reopened"].includes(to) && note === "") problems.push(`${to} needs its evidence in --note: the command, its passed/failed/skipped counts, the commit`);
    if (to === "fixed" && empty(fieldOf(next, "Fix"))) problems.push("fixed needs the branch and commit in --fix (\"<branch> @ <sha>\")");
    if (to === "assigned" && (owner.length === 0 || verifier.length === 0)) problems.push("assigned needs an owner and a verifier (--owner, --verifier)");
    if (to === "verified" && verifier.length === 0) problems.push("verified needs a verifier on the ticket (--verifier, by whoever assigns it)");
    if (["deferred", "wont-fix", "duplicate"].includes(to) && empty(fieldOf(next, "Decision"))) problems.push(`${to} needs the reason in --decision${to === "duplicate" ? " (\"duplicate of <ID>\")" : ""}`);
    if (to === "triaged") {
      if (empty(fieldOf(next, "Severity").split(/\s+/)[0] ?? "")) problems.push("triaged needs a severity");
      if (empty(fieldOf(next, "Decision"))) problems.push("triaged needs a decision (--decision \"do now\")");
      const criteria = /^## Acceptance criteria\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(next)?.[1] ?? "";
      if (criteria.trim() === "") problems.push("triaged needs acceptance criteria under \"## Acceptance criteria\"");
    }
  }
  if (problems.length > 0) return { problems, warnings, from };
  next = setField(next, "Status", to);
  next = appendLog(next, `- ${hhmm(now)} ${by}: ${to}${note ? ` — ${note}` : ""}${force ? " (forced)" : ""}`);
  return { text: next, problems, warnings, from };
}

/** The board's tickets, read as `fleet ticket list` and the in-progress check need them. */
export function listTickets(boardDir) {
  const dir = path.join(boardDir, "tickets");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      return {
        id: f.replace(/\.md$/, ""),
        title: (/^#\s*[^:\n]+:\s*(.*)$/m.exec(text)?.[1] ?? "").trim(),
        status: normStatus(fieldOf(text, "Status")),
        severity: (fieldOf(text, "Severity").split(/\s+/)[0] ?? "").toLowerCase(),
        owner: fieldOf(text, "Owner"),
        verifier: fieldOf(text, "Verifier"),
        fix: fieldOf(text, "Fix"),
        area: fieldOf(text, "Area"),
      };
    });
}
