#!/usr/bin/env node
// Agent Fleet hook. Reads the hook input (JSON on stdin) and never fails the session: any problem is silent.
//
//   session-start  prints one short note when the session's folder (or a parent: a member's worktree) has an active
//                  fleet, so a member knows where its board and protocol are, and says so when this session's plugin is
//                  older than the one that wrote the fleet. After a compaction (source "compact")
//                  of a known member's session, prints that member's resume note instead: who it is, its open tickets.
//   prompt         when the prompt starts /agent-fleet:new or /agent-fleet:launch, remembers this session as the
//                  fleet's lead (.fleet/lead.json: its session id and transcript), so the dashboard follows it too.
//                  When the prompt carries a member's marker (a brief, a resume note), records the session as that
//                  member's (.fleet/<slug>/sessions/<id>.jsonl), so a member cleared to save tokens is still followed.

import fs from "node:fs";
import path from "node:path";
import { versionNote } from "../scripts/lib/plan.mjs";
import { memberOfPrompt, memberOfSession, recordSession, resumeNote } from "../scripts/lib/sessions.mjs";

const mode = process.argv[2];

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function fleetHome(from) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".fleet"))) return path.join(dir, ".fleet");
    if (path.dirname(dir) === dir) return undefined;
  }
}

try {
  const input = readInput();
  const cwd = input.cwd || process.cwd();
  if (mode === "prompt") {
    const prompt = String(input.prompt ?? "");
    if (/^\s*\/agent-fleet:(new|launch)\b/.test(prompt)) {
      const home = fleetHome(cwd) ?? path.join(cwd, ".fleet");
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(path.join(home, "lead.json"), JSON.stringify({ sessionId: input.session_id, transcriptPath: input.transcript_path, cwd, at: new Date().toISOString() }, null, 2));
    }
    const member = memberOfPrompt(prompt);
    const home = member && fleetHome(cwd);
    if (home && input.session_id && fs.existsSync(path.join(home, member.slug, "fleet.json"))) {
      recordSession(path.join(home, member.slug), member.id, { sessionId: input.session_id, transcriptPath: input.transcript_path });
    }
  } else if (mode === "session-start") {
    const home = fleetHome(cwd);
    const slug = home && fs.existsSync(path.join(home, "current")) ? fs.readFileSync(path.join(home, "current"), "utf8").trim() : undefined;
    if (home && slug) {
      const fleet = JSON.parse(fs.readFileSync(path.join(home, slug, "fleet.json"), "utf8"));
      const end = Date.parse(fleet.mission?.endAt ?? "");
      if (Number.isFinite(end) && Date.now() < end) {
        // A session on an older plugin than the fleet's is told first: the commands its brief names may be missing.
        const note = versionNote(fleet);
        if (note) process.stdout.write(`${note}

`);
        const member = input.source === "compact" ? memberOfSession(fleet, path.join(home, slug), input.session_id) : undefined;
        if (member !== undefined) {
          process.stdout.write(resumeNote(fleet, member, { reason: "compacted" }));
        } else {
          const board = String(fleet.board?.dir ?? path.join(home, slug, "board")).replaceAll("\\", "/");
          process.stdout.write(
            `Agent fleet "${fleet.mission.name}" is active in this project until ${new Date(end).toISOString()}. Goal: ${fleet.mission.goal}\n` +
              `If you are one of its members, your protocol is ${board}/README.md and your brief is ${board}/briefs/<your id>.md. ` +
              `Status: /agent-fleet:status. Dashboard: /agent-fleet:dashboard.\n`,
          );
        }
      }
    }
  }
} catch {
  // A hook must never break the session.
}
