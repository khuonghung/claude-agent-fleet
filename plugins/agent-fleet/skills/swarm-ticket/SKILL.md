---
name: swarm-ticket
description: Work one ticket with several fleet members at once — pick the pattern (split by ownership behind a contract, builder + tester, driver + navigator, parallel investigation, multi-dimension review), set up the crew and its thread, coordinate checkpoints and integration, and close it with one owner accountable. Use when a ticket is too big or too risky for one member, spans areas, or has several plausible causes, and as a crew member of such a ticket.
---

# Swarm a ticket

Most tickets have one owner. Some go faster or come out better with a **crew**: a feature that spans two areas, a bug with several plausible causes, a risky change that needs a second pair of eyes while it is built. A swarm adds coordination cost, so use it only when the gain is clear — and keep it to 2–4 members.

## Choose the pattern

| Situation | Pattern | Crew |
|---|---|---|
| The work spans two or more areas | **Split behind a contract** | one builder per area; the owner holds the contract |
| The acceptance criteria are testable before the code exists | **Builder + tester in parallel** | a builder, a tester who writes the acceptance tests meanwhile |
| A risky or subtle change in one area | **Driver + navigator** | the area's builder drives; a reviewer or architect navigates |
| A bug with several plausible causes, or one nobody can reproduce | **Parallel investigation** (see `investigate-bug`) | 2–3 investigators, one hypothesis each; the owner arbitrates |
| A change that must be checked from several angles | **Multi-dimension review** (see `review-change`) | 2–3 reviewers, one dimension each |

Not a swarm: two members editing the same files at the same time. That always ends in conflicts — split the files or take turns.

## Set it up (the owner)

1. In the ticket: `Owner:` you (accountable, coordinates, integrates), `Crew:` the others, and a Log line naming the pattern.
2. Open `threads/<ID>.md` (format in the protocol) with `Members:` = the crew and a `## Context` that holds the **crew plan**:

```markdown
## Context
Pattern: split behind a contract
Contract: `src/contracts/export.ts` — owned by dev-api, read-only for the others; changed only via a `proposal` here.

| Member | Part | Files (only these) | Done when | Hands to |
|---|---|---|---|---|
| dev-api | export endpoint | apps/api/src/export/** | DA tests green, `ready` posted | dev-web |
| dev-web | export button + download | apps/portal/src/export/** | renders against the stub, then the real API | owner |
| qa | acceptance tests from the criteria | tests/e2e/export.spec.ts | tests written and failing for the right reason | owner |

Checkpoints: 14:30 contract ready · 15:15 parts done · 15:40 integrated and verified
```

3. Each part gets a **self-contained brief** in the table or as child tickets (`<ID>-a`, `<ID>-b`): objective, the files it may change, the interface it consumes and the one it produces, acceptance criteria, what is out of scope. A crew member must not need your context to start.
4. Ring the doorbell to each crew member with the thread path.

## Patterns in practice

**Split behind a contract.** The first deliverable is the contract (types, endpoint shape, fixture), committed by its owner and announced with `ready`. Others build against it — against a stub until the real part is ready. Nobody changes the contract without a `proposal` in the thread and the owner's `decision`. Barrel and index files (`index.ts`, `__init__.py`), lockfiles and shared config get exactly one owner.

**Builder + tester in parallel.** The tester turns each acceptance criterion into a test from the ticket alone, before the code exists, and posts `ready` with the test path; the builder runs them as the definition of done. A test that turns out wrong is fixed by the tester, after a post in the thread — the builder does not edit the tests to pass.

**Driver + navigator.** The driver writes the code on their branch and posts a short `status` at each step (plan, test written, change made). The navigator reads each step as it lands — the plan before code, the diff after each commit — and answers with `agree` or a `concern` with evidence, within one step. The navigator does not write the code; they own the review, a list of edge cases, and the test ideas.

**Parallel investigation.** Each investigator takes one hypothesis, gathers evidence for and against, and posts it with a confidence; the owner arbitrates and assigns the fix. See `investigate-bug`.

## Run it

- **Checkpoints, not chatter**: posts at `ready`, `blocked`, `handoff`, and at each checkpoint time — a one-line `status` if nothing else happened. Read the thread between your own steps.
- **Integration points** are explicit: who goes first, what `ready` means (committed, tests green, path given), who merges. The owner integrates the parts on their branch, or hands the parts to the release manager in dependency order.
- **Rebalance**: a part that runs late is the owner's call — split it, take it over, or move a crew member onto it. Announce it in the thread.
- **Wrong split mid-stream**: stop, re-plan in the thread, and accept the lost work; continuing with a wrong split costs more.

## Close it

1. Every part is `ready`, integrated, and the ticket's acceptance criteria pass with evidence on the integrated code (see `verify-before-done`).
2. The owner sets the ticket to `fixed` (or hands it to the release manager), lists every crew member's commits in the Log, and closes the thread with a final post.
3. The verifier is someone **outside** the crew.

One ticket, one owner: the crew shares the work, the owner keeps the accountability.
