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
5. Offer to keep the fleet moving while the user is away: a recurring check every ~20 minutes (CronCreate, at an off-minute) that runs `fleet status --json` and `fleet dashboard` (it reuses a running dashboard, and brings back one that died with a session on the port it had), reads `BOARD.md` and the tickets, wakes idle members with concrete work (SendMessage to their session id), keeps the token limit and the members' context lean (below), and at the end time runs `/agent-fleet:wrap-up` — the end read from `fleet status` on each check, never fixed when the check is set up, since `/agent-fleet:extend` may move it. Only set it up on a yes. With a token limit, say that without this check the limit is only kept, and desktop members only cleared, when you are asked for status.

## Keeping context lean

Every model call re-reads a member's whole context, so a member that carries 150k tokens from its last ticket into the next pays for them on each step. The plan keeps it under `context.compactAt` (100k tokens by default; 0 turns this off):

- **Subagents** and **headless** members compact on their own at that size (their agent's `autoCompactWindow`, and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` for `fleet spawn`). After a compaction, the plugin's hook gives a headless member its resume note. Nothing to do.
- **Desktop sessions** cannot be compacted from outside, so you clear them. `fleet status --json` lists them in `context.clear`: desktop members whose turn has ended with a context over the limit. On every check, for each one:
  1. Clear it: `clear_session` with its session id from `ROSTER.md` (only an idle session you started can be cleared; the app may ask the user to approve each clear).
  2. Wake it: SendMessage to the same session id with the output of `fleet resume <id>` as the message, unchanged. Its first line, `Fleet member: <slug>/<id>`, lets the hook tie the new transcript to the member, so the dashboard keeps following it and its tokens still count toward the limit.
  
  The protocol tells members to keep each ticket's Log current before they end a turn, so a clear loses nothing. A member with a ticket `in-progress` (`context.members[].inProgress`) is cleared too: its Log is where it picks the work back up.

## Keeping the token limit

`fleet status --json` returns `budget`: `state` (`none`, `ok`, `near`, `over`), `used`, `limit`, `share` and `onLimit`. On every check:

- `near`, the first time: tell the user how much is used and what will happen at the limit (a PushNotification when they are away and it is available). Write it in `NOTICES.md`.
- `over`, the first time, per `onLimit`:
  - `warn`: tell the user, note it in `NOTICES.md`, and keep going; ask whether to raise the limit, wrap up or stop.
  - `wrap-up`: note it in `NOTICES.md` and run `/agent-fleet:wrap-up`.
  - `stop`: tell every member still working to stop now, leave its work as it is, write one line in its report and end its turn (SendMessage to its session id or name); stop headless members' processes by PID; then tell the user where things stand and stop the recurring check.
- Record in `NOTICES.md` that you acted, so a later check does not act twice. A user who raises the limit: update `budget.outputTokens` in `fleet.json` (the dashboard and the next check read it).
