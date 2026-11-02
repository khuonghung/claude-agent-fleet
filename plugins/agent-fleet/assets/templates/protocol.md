# {{name}}: fleet protocol

Goal: {{goal}}

Window: {{start}} → {{end}} ({{hours}} h). This folder is the fleet's shared board; every member reads this file first and follows it.
Board: `{{boardDir}}`. Dashboard: run `/agent-fleet:dashboard` (or open the URL the lead posted).

## Members

{{roster}}

Message a teammate with `SendMessage` and `to` = their session id from `ROSTER.md` (a desktop session) or their name (a subagent). A message to a busy session waits until its turn ends, so **the board is the channel and a message is only the doorbell**: assignments live in the tickets and `BOARD.md`, discussions in `threads/`, short news for everyone in `CHANNEL.md`, a message for one member in their inbox (`{{sendCmd}}`; it waits in `inbox/<id>.md` until they acknowledge it with `fleet ack <id> <n>`, and each prompt they get shows it), and everyone re-reads `BOARD.md`, the last lines of `CHANNEL.md`, greps `{{boardDir}}/tickets/` and `{{boardDir}}/threads/` for their id between tasks. The `team-communication` skill has the rules.

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

## Team channel

`CHANNEL.md` is the team's one shared line: short news that everyone may need in the next minutes and that fits no ticket or thread — "touching `src/contracts/items.ts` until 12:30", "the stack is down, restarting", "integration round in 5 min", "who knows why `api.test.ts` flakes?". One line per post, newest at the bottom:

```markdown
- HH:MM <id> · <heads-up | ask | answer | fyi>: <one line, with `path:line` or a ticket id where it matters>
```

- **Post with the fleet CLI**, never by editing the file: `{{sayCmd}}`. It takes the time from the clock and appends one line, so two members posting at once never erase each other.
- **Read the last lines** between tasks: `tail -n 30 {{boardDir}}/CHANNEL.md`. Answer an `ask` you can answer with an `answer` that names who asked.
- **Write it the way you would say it in a team chat**: one or two plain sentences that tell the reader what changed for them and who should do what, in the language of the mission's goal with its proper accents (never mixed with English or stripped of diacritics). Name people as `@id`; never open with your own id, the channel already shows who posted. The evidence — commits, test counts, command output — belongs in the ticket's Log; a ticket id is enough for the reader to open it.
  - Not: `dev-app tip f2b2fb7d: P-030 fixed e32f1f0a (db-roles one-shot service; api 64/64 files 408/408), P-033 3c784df1. My queue is empty`
  - But: `@pm P-030 and P-033 are fixed on my branch, all API tests pass. My queue is empty — what next?`
  - Not: `round 7 merged @ 6f95e6ec: P-008 (dc85ecb4+bab4b537), P-029, DC-002; full checks running (~10 min)`
  - But: `Round 7 is merged; full checks take about 10 minutes, please hold off on heavy test runs until then.`
- **Only what everyone needs now.** Work goes in its ticket, a question that needs a decision opens a thread, news for one member is a direct message. No acks, no thanks, no progress reports: a ticket moving to `fixed`, `integrated` or `verified` is already in the ticket and on the dashboard, so post only when someone must act on it now ("@qa2 round 7 is in, P-020 to P-034 are ready to verify").
- **No doorbell**: posting rings no one. If a member must act, write it in their ticket or thread and message them as usual.

## Timeline

{{timeline}}

## Files

| Path | Writer | What |
|---|---|---|
| `README.md` | the lead | this protocol |
| `ROSTER.md` | each member edits only their own row | session id, worktree, branch |
| `BOARD.md`, `NOTICES.md` | the delivery lead (or the lead) | summary, assignments, notices |
| `CHANNEL.md` | every member and the owner, one appended line at a time with `fleet say` | the team channel |
| `inbox/<id>.md`, `inbox/<id>.read` | anyone appends messages with `fleet send`; the member acknowledges with `fleet ack` | that member's direct messages |
| `tickets/<ID>.md` | see "Tickets" | one file per issue |
| `threads/<topic>.md` | its members append posts; its owner the header | one discussion or shared piece of work |
| `reports/<id>.md` | that member only | running notes and the end report |
| `FINAL-REPORT.md` | the delivery lead (or the lead) | the report for the owner |
| `briefs/<id>.md` | the lead | each member's brief |

## Writing to the board from a worktree

The board is one folder in the main checkout, `{{boardDir}}`, shared by every member. It is not in git (`.fleet/` is excluded), so a worktree has no copy of it and nothing on it travels through branches or merges. A member working in their own worktree:

1. Reads and writes board files only by their absolute path under `{{boardDir}}`. A relative `.fleet/…`, `tickets/…` or `threads/…` from the worktree points somewhere else; grep the same way: `grep -l <your id> {{boardDir}}/threads/*.md`.
2. Never creates `.fleet/` or board files inside the worktree, and never `git add`s or commits them: a board edit is seen by everyone the moment it is saved, and a commit carries product code only.
3. Records their worktree and branch in their row with the fleet CLI, run as is from the worktree: `{{rosterCmd}}`.
4. Writes paths in tickets and posts relative to the repository root (`src/api/users.ts:42`), never to their worktree, so they mean the same file to every member.
5. If a write to the board is refused (a declined permission prompt, a sandbox that allows only the worktree), stops and tells the lead with `SendMessage` what was refused; never works around it with a copy of the board in the worktree.

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

The `Status:` line holds the status word and nothing else (`- Status: duplicate`, not `duplicate → DA-004`): the reason, the other ticket, the commit go in `Decision:`, `Fix:` or the Log. Each move is made by the member who did the step, with a Log line, the moment it happens — never skip a status, since the dashboard and the delivery lead read where work stands from it.

**Move a status with the fleet CLI, never by editing the `- Status:` line**: `{{ticketCmd}}`. It refuses a move that skips a step, a move that is not yours (below) and a move without its evidence, sets `Owner`, `Verifier`, `Fix` or `Decision` when you pass them (`--owner`, `--verifier`, `--fix "<branch> @ <sha>"`, `--decision`), and writes the Log line with the clock's time. If it refuses a move you believe is right, ask the lead; only the lead passes `--force`. `fleet ticket list --owner <your id>` lists your tickets.


| To | Set by | When |
|---|---|---|
| `new` | whoever files it | the ticket is written (see `write-ticket`) |
| `triaged` | the product owner | severity, decision and acceptance criteria are written |
| `assigned` | the delivery lead (or the lead) | `Owner` and `Verifier` are set |
| `in-progress` | the owner | they start the ticket — before reading code for it, planning or committing; again when they start on a `reopened` one; one `in-progress` per member at a time |
| `fixed` | the owner | the commit is on their branch and the checks are green; `Fix:` names branch @ commit |
| `integrated` | the release manager (or the lead) | the fix is merged into the integration branch |
| `verified` | the verifier — never the owner or a crew member | checked on the integration branch against every criterion, with evidence |
| `reopened` | the verifier, a reviewer, or the release manager when the merge breaks the checks | the fix misses a criterion or breaks something, with evidence; the owner takes it back to `in-progress` |
| `deferred` | the product owner; the delivery lead at the freeze | not done in this window (out of time, not started before the freeze), with the reason in `Decision:` |
| `wont-fix` | the product owner | not a problem, or not worth its cost, with the reason in `Decision:` |
| `duplicate` | the product owner | the same problem as another ticket: `Decision: duplicate of <ID>`, the extra details copied into that ticket's Log |

Putting a ticket down before it is fixed (blocked, handed over) sets it back to `assigned` with a Log line saying why.

Log times are the local clock when you write the line: read it with `date +%H:%M`, never estimate it. Append Log lines at the end, oldest first.

## Rules

1. Never commit to `{{base}}`, never push, never open pull requests: the owner reviews and merges.
2. Builders commit only on their own branch, one commit per ticket, with a test where tests exist, following the project's commit conventions and its CLAUDE.md / AGENTS.md. Each commit must merge on its own: never build a ticket on top of a commit whose ticket is not yet `integrated`. When your branch holds such a commit, start the next ticket on a new branch from the integration branch (`git switch -c <your branch>-<ticket id> <integration branch>`) and name it in `Fix:`. Work only on tickets assigned to you: never on one that is `deferred`, `wont-fix` or `duplicate` — a deferred ticket waits until the product owner brings it back.
3. Stay in your area (see Members). A change elsewhere: ask its owner.
4. Only one member runs long-lived servers; kill processes by PID only, never by name.
5. No secrets in tickets, reports or commits.
6. Keep working until your window ends. Never sit waiting on a teammate: do other work and re-read the thread between steps; with nothing else to do, wait in bounded stretches (`Monitor` with an until-loop on the thread file, ten minutes at most), not `sleep`. Before you stop, write `reports/<id>.md`.
7. Disagree in the thread with evidence, then follow the owner's decision.{{contextRule}}
