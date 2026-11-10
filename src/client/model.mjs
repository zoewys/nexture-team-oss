/** Role identity lives in the URI; the readable label may change. */
export function roleMention(role) {
 const label=String(role.name||'角色').replace(/[\[\]\\\r\n]+/g,' ').replace(/\s+/g,' ').trim()
 return `@[${label}](nexture-role:${role.id})`
}
export function activeRoles(roles=[]) { return roles.filter(role=>role.status!=='archived'&&role.enabled!==false) }
export function roleFromForm(form) {
 return {name:form.name.trim(),type:form.type,prompt:form.prompt.trim(),skills:[...new Set((Array.isArray(form.skills)?form.skills:form.skills.split(/[,，\n]/)).map(s=>s.trim()).filter(Boolean))],execution:form.execution||'dsh',model:form.model?.trim()||'',provider:form.provider?.trim()||'',autoMemory:Boolean(form.autoMemory),enabled:form.enabled!==false}
}
export function taskFromRole(role) { return {roleId:role.id,title:'',prompt:'',execution:role.execution||'dsh',model:role.model||'',provider:role.provider||'',mode:'read',criteria:''} }
export function insertRole(inputActions,role) {
 if(!inputActions?.captureInsertion||!inputActions?.insertText)return false
 return inputActions.insertText(`${roleMention(role)} `,inputActions.captureInsertion())===true
}
export function createRoleSource(api) {
 return {
  trigger:'@',name:'nexture-team',showGroupTitle:false,
  async candidates(session,{query='',quoted,signal}={}) {
   if(quoted)return []
   const state=await api.state(session?.sessionId,{signal})
   if(signal?.aborted)return []
   const needle=query.toLocaleLowerCase()
   return activeRoles(state.roles).filter(r=>`${r.name} ${r.prompt||''}`.toLocaleLowerCase().includes(needle)).map(role=>({name:role.name,label:role.name,description:role.type==='temporary'?'临时角色':'长期角色',section:'团队角色',icon:'session',value:JSON.stringify({id:role.id,name:role.name})}))
  },
  onPick({candidate}) {
   try {const role=JSON.parse(candidate.value);if(!role.id||!role.name)return;const ref=roleMention(role);return {insert:{source:'nexture-team',ref,label:role.name,appearance:'session',clipboardText:ref}}}catch{return undefined}
  },
  codec:{clipboardText:ref=>ref,serialize:ref=>Promise.resolve(ref)}
 }
}
export const statusLabels={proposed:'待确认',approved:'已确认',rejected:'已拒绝',running:'执行中',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断',pending:'等待执行',active:'可用',archived:'已归档',queued:'排队中',stale:'需重新确认',blocked:'前置未完成'}
/** A cancelled Team task may still have native process cleanup in progress. */
export function hasPendingTasks(plans=[]) {
 return plans.some(plan=>plan.status==='running'||plan.tasks?.some(task=>task.nativeCleanup?.status==='pending'||plan.status!=='cancelled'&&task.status==='interrupted'&&['pi','codex','kimi'].includes(task.execution)&&task.nativeObservation?.nativeSession&&typeof task.nativeObservation.text==='string'))
}
/** Retain the dependency graph when turning a stored plan back into an editable draft. */
export function editableTasks(tasks=[]) {
 return tasks.map(({id,dependsOn=[],roleId,title,prompt,execution,model,provider,mode,criteria})=>({id,dependsOn:[...dependsOn],roleId,title,prompt,execution,model,provider,mode,criteria}))
}
export function assertTaskDependencies(tasks,originalTasks=[]) {
 const ids=new Set(tasks.map(task=>task.id).filter(Boolean))
 for(const task of tasks)for(const id of task.dependsOn||[])if(!ids.has(id)) {
  const title=originalTasks.find(item=>item.id===id)?.title||id
  throw new Error(`任务“${task.title}”依赖前置任务“${title}”。请恢复该任务后再提交分工。`)
 }
}
