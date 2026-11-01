---
name: status-report
description: Write a short, factual fleet status — progress, plans, problems — for the board, a phase change, a member's end report or the final report for the owner. Use when the lead, a delivery lead or any member reports on where the work stands.
---

# Write a status report

A status is read in under a minute by someone deciding what to do next. Lead with what changed, back every claim with a ticket id or a number, and say plainly what is not done.

## The shape: Progress · Plans · Problems

```markdown
## Status <HH:MM> — <phase>, <time left>

**Progress**
- <n> tickets verified (<ids>), <n> integrated awaiting verification, <n> in progress.
- <the one or two results that matter most, with ticket ids>

**Plans** (until <next checkpoint>)
- <who does what next, by ticket id>

**Problems**
- <blocker or risk> — <what it affects> — <who is on it / what is needed from whom>
```

Rules:

- **Numbers from the board**, not memory: count tickets by status from `tickets/`, take token use from the dashboard.
- **Ids, not adjectives**: "T1-014 fixed and verified" beats "good progress on the API".
- **Bad news first in Problems**, with what is needed to unblock it. A risk that is not written down is not managed.
- Keep it under 15 lines on the board; detail belongs in the tickets.

## A member's end report (`reports/<id>.md`)

What you did (tickets, commits), what you found (tickets filed), what is left and how you would do it, and anything the next person must know (a flaky test, a trap in the code). Write it before your window ends, even if you are interrupted.

## The final report for the owner (`FINAL-REPORT.md`)

1. **Outcome** against the goal's check, in one paragraph: met, partly met (what is missing), not met.
2. **What to review**: the integration branch, its head, the commits in it, and the checks' result on it.
3. **Tickets**: verified, integrated but unverified, deferred (with reasons), won't do — each as a short table.
4. **Risks and follow-ups**: what the owner should look at first, and the next backlog.
5. **Cost**: duration, members, output tokens against the budget.

Never round "integrated" up to "verified", and never leave out what failed.
