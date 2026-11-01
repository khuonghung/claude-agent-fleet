---
name: dispatch-work
description: Assign triaged tickets to fleet members and keep the flow moving without collisions — one owner per file, a small queue per builder, self-contained task briefs, report statuses that say what a member needs, rulings instead of stalls, rebalancing idle and overloaded members. Use as the delivery lead or the lead whenever tickets are `triaged`, a member goes idle, reports back or gets stuck, and at the code freeze.
---

# Dispatch work

The dispatcher's job is flow: every builder has exactly one ticket in progress and the next one queued, no two members edit the same file, nobody waits on a message, and no question parks the fleet.

## Assign

For each `triaged` ticket, top of the queue first:

1. **Owner** = the member whose area (`ROSTER.md`, the protocol's Members table) contains the ticket's Area. If no area fits, give it to the closest member and widen their area in `BOARD.md` explicitly — never let two members share a path. Barrel/index files, lockfiles and shared config have exactly one owner.
2. **Verifier** = a tester or reviewer other than the owner.
3. A ticket too big for one member, spanning areas, or with several plausible causes → a crew (see `swarm-ticket`).
4. Set `Owner`, `Verifier`, status `assigned`, a Log line, and add it to the member's queue in `BOARD.md`.

**Limits: one `in-progress` and at most two `assigned` per builder.** A longer queue hides work from others and goes stale.

## Order: shallow graphs, critical path first

- Independent tickets run in parallel; a ticket that changes a shared interface goes first and alone, and the tickets that use it start after it is `integrated` (or against a contract stub — see `swarm-ticket`).
- Prefer wide, shallow dependency graphs over long chains; add a dependency only when it is real. The longest chain sets the earliest finish — staff it first.
- Two tickets waiting on each other is a deadlock: break it with a stub or a contract decision (see `discuss-and-decide`).

## Brief, not hint

A member starts with none of your context. When a ticket alone is not enough, its Log line (or a child ticket) carries a brief:

```markdown
Objective: <one or two sentences>
Files you may change: <paths>; read-only: <paths>
Consumes: <interfaces, fixtures from other tickets — exact names>
Produces: <what others will build on — exact names>
Done when: <the acceptance criteria / the command that proves it>
Out of scope: <what not to touch>
Ask: <who, for what>
```

Pass files and paths, not pasted history: a brief describes one task, never the session so far.

## What members report back, and what you do

Ask every member to end a piece of work with one of these statuses in the ticket Log:

| Status | Means | You |
|---|---|---|
| `done` | criteria met, evidence attached | hand to integration / verification; queue the next ticket |
| `done-with-concerns` | done, but something worries them | read the concern; file a ticket or open a thread if it is real |
| `needs-context` | cannot continue without an answer | answer now, or name who will and by when |
| `blocked` | stopped by something outside their control | unblock (decision, stub, reassignment) or move them to other work |

## Rulings, not stalls

When a ticket is ambiguous, a plan has a defect, two requirements conflict or a cap would be exceeded, **decide** and record it rather than parking the fleet on a question:

```text
- 14:40 delivery-lead: Ruling: export keeps CSV only — the criteria say "a file the owner can open"; XLSX doubles the work — if wrong: one more ticket after the freeze.
```

Stop and ask the lead (who asks the user) only for: something irreversible or destructive, something security-sensitive, a side effect outside the fleet's workspace (a push, a merge to the base branch, a publish, a paid call), or a goal so unclear that every path is a guess.

## Keep it moving

Between tasks, scan the board:

| Signal | Likely cause | Action |
|---|---|---|
| a member with nothing `assigned` | uneven queue | next ticket in their area, or a test/review task |
| `in-progress` for 45+ minutes, no Log line | stuck or silent | ask for a status line; offer to split the ticket or add a navigator |
| one member holds 3× the others' queue | overloaded | reassign the tail of their queue |
| every ticket blocked | a dependency problem | resolve the critical path first |
| `fixed` piling up | integration lagging | ask the release manager for a round |
| `integrated` piling up | verification lagging | ask the verifiers; move a builder to testing |
| `reopened` | a fix that missed | back to its owner, top of their queue, with `respond-to-review` |

Record each nudge in the ticket's Log so the dashboard and the final report show it. Message members with the `team-communication` rules: the doorbell points at the ticket.

## Model per task

When you start or ask for help on a task, match the model to the work: a mechanical change with a complete spec suits the cheapest model; multi-file integration and debugging a standard one; design and the final review the most capable. Turn count beats token price — a model that needs three times the turns costs more.

## Code freeze

At the freeze, assign nothing new to builders; move unstarted tickets to `deferred` ("not started before freeze"), point everyone at verification and reports, and post the freeze in `NOTICES.md`.
