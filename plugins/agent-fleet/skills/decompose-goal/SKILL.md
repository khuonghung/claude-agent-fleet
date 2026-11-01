---
name: decompose-goal
description: Break a fleet goal (or an epic, an audit area, a large ticket) into small, independent, testable tickets with one owner each — choose how to split (by slice, component, concern or file ownership), put contracts at the seams, draw a shallow dependency graph and staff the critical path. Use when a fleet starts, when a product owner or delivery lead plans the next batch of work, or when a ticket turns out too big for one commit.
---

# Decompose a goal into tickets

A fleet goes as fast as its work splits. The aim: tickets that members pick up **in parallel without touching the same files**, each small enough for one commit and one verification, and together enough to meet the goal.

## 1. Pin down "done"

Write the goal as one sentence and the check that proves it: a command that goes green, a report that exists, a list of tickets verified. If you cannot name the check, settle it with the lead first (see `discuss-and-decide`) — splitting an unclear goal multiplies the confusion.

## 2. Map the ground

Read before you split: the layout, packages and apps, the test commands, CLAUDE.md / AGENTS.md, and the areas in `ROSTER.md`. Note the **seams** — module boundaries, public interfaces, test suites — because good tickets follow them, and note the shared files (barrels, lockfiles, config) that need a single owner.

## 3. Choose how to split

| Split by | Best for | Watch out |
|---|---|---|
| **Vertical slice** — one behaviour end to end | features; each slice testable alone | shared utilities duplicated |
| **Component** — one module each | modular code, services | cross-module flows need an integration ticket |
| **Concern** — security, performance, docs… | audits and reviews | findings overlap; dedupe |
| **File ownership** — one directory each | parallel building, no conflicts | tickets that cross directories need contracts |

Most goals mix them: slices for features, a contract ticket for shared infrastructure, a concern pass at the end.

## 4. Cut the tickets

Each ticket is:

- **One area** — its files sit in one member's `owns`. Spanning two areas: split at the interface, and make a **contract** ticket first (the types, the endpoint shape, the fixture), owned by one member and read-only for the others.
- **One commit** — describable in one commit subject.
- **One check** — testable acceptance criteria (see `write-ticket`).
- **Independent** — it can start now, or names exactly what it waits for (`Depends on: <ID>`).
- **15–60 minutes** of a builder's work. Bigger → an epic with child tickets, or a crew (see `swarm-ticket`); smaller → merge into a neighbour.

## 5. Shape the graph

- Prefer **wide and shallow**: many independent tickets feeding an integration step, not a long chain. Add a dependency only when it is real.
- The **critical path** (the longest chain) sets the earliest finish: start it first and put your strongest members on it.
- Order: unblockers first (contracts, fixtures, a red baseline), then the riskiest work, then the rest.
- No cycles: two tickets that need each other become one ticket, or a contract plus two tickets.

## 6. Write them down

One file per ticket in `tickets/` with your id prefix, status `new`, in the protocol's format. Add the plan to `BOARD.md`: id, title, area, depends-on, and the critical path marked.

## Checks before you hand it over

- [ ] Every ticket has exactly one area and one owner-to-be; shared files have one owner.
- [ ] No two tickets that can run at the same time change the same file.
- [ ] Every cross-area seam has a contract ticket that comes first.
- [ ] Every ticket has testable acceptance criteria.
- [ ] Dependencies are written, the graph has no cycle, the critical path is marked.
- [ ] The tickets together meet the goal's check, and nothing on the list is outside the goal.
