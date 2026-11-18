import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons.jsx'
export default function RecordViewer({ id, api, project, onClose, onPeer }) {
  const dialog = useRef(),
    body = useRef(),
    [data, setData] = useState(null),
    [error, setError] = useState(null),
    [pct, setPct] = useState(0)
  const update = () => {
    const el = body.current
    if (el)
      setPct(
        el.scrollHeight <= el.clientHeight
          ? 100
          : Math.min(100, Math.round((100 * el.scrollTop) / (el.scrollHeight - el.clientHeight)))
      )
  }
  useEffect(() => {
    const el = dialog.current,
      previous = document.activeElement
    el.showModal()
    return () => {
      el.close()
      previous?.focus?.()
    }
  }, [])
  useEffect(() => {
    const abort = new AbortController()
    api.record(id, project, { signal: abort.signal }).then(setData, (e) => {
      if (!abort.signal.aborted) setError(e)
    })
    return () => abort.abort()
  }, [id, project, api])
  useEffect(() => {
    update()
    const observer = new ResizeObserver(update)
    if (body.current) observer.observe(body.current)
    return () => observer.disconnect()
  }, [data])
  return createPortal(
    <dialog
      ref={dialog}
      className="nt-workspace nt-record-dialog"
      aria-label="只读记录查看器"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose()
      }}
    >
      <section className="drawer">
        <header className="d-head">
          <div>
            <div className="d-eyebrow">只读记录</div>
            <h2>{data?.topic || '互找记录'}</h2>
            {data && (
              <>
                <div className="d-meta">
                  {data.fromName} → {data.peerName}
                  <span className="chip green">已结束</span>
                </div>
                <p className="mem-hint">
                  {new Date(data.startedAt).toLocaleString('zh-CN')} —{' '}
                  {new Date(data.endedAt).toLocaleTimeString('zh-CN')}
                </p>
              </>
            )}
          </div>
          <button autoFocus className="icon-btn" aria-label="关闭记录" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div ref={body} className="d-body" onScroll={update}>
          {error ? (
            <p role="alert">{error.message}</p>
          ) : !data ? (
            <p role="status">正在读取记录…</p>
          ) : (
            data.messages.map((m, i) => (
              <article className="rmsg" key={i}>
                <div className="m-col">
                  <div className="m-meta">
                    {m.name} · {new Date(m.at).toLocaleTimeString('zh-CN')}
                  </div>
                  <div className="mtext">{m.text}</div>
                </div>
              </article>
            ))
          )}
        </div>
        {pct > 15 && (
          <button className="to-top" onClick={() => body.current.scrollTo({ top: 0, behavior: 'auto' })}>
            ↑ 回到开头
          </button>
        )}
        <footer className="d-foot">
          <span>仅供阅读 · 已读 {pct}%</span>
          {data && (
            <button className="btn sm" onClick={() => onPeer(data.peerRoleId)}>
              打开对方对话 <Icon name="arrow" size={14} />
            </button>
          )}
        </footer>
      </section>
    </dialog>,
    document.body
  )
}
