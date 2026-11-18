import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { teamApi } from './api.mjs'
import { composerBridge } from './composer.mjs'
import RoleProfile, { enabled } from './RoleProfile.jsx'
import RecordViewer from './RecordViewer.jsx'
import ConversationSidebar from './ConversationSidebar.jsx'
import TeamOverview from './TeamOverview.jsx'
import RoleConversation from './RoleConversation.jsx'
export default function TeamApp({
  api = teamApi,
  sourceSession: explicitSession,
  sourceProject,
  chat,
  onBack,
  preview = false
}) {
  const bridge = useSyncExternalStore(composerBridge.subscribe, composerBridge.getSnapshot)
  const sourceSession = explicitSession || bridge?.sessionId,
    project = sourceProject || bridge?.project
  const [resource, setResource] = useState(null),
    [error, setError] = useState(null),
    [selected, setSelected] = useState(null),
    [view, setView] = useState('chat'),
    [profile, setProfile] = useState(null),
    [record, setRecord] = useState(null),
    [drafts, setDrafts] = useState({}),
    [busy, setBusy] = useState({}),
    [native, setNative] = useState(false)
  const revision = useRef(0),
    refresh = useRef(() => {}),
    pendingRequest = useRef(new Map()),
    generation = useRef(0),
    sendLock = useRef(new Set()),
    scroll = useRef(),
    stick = useRef(true)
  useEffect(() => {
    let active = true,
      timer,
      loading = false
    const abort = new AbortController()
    const version = ++generation.current
    setResource(null)
    setSelected(null)
    setProfile(null)
    setRecord(null)
    setDrafts({})
    setView('chat')
    setError(null)
    async function load() {
      if (loading) return
      loading = true
      const requestRevision = revision.current
      clearTimeout(timer)
      try {
        const [state, conversations] = await Promise.all([
          api.state(sourceSession, { signal: abort.signal }),
          project
            ? api.conversations(project, { signal: abort.signal })
            : Promise.resolve({ conversations: [] })
        ])
        if (active && requestRevision === revision.current) {
          setResource({ state, conversations: conversations.conversations })
          setError(null)
        }
      } catch (e) {
        if (active) setError(e.message)
      } finally {
        loading = false
        if (active) timer = setTimeout(load, 1500)
      }
    }
    refresh.current = load
    const focus = () => load()
    window.addEventListener('focus', focus)
    load()
    return () => {
      window.removeEventListener('focus', focus)
      active = false
      generation.current = version + 1
      abort.abort()
      clearTimeout(timer)
    }
  }, [api, project, sourceSession])
  const roles = resource?.state.roles.filter((r) => r.status !== 'archived') || [],
    groups = resource?.state.roleGroups || [],
    conversations = resource?.conversations || [],
    role = roles.find((r) => r.id === selected),
    conversation = conversations.find((c) => c.roleId === selected),
    sending = conversation?.status === 'sending' || Boolean(busy[JSON.stringify([project, selected])]),
    draft = drafts[selected] || '',
    blocked = !project || !sourceSession
  useEffect(() => {
    if (stick.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [selected, conversation?.messages.length, sending])
  async function open(r) {
    revision.current++
    const version = generation.current
    setSelected(r.id)
    setView('chat')
    setRecord(null)
    stick.current = true
    if (!project) return
    try {
      const c = await api.action('openConversation', { roleId: r.id, project })
      if (version !== generation.current) return
      revision.current++
      setResource((prev) =>
        prev
          ? {
              ...prev,
              conversations: prev.conversations.some((x) => x.id === c.id)
                ? prev.conversations
                : [...prev.conversations, c]
            }
          : prev
      )
    } catch (e) {
      if (version === generation.current) setError(e.message)
    }
  }
  async function send() {
    const requestKey = JSON.stringify([project, selected])
    if (sendLock.current.has(requestKey) || blocked || sending || !draft.trim() || !enabled(role)) return
    sendLock.current.add(requestKey)
    revision.current++
    setBusy((b) => ({ ...b, [requestKey]: true }))
    setError(null)
    const roleId = selected,
      text = draft,
      version = generation.current
    const prior = pendingRequest.current.get(requestKey)
    const request =
      prior?.roleId === roleId && prior?.text === text && prior?.project === project
        ? prior
        : { roleId, text, project, requestId: crypto.randomUUID() }
    pendingRequest.current.set(requestKey, request)
    try {
      const c = await api.action('sendMessage', {
        roleId,
        text,
        project,
        sourceSession,
        requestId: request.requestId
      })
      if (version !== generation.current) return
      pendingRequest.current.delete(requestKey)
      revision.current++
      setDrafts((d) => (d[roleId] === text ? { ...d, [roleId]: '' } : d))
      setResource((prev) => ({
        ...prev,
        conversations: [...prev.conversations.filter((x) => x.id !== c.id), c]
      }))
      stick.current = true
    } catch (e) {
      if (version === generation.current) setError(e.message)
    } finally {
      sendLock.current.delete(requestKey)
      setBusy((b) => {
        const next = { ...b }
        delete next[requestKey]
        return next
      })
    }
  }
  function showProfile(r) {
    setProfile({ roleId: r.id, from: view })
    setView('profile')
  }
  function saveRoleInView(saved, sourceGeneration) {
    if (sourceGeneration !== generation.current) return
    revision.current++
    setResource((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        roles: prev.state.roles.map((r) => (r.id === saved.id && r.version < saved.version ? saved : r))
      }
    }))
  }
  const viewGeneration = generation.current
  const profileRole = roles.find((r) => r.id === profile?.roleId)
  return (
    <div className="nt-workspace">
      <div className="app">
        <ConversationSidebar
          {...{
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
            onBack
          }}
          onRefresh={() => refresh.current()}
        />
        <main className="main">
          {error && (
            <div className="app-error" role="alert">
              {typeof error === 'string' ? error : error.message}
              <button className="btn sm" onClick={() => refresh.current()}>
                重试
              </button>
              <button className="btn sm" onClick={() => setError(null)}>
                关闭
              </button>
            </div>
          )}
          {!resource ? (
            <div className="empty" role="status">
              {error ? '暂时无法加载团队，正在重试…' : '正在加载团队…'}
            </div>
          ) : view === 'overview' ? (
            <TeamOverview {...{ roles, groups, showProfile, open }} onBack={() => setView('chat')} />
          ) : view === 'profile' && profileRole ? (
            <RoleProfile
              key={profileRole.id}
              role={profileRole}
              api={api}
              project={project}
              sourceSession={sourceSession}
              from={profile.from}
              onBack={() => setView(profile.from)}
              onTalk={open}
              onRoleSaved={(saved) => saveRoleInView(saved, viewGeneration)}
            />
          ) : (
            <RoleConversation
              {...{
                role,
                conversation,
                sending,
                draft,
                blocked,
                send,
                showProfile,
                setRecord,
                scroll,
                stick
              }}
              onDraft={(text) => setDrafts((d) => ({ ...d, [selected]: text }))}
              onOverview={() => setView('overview')}
            />
          )}
        </main>
        {chat && (
          <aside className="compat-chat" hidden={!native}>
            <header>
              兼容主会话
              <button className="btn sm" onClick={() => setNative(false)}>
                收起
              </button>
            </header>
            {chat}
          </aside>
        )}
      </div>
      {record && (
        <RecordViewer
          id={record}
          api={api}
          project={project}
          onClose={() => setRecord(null)}
          onPeer={(id) => {
            const peer = roles.find((r) => r.id === id)
            if (peer && enabled(peer)) open(peer)
            else setError('对方角色已停用或不存在，可在团队总览查看资料。')
            setRecord(null)
          }}
        />
      )}
    </div>
  )
}
