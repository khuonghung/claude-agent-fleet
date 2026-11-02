---
name: discuss-and-decide
description: Run a short, written discussion between fleet members in a board thread and end it with a recorded decision — frame the question, lay out options with a recommendation, collect structured answers by a deadline, decide, and follow through. Use when a choice spans areas or members (an interface, a design, a conflicting requirement, how to split a shared ticket), when members disagree, or when an acceptance criterion is unclear.
---

# Discuss and decide

A fleet loses more time to undecided questions than to wrong decisions. A good discussion is short, written, has one owner, a deadline, and ends in a decision everyone follows. It happens in a thread: `threads/<topic>.md` (format in the protocol, "Working together").

## When to open one

- A change crosses areas: an interface, a shared type, a migration, a convention.
- Two reasonable approaches exist and the choice matters to someone else.
- Acceptance criteria are ambiguous or contradict each other.
- Members disagree, or a reviewer and an owner disagree about a finding.
- A ticket needs several members (see `swarm-ticket`).

Do not open one for what you can decide alone inside your area, or for what the board already answers.

## 1. Look before you ask

Read the ticket, the code involved and the project's conventions until you can explain how it works today and what the change touches. A question the code answers wastes everyone's turn.

## 2. Frame it (the opener)

Write the thread header — `Status: open`, `Ticket`, `Owner` (who decides: the area owner for an area question, the architect for cross-cutting design, the product owner for scope and acceptance, the delivery lead for who-does-what), `Members` (only those whose answer you need), `Decide by` (15–30 minutes for most questions; never past the next phase change) — then the `## Context`:

```markdown
## Context
Question: <one sentence, answerable>
Why it matters: <what it blocks or changes, which tickets>
Known: <facts, with `path:line`, ticket ids, measurements>

Options:
A. <approach> — cost: <…>; risk: <…>; touches: <areas>
B. <approach> — cost: <…>; risk: <…>; touches: <areas>
Recommendation: <A or B>, because <the one fact that decides it>.
Default if nobody answers by <time>: <option>.
```

Two or three options, each with its real cost; always a recommendation and a default. Then ring the doorbell to each member (see `team-communication`).

## 3. Answer (each member, once per round)

Post one structured answer:

```markdown
### 14:12 dev-web · agree
B works for the portal; I need `expiresAt` in seconds, not ms.

### 14:15 test-api · concern
B breaks the retry test in `tests/client.test.ts:88` (it assumes A's error shape). Evidence: <output>.
Proposed change: keep A's error shape inside B. Blocking: no.
```

- **Open with your point**, the way you would say it across the table: agree or not, what must change, what you need from whom (`@id`). Evidence follows it and stays — the thread is the record — but a post that opens with a commit range or a list of files makes everyone dig for its meaning. Write in the mission's language, with its accents.
- Kinds: `agree`, `concern`, `proposal` (a better option), `question`, `answer`.
- A concern carries **evidence** and says whether it is **blocking** (you cannot live with it) or not.
- Argue the technical point, not the person; no performative agreement — "agree" with the condition that matters, or a concern with evidence.
- One post per round; read all posts before you write.
- Do not act on a point still open: a change made before the owner decides is undone when they choose otherwise. Wait for the decision, or the deadline and its default.

## 4. Decide (the owner)

By `Decide by`, or as soon as every member answered:

1. Weigh the blocking concerns first; a non-blocking concern is noted, not a veto.
2. Write the decision post and the header:

```markdown
### 14:25 architect · decision
B, with A's error shape kept (test-api's concern). dev-api changes `src/contracts/auth.ts` by 15:00; dev-web builds against it after `ready`.
Not chosen: A — needs a migration we cannot verify before the freeze.
Revisit if: token refresh shows up in the e2e failures.
```

   Set `Status: decided`, fill `Decision:` with one plain sentence — what was chosen and who does what, readable without the posts, since the dashboard shows it on the discussion ("B, keeping A's error shape; dev-api changes the auth contract by 15:00", not "B per 14:25, see posts") — and copy it to the ticket's `Decision` line and Log.
3. Turn the decision into work: tickets, owners, the order (who goes first, what "ready" means).

If the discussion does not converge in two rounds, the owner decides anyway; if the owner cannot (the question is above their role), escalate one level (see `team-communication`) with the thread as the record.

## 5. Follow through

- Everyone follows the decision, including those who disagreed ("disagree and commit"). Their concern stays in the record.
- Reopen only with **new evidence** (a failing test, a measurement), as a new post with kind `concern`, addressed to the owner.
- When the work is done, the owner sets `Status: closed` with a last post pointing at the commits or tickets.

## Smells

- A thread with no `Owner` or no `Decide by` — nobody will decide.
- Ten posts and no options — reframe as options and a recommendation.
- The same two members going back and forth — the owner decides now.
- A decision made in a direct message — write it in the thread, or it did not happen.
- Posts that open with hashes, file lists or "see post 23:51" — say the point first, then the evidence.
