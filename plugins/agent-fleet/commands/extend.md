---
description: Give the running agent fleet more time — move its end, the phases and the members' windows, update every brief, and tell the team
argument-hint: "[how much more, e.g. \"2 hours\" or \"until 18:00\"]"
---

Extend the current agent fleet while it works. The fleet CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/fleet.mjs"` (call it `fleet` below); run it from the project root. Speak the user's language.

1. Run `fleet status --json`. With no fleet, point the user to `/agent-fleet:new` and stop. Read the end time and the phases from `.fleet/<slug>/fleet.json`.
2. From `$ARGUMENTS`, pick `--hours <N>` (more time from the current end; from now if the fleet has ended) or `--to <HH:MM or ISO time>` (a new end; a clock time is the first one after the current end). With nothing given, ask how much more time, once.
3. Run `fleet extend <--hours N | --to T> --dry-run` and show the user: the end before and after; the phases — the one in progress grows (the work phase when the fleet is still starting up) and the later ones (freeze, reports) move with the end, keeping their length; the members whose window moves (`moved`; a window that ended earlier is kept); and the output tokens the fleet is now expected to write (`tokens.before` → `tokens.after`) against the limit (`tokens.limit`, or "no limit"). When the new estimate passes the limit, offer to raise `budget.outputTokens` in `fleet.json`.
4. On the user's go-ahead, run the same command without `--dry-run`. It writes the new times into `fleet.json`, rewrites the board's README (end and timeline), every brief and every member's agent — tickets, reports, roster and session ids kept — notes it in `NOTICES.md` and posts it on the team channel. The dashboard, `fleet status` and the recurring check read the new end by themselves.
5. Members who already run read their brief when they started, so tell each one: SendMessage to its session id (from `ROSTER.md`) or name with the `message` the command printed, unchanged. Skip members whose window did not move. Headless members read it on the team channel.
6. If you scheduled anything at the old end time (a one-off wrap-up, a reminder), move it to the new end.
7. Give the user a one-line summary: the new end, the phase that grew, and the dashboard link.
