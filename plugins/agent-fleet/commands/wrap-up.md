---
description: Close the current agent fleet — collect every member's report, check the final state and write the report for the owner
---

Wrap up the current agent fleet. The fleet CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/fleet.mjs"`; the board is `.fleet/<slug>/board/` (see `fleet status`).

1. Tell every member still working (SendMessage to their session id, or their name for subagents) to stop starting new work, finish what they hold, write `reports/<id>.md` and end their turn. Give them a few minutes; do not wait on a member that is idle.
2. Check the state yourself: tickets by status (`fleet status --json`), what is on each member's branch and on the integration branch (`git log --oneline <base>..<branch>`), that the base branch did not move, that no server or background process a member started is still running.
3. If the plan has a delivery lead and it wrote `FINAL-REPORT.md`, review it; otherwise write `FINAL-REPORT.md` (load the `agent-fleet:status-report` skill for its shape) in the board yourself, in the owner's language: summary; numbers (found / fixed / verified / deferred); a table per ticket; the branches and the exact commands to review and merge them; what failed or was interrupted; open risks; decisions for the owner; what was left on disk or running; links to every report.
4. Tell the user where the report is and give the dashboard URL as a link they can click (from `.fleet/<slug>/dashboard.json`), and offer to stop the dashboard (`fleet stop`) and any recurring check you set up. If tickets are left open (deferred, not started), say that the next round can start from them with the same team: `/agent-fleet:new` offers `fleet clone`.
