import React, { useEffect, useState } from 'react'
import { Icon } from './icons.jsx'
import RoleModelEditor from './RoleModelEditor.jsx'
import { roleModelLabel } from './model.mjs'
export const executionLabel = (r) =>
  ({ dsh: 'DSH 原生智能体', pi: 'Pi', codex: 'Codex', kimi: 'Kimi Code', claude: 'Claude Code' })[
    r.execution
  ] ||
  r.execution ||
  'DSH 原生智能体'
export const enabled = (r) => r.enabled !== false && r.status !== 'archived'
export function Avatar({ role }) {
  return (
    <span className="av" style={{ background: '#373d39' }}>
      {(role?.name || '角色').slice(0, 2)}
    </span>
  )
}
export function RoleChips({ role }) {
  return (
    <span className="chips">
      <span className="chip">{role.type === 'temporary' ? '临时' : '长期'}</span>
      <span className={`chip ${enabled(role) ? 'green' : 'off'}`}>{enabled(role) ? '启用' : '停用'}</span>
    </span>
  )
}
export default function RoleProfile({ role, api, project, sourceSession, from, onBack, onTalk, onRoleSaved }) {
  const [resource, setResource] = useState({ loading: true, rows: [], error: null })
  const [editingModel, setEditingModel] = useState(false)
  useEffect(() => {
    let current = true
    const abort = new AbortController()
    setResource({ loading: true, rows: [], error: null })
    api.memory(role.id, project || '', { signal: abort.signal }).then(
      (r) => {
        if (current) setResource({ rows: r.memories, loading: false })
      },
      (error) => {
        if (current) setResource({ rows: [], loading: false, error })
      }
    )
    return () => {
      current = false
      abort.abort()
    }
  }, [role.id, project, api])
  return (
    <section className="pf" aria-label="角色资料">
      <header className="pf-top">
        <button className="btn" onClick={onBack}>
          <Icon name="back" size={14} />
          返回
        </button>
        <Avatar role={role} />
        <div className="pf-id">
          <h1>{role.name}</h1>
          <RoleChips role={role} />
        </div>
        <span className="pf-from">来自：{from === 'overview' ? '团队总览' : '角色对话'}</span>
      </header>
      <div className="pf-sec">提示词</div>
      <pre className="pf-pre">{role.prompt || '暂无提示词'}</pre>
      <div className="pf-sec">配置</div>
      <dl className="pf-dl">
        <dt>名称</dt>
        <dd>{role.name}</dd>
        <dt>类型</dt>
        <dd>{role.type === 'temporary' ? '临时角色' : '长期角色'}</dd>
        <dt>Skills</dt>
        <dd>
          <ul className="skill-list">
            {role.skills?.length ? role.skills.map((s) => <li key={s}>{s}</li>) : '未配置'}
          </ul>
        </dd>
        <dt>执行方式 / 模型</dt>
        <dd className="pf-model">
          <span>{executionLabel(role)} · {roleModelLabel(role)}</span>
          <button className="btn sm" onClick={() => setEditingModel(true)}>更改模型</button>
        </dd>
        <dt>自动积累记忆</dt>
        <dd>
          <span className={`status-dot ${role.autoMemory ? 'on' : 'off'}`} />
          {role.autoMemory ? '开启' : '关闭'}
        </dd>
        <dt>启用状态</dt>
        <dd>{enabled(role) ? '已启用' : '已停用'}</dd>
      </dl>
      <div className="pf-sec">角色记忆 · 只读</div>
      {resource.loading ? (
        <p role="status">正在读取记忆…</p>
      ) : resource.error ? (
        <p role="alert">{resource.error.message}</p>
      ) : (
        <ul className="mem-list">
          {resource.rows.map((m) => (
            <li className="mem-item" key={m.id}>
              {m.title && <strong className="mt">{m.title}：</strong>}
              <span className="md">{m.text}</span>
              {m.project && <span className="mem-scope"> · 项目：{m.project}</span>}
            </li>
          ))}
        </ul>
      )}
      {!resource.loading && !resource.error && !resource.rows.length && <p className="mem-hint">暂无记忆</p>}
      <p className="mem-hint">关闭自动积累后仍可读取已有记忆。经验只属于当前角色。</p>
      <footer className="pf-actions">
        <button className="btn primary" disabled={!enabled(role)} onClick={() => onTalk(role)}>
          <Icon name="chat" size={15} />
          打开对话
        </button>
      </footer>
      {editingModel && (
        <RoleModelEditor
          {...{ role, api, sourceSession }}
          onSaved={onRoleSaved}
          onClose={() => setEditingModel(false)}
        />
      )}
    </section>
  )
}
