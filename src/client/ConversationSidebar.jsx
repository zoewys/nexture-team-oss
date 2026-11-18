import React from 'react'
import { Icon } from './icons.jsx'
import { Avatar, RoleChips, executionLabel, enabled } from './RoleProfile.jsx'
export default function ConversationSidebar({
  resource,
  roles,
  conversations,
  selected,
  view,
  setView,
  open,
  preview,
  chat,
  native,
  setNative,
  onBack,
  onRefresh
}) {
  return (
    <aside className="side">
      <header className="side-head">
        <span className="mark">
          <Icon name="team" size={21} />
        </span>
        <div className="side-title">
          Nexture Team<small>你的角色，持续协作</small>
        </div>
      </header>
      <button
        className="btn ov-btn"
        aria-current={view === 'overview' ? 'true' : undefined}
        onClick={() => setView('overview')}
      >
        <Icon name="team" size={16} />
        团队总览 <Icon name="arrow" size={14} />
      </button>
      <div className="side-sub">
        角色对话
        <button className="icon-btn" aria-label="刷新团队数据" onClick={onRefresh}>
          <Icon name="refresh" size={13} />
        </button>
      </div>
      <ul className="conv-list">
        {conversations
          .filter((c) => roles.some((r) => r.id === c.roleId))
          .map((c) => {
            const r = roles.find((r) => r.id === c.roleId),
              last = c.messages.at(-1)
            return (
              <li key={c.id}>
                <button
                  className="conv-item"
                  aria-current={view === 'chat' && selected === r.id ? 'true' : undefined}
                  onClick={() => open(r)}
                >
                  <Avatar role={r} />
                  <div className="conv-main">
                    <div className="conv-top">
                      <span className="conv-name">{r.name}</span>
                      <span className="conv-time">
                        {new Date(c.updatedAt).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <div className="conv-sum">
                      {c.status === 'sending' ? '正在回复…' : last?.text || last?.summary || '开始新的对话'}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        {resource && !conversations.length && (
          <li className="side-empty">
            <div className="t">还没有角色对话</div>
            <div className="d">从团队总览选择一位角色，开始对话。</div>
            <button className="btn sm" onClick={() => setView('overview')}>
              查看团队
            </button>
          </li>
        )}
      </ul>
      <footer className="side-foot">
        每位角色一条对话，随时接着聊。{preview && <p>本地开发预览 · 模拟执行</p>}
        {chat && (
          <button className="btn sm" onClick={() => setNative((v) => !v)}>
            {native ? '收起' : '打开'}兼容主会话
          </button>
        )}
        {onBack && (
          <button className="btn sm" onClick={onBack}>
            返回主会话
          </button>
        )}
      </footer>
    </aside>
  )
}
