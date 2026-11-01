---
name: verify-before-done
description: Prove a claim before you make it — identify the command that proves it, run it fresh, read the whole output, attach the evidence — before marking a ticket fixed, integrated or verified, posting `ready` in a thread, or reporting work as done; and never trust a teammate's "done" without checking it. Use every time you are about to say something works, passes, is ready or is finished.
---

# Verify before you call it done

In a fleet, one false "done" costs three members: the builder who moves on, the release manager who merges it, the tester who finds it again — and every teammate who builds on a `ready` that was not. A status is a claim, and a claim needs fresh evidence that anyone can check.

## The rule

**No status change, no `ready`, no "done" without the command and its output, run after your last change.**

## The gate

Before any claim:

1. **Identify** the command that proves it — the acceptance criterion and what exercises it.
2. **Run** it now, complete, on the code the claim is about (your commit; the integration branch for `integrated` and `verified`).
3. **Read** the whole result: exit code, failures, skipped tests, errors printed above the summary.
4. **Compare**: does the output show the claim? No → state the real status with the output. Yes → state the claim **with** the output.

```markdown
- 14:32 dev-api: fixed on dev-api/fix @ 3f2a1c9 — `pnpm --filter api test` → 214 passed, 0 failed, 0 skipped; `pnpm --filter api typecheck` → 0 errors; repro from the ticket now returns 200 (output below)
```

## What proves what

| Claim | Needs | Not enough |
|---|---|---|
| tests pass | the test command's output: 0 failures | an earlier run; "should pass" |
| the bug is fixed | the original repro now behaves as expected | the code changed |
| the regression test works | it failed before the fix and passes after | it passes once |
| types/lint clean | that tool's output: 0 errors | the build passing |
| an acceptance criterion is met | that criterion exercised, line by line | the test suite passing |
| a teammate's or subagent's work is done | the diff (`git show`) and its checks run by you | their message saying so |
| `ready` for teammates | committed, the path and sha, the consumer's view working (an import compiles, an endpoint answers) | "pushed to my branch" |

## Red flags — stop and run the check

"should", "probably", "seems to", "looks right", "I'm confident", "just this once", "the linter passed so it builds", "they said it works", satisfaction before evidence ("Done!", "Perfect!"), or being tired and wanting to move on.

## Who may set what

| Status | Who | Evidence |
|---|---|---|
| `fixed` | the owner | the new test failing before and passing after; the package's checks green |
| `integrated` | the release manager | the merge commit; the full check suite green on the integration branch |
| `verified` | the verifier — never the owner or a crew member | each acceptance criterion exercised on the integration branch, with output |
| `reopened` | the verifier | the criterion that failed, the command and its output |

## When the check fails

Say so plainly, with the output. A red result is information; a hidden one is a defect in the report. Set the status that is true (`in-progress`, `reopened`) and write the next step.

## When you cannot check

If the check needs something you do not have (a service, credentials, a platform), do not guess: write exactly what is unverified and why, leave the status where it is, and tell the delivery lead. "Unverified: needs the staging DB" is a fine Log line; "verified" without it is not.
