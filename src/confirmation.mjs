import {sharePlanConfirmation} from './plan-confirmation.mjs'
const escape=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_[\]{}()!#|~$]/g,'\\$&').replace(/\r?\n/g,' ')
function section(kind,value){
  const text=String(value??'')
  let nonce=0
  while(text.includes(`nexture-team:${kind}:${nonce} -->`))nonce++
  return `<!-- nexture-team:${kind}:${nonce} -->\n\n${text}\n\n<!-- /nexture-team:${kind}:${nonce} -->`
}
const table=rows=>section('metadata',['| 信息 | 内容 |','| :--- | :--- |',...rows.map(([k,v])=>`| ${k} | ${escape(v)} |`)].join('\n'))
// Preserve code and Markdown exactly; use the same renderer as native chat.
// A delimiter absent from the content prevents nested text closing its section.
const prose=s=>section('content',s)
const instructions=s=>section('instructions',s)
const executionName={dsh:'DSH 原生智能体',pi:'Pi',codex:'Codex',claude:'Claude Code',kimi:'Kimi Code'}
export function draftDetail(d){
  if(d.kind==='role')return table([['名称',d.role.name],['类型',d.role.type==='longterm'?'长期角色':'临时角色'],['Skills',d.role.skills.join('、')||'沿用环境'],['执行',executionName[d.role.execution]||d.role.execution],['模型',d.role.model?`${d.role.provider?d.role.provider+'/':''}${d.role.model}`:'继承当前对话'],['记忆',d.role.autoMemory?'自动积累':'关闭自动积累（已有记忆仍可读取）']])+`\n\n### 职责与提示词\n\n${prose(d.role.prompt)}`
  if(d.kind==='memory-rule')return `### 待确认的长期规则\n\n${prose(d.text)}\n\n来源：${escape(d.source)}`
  return table([['项目',d.project]])+(d.requests?.length?'\n\n### 独立请求与交付\n\n'+table(d.requests.map(r=>[`${r.id} · ${r.text}`,`${({direct:'已直接回答',delegated:'派发任务',blocked:'已阻塞'})[r.handling]||r.handling}${r.output?'：'+r.output:r.reason?'：'+r.reason:''}`])):'')+'\n\n'+d.tasks.map((t,i)=>{
    const rows=[['角色',t.roleSnapshot.name],['执行',`${executionName[t.execution]||t.execution} · ${t.provider?t.provider+'/':''}${t.model||'继承当前对话'}`],['范围',t.mode==='read'?'只读':'允许修改项目'],['验收',t.criteria]]
    if(t.requestId)rows.push(['对应请求',t.requestId])
    if(t.dependsOn?.length)rows.push(['前置任务',t.dependsOn.map(id=>{const index=d.tasks.findIndex(task=>task.id===id);return index<0?id:`任务 ${index+1}：${d.tasks[index].title}`}).join('、')])
    return `### ${i+1}. ${escape(t.title)}\n\n${table(rows)}\n\n${instructions(t.prompt)}`
  }).join('\n\n---\n\n')
}
export async function confirmInChat({service,questions,exec,id,version,isClosing=()=>false,resolveConfirmation}){
  const checkActive=()=>{if(isClosing())throw new Error('Nexture Team is shutting down');exec?.signal?.throwIfAborted()}
  checkActive()
  const d=service.draft(id),session=exec?.agent?.session?.header?.id
  if(!session||d.sourceSession!==session)throw new Error('草案属于其他 chat 对话，请在原对话或 Team 面板确认')
  if(d.status!=='proposed'||d.version!==version)throw new Error('Draft version changed or 已处理')
  const commitActive=()=>{checkActive();if(service.draft(id).sourceSession!==session)throw new Error('草案属于其他 chat 对话')}
  const decision=await sharePlanConfirmation(service,session,d.id,d.version,async()=>{
    commitActive()
    if(d.kind==='plan'){
      const authorization=await resolveConfirmation?.(exec)
      commitActive()
      if(authorization?.kind==='parent-policy')return service.confirm(d.id,d.version,authorization,commitActive)
    }
    if(!questions?.ask)throw new Error('原生确认不可用，请在 Team 面板查看并确认')
    const affirmative=d.kind==='role'?(d.roleId?'确认修改':'确认创建'):d.kind==='plan'?'确认执行':'确认记住'
    const qid=`nexture-team-${d.id}-v${d.version}`
    const result=await questions.ask({agent:exec.agent,signal:exec.signal,questions:[{id:qid,header:'Nexture Team · '+(d.kind==='role'?'角色草案':d.kind==='plan'?'任务分工':'长期规则'),question:d.title||d.role?.name||'确认这条长期规则',detail:draftDetail(d),options:[{label:affirmative,description:'按展示的版本确认'},{label:'返回调整',description:'保留草案，继续讨论'}]}]})
    commitActive()
    const matches=result.answers?.filter(a=>a.id===qid)||[],a=matches.length===1?matches[0]:null
    if(a?.selected?.length!==1||a.selected[0]!==affirmative||a.custom!==undefined)return {approved:false,id:d.id,feedback:a?.custom||'',message:'用户未确认，停止执行并等待修改意见。'}
    return service.confirm(d.id,d.version,{kind:'human'},commitActive)
  })
  commitActive()
  return decision
}
