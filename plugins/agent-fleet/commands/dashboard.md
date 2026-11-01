---
description: Start (or find) the live dashboard of the current agent fleet and open it
argument-hint: "[--port N]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/fleet.mjs" dashboard $ARGUMENTS` from the project root. It starts the dashboard server in the background for the current fleet, or says it already runs, and prints its URL on a line of its own (and the port it moved to when the usual one was taken).

- If it says there is no fleet, tell the user to plan one with `/agent-fleet:new`.
- Give the user the URL as a link they can click, on a line of its own — `Dashboard: [http://localhost:4600](http://localhost:4600)` with the port it printed — never only the port number. When you have a browser pane or preview tool, open the URL there too.
- Mention what they can do there in one line: switch the language (English, Tiếng Việt, 日本語, 한국어, 中文) and the theme in the header; the tabs Overview, Org chart, Team, Tickets, Code & infra and Reports; click any member or ticket for details.
- To stop it later: `node "${CLAUDE_PLUGIN_ROOT}/scripts/fleet.mjs" stop`.
