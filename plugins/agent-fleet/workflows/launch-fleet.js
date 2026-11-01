export const meta = {
  name: 'agent-fleet-launch',
  description: 'Run the members of an agent fleet as parallel subagents, each with its brief, until each one ends its work',
  whenToUse:
    'Run by /agent-fleet:launch when the user asked for a workflow and the fleet launches its members as subagents. Requires args {members: [{id, description, prompt}]} — the entries of `fleet launch-plan` with each brief read into `prompt`. The dashboard finds each member by its description, so pass it unchanged.',
  phases: [{ title: 'Fleet', detail: 'one subagent per member, all at once; each works from its brief and the fleet board' }],
}

const ARGS = typeof args === 'string' ? (() => { try { return JSON.parse(args) } catch (e) { return {} } })() : args || {}
const members = Array.isArray(ARGS.members) ? ARGS.members.filter(m => m && m.id && m.prompt) : []
if (members.length === 0) throw new Error('agent-fleet-launch needs args.members: [{id, description, prompt}] from `fleet launch-plan`')

phase('Fleet')
const results = await parallel(
  members.map(m => () =>
    agent(m.prompt, { label: m.description || m.id, phase: 'Fleet' })
      .then(output => ({ id: m.id, ok: true, output }))
      .catch(error => ({ id: m.id, ok: false, error: String(error && error.message || error) })),
  ),
)

return { members: results.map(r => ({ id: r.id, ok: r.ok, ...(r.ok ? {} : { error: r.error }) })) }
