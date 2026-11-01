---
description: Summarise the current agent fleet — time left, tickets by status, who is idle, what needs attention
---

Give the user a short status of the current agent fleet, in their language.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/fleet.mjs" status --json` from the project root (if there is no fleet, say so and point to `/agent-fleet:new`).
2. If the dashboard runs (`.fleet/<slug>/dashboard.json` has its URL), read `<url>/api/state` for the live view: each member's state (running a tool, thinking, waiting, silent, not started), output tokens against the budget, and the model each runs against the one planned.
3. Read the fleet board's `BOARD.md` and `NOTICES.md` and skim `tickets/` for `reopened`, `critical` and fixes waiting for verification.
4. Answer in a few lines, in the Progress · Plans · Problems shape of the `agent-fleet:status-report` skill: time left and phase; tickets found / fixed / verified; members idle or silent for 10+ minutes; output tokens against the limit (`budget` in the status: used / limit, and what happens at it, or "no limit"); anything that needs the user (a decision, a model mismatch, the base branch moving). End with the dashboard URL.
5. If `budget.state` is `near` or `over` and `NOTICES.md` does not show it was handled, act as `/agent-fleet:launch` describes under "Keeping the token limit".
