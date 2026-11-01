---
name: plan-ticket
description: Plan the implementation of one assigned ticket before touching code — root cause, the exact files, the interfaces it consumes and produces, steps with checkable results, the test that proves it, the commands — record it in the ticket, then work it test first. Use as a builder when you start a ticket, especially one that spans several files, touches an interface others use, or whose fix is not obvious.
---

# Plan a ticket

Ten minutes of planning saves a reopened ticket. The plan lives in the ticket, so the verifier, a reviewer, a navigator or whoever takes over can follow it — and so you can, after a context compaction.

## 1. Understand

- Read the ticket, its acceptance criteria, its Log and any thread about it.
- Reproduce the problem (or, for new work, run the closest existing behaviour). Cannot reproduce → say so in the Log and ask the author before going on.
- Read the code around it and its tests; read the project's conventions (CLAUDE.md / AGENTS.md) and follow the patterns of the neighbouring code.
- For a bug, find the root cause first (see `investigate-bug`).
- Check scope: if the ticket hides two independent changes, split it now.

## 2. Write the plan

Append to the ticket, under `## Plan`:

```markdown
## Plan
Root cause / approach: <one or two sentences, with `path:line`>
Files:
- Modify: `src/export/csv.ts:40-72` — <what and why>
- Create: `src/export/csv.test.ts`
Interfaces:
- Consumes: `ItemRow` from `src/contracts/items.ts` (DA-003)
- Produces: `toCsv(rows: ItemRow[]): string` — used by DW-007
Steps:
1. Write the failing test `exports quoted commas` → run it, see it fail on the assertion (not on an import)
2. Implement `toCsv` quoting → run the test, see it pass
3. Run the package checks: `pnpm --filter api test && pnpm --filter api typecheck` → 0 failures, 0 errors
4. Commit: `fix(api): quote commas in csv export`
Out of scope: <what you will not change; tickets filed for it>
Risk: <what could break, and the test that guards it>
```

Each step is **one action with a checkable result**. Exact paths and names, not "the export module"; the exact command and the output that means success. The `Produces` names are a promise to teammates: if they change, say so in their thread before you commit.

Self-check before you start: every acceptance criterion maps to a step or a test; names are the same everywhere in the plan; the plan touches only your area (a file outside it → ask its owner, or split the ticket).

## 3. Work it, test first

1. Write the test that fails for the reason in the ticket; run it and **watch it fail** for that reason.
2. Make the smallest change that makes it pass.
3. Run the checks you listed — all green.
4. Read your own diff once as a reviewer would (see `review-change`): debug leftovers, unrelated edits, missing edge cases.
5. Commit once, with the project's commit convention. Set the ticket to `fixed` with `Fix: <branch> @ <sha>` and a Log line with the commands and their results (see `verify-before-done`).

If the plan turns out wrong, **update the Plan section first**, then change direction — the next reader needs the plan that was followed. If you are stuck after two attempts, report `blocked` or `needs-context` (see `dispatch-work`) instead of improvising outside the plan.
