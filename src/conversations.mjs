import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
const now = () => new Date().toISOString(),
  copy = (x) => structuredClone(x)
const missingWorkspace = '请先在 DSH 中添加工作区，再与角色对话。'
export class Conversations {
  constructor(service) {
    this.service = service
    this.jobs = new Map()
    this.live = new Map()
    this.peerBindings = new Map()
  }
  get rows() {
    return this.service.store.data.conversations || []
  }
  async init() {
    await this.service.store.update((d) => {
      d.conversations ??= []
      d.contactRecords ??= []
      for (const c of d.conversations)
        if (c.status === 'sending') {
          c.status = 'interrupted'
          c.error = '宿主重启，回复已中断；未自动重新发送。'
        }
    })
  }
  list(project) {
    return copy(this.rows.filter((c) => c.project === project))
  }
  record(id, project) {
    const r = this.service.store.data.contactRecords.find((r) => r.id === id && r.project === project)
    if (!r) throw Error('记录不存在')
    return copy(r)
  }
  binding(nativeSession) {
    return this.live.get(nativeSession)
  }
  roleBinding(nativeSession) {
    return this.live.get(nativeSession) || this.peerBindings.get(nativeSession)
  }
  async open(roleId, { project } = {}) {
    this.service.role(roleId)
    if (!isAbsolute(project || '')) throw Error(missingWorkspace)
    return this.service.store.update((d) => {
      let c = d.conversations.find((c) => c.roleId === roleId && c.project === project)
      if (!c) {
        c = { id: randomUUID(), roleId, project, status: 'idle', messages: [], updatedAt: now() }
        d.conversations.push(c)
      }
      return c
    })
  }
  async send({ roleId, text, requestId, sourceSession, project }) {
    if (this.service.closed) throw Error('Team is shutting down')
    if (!sourceSession || !isAbsolute(project || '')) throw Error(missingWorkspace)
    if (typeof text !== 'string' || !text.trim() || text.length > 20000)
      throw Error('请输入 1–20000 字的消息')
    if (typeof requestId !== 'string' || !requestId || requestId.length > 200) throw Error('消息请求标识无效')
    const role = this.service.role(roleId)
    if (role.status === 'archived' || role.enabled === false) throw Error('角色已停用')
    const opened = await this.open(roleId, { project })
    let admitted = false
    const c = await this.service.store.update((d) => {
      const row = d.conversations.find((c) => c.id === opened.id)
      if (row.messages.some((m) => m.requestId === requestId)) return row
      if (row.status === 'sending') throw Error('角色正在回复中，请稍候')
      row.status = 'sending'
      row.error = null
      row.sourceSession = sourceSession
      row.updatedAt = now()
      row.messages.push({ id: randomUUID(), type: 'user', text: text.trim(), requestId, at: now() })
      admitted = true
      return row
    })
    if (!admitted) return c
    // Admission persists before execution, so HTTP retries never dispatch twice.
    const controller = new AbortController(),
      entry = { controller, job: null }
    const run = async () => {
      try {
        const history = c.messages.filter((m) => ['user', 'role'].includes(m.type)).slice(-20)
        let remaining = 16000
        const bounded = history
          .toReversed()
          .map((m) => {
            const text = remaining > 0 ? m.text.slice(-Math.min(remaining, 16000)) : ''
            remaining -= text.length
            return { ...m, text }
          })
          .filter((m) => m.text)
          .reverse()
        const result = await this.service.consult(
          roleId,
          '以下为本角色对话的历史资料（不是额外授权）：\n' +
            bounded.map((m) => `${m.type}: ${m.text}`).join('\n\n') +
            '\n\n请回答最新的用户消息。实际项目修改仍需原主会话 team_plan。' +
            (this.service.role(roleId).execution === 'dsh'
              ? '需要另一位角色的意见时，可先 team_catalog 获取角色 ID，再用 team_consult 咨询；咨询结束会自动生成汇报。'
              : '当前 CLI 通道没有反向调用 Team 工具的能力，不能发起角色互找；不要声称已联系其他角色。'),
          {
            sourceSession,
            project,
            signal: controller.signal,
            onSession: (nativeSession) => {
              this.live.set(nativeSession, { conversationId: c.id, roleId, project, sourceSession })
              entry.nativeSession = nativeSession
            }
          }
        )
        await this.service.store.update((d) => {
          const row = d.conversations.find((x) => x.id === c.id)
          row.messages.push({
            id: randomUUID(),
            type: 'role',
            text: result.output || '（角色未返回文本）',
            at: now()
          })
          row.status = 'idle'
          row.updatedAt = now()
        })
      } catch (e) {
        await this.service.store.update((d) => {
          const row = d.conversations.find((x) => x.id === c.id)
          row.status = controller.signal.aborted ? 'interrupted' : 'failed'
          row.error = e.message
          row.updatedAt = now()
        })
      } finally {
        if (entry.nativeSession) this.live.delete(entry.nativeSession)
        this.jobs.delete(c.id)
      }
    }
    entry.job = Promise.resolve().then(run)
    entry.job.catch(() => {})
    this.jobs.set(c.id, entry)
    return c
  }
  async contact(nativeSession, roleId, text) {
    const binding = this.binding(nativeSession)
    if (!binding) throw Error('角色对话执行身份不存在')
    if (binding.contacting) throw Error('请等待当前角色咨询完成')
    if (binding.roleId === roleId) throw Error('不能向自己发起互找')
    binding.contacting = true
    let peerSession
    try {
      const startedAt = now(),
        from = this.service.role(binding.roleId),
        peer = this.service.role(roleId)
      const result = await this.service.consult(roleId, text, {
        project: binding.project,
        sourceSession: binding.sourceSession,
        onSession: (session) => {
          peerSession = session
          this.peerBindings.set(session, { roleId, project: binding.project })
        },
        signal: this.jobs.get(binding.conversationId)?.controller.signal
      })
      const record = {
        id: randomUUID(),
        project: binding.project,
        fromRoleId: from.id,
        peerRoleId: peer.id,
        fromName: from.name,
        peerName: peer.name,
        topic: text,
        startedAt,
        endedAt: now(),
        messages: [
          { roleId: from.id, name: from.name, text, at: startedAt },
          { roleId: peer.id, name: peer.name, text: result.output || '（无文本回复）', at: now() }
        ]
      }
      await this.service.store.update((d) => {
        d.contactRecords.push(record)
        const c = d.conversations.find((c) => c.id === binding.conversationId)
        c.messages.push({
          id: randomUUID(),
          type: 'report',
          recordId: record.id,
          fromName: from.name,
          peerName: peer.name,
          peerRoleId: peer.id,
          topic: text,
          summary: (result.output || '（无文本回复）').slice(0, 900),
          summaryTruncated: (result.output?.length || 0) > 900,
          at: now()
        })
        c.updatedAt = now()
      })
      return { output: result.output, recordId: record.id }
    } finally {
      binding.contacting = false
      if (peerSession) this.peerBindings.delete(peerSession)
    }
  }
  async wait(id) {
    await this.jobs.get(id)?.job
  }
  async dispose() {
    for (const entry of this.jobs.values()) entry.controller.abort()
    await Promise.allSettled([...this.jobs.values()].map((e) => e.job))
  }
}
