---
name: integrate-branches
description: Merge the builders' branches into the fleet's integration branch safely — one branch at a time, the full checks after each merge, red merges backed out, tickets moved to integrated and verifiers told. Use as the release manager on every integration round, and by the lead when there is no release manager.
---

# Integrate branches

The integration branch is the one place where everyone's work meets. Keep it green: the testers verify on it and the owner reviews it at the end.

## Before the first round

1. Your worktree's branch is the integration branch; write it in `ROSTER.md`.
2. Make sure the tests can run here (`fleet doctor` names the env files a worktree lacks and the variables turbo drops). A worktree has no untracked files: copy the `.env` (or whatever the tests read) from the main checkout, start the services they need, and check the test runner passes the variables through (a task runner such as turbo may drop `DATABASE_URL` unless it is declared). A suite that skips itself for want of a database is not green, it did not run.
3. Run the project's full checks on it once (install, build, typecheck, lint, tests) and record the **baseline** in your report: the exact commands, and per suite how many tests passed, failed and were **skipped**. Later rounds are judged against it.

## Each round (about every 30 minutes, or when several tickets are `fixed`)

1. Run `fleet integrate` (read-only; the fleet CLI from your brief). It lists the `fixed` tickets in merge order, each with its commit, the packages it touches and the exact `git merge` command with its message; fixes another fix brings along are merged together; it names the fixes that are **blocked** because unready work sits below them, the ones **already in** the integration branch, the ones with no commit found, commits with no ticket, and whether the round needs the full suite. Read it, then act on it below — it merges nothing.
2. Merge only what is ready: the commits of `fixed` tickets. When a branch carries a commit of a ticket that is not `fixed` (in progress, `deferred`) below the one you want, do not merge it — the unready work would come along. Ask the owner to move the ready commit onto its own branch from the integration head, and say so in both tickets. When the unready commits sit above, merge up to the ready commit only (`git merge --no-ff <sha>`).
3. Merge **one branch at a time**, in dependency order (interfaces first), with a message that says what came in — never git's default `Merge branch '…'`:

   ```
   git merge --no-ff <branch or sha> -m "merge(<scope>): <what it brings, in a few words>" -m "Tickets: DA-004, DA-007"
   ```

   `<scope>` is the area or package; follow the project's own convention for merge messages when it has one (CLAUDE.md, AGENTS.md, CONTRIBUTING). The owner reads this history; a message fixed later means rewriting it. Never rebase, reset or edit a builder's branch; never touch the base branch; never push.
4. After **each** merge, run the checks of the packages it touched and of the packages that depend on them. Run the full suite once at the end of a round when it touched shared code (root config, the lockfile, a package others import), and always at the freeze; a round of one builder's changes in one package needs only that package and its dependents.
5. Read the counts, not the colour: compare passed, failed and skipped per suite with the baseline. **More tests skipped than the baseline is red** until you know why (a missing variable, a service down) and have run them. A test that times out: run its file alone once before you call the merge red — with many members on one machine a timeout may be load, not the change; say in the Log that you re-ran it.
6. **Green** → set each merged ticket to `integrated` (`fleet ticket set <ID> integrated --by <your id> --note '…'`) with the merge commit, the exact commands and their counts (`pnpm turbo test --filter=api...` → 214 passed, 0 failed, 3 skipped (baseline 3)) in its Log (see `verify-before-done`), and tell its verifier.
7. **Red** → find the merge that broke it. Back it out (`git revert -m 1 <merge>` or `git reset --hard` to before the merge, if you have not built on it), set the ticket to `reopened` with the failing output, and tell its owner. Do not fix builders' code yourself.
8. **Conflict** → do not resolve conflicts in code you do not own unless the resolution is mechanical (both sides' lines kept, no logic change). Otherwise abort the merge, write the conflicting files in the ticket and ask the two owners which side wins; the later ticket's owner rebases their work onto the integration branch on their own branch.

## Housekeeping

- Long-lived processes (servers, watchers) are yours alone; start them once, stop them by PID only.
- Keep a round log in `reports/<your id>.md`: time, branches merged, the commands and their pass/fail/skip counts, reverts.
- At the code freeze, run the last round, then the full suite, and record the final state: integration head, what is in it, what is green, what is not.
