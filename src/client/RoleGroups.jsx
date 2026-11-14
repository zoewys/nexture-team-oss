import React, {useState} from 'react'
import {Button, ErrorNotice, Field, Modal} from './components.jsx'

export function GroupedRoleList({groups, roles, renderRole, createCard, searching, collapsed, setCollapsed}) {
  const groupByRole = new Map()
  for (const group of groups) {
    for (const roleId of group.roleIds) groupByRole.set(roleId, group.id)
  }

  const visible = new Map(groups.map(group => [group.id, []]))
  const ungrouped = []
  for (const role of roles) {
    const group = visible.get(groupByRole.get(role.id))
    if (group) group.push(role)
    else ungrouped.push(role)
  }

  if (!groups.length) {
    return roles.length > 0 && <>
      <div className="nt-subheading"><h3>工作角色</h3><span>{roles.length} 位成员</span></div>
      <div className="nt-role-grid">{roles.map(renderRole)}{createCard}</div>
    </>
  }

  const sections = [...groups.map(group => ({...group, members: visible.get(group.id)})),
    {id: '', name: '未分组', members: ungrouped}]

  return sections.filter(section => !searching || section.members.length > 0).map(section => {
    const expanded = searching || !collapsed[section.id]
    return <section className="nt-role-group" key={section.id}>
      <button className="nt-group-heading" type="button" aria-expanded={expanded}
        onClick={() => setCollapsed(previous => ({...previous, [section.id]: !previous[section.id]}))}
        disabled={searching}>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <strong>{section.name}</strong>
        <span>{section.members.length} 位成员</span>
      </button>
      {expanded && (section.members.length || (!section.id && createCard)
        ? <div className="nt-role-grid">{section.members.map(renderRole)}{!section.id && createCard}</div>
        : <p className="nt-group-empty">这个分组还没有角色。</p>)}
    </section>
  })
}

export default function RoleGroups({groups, roles, api, onChanged, onClose}) {
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [selected, setSelected] = useState([])
  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const selectedRoles = roles.filter(role => selected.includes(role.id)).map(role => role.id)
  const groupName = new Map(groups.flatMap(group => group.roleIds.map(roleId => [roleId, group.name])))

  async function submit(action, params, onSaved) {
    setBusy(true)
    setError(null)
    try {
      await api.action(action, params)
      onSaved()
      try {
        await onChanged()
      } catch {
        setError('分组操作已保存。关闭窗口并刷新团队数据以查看结果。')
      }
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  function saveGroup(event) {
    event.preventDefault()
    void submit('saveRoleGroup', {groupId: editing.id, name: editing.name}, () => setEditing(null))
  }

  function moveRoles(event) {
    event.preventDefault()
    void submit('moveRoles', {roleIds: selectedRoles, groupId: destination || null}, () => setSelected([]))
  }

  return <Modal title="管理分组" onClose={() => {if (!busy) onClose()}}>
    <div className="nt-modal-body nt-group-manager">
      <ErrorNotice error={error} onDismiss={() => setError(null)}/>
      <section>
        <div className="nt-group-manager-heading">
          <h3>分组</h3>
          <Button type="button" icon="plus" disabled={busy}
            onClick={() => {setDeleting(null); setEditing({name: ''})}}>新建分组</Button>
        </div>
        {groups.map(group => <div className="nt-group-manager-row" key={group.id}>
          <span>{group.name}</span>
          <div className="nt-actions">
            <Button type="button" disabled={busy} aria-label={`重命名 ${group.name}`}
              onClick={() => {setDeleting(null); setEditing({id: group.id, name: group.name})}}>重命名</Button>
            <Button type="button" disabled={busy} aria-label={`删除 ${group.name}`}
              onClick={() => {setEditing(null); setDeleting(group)}}>删除</Button>
          </div>
        </div>)}
        {editing && <form className="nt-group-editor" onSubmit={saveGroup}>
          <Field label="分组名称">
            <input value={editing.name} onChange={event => setEditing({...editing, name: event.target.value})}
              maxLength={60} required disabled={busy}/>
          </Field>
          <div className="nt-actions">
            <Button type="button" disabled={busy} onClick={() => setEditing(null)}>取消</Button>
            <Button primary type="submit" disabled={busy || !editing.name.trim()}>保存分组</Button>
          </div>
        </form>}
        {deleting && <div className="nt-group-editor">
          <p>删除「{deleting.name}」后，组内角色将回到「未分组」。</p>
          <div className="nt-actions">
            <Button type="button" disabled={busy} onClick={() => setDeleting(null)}>取消</Button>
            <Button danger type="button" disabled={busy} onClick={() => {
              void submit('deleteRoleGroup', {groupId: deleting.id}, () => {
                setDeleting(null)
                if (destination === deleting.id) setDestination('')
              })
            }}>确认删除分组</Button>
          </div>
        </div>}
      </section>
      {roles.length > 0 && <form className="nt-group-editor" onSubmit={moveRoles}>
        <h3>移动角色</h3>
        <Field label="移到分组">
          <select value={destination} onChange={event => setDestination(event.target.value)} disabled={busy}>
            <option value="">未分组</option>
            {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </Field>
        <div className="nt-group-members">
          {roles.map(role => <label className="nt-group-member" key={role.id}>
            <input type="checkbox" checked={selectedRoles.includes(role.id)} disabled={busy} onChange={event => {
              setSelected(event.target.checked ? [...selectedRoles, role.id] : selectedRoles.filter(id => id !== role.id))
            }}/>
            <span>{role.name}</span>
            <small>{groupName.get(role.id) || '未分组'}</small>
          </label>)}
        </div>
        <div className="nt-actions">
          <Button type="submit" primary disabled={busy || !selectedRoles.length}>移动所选角色{selectedRoles.length > 0 ? `（${selectedRoles.length}）` : ''}</Button>
        </div>
      </form>}
    </div>
    <footer className="nt-modal-foot"><Button type="button" disabled={busy} onClick={onClose}>完成</Button></footer>
  </Modal>
}
