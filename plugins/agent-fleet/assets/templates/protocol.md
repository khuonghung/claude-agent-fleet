# {{name}}: fleet protocol

Goal: {{goal}}

Window: {{start}} → {{end}} ({{hours}} h). This folder is the fleet's shared board; every member reads this file first and follows it.
Board: `{{boardDir}}`. Dashboard: run `/agent-fleet:dashboard` (or open the URL the lead posted).

## Members

{{roster}}

Message a teammate with `SendMessage` and `to` = their session id from `ROSTER.md` (a desktop session) or their name (a subagent). A message to a busy session waits until its turn ends, so **the board is the channel and a message is only the doorbell**: assignments live in the tickets and `BOARD.md`, discussions in `threads/`, and everyone re-reads `BOARD.md`, greps `tickets/` and `threads/` for their id between tasks. The `team-communication` skill has the rules.

## Working together

When members must talk to get one piece of work done — a design choice, a question across areas, one ticket shared by several members — they do it in a **thread**: `threads/<topic>.md`, one file per discussion, opened by whoever needs it.

```markdown
# <topic: the question, in one line>

- Status: open | decided | closed
- Ticket: <ID, or —>
- Owner: <the member who decides>
- Members: <ids who must answer>
- Decide by: HH:MM
- Decision: <filled in by the owner>

## Context
What is being decided or done together, what is known, the options.

## Posts
### HH:MM <id> · <question | proposal | answer | concern | agree | decision | ready | blocked | handoff | status>
<text: self-contained, with `path:line`, ticket ids and command output where they matter>
```

Rules: append posts at the end, never edit another member's post; after posting, ring the doorbell — one `SendMessage` line to the members you need ("posted a proposal in threads/<topic>.md, answer by HH:MM"). Every member named in `Members` answers by `Decide by`; no answer by then counts as agreement. The owner decides, writes the `Decision` (and the ticket's `Decision` line), sets `Status: decided`; everyone follows it, and it is reopened only with new evidence. A ticket worked by several members names them in `- Crew:` and has a thread `threads/<ID>.md`. The `discuss-and-decide` and `swarm-ticket` skills say how.

## Timeline

{{timeline}}

## Files

| Path | Writer | What |
|---|---|---|
| `README.md` | the lead | this protocol |
| `ROSTER.md` | each member edits only their own row | session id, worktree, branch |
| `BOARD.md`, `NOTICES.md` | the delivery lead (or the lead) | summary, assignments, notices |
| `tickets/<ID>.md` | see "Tickets" | one file per issue |
| `threads/<topic>.md` | its members append posts; its owner the header | one discussion or shared piece of work |
| `reports/<id>.md` | that member only | running notes and the end report |
| `FINAL-REPORT.md` | the delivery lead (or the lead) | the report for the owner |
| `briefs/<id>.md` | the lead | each member's brief |

## Tickets

File name = ticket id. Each member numbers their own ids with their prefix (`{{prefixExample}}`), so ids never collide.

```markdown
# <ID>: <one-line title>

- Status: new
- Severity: critical | high | medium | low
- Area: <path or component>
- Owner: <member who fixes it; with a crew, the one who coordinates and integrates>
- Crew: <other members working on it, each on their own part — only for shared tickets>
- Verifier: <member who checks it>
- Decision: <do now | defer | won't do, and why>
- Fix: <branch @ commit>

## Problem
What happens, where (`path:line`), how to reproduce, expected vs actual.

## Acceptance criteria

## Log
- HH:MM <member>: <note>
```

Status flow: {{flow}}; also {{parked}}. Change a ticket with small edits, never rewrite a file someone else edits; anyone may append to `## Log`.

## Rules

1. Never commit to `{{base}}`, never push, never open pull requests: the owner reviews and merges.
2. Builders commit only on their own branch, one commit per ticket, with a test where tests exist, following the project's commit conventions and its CLAUDE.md / AGENTS.md.
3. Stay in your area (see Members). A change elsewhere: ask its owner.
4. Only one member runs long-lived servers; kill processes by PID only, never by name.
5. No secrets in tickets, reports or commits.
6. Keep working until your window ends. Never sit waiting on a teammate: do other work and re-read the thread between steps; with nothing else to do, wait in bounded stretches (`Monitor` with an until-loop on the thread file, ten minutes at most), not `sleep`. Before you stop, write `reports/<id>.md`.
7. Disagree in the thread with evidence, then follow the owner's decision.
