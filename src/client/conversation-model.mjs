const toolLabels = {
  read: '读取文件',
  search: '搜索资料',
  command: '执行命令',
  web: '读取网页',
  edit: '编辑文件',
  consult: '咨询其他角色',
  other: '调用工具'
}

export function activityLabel(activity) {
  switch (activity?.phase) {
    case 'starting': return '正在启动 Agent'
    case 'waiting': return '等待模型返回'
    case 'tool': return `正在${toolLabels[activity.tool] ?? toolLabels.other}`
    case 'approval': return '等待工具审批'
    case 'finishing': return '正在结束本轮'
    default: return '等待 Agent 反馈'
  }
}

export function activityDetails(conversation, now = Date.now()) {
  const start = Date.parse(conversation?.updatedAt)
  const seconds = Math.floor(Math.max(0, now - start) / 1000)
  const minutes = Math.floor(seconds / 60)
  const activity = conversation?.activity
  const sinceUpdate = Math.floor((now - activity?.at) / 1000)
  return [
    Number.isFinite(seconds) && `已用时 ${minutes ? `${minutes} 分 ` : ''}${seconds % 60} 秒`,
    activity?.toolCount > 0 && `${activity.toolCount} 次工具调用`,
    activity?.phase === 'waiting' && toolLabels[activity.tool] && `最近操作：${toolLabels[activity.tool]}`,
    activity?.phase === 'waiting' && sinceUpdate >= 15 && `上次进度更新在 ${sinceUpdate} 秒前`
  ].filter(Boolean).join(' · ')
}

/** Groups store role IDs; stale group references belong to the ungrouped section. */
export function roleSections(roles = [], groups = []) {
  const assigned = new Set(groups.flatMap((g) => g.roleIds || []))
  return [
    ...groups.map((g) => ({ ...g, roles: roles.filter((r) => (g.roleIds || []).includes(r.id)) })),
    { id: null, name: '未分组', roles: roles.filter((r) => !assigned.has(r.id)) }
  ].filter((g) => g.roles.length)
}
