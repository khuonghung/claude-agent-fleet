---
name: review-change
description: Review a fleet member's change (a commit, a branch, an integrated merge) against its ticket — correctness, tests, security, performance, conventions, scope — with calibrated severity and one ticket per real finding; and organise a multi-reviewer review by dimension with deduplicated, consolidated findings. Use as a reviewer or architect on integrated work, as a navigator in a crew, and as a builder on your own diff before you set a ticket to fixed.
---

# Review a change

A review looks for problems that would reach the owner: wrong behaviour, missing tests, security holes, slow paths, and changes nobody asked for. It is not a style pass, and it is not a rubber stamp.

## Get the change and its intent

- A builder's ticket: `git show <sha>` (or `git diff <base>...<sha>` for several commits) from the ticket's `Fix:` line.
- An integrated merge: `git diff <base>...<integration branch>` limited to the merge's files.
- Read the ticket, its acceptance criteria, its Plan and any thread first: you review **against what the change was meant to do**, and against decisions already made.
- Read the whole function around each hunk, and the callers of anything whose behaviour changed.

## Dimensions

| Dimension | Look for |
|---|---|
| Correctness | For each changed line: which input, state or timing makes it wrong? Null/empty, off-by-one, error paths swallowed, concurrency, time zones, a removed guard not re-established elsewhere. |
| Tests | A test that fails without the change; behaviour tested, not implementation; neighbouring cases still covered; no test weakened to pass. |
| Security | Input reaching a query, shell, path or HTML; secrets in code or logs; permission checks on new routes; outside data trusted. |
| Performance | Work in hot paths, N+1 queries, repeated I/O, unbounded growth. |
| Conventions | The project's CLAUDE.md / AGENTS.md rules and the surrounding patterns — flag only with the rule quoted. |
| Scope | Files outside the ticket's area or criteria; drive-by refactors; another member's files; features nothing uses. |

Pick by change type: an API change → correctness, security, performance; UI → correctness, tests, accessibility; a migration → correctness, performance; auth → security, tests.

## Severity, calibrated

| Severity | Impact | Examples |
|---|---|---|
| critical | data loss, security breach, complete failure — likely | injection, auth bypass, corruption |
| high | a main flow broken or degraded, no workaround | missing validation on a main path, a leak, a broken flow |
| medium | partial impact or a workaround exists | N+1 query, missing edge case, unclear error |
| low | cosmetic or minimal | naming, minor tidy-up |

Rules: anything exploitable from outside is at least high; a slow hot path or a missing test on a critical path at least medium; style without functional impact is low.

## Report

- **A real problem** → its own ticket (see `write-ticket`): `path:line`, the failing scenario (input → wrong result), severity, the dimension; linked from the reviewed ticket's Log.
- **A question** → a Log line (or a thread post) to the owner.
- **Nothing found** → `reviewed <sha>: no findings (correctness, tests, security, performance, conventions, scope)`.

Say what is certain and what is a suspicion. Do not fix the code yourself outside your area — the owner fixes (see `respond-to-review`), you verify.

## Several reviewers on one change

The coordinator (the ticket owner or the architect) gives each reviewer one or two **dimensions** and the same inputs (the ticket, the diff path, the decisions). Do not tell a reviewer what not to flag. Then consolidate:

1. Same `path:line`, same issue → one finding, crediting both; keep the clearer description.
2. Same location, different issues → separate findings, marked co-located.
3. Same issue, several locations → separate findings, cross-referenced.
4. Severities disagree → the higher one; recommendations disagree → both, attributed.

Post the consolidated list in the ticket's thread: counts by severity and dimension, the findings ranked, and a one-line recommendation (merge / fix first / rethink).

Keep a review log in `reports/<your id>.md`: what you reviewed, what you filed.
