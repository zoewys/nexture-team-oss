import React, { useState } from 'react'
import { Button, ErrorNotice, Modal } from './components.jsx'
import { CatalogExecutionFields, executionNames } from './ExecutionCatalog.jsx'
import { executionCatalogFor } from './execution-catalog.mjs'
import { roleModelLabel } from './model.mjs'

function routeLabel(route) {
  return [executionNames[route.execution], roleModelLabel(route)].filter(Boolean).join(' · ')
}

export default function RoleModelEditor({ api, role, sourceSession, onClose, onSaved }) {
  const [original] = useState(() => ({
    execution: role.execution || 'dsh',
    model: role.model || '',
    provider: role.provider || ''
  }))
  const [roleVersion] = useState(role.version)
  const [value, setValue] = useState(original)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const changed = Object.keys(original).some((key) => original[key] !== value[key])

  async function run(action) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  function review(event) {
    event.preventDefault()
    if (!changed) return
    return run(async () => {
      setDraft(await api.action('draftRole', { role: value, roleId: role.id, roleVersion, sourceSession }))
    })
  }

  function decide(action) {
    return run(async () => {
      const result = await api.action(action, { id: draft.id, version: draft.version })
      if (action === 'confirm') onSaved(result)
      onClose()
    })
  }

  function close() {
    if (busy) return
    if (draft) void decide('reject')
    else onClose()
  }

  return (
    <Modal title={draft ? '确认更改模型' : '更改模型'} subtitle={role.name} onClose={close}>
      <ErrorNotice error={error} />
      {draft ? (
        <>
          <div className="nt-modal-body">
            <dl className="nt-review">
              <dt>当前配置</dt>
              <dd>{routeLabel(original)}</dd>
              <dt>新配置</dt>
              <dd>{routeLabel(draft.role)}</dd>
            </dl>
          </div>
          <footer className="nt-modal-foot">
            <Button onClick={close} disabled={busy}>取消</Button>
            <Button primary onClick={() => decide('confirm')} disabled={busy}>
              {busy ? '处理中…' : '确认保存'}
            </Button>
          </footer>
        </>
      ) : (
        <form onSubmit={review}>
          <div className="nt-modal-body">
            <fieldset className="nt-role-model-fields" disabled={busy}>
              <CatalogExecutionFields
                resource={executionCatalogFor(api)}
                value={value}
                onChange={(patch) => setValue((current) => ({ ...current, ...patch }))}
                selectDshModel
              />
            </fieldset>
          </div>
          <footer className="nt-modal-foot">
            <Button type="button" onClick={close} disabled={busy}>取消</Button>
            <Button primary type="submit" disabled={!changed || busy}>
              {busy ? '准备中…' : '检查更改'}
            </Button>
          </footer>
        </form>
      )}
    </Modal>
  )
}
