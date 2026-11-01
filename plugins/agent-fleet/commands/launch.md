---
description: Launch the members of the current agent fleet (desktop sessions, subagents or headless claude -p) with their briefs, models and efforts, and start the dashboard
argument-hint: "[member ids to launch, default all]"
---

Launch the current agent fleet. The fleet CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/fleet.mjs"` (call it `fleet` below); run it from the project root. If `fleet status` says there is no fleet, tell the user to plan one with `/agent-fleet:new` and stop.

1. Run `fleet launch-plan`. Each entry is a member: `id`, `launch` (`self`, `session`, `subagent` or `headless`), `title`, `description`, `subagentType` (the member's generated agent, `fleet-<slug>-<id>`), `agentFile` (its definition), `modelId`, `effort`, `worktree`, `branch`, and `brief` (the path of its brief). If `$ARGUMENTS` names members, launch only those.
2. Show the user what will start (member, how, model · effort, worktree), that it runs until the fleet's end time, and the token limit from `fleet status` (the limit and what happens at it, or "no limit"). If the plan has no `budget.outputTokens` and the user was never asked, ask now whether to set one (as in `/agent-fleet:new`, step 6) and write the answer into `.fleet/<slug>/fleet.json` under `budget`. Ask for a go-ahead once, unless they already asked you to launch.
3. Start each member, without waiting for one to finish before the next:
   - **`self`**: that is you, the lead. Do not start anything; your work is to coordinate.
   - **`session`**, when the desktop session tools are available (`start_session`): start a new session per member with initiation `user_asked`, `title` = the entry's `title` exactly (the dashboard finds the member by it), `name` = the `id`, context `fresh`, `prompt` = the full text of the brief file, `background` = one paragraph on the fleet's goal and where its board is, `model` = `modelId` (leave it out when empty), `effort`, `use_worktree` = `worktree`, `branch_name` = `branch`. Record the session id it returns: `fleet roster <id> session=<session id>`. When those tools are not available, say so and ask whether to use `subagent` or `headless` instead.
   - **`subagent`**: use the Agent tool with `subagent_type` = `subagentType` (the member's generated agent), `description` = the entry's `description` exactly (the dashboard finds the member by it), `prompt` = the full brief text, `run_in_background: true`, and `model` = the model alias when it is not `inherit`. Project agents are loaded when a session starts: if `subagentType` is not available yet in this session, use `general-purpose` with the content of `agentFile` (without its front matter) followed by the brief as the prompt. (When the user asked for a workflow, run the `launch-fleet` workflow of this plugin with the entries instead.)
   - **`headless`**: run `fleet spawn <id>`. Ask the user first which permission mode the headless members may use (they cannot answer prompts), and pass it as `--permission-mode <mode>`.
4. Run `fleet dashboard` (it reuses a running one) and give the user the URL as a link they can click, on a line of its own — `Dashboard: [http://localhost:4600](http://localhost:4600)` with the port it printed — never only the port number; open it in the browser pane when you have one.
5. Offer to keep the fleet moving while the user is away: a recurring check every ~20 minutes (CronCreate, at an off-minute) that runs `fleet status --json`, reads `BOARD.md` and the tickets, wakes idle members with concrete work (SendMessage to their session id), keeps the token limit (below), and at the end time runs `/agent-fleet:wrap-up`. Only set it up on a yes. With a token limit, say that without this check the limit is only kept when you are asked for status.

## Keeping the token limit

`fleet status --json` returns `budget`: `state` (`none`, `ok`, `near`, `over`), `used`, `limit`, `share` and `onLimit`. On every check:

- `near`, the first time: tell the user how much is used and what will happen at the limit (a PushNotification when they are away and it is available). Write it in `NOTICES.md`.
- `over`, the first time, per `onLimit`:
  - `warn`: tell the user, note it in `NOTICES.md`, and keep going; ask whether to raise the limit, wrap up or stop.
  - `wrap-up`: note it in `NOTICES.md` and run `/agent-fleet:wrap-up`.
  - `stop`: tell every member still working to stop now, leave its work as it is, write one line in its report and end its turn (SendMessage to its session id or name); stop headless members' processes by PID; then tell the user where things stand and stop the recurring check.
- Record in `NOTICES.md` that you acted, so a later check does not act twice. A user who raises the limit: update `budget.outputTokens` in `fleet.json` (the dashboard and the next check read it).
