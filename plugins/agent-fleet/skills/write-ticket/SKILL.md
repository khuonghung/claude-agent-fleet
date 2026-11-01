---
name: write-ticket
description: Write a fleet ticket that another agent can act on without asking — a precise problem, evidence, severity, area and Given/When/Then acceptance criteria. Use whenever you file a bug, a finding or a task on the board, or when a ticket you were given is too vague to start.
---

# Write a ticket

A ticket is read by someone with none of your context, often hours later. Write it so they can reproduce, fix and verify it from the file alone.

## Format

Follow the board protocol (`README.md` → Tickets). File name = id with your prefix.

```markdown
# <ID>: <what is wrong or wanted, in one line — no "fix", "issue with">

- Status: new
- Severity: critical | high | medium | low
- Area: <path or component>
- Owner:
- Verifier:
- Decision:
- Fix:

## Problem
<What happens> at `<path>:<line>` when <condition>. Expected: <…>. Actual: <…>.

Repro:
1. <exact command or steps, from a clean checkout>
2. <…>

Evidence: <the failing output, trimmed to the lines that matter>

## Acceptance criteria
- Given <state>, when <action>, then <observable result>.
- Given <…>, when <…>, then <…>.

## Log
- HH:MM <your id>: filed
```

## Rules

- **Title**: the symptom or the outcome, specific enough to tell two tickets apart in a list.
- **Evidence over opinion**: paste the command and the output you saw. "Seems slow" is not a ticket; "`GET /api/items` takes 4.2 s with 10k rows (log below)" is.
- **Acceptance criteria**: 2–5, each one a check that passes or fails — no "works well", "is fast", "is clean". Include the case that was broken and one neighbouring case that must keep working.
- **One problem per ticket.** Two root causes → two tickets that link each other.
- **Severity** (the triager may change it):
  - critical — data loss, security hole, the main flow is unusable, the build is red;
  - high — a main flow is wrong for many cases, with no workaround;
  - medium — wrong in some cases, or there is a workaround;
  - low — cosmetic, wording, tidy-up.
- **Duplicates**: grep `tickets/` for the path and key words first. If it exists, append your evidence to that ticket's Log instead.
- **No secrets** in tickets: redact tokens, keys and personal data from output.

## A task, not a bug

For work that is not a defect, replace Problem with **Why** (who needs it and what it unlocks) and **Scope** (in / out), and keep the acceptance criteria.
