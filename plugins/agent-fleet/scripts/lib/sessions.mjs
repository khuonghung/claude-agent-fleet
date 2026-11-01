// Which Claude Code session is which member, across clears and compactions. Every brief and every resume note starts
// with a marker line, `Fleet member: <slug>/<id>`; the prompt hook sees it and appends the session to
// `.fleet/<slug>/sessions/<id>.jsonl`. A member cleared to save tokens starts a new transcript, and the dashboard,
// `fleet status` and the compaction hook still know whose it is.

import fs from "node:fs";
import path from "node:path";
import { normStatus } from "../server/board.mjs";

export const markerOf = (slug, id) => `Fleet member: ${slug}/${id}`;

/** The member a prompt was written for: the marker on a line of its own near the top (a brief, a resume note). */
export function memberOfPrompt(prompt) {
  const m = /^Fleet member: ([a-z0-9-]+)\/([a-z][a-z0-9-]*)[ \t]*$/m.exec(String(prompt ?? "").slice(0, 4000));
  return m ? { slug: m[1], id: m[2] } : undefined;
}

/** Appends one session to a member's record; one append per line, so members recording at once never collide. */
export function recordSession(fleetDir, id, session) {
  const dir = path.join(fleetDir, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${id}.jsonl`), `${JSON.stringify({ ...session, at: new Date().toISOString() })}\n`);
}

/** Every member's recorded sessions: `{ id: [{ sessionId, transcriptPath, at }] }`. */
export function sessionsOf(fleetDir) {
  const dir = path.join(fleetDir, "sessions");
  const out = {};
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return out;
  }
  for (const file of files) {
    out[file.replace(/\.jsonl$/, "")] = fs
      .readFileSync(path.join(dir, file), "utf8")
      .split("\n")
      .flatMap((line) => {
        try {
          return line.trim() ? [JSON.parse(line)] : [];
        } catch {
          return [];
        }
      });
  }
  return out;
}

/** The member a session belongs to: by its recorded sessions, else a headless member's own session id. */
export function memberOfSession(fleet, fleetDir, sessionId) {
  if (!sessionId) return undefined;
  const hit = Object.entries(sessionsOf(fleetDir)).find(([, list]) => list.some((s) => s.sessionId === sessionId));
  return hit?.[0] ?? fleet.agents.find((a) => a.match?.sessionId === sessionId && a.launch !== "self")?.id;
}

const FINAL = new Set(["verified", "deferred", "wont-fix", "duplicate"]);
const field = (text, name) => new RegExp(`^[ \\t]*-[ \\t]*${name}:[ \\t]*(.*)$`, "im").exec(text)?.[1].trim() ?? "";
const names = (text, id) => text.split(/[,\s]+/).some((word) => word.replace(/[`*]/g, "") === id);

/** A member's open tickets on the board, with the part it plays in each (owner, crew, verifier). */
export function openTicketsOf(boardDir, id) {
  const dir = path.join(boardDir, "tickets");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
  return files.flatMap((file) => {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const status = normStatus(field(text, "Status"));
    if (FINAL.has(status)) return [];
    const part = names(field(text, "Owner"), id) ? "owner" : names(field(text, "Crew"), id) ? "crew" : names(field(text, "Verifier"), id) ? "verifier" : undefined;
    return part === undefined ? [] : [{ id: file.replace(/\.md$/, ""), status, part }];
  });
}

/**
 * What a member reads first in a fresh context — after the lead cleared it, or after a compaction: who it is, where its
 * brief is, its open tickets (the one in progress first), and where the team is. Starts with the member's marker.
 */
export function resumeNote(fleet, id, { reason = "cleared" } = {}) {
  const agent = fleet.agents.find((a) => a.id === id);
  if (agent === undefined) throw new Error(`No member ${id}`);
  const board = fleet.board.dir.replaceAll("\\", "/");
  const tickets = openTicketsOf(fleet.board.dir, id).sort((a, b) => (b.status === "in-progress") - (a.status === "in-progress"));
  const end = new Date(agent.window?.to ?? fleet.mission.endAt);
  const hhmm = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  return [
    markerOf(fleet.mission.slug, id),
    "",
    `You are **${id}** (${agent.title}) in the agent fleet "${fleet.mission.name}". Your context was ${reason} to save tokens; nothing is lost: the board holds the work.`,
    "",
    `1. Re-read your brief \`${board}/briefs/${id}.md\` and the protocol \`${board}/README.md\`.`,
    `2. Your open tickets: ${tickets.length ? tickets.map((t) => `${t.id} (${t.status}, ${t.part})`).join(", ") : "none"}. ${tickets.some((t) => t.status === "in-progress") ? "Pick the one in progress back up from its Log." : "Take the next one assigned to you."}`,
    `3. Catch up with the team: \`${board}/BOARD.md\`, \`tail -n 30 ${board}/CHANNEL.md\`, \`grep -l ${id} ${board}/threads/*.md\`.`,
    "",
    `Keep working until ${hhmm}, as your brief says.`,
    "",
  ].join("\n");
}
