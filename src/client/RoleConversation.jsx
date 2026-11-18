import React from 'react'
import { Icon } from './icons.jsx'
import { Avatar, RoleChips, executionLabel, enabled } from './RoleProfile.jsx'
import { roleModelLabel } from './model.mjs'
import Empty from './ConversationEmpty.jsx'
const gate = '请先在 DSH 中添加工作区，再与角色对话。'
export default function RoleConversation({
  role,
  conversation,
  sending,
  draft,
  blocked,
  send,
  onDraft,
  showProfile,
  setRecord,
  scroll,
  stick,
  onOverview
}) {
  return (
    <section className="chat">
      {role && (
        <header className="chat-head">
          <Avatar role={role} />
          <div className="who">
            <div className="nm">
              {role.name}
              <span className={`chip ${enabled(role) ? 'green' : 'off'}`}>
                {enabled(role) ? '启用' : '停用'}
              </span>
            </div>
            <div className="meta">
              {executionLabel(role)} · {roleModelLabel(role)}
              {role.execution !== 'dsh' && (
                <div className="capability-note">当前执行方式暂不支持角色互找</div>
              )}
            </div>
          </div>
          <span className="spacer" />
          <button className="btn" onClick={() => showProfile(role)}>
            角色资料 <Icon name="arrow" size={14} />
          </button>
        </header>
      )}
      <div
        className="chat-body"
        ref={scroll}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70
        }}
      >
        {!role ? (
          <Empty title="选择一位角色，开始对话" onOverview={onOverview}>
            在左侧继续已有对话，或从团队总览选择角色。
          </Empty>
        ) : !conversation?.messages.length ? (
          <Empty title={`和${role.name}聊聊`}>
            当前只有你与这位角色在对话。可以先聊想法，也可以请他提供建议。
          </Empty>
        ) : (
          conversation.messages.map((m) =>
            m.type === 'report' ? (
              <article key={m.id} className="report" aria-label="角色互找汇报">
                <header className="rc-title">
                  <span>协作汇报</span>
                  <span className="chip green">已返回</span>
                </header>
                <div className="rc-roles">
                  {m.fromName} → {m.peerName}
                </div>
                <div className="rc-topic">{m.topic}</div>
                <div className="rc-summary">{m.summary}</div>
                <div className="rc-actions">
                  <button className="btn sm" onClick={() => setRecord(m.recordId)}>
                    查看完整记录 <Icon name="arrow" size={14} />
                  </button>
                  <span className="rc-note">
                    {m.summaryTruncated ? '完整内容见记录 · 只读' : '只读往来记录'}
                  </span>
                </div>
              </article>
            ) : (
              <article className={`msg ${m.type === 'user' ? 'user' : 'role'}`} key={m.id}>
                <div className="m-col">
                  <div className="m-meta">
                    {m.type === 'user' ? '你' : role.name} ·{' '}
                    {new Date(m.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className={m.type === 'user' ? 'bubble' : 'mtext'}>{m.text}</div>
                </div>
              </article>
            )
          )
        )}
        {role && sending && (
          <div className="sending-line" role="status">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            {role.name}正在回复…
          </div>
        )}
        {conversation?.error && (
          <div className="notice" role="alert">
            {conversation.error}
          </div>
        )}
      </div>
      {role && (
        <footer className="composer">
          {blocked && <div className="composer-note">{gate}</div>}
          {!enabled(role) && <div className="composer-note">角色已停用，已有对话仅供查看。</div>}
          <form
            className={`composer-box ${blocked ? 'disabled' : ''}`}
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <textarea
              aria-label={`给${role.name}发消息`}
              rows={2}
              value={draft}
              disabled={blocked || sending || !enabled(role)}
              placeholder={blocked ? '等待工作区与执行会话就绪' : `给${role.name}发消息…`}
              onChange={(e) => onDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button
              className="send-btn"
              aria-label="发送消息"
              disabled={blocked || sending || !draft.trim() || !enabled(role)}
            >
              <Icon name="arrow" size={18} />
            </button>
          </form>
          <div className="hint">Enter 发送 · Shift + Enter 换行 · 当前仅与这一位角色对话</div>
        </footer>
      )}
    </section>
  )
}
