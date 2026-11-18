const tools = new Map(Object.entries({
  read: 'read', read_file: 'read',
  grep: 'search', glob: 'search', find: 'search', ls: 'search',
  bash: 'command', shell: 'command', exec_command: 'command',
  fetchurl: 'web', websearch: 'web', web_fetch: 'web', web_search: 'web',
  write: 'edit', edit: 'edit', apply_patch: 'edit',
  team_consult: 'consult'
}))

function toolKind({ name, arguments: args }) {
  // ACP can map Grep to the host's read tool and FetchURL to an external tool.
  // Only recognized labels leave this projection, including under external ACP.
  if (typeof args === 'string' && args.length <= 200) {
    try {
      const title = JSON.parse(args)?.title
      if (typeof title === 'string' && tools.has(title.toLowerCase())) return tools.get(title.toLowerCase())
    } catch {}
  }
  return tools.get(name) ?? 'other'
}

export function dshActivity(events) {
  const pending = new Map()
  const approvals = new Set()
  let phase = 'starting', toolCount = 0, lastTool, at
  for (const { type, data, time } of events) {
    switch (type) {
      case 'request/header':
        phase = 'waiting'
        break
      case 'tool/call':
        lastTool = toolKind(data)
        pending.set(data.callId, lastTool)
        toolCount++
        phase = 'waiting'
        break
      case 'tool/result':
        pending.delete(data.message.toolCallId)
        break
      case 'approval/asked':
        approvals.add(data.id)
        break
      case 'approval/decided':
        approvals.delete(data.id)
        break
      case 'turn/end':
        pending.clear()
        approvals.clear()
        phase = 'finishing'
        break
      default:
        continue
    }
    at = time
  }
  const activeTool = [...pending.values()].at(-1)
  return {
    phase: approvals.size ? 'approval' : activeTool ? 'tool' : phase,
    ...(lastTool && { tool: activeTool ?? lastTool }),
    toolCount,
    ...(Number.isFinite(at) && { at })
  }
}
