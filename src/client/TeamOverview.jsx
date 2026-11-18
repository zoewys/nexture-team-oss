import React from 'react'
import { Icon } from './icons.jsx'
import { Avatar, RoleChips, executionLabel, enabled } from './RoleProfile.jsx'
import { roleSections } from './conversation-model.mjs'
import { roleModelLabel } from './model.mjs'
import Empty from './ConversationEmpty.jsx'
export default function TeamOverview({ roles, groups, onBack, showProfile, open }) {
  return (
    <section className="ov">
      <header className="ov-head">
        <div>
          <h1 className="ov-title">团队总览</h1>
          <div className="ov-sub">{roles.length} 位角色 · 查看资料，或打开各自的对话。</div>
        </div>
        <button className="btn" onClick={onBack}>
          <Icon name="back" size={14} />
          返回对话
        </button>
      </header>
      {!roles.length && <Empty title="团队中还没有角色">可在主会话中与角色顾问讨论创建角色。</Empty>}
      {roleSections(roles, groups).map((g) => {
        const members = g.roles
        return (
          <section key={g.id || 'none'}>
            <h2 className="ov-group">
              {g.name} · {members.length}
            </h2>
            <div className="ov-grid">
              {members.map((r) => (
                <article className="role-card" key={r.id}>
                  <header className="rc2-head">
                    <Avatar role={r} />
                    <span className="nm">{r.name}</span>
                    <RoleChips role={r} />
                  </header>
                  <div className="rc-duty">{r.prompt}</div>
                  <div className="rc2-note">
                    {executionLabel(r)} · {roleModelLabel(r)}
                  </div>
                  <footer className="rc2-actions">
                    <button className="btn sm" onClick={() => showProfile(r)}>
                      查看资料
                    </button>
                    <button className="btn primary sm" disabled={!enabled(r)} onClick={() => open(r)}>
                      打开对话
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        )
      })}
      <p className="ov-foot">选择角色后会回到该角色自己的对话；已有对话会直接复用。</p>
    </section>
  )
}
