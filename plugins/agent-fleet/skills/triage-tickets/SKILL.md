---
name: triage-tickets
description: Triage new fleet tickets — confirm severity, decide do now / defer / won't do, check acceptance criteria, merge duplicates — and rank the backlog for the time left. Use as the product owner (or the lead) whenever tickets are `new`, at every phase change, and when time or budget runs short.
---

# Triage tickets

Triage turns a pile of findings into a ranked queue the builders can trust. Do it often and quickly: a `new` ticket should not wait more than 15 minutes.

## For each `new` ticket

1. **Read it and try the repro** if it is cheap (under 2 minutes). A ticket without a reproducible problem goes back to its author with a question in the Log, status stays `new`.
2. **Duplicates**: grep `tickets/` for the same path and symptom. Keep the clearest one, set the others to `duplicate` with `Decision: duplicate of <ID>`.
3. **Severity**: apply the scale from `write-ticket`; change it if the author over- or under-rated it and say why in the Log.
4. **Acceptance criteria**: make sure there are 2–5 testable ones; add or sharpen them now — builders and testers work from them.
5. **Decision**, with one line of why:
   - `do now` — in the goal, and it fits the time left;
   - `defer` — real but outside the goal or too big for the window; say what it would take;
   - `won't do` — not a problem, or the cost outweighs the value.
6. Set status `triaged` (or `deferred` / `wont-fix` / `duplicate`) and append to the Log.

## Rank what is `do now`

Order the triaged queue in `BOARD.md`, top first:

1. Anything that breaks the build, the baseline checks or other members' work.
2. critical, then high severity.
3. Within a severity, score **ICE** — Impact (1–5) × Confidence the fix works (1–5) × Ease (1–5) — and sort by the score.
4. Unblockers before what they unblock.

## Watch the clock

At each phase change, and whenever less than a third of the window is left, re-check the queue against the time: move `medium`/`low` tickets nobody will reach to `deferred` with "out of time" so the final report is honest, and keep the builders on what can still be verified before the freeze.

## Accepting finished work

When a ticket is `verified`, check it against its acceptance criteria once more (read the verifier's evidence; you do not need to re-run it). Accept with a Log line, or reopen with the criterion that is not met.
