# Notices

The skills in `skills/` are written for Agent Fleet's board protocol (tickets, threads, desktop sessions whose messages
wait until a turn ends). Their methods draw on these open-source collections, read in full while writing them; no text
is copied. Thanks to their authors.

| Skill | Ideas from | License |
|---|---|---|
| `team-communication` | [wshobson/agents](https://github.com/wshobson/agents) `agent-teams`: team-communication-protocols (direct message over broadcast, integration-point messages, deadlock stubs, anti-patterns); [obra/superpowers](https://github.com/obra/superpowers) subagent-driven-development (bounded waits) | MIT |
| `discuss-and-decide` | [obra/superpowers](https://github.com/obra/superpowers) brainstorming (look before you ask, options with a recommendation); subagent-driven-development (rulings instead of stalls) | MIT |
| `swarm-ticket` | [wshobson/agents](https://github.com/wshobson/agents) `agent-teams`: parallel-feature-development (one owner per file, interface contracts, stubs, wrong-split recovery), team-composition-patterns (team sizes) | MIT |
| `investigate-bug` | [obra/superpowers](https://github.com/obra/superpowers) systematic-debugging (four phases, three failed fixes); [wshobson/agents](https://github.com/wshobson/agents) parallel-debugging (competing hypotheses, evidence strength, arbitration) | MIT |
| `respond-to-review` | [obra/superpowers](https://github.com/obra/superpowers) receiving-code-review (verify before implementing, clarify first, reasoned pushback, YAGNI) | MIT |
| `decompose-goal`, `dispatch-work` | [wshobson/agents](https://github.com/wshobson/agents) task-coordination-strategies (split strategies, shallow graphs, task briefs, imbalance signals); [obra/superpowers](https://github.com/obra/superpowers) dispatching-parallel-agents, subagent-driven-development (report statuses, model per task) | MIT |
| `plan-ticket` | [obra/superpowers](https://github.com/obra/superpowers) writing-plans (steps with checkable results, consumes/produces interfaces, self-review), test-driven-development | MIT |
| `verify-before-done` | [obra/superpowers](https://github.com/obra/superpowers) verification-before-completion (the gate, claims and the evidence they need, red-flag words) | MIT |
| `review-change` | [wshobson/agents](https://github.com/wshobson/agents) multi-reviewer-patterns (dimensions, severity calibration, deduplication); [obra/superpowers](https://github.com/obra/superpowers) requesting-code-review | MIT |
| `integrate-branches` | [obra/superpowers](https://github.com/obra/superpowers) finishing-a-development-branch, using-git-worktrees | MIT |
| `write-ticket`, `triage-tickets` | [product-on-purpose/pm-skills](https://github.com/product-on-purpose/pm-skills) — user stories, acceptance criteria, prioritisation frameworks | Apache-2.0 |
| `status-report` | [anthropics/skills](https://github.com/anthropics/skills) — internal communications (progress, plans, problems) | Apache-2.0 |
