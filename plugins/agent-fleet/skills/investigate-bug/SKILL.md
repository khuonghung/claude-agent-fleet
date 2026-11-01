---
name: investigate-bug
description: Find the root cause of a bug, failing test or unexpected behaviour before fixing it — reproduce, trace, form and test one hypothesis at a time — and, for a hard bug, split competing hypotheses across several fleet members and arbitrate on evidence. Use before proposing any fix, when a first fix did not work, and when a bug spans components or has several plausible causes.
---

# Investigate a bug

**No fix without a root cause.** A fix for a symptom moves the bug, costs a reopened ticket and a second verification. Under time pressure this matters more, not less: systematic is faster than guessing.

## Alone: four phases, in order

### 1. Reproduce and read

- Read the whole error: message, stack trace, file and line, exit code. Warnings too.
- Reproduce it reliably from a clean state, with the exact command. Not reproducible → gather data (logs, inputs, timing), do not guess.
- What changed? `git log` and `git diff` on the area, new dependencies, config, environment.
- In a system with several components (client → API → service → database, CI → build → script), find **where** it breaks before **why**: log what enters and leaves each boundary once, run it, and read which boundary is wrong.

### 2. Compare

- Find a similar path that works (another endpoint, the previous version, a passing test) and list every difference, however small.
- Trace the bad value backwards: where does it come from, who called this with it — up to the source. Fix at the source.

### 3. Hypothesis, then a minimal test

- Write one hypothesis: "X is the root cause because Y" — in the ticket's Log.
- Test it with the **smallest** change or probe, one variable at a time.
- Confirmed → phase 4. Refuted → a new hypothesis from what you learned; do not stack fixes.

### 4. Fix

- First a failing test that reproduces the bug (see `plan-ticket`), then **one** fix at the root cause, then the checks.
- The fix does not work → back to phase 1 with what the attempt showed.
- **Three fixes failed** → stop fixing. The problem is likely structural (a wrong assumption, shared state, a design that fights the case). Write it up and open a thread with the architect or the area owner (see `discuss-and-decide`) before a fourth attempt.

Red flags that send you back to phase 1: "just try this", "probably", a fix you cannot explain, several changes at once, a test edited to pass.

## Together: competing hypotheses

For a bug with several plausible causes, one nobody could reproduce, or one that spans areas, the ticket's owner runs a parallel investigation (the `swarm-ticket` crew pattern):

1. **List hypotheses** across the usual failure modes — logic (wrong condition, off-by-one, missing case), data (null, type, encoding, truncation), state (race, stale cache, initialisation, shared mutation), integration (contract mismatch, version, configuration, environment variables), resources (leaks, pool exhaustion, limits), environment (platform, permissions, time zone, locale). Keep the 2–3 most plausible.
2. **One investigator per hypothesis**, in the ticket's thread: the hypothesis, what would confirm it, what would refute it, and a deadline (30 minutes is typical). Investigators read and probe; they do not change product code.
3. **Each reports** a post of kind `answer`:

```markdown
### 15:05 qa-api · answer
Hypothesis 2 (stale cache): **confirmed**, confidence high.
For: `src/cache.ts:41` keys by user id only, the failing request differs by tenant (log below). Reproduced with two tenants: <command + output>.
Against: none found.
```

   Evidence ranks: **direct** (code at `path:line`, a reproduction) > **correlational** (started after commit X) > **absence** (no null check on the path) > **testimonial** ("it works for me"). Confidence: high (several direct pieces, a clear causal chain, nothing against), medium, low.
4. **The owner arbitrates**: each hypothesis is confirmed, plausible, refuted or inconclusive. One confirmed → the root cause; several confirmed → a compound cause, fix each; none → new hypotheses from the evidence gathered. The decision post names the root cause and who fixes it.
5. **The fix** follows phase 4 above, by the area's owner, verified by someone outside the crew.

## Record

The ticket ends with: the root cause (one paragraph, `path:line`), the evidence, the hypotheses ruled out and why, the fix commit and the test that pins it. The next person who meets a similar bug starts from there.
