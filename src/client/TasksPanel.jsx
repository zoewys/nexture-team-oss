import React from 'react'
import {Badge,Button,Empty,RoleAvatar} from './components.jsx'
import {Icon} from './icons.jsx'
const executionNames={dsh:'DSH',pi:'Pi',codex:'Codex',claude:'Claude Code',kimi:'Kimi Code'}
// History belongs to the role that accepted the assignment, even after a rename.
const taskRole=(task,roles)=>({...roles.find(r=>r.id===task.roleId),...task.roleSnapshot,id:task.roleId||task.roleSnapshot?.id,name:task.roleSnapshot?.name||roles.find(r=>r.id===task.roleId)?.name||task.roleId||'未指定角色'})
const planRoles=(plan,roles)=>[...new Map((plan.tasks||[]).map(task=>{const role=taskRole(task,roles);return [role.id||role.name,role]})).values()]
const projectName=path=>path?.split(/[\\/]/).filter(Boolean).at(-1)||'未指定项目'

export default function TasksPanel({plans,roles,selected,onSelect,onCreate,onEdit,onAction,busy}) {
 const plan=plans.find(p=>p.id===selected),members=plan?planRoles(plan,roles):[]
 return <section className="nt-tasks-workspace">
  <div className="nt-section-heading"><div><h2>任务分工</h2></div><Button primary icon="plus" onClick={onCreate}>新建任务</Button></div>
  {!plans.length?<Empty icon="tasks" title="下一件事，交给团队" action={<Button icon="plus" onClick={onCreate}>创建第一份分工</Button>}>选择角色、明确交付，一次确认整份分工。</Empty>:<div className="nt-plans-layout">
   <aside className="nt-plan-index"><div className="nt-plan-index-heading"><strong>全部分工</strong><span>{plans.length} 份</span></div><nav className="nt-plan-list" aria-label="任务列表" tabIndex={0}>{[...plans].reverse().map(p=>{
    const assigned=planRoles(p,roles)
    return <button key={p.id} className={`nt-plan-item ${p.id===selected?'selected':''}`} aria-current={p.id===selected?'true':undefined} onClick={()=>onSelect(p.id)}>
     <span className="nt-plan-item-top"><span>{p.tasks?.length||0} 个子任务</span><Badge status={p.status}/></span>
     <strong className="nt-plan-item-title" title={p.title}>{p.title}</strong>
     <span className="nt-plan-item-roles" title={assigned.map(r=>r.name).join('、')}>{assigned.slice(0,2).map(role=><span className="nt-assignee-chip" key={role.id||role.name}>{role.name}</span>)}{assigned.length>2&&<span className="nt-assignee-more">+{assigned.length-2}</span>}</span>
     <span className="nt-plan-item-project" title={p.project}><Icon name="tasks" size={12}/>{projectName(p.project)}</span>
    </button>
   })}</nav></aside>
   {plan?<article key={plan.id} className="nt-plan-detail" aria-label="分工详情" tabIndex={0}>
    <header className="nt-plan-header"><div className="nt-plan-heading-line"><div className="nt-eyebrow">{plan.status==='proposed'?'分工草案':'任务分工'} · V{plan.version}</div><Badge status={plan.status}/></div><h3>{plan.title}</h3><p className="nt-plan-project" title={plan.project}>{plan.project||'未指定项目'}</p><div className="nt-plan-assignees"><span>执行角色</span>{members.map(role=><span className="nt-assignee" key={role.id||role.name}><RoleAvatar role={role}/><strong>{role.name}</strong></span>)}<span className="nt-plan-progress">{plan.tasks.filter(t=>t.status==='completed').length} / {plan.tasks.length} 项完成</span></div></header>
    {plan.memoryStatus==='failed'&&<details className="nt-memory-failure"><summary>记忆整理未完成 · 待整理经验已保留</summary><p>{plan.memoryError||'记忆管理员暂时不可用。'}</p>{plan.memoryPending?.map((group,i)=><div key={i}><strong>{roles.find(r=>r.id===group.roleId)?.name||group.roleId}</strong><ul>{group.suggestions?.map((item,j)=><li key={j}>{item.text}</li>)}</ul></div>)}<small>任务结果仍可查看；可在角色记忆中手动整理这些经验。</small></details>}
    {plan.status==='proposed'&&<div className="nt-plan-confirm"><p>确认这份完整分工后，才可以开始执行。</p><div className="nt-actions"><Button onClick={()=>onEdit(plan)} disabled={busy} icon="edit">调整分工</Button><Button primary onClick={()=>onAction('confirm',{id:plan.id,version:plan.version})} disabled={busy} icon="check">确认全部 {plan.tasks.length} 项</Button><Button onClick={()=>onAction('reject',{id:plan.id,version:plan.version})} disabled={busy}>拒绝</Button></div></div>}
    {plan.status==='approved'&&<div className="nt-plan-confirm"><p>分工已确认。由你决定何时开始。</p><Button primary icon="play" disabled={busy} onClick={()=>onAction('run',{id:plan.id})}>开始执行</Button></div>}
    {plan.status==='running'&&<div className="nt-plan-confirm"><span className="nt-live-dot"/>角色正在各自的任务上下文中执行<Button icon="stop" disabled={busy} onClick={()=>onAction('cancel',{id:plan.id})}>取消执行</Button></div>}
    {plan.status!=='running'&&['pending','failed'].includes(plan.memoryStatus)&&<div className="nt-plan-confirm"><p>任务经验尚未整理完成。可单独重试。</p><Button disabled={busy} onClick={()=>onAction('retryMemory',{id:plan.id})}>重试记忆整理</Button></div>}
    <div className="nt-task-results">{plan.tasks.map((task,index)=>{
     const role=taskRole(task,roles)
     return <section key={task.id||index} className="nt-task-result">
      <div className="nt-task-owner"><RoleAvatar role={role}/><div><span>执行角色</span><strong>{role.name}</strong></div><Badge status={task.status||'pending'}/></div>
      <div className="nt-task-title"><span>{String(index+1).padStart(2,'0')}</span><h4>{task.title}</h4></div>
      <div className="nt-task-runtime"><span>{executionNames[task.execution]||task.execution||'DSH'}</span><span>{task.model||'默认模型'}</span><span>{task.mode==='write'?'允许修改':'只读'}</span></div>
      {task.status==='running'&&task.summary&&<p className="nt-info" role="status">{task.summary}</p>}
      {task.status==='interrupted'&&task.nativeSession&&<div className="nt-plan-confirm"><p>{task.summary||'执行已中断，可读取原会话确认结果。'}</p><Button disabled={busy} onClick={()=>onAction('reconcile',{id:plan.id,taskId:task.id,timeoutMs:30000})}>读取原会话结果</Button></div>}
      {task.dependsOn?.length>0&&<p className="nt-task-prerequisites">前置任务：{task.dependsOn.map(id=>plan.tasks.find(t=>t.id===id)?.title||id).join('、')}</p>}
      {task.criteria&&<div className="nt-task-criteria"><span>验收要求</span><p>{task.criteria}</p></div>}
      <details className="nt-task-instructions"><summary>完整任务说明</summary><p className="nt-prewrap">{task.prompt}</p></details>
      {task.output&&<details open className="nt-output"><summary>任务结果</summary><pre>{typeof task.output==='string'?task.output:JSON.stringify(task.output,null,2)}</pre></details>}
      {task.error&&<p className="nt-error">{typeof task.error==='string'?task.error:task.error.message||JSON.stringify(task.error)}</p>}
      {['pending','failed'].includes(task.nativeCleanup?.status)&&<div className={`nt-native-cleanup nt-cleanup-${task.nativeCleanup.status}`} role="status"><strong>{task.nativeCleanup.status==='pending'?'原生会话停止中，请检查 Nexture CLI':'原生会话停止失败，请检查 Nexture CLI'}</strong>{task.nativeCleanup.error&&<p>{task.nativeCleanup.error}</p>}{task.nativeCleanup.nativeSession&&<code>会话：{task.nativeCleanup.nativeSession}</code>}</div>}
      {task.nativeSession&&<details className="nt-source"><summary>执行会话</summary><code>{typeof task.nativeSession==='string'?task.nativeSession:JSON.stringify(task.nativeSession)}</code></details>}
     </section>
    })}</div>
   </article>:<Empty icon="tasks" title="选择一份分工">查看任务、确认草案和阅读结果。</Empty>}
  </div>}
 </section>
}
