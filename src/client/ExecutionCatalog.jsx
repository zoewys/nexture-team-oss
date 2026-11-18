import React, {useEffect, useSyncExternalStore} from 'react'
import {ErrorNotice, ExecutionFields} from './components.jsx'

export const executionNames = {dsh: 'DSH 原生', pi: 'Pi', codex: 'Codex', claude: 'Claude Code', kimi: 'Kimi Code'}

export function ExecutionCatalog({resource, children}) {
  const {catalog, loading, error} = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot)
  useEffect(() => { void resource.load() }, [resource])
  const warning = error || catalog?.notice

  return <>
    {children(catalog)}
    {loading && <p className="nt-info" role="status">正在读取模型目录…</p>}
    <ErrorNotice error={!loading && warning} onRetry={() => resource.load({force: true})}/>
    {!loading && catalog && !warning && <button type="button" className="nt-text-button"
      onClick={() => resource.load({force: true})}>刷新模型目录</button>}
  </>
}

export function CatalogExecutionFields({resource, ...props}) {
  if (!resource) return <ExecutionFields {...props}/>
  return <ExecutionCatalog resource={resource}>
    {catalog => <ExecutionFields {...props} catalog={catalog}/>}
  </ExecutionCatalog>
}
