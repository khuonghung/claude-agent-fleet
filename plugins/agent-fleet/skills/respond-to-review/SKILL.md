---
name: respond-to-review
description: Handle review findings, a reopened ticket or a teammate's change request with technical rigour — understand every item, verify it against the code, push back with evidence when it is wrong, fix one item at a time with a test, and answer in the ticket or thread. Use when a ticket comes back reopened, a reviewer files findings on your change, or a teammate asks you to change your work.
---

# Respond to a review

A finding is a claim about the code, not an order and not an insult. Your job is to find out whether it is true for this codebase, then act on what is true.

## The sequence

1. **Read everything** before acting: all findings, the reopened ticket's evidence, the thread.
2. **Restate** each item in your own words. An item you cannot restate is unclear — **ask about it before implementing anything**, because items are often related and a partial understanding produces the wrong fix.
3. **Verify** each item against the code: reproduce the failure the verifier showed; read the code at `path:line`; check whether the suggested change breaks something else, whether there was a reason for the current code, whether it holds on every platform the project supports.
4. **Decide** per item: fix, push back, or ask.
5. **Fix one item at a time**, each with its test and the checks, in this order: blocking (broken behaviour, security) → simple → complex.
6. **Answer** in the ticket Log or the thread, per item.

## Answers that work

- Fixed: `R-012 fixed in dev-api @ 4b1e2a0 — empty email now rejected at src/validators/user.ts:87; test added; package tests green (output).`
- Pushback, with evidence: `R-013: keeping the legacy branch — the portal still calls v1 (apps/portal/src/api.ts:22). Remove both together in a follow-up? Filed T1-031.`
- Not needed: `R-014: grepped — nothing calls this endpoint. Remove it instead of adding filters?`
- Cannot verify: `R-015: needs the staging database to reproduce. Leaving it open; asked op-ci in the team channel.`

No performative agreement ("great catch!", "you're absolutely right"), no thanks, no long apologies — state the fix or the reason. If you pushed back and were wrong: "Checked — you were right, X does Y. Fixing." and move on.

## Push back when

- the change would break existing behaviour or another member's area;
- the reviewer lacks context you can show (a caller, a requirement, a decision in a thread);
- it adds something nothing uses (YAGNI — grep for callers first);
- it is wrong for this stack or conflicts with the project's conventions or an earlier decision.

Push back with code, tests and links, in the ticket or thread. If it is a design disagreement, open or join a thread (see `discuss-and-decide`) and let its owner decide — do not argue in Log lines.

## A reopened ticket

Set it to `in-progress` with a Log line as you pick it up, so the board shows it is being worked. Treat it as a new bug in your fix: reproduce the verifier's failing check first (see `investigate-bug`); do not patch around the check. When it passes, set the ticket back to `fixed` with the new commit, the check's output, and a line on what the first fix missed.
