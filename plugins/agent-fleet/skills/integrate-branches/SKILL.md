---
name: integrate-branches
description: Merge the builders' branches into the fleet's integration branch safely — one branch at a time, the full checks after each merge, red merges backed out, tickets moved to integrated and verifiers told. Use as the release manager on every integration round, and by the lead when there is no release manager.
---

# Integrate branches

The integration branch is the one place where everyone's work meets. Keep it green: the testers verify on it and the owner reviews it at the end.

## Before the first round

1. Your worktree's branch is the integration branch; write it in `ROSTER.md`.
2. Run the project's full checks on it once (install, build, typecheck, lint, tests) and record the **baseline** in your report: what passes, what already fails. Later rounds are judged against it.

## Each round (about every 30 minutes, or when several tickets are `fixed`)

1. List the `fixed` tickets and their `Fix:` branches and commits.
2. Merge **one branch at a time**, in dependency order (interfaces first): `git merge --no-ff <branch>`. Never rebase, reset or edit a builder's branch; never touch the base branch; never push.
3. After **each** merge, run the checks of the packages it touched; after the round, run the full suite once.
4. **Green** → set each merged ticket to `integrated` with the merge commit and the check output in its Log (see `verify-before-done`), and tell its verifier.
5. **Red** → find the merge that broke it. Back it out (`git revert -m 1 <merge>` or `git reset --hard` to before the merge, if you have not built on it), set the ticket to `reopened` with the failing output, and tell its owner. Do not fix builders' code yourself.
6. **Conflict** → do not resolve conflicts in code you do not own unless the resolution is mechanical (both sides' lines kept, no logic change). Otherwise abort the merge, write the conflicting files in the ticket and ask the two owners which side wins; the later ticket's owner rebases their work onto the integration branch on their own branch.

## Housekeeping

- Long-lived processes (servers, watchers) are yours alone; start them once, stop them by PID only.
- Keep a round log in `reports/<your id>.md`: time, branches merged, check results, reverts.
- At the code freeze, run the last round, then the full suite, and record the final state: integration head, what is in it, what is green, what is not.
