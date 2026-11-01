---
name: team-communication
description: How fleet members talk to each other — which channel for what (ticket, thread, direct message, notice), how to write a message a busy agent can act on, when to speak up (interfaces ready, blocked, done), how to wait without stalling, and how to break deadlocks and escalate. Use before you message a teammate, when you need an answer from another member, when you are blocked on someone, or when teammates are not coordinating.
---

# Team communication

Fleet members are separate Claude Code sessions (or subagents). None of them sees your context, and a message to a busy session **waits until its current turn ends** — minutes, sometimes an hour. Communication that works under those conditions is written, self-contained and asynchronous.

## Pick the channel

| You need to… | Channel | Why |
|---|---|---|
| hand over, assign or report on work | the **ticket** (`Owner`, `Status`, a `## Log` line) | the dashboard, the verifier and the final report read it |
| discuss, ask a question across areas, decide something, coordinate a shared ticket | a **thread** `threads/<topic>.md` (see `discuss-and-decide`) | several members, a written record, a decision at the end |
| get one member's attention to something already written | a **direct message**: the doorbell | it wakes an idle session and is read when a busy one finishes its turn |
| tell everyone about something that changes their work (shared file changed, base moved, freeze) | `NOTICES.md` + a direct message to those affected | a broadcast to everyone costs every member a turn |

**A message never carries the only copy of anything.** Write the substance in the ticket or thread, then ring the doorbell pointing at it. If the recipient's context is compacted or the message lands mid-task, the board still has it.

## Write a message that can be acted on cold

```text
<ticket or thread> — <what you need> — <by when>
<one or two lines of context or the exact question>
```

- `T1-014 — need your answer on the retry policy in threads/T1-014.md — by 14:30`
- `DA-003 ready — the /api/items contract is in src/contracts/items.ts @ 3f2a1c9; you can build against it`
- `blocked on PO-007: the acceptance criteria contradict (see Log 13:52) — which wins?`

Rules: address members by their **id** (from `ROSTER.md`), never by role or a session UUID; one subject per message; say what you need back (an answer, a review, nothing); no status JSON, no pleasantries, no "great point!".

## When to speak up — and when not to

Message **at integration points**, not at every step:

- an interface, contract, fixture or migration another member builds on is **ready** (commit and path);
- you are **blocked** and know who can unblock you;
- you **changed something others depend on** (a shared type, a config, a script) — before you commit it, in the thread;
- you **finished** work someone is waiting for (the ticket status says it; the doorbell makes sure they look);
- you **disagree** with a decision that affects your area — in the thread, with evidence.

Do not: send routine progress updates (the ticket Log is for that), micromanage another member's steps, broadcast what concerns two people, or ask what the board already answers — read `BOARD.md`, the ticket and the thread first.

## Wait without stalling

- Never end your turn or sit idle just to wait for an answer while you have other work: do the next ticket, write the test, read the code you will need, and re-read the thread between steps.
- With nothing else to do, wait in **bounded** stretches: `Monitor` with an until-loop on the thread or ticket file (for example "until the file changes, at most 10 minutes"), then re-check, post one line of status if useful, and wait again. Never `sleep` in a loop, never an open-ended wait.
- When you ask a question, offer a **default**: "if no answer by 14:30 I go with option B". Silence then costs nothing.

## Answer others

Read your mentions between tasks: `grep -l "<your id>" threads/*.md tickets/*.md`. Answer by the deadline you were given, in the thread, even if the answer is "I don't know — ask dev-web". A question to you that sits unanswered blocks someone.

## Deadlocks and escalation

- **Two members waiting on each other**: one of them unblocks the other with a stub, a mock or a provisional contract, written in the thread; the real thing replaces it later.
- **No answer by the deadline**: go with the default you announced and say so in the thread.
- **Disagreement that does not converge** in two rounds: the thread's owner decides. Above that: the member's manager (`reportsTo`), then the delivery lead, then the lead; only the lead asks the user.
- **A member silent for 30 minutes** on something you need: tell the delivery lead (or the lead) in `NOTICES.md`; they wake or reassign.

## Before you stop

Answer or hand over every open question addressed to you, post `handoff` in each thread you are part of (what is done, what is open, who takes it), and write your report.
