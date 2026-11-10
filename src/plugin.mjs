import {createPlanConfirmationResolver} from './plan-confirmation.mjs'
import {stat} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {TeamService} from './service.mjs'
import {selectMemories} from './memory.mjs'
import {DshRuntime} from './dsh-runtime.mjs'
import {CliRuntime} from './cli-runtime.mjs'
import {createCliBridgeReader} from './cli-bridge.mjs'
import {assertDshProvider,isDirectProvider} from './execution-route.mjs'
import {createHandler,BASE} from './http.mjs'
import {confirmInChat} from './confirmation.mjs'
import {createHostNotifier,sessionUsage} from './host-notifier.mjs'
export const name='nexture-team'
export const inject=['tools','webServer','connection','userQuestions','systemPrompt','subagents','agents','sessionController']
let z
try{z=(await import('@deepseek-ai/schemastery')).default}catch{}
export const Config=z?.object({stateDir:z.string().default(''),cliModule:z.string().default('')})

const guidance=`## Nexture Team 角色与团队
使用 Team 管理角色和私有记忆，CLI 为可选执行方式。用户 @角色 或消息含 @[名称](nexture-role:ID) 时按稳定 ID 定位，不当作文件或其他会话引用。
普通简单咨询可以直接回复，不要求派发；需要指定角色意见时调用 team_consult；@角色顾问/创建助手时调用 team_consult 获取问题或配置建议，再由你在当前原生对话提问、保存草案；子角色不直接向用户申请确认。创建/修改：team_role_draft 保存草案 → team_confirm 展示完整草案供用户确认；未确认不创建。不要用 shell 或写文件绕过。
执行任务：team_catalog 查询匹配角色（优先长期）→ team_plan 提出统一分工，所有角色按原主对话审批设置一次确认（ask 人工卡；never 不重复弹卡；Auto 每次工具调用已经宿主审查，不追加审查；设置缺失或异常时人工确认） → team_confirm → team_start 立即返回，再用 team_wait(id,after:cursor,timeoutMs:30000) 等待增量事件、team_result 取简短结果（完整输出按需读取 outputFile 或 fullOutput:true）。旧 team_run 只做短等待。任务默认只读，写任务在草案中明示。无合适角色时先提出临时角色草案确认，再提出分工。不得把派发、终端存活、空闲当作完成，不要反复轮询未变化的完整状态。
先列出用户的每个独立请求，用 requests 标记 direct（已直接回答）、delegated（绑定 task.requestId）、blocked（明确原因）；每个请求都须有去向。只有任务确实需要另一个任务的结果才写 dependsOn，不能因它们在同一句话中就串行。独立请求分别交付，快速咨询完成立即回复，开发继续后台运行；调用可能等待的人工确认前，先把已完成的独立回答发给用户。最终汇总不能吞掉已完成的独立结果。等待超时不表示执行失败，不重发任务，不用 shell sleep、长时间占用工具或反复查询完整状态等待；收到后台事件时按 cursor 去重并及时交付。验证、产物、阻塞和执行身份以结果元数据为准，记忆整理在业务完成后异步运行。原生观察中断后用 team_reconcile 只读恢复结果；待恢复的记忆用 team_retry_memory 显式重试，不重发业务任务。阶段通知只是执行者报告，不能当作验证通过；DSH 宿主暂不支持实时阶段流。
角色、提示词、Skills、默认执行方式/模型和记忆积累可通过面板/草案调整。未明确指定时沿用角色默认；DSH 模型需 provider/model 成对选择。未安装 Nexture CLI 时只用 DSH，不静默替换用户选定的执行方式。角色经验私有，关闭积累不影响已有记忆读取；长期规则变更等用户确认。用户要求角色派生、记忆继承或新增角色审批员时说明属于 3.5 期；任务计划沿用原主对话权限设置。
任务中的推送、发布、部署等仍须遵守宿主权限和用户授权，分工确认不扩大权限。`
const parse=text=>{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected JSON object');return value}
const brief=p=>({id:p.id,kind:p.kind,title:p.title,version:p.version,status:p.status,project:p.project,requests:p.requests,tasks:p.tasks?.map(t=>({id:t.id,requestId:t.requestId,roleId:t.roleId,title:t.title,dependsOn:t.dependsOn,execution:t.execution,model:t.model,provider:t.provider,mode:t.mode,criteria:t.criteria,status:t.status}))})
export function apply(ctx,config={}){
  const resolveConfirmation=createPlanConfirmationResolver(ctx)
  const dsh=new DshRuntime(ctx)
  const getBridge=createCliBridgeReader(config.cliModule,{ctx})
  const cli=new CliRuntime({getBridge})
  const validateTask=async(task,context)=>{
    if(task.execution==='dsh'){
      assertDshProvider(task.provider)
      if(!dsh.available())throw Error('DSH 子任务执行方式不可用，未派发；请保留原角色执行方式并检查宿主支持。')
      if(!task.provider){const parent=ctx.agents?.get?.(context.sourceSession);assertDshProvider(parent?.model?.current?.()?.provider??ctx.sessionController?.agents?.selectionFor?.(parent)?.provider)}
    }else{
      const bridge=await getBridge()
      if(!await cli.available()||!bridge?.kinds?.includes(task.execution))throw Error('所选 '+task.execution+' 执行方式不可用：请启用支持 Team 的 Nexture CLI，并检查活动连接。未切换执行方式、未派发任务。')
    }
  }
  const runtime={validateTask,prepare:async (plan,signal)=>plan.tasks.some(t=>t.execution!=='dsh')?cli.prepare(plan,signal):undefined,run:async(task,context)=>{await validateTask(task,context);return (task.execution==='dsh'?dsh:cli).run(task,context)},reconcile:(task,context)=>{if(task.execution==='dsh')throw new Error('DSH read-only reconciliation unavailable; inspect the original native session without resending');return cli.reconcile(task,context)}}
  const stateDir=config.stateDir||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'nexture-team')
  let instance,http,closing=false
  const ready=()=>{
    if(closing)return Promise.reject(new Error('Nexture Team is shutting down'))
    return instance??=(new TeamService({stateDir,runtime,onEvent:createHostNotifier(ctx)})).init().then(s=>{if(!closing)void s.retryPendingEvents().catch(e=>ctx.logger?.warn?.(e.message));return s})
  }
  const restoration=stat(join(stateDir,'state.json')).then(info=>{if(!closing&&info.isFile())return ready()}).catch(error=>{if(error.code!=='ENOENT')ctx.logger?.warn?.('Team observation restore failed: '+error.message)})
  const retryTimer=setInterval(()=>{if(instance&&!closing)void instance.then(s=>s.retryPendingEvents()).catch(e=>ctx.logger?.warn?.(e.message))},30000);retryTimer.unref?.()
  const caller=exec=>{const h=exec?.agent?.session?.header;if(!h?.id)throw new Error('Calling DSH session required');return {sourceSession:h.id,project:h.cwd}}
  const original=(s,id,exec)=>{if(s.draft(id).sourceSession!==caller(exec).sourceSession)throw new Error('请在草案原对话中继续，或使用 Team 面板')}
  const roleAccess=(s,roleId,exec)=>{const h=exec?.agent?.session?.header;if(h?.origin==='subagent'){const bound=s.snapshot().plans.flatMap(p=>p.tasks).find(t=>t.nativeSession===h.id);if(!bound||bound.roleId!==roleId)throw new Error('角色私有记忆不可跨角色读取或咨询')}}
  const catalog=async(includeModels=true)=>{
    const bridge=await getBridge(),available=await cli.available();let models=[],notice='',installed=[]
    if(includeModels)try{const data=await ctx.sessionController.modelCatalog();models=data.groups?.filter(p=>!isDirectProvider(p.id)).flatMap(p=>(p.models||[]).map(m=>({execution:'dsh',provider:p.id,id:m.id,label:m.name||m.id})))||[]}catch(e){notice=e.message}
    if(available&&includeModels)try{installed=await bridge.catalog?.()}catch(e){notice=[notice,e.message].filter(Boolean).join('；')}
    const kinds=bridge?.kinds||[],cliKinds=['pi','codex','claude','kimi']
    const rowAvailable=row=>row?.available===true||row?.available===undefined&&Boolean(row?.executable)
    if(available&&includeModels)for(const row of installed){
      if(!cliKinds.includes(row.kind)||!kinds.includes(row.kind)||!rowAvailable(row))continue
      for(const m of Array.isArray(row.models)?row.models:[])if(typeof m?.id==='string'&&m.id.trim())models.push({execution:row.kind,id:m.id,label:m.label||m.id,...(m.source?{source:m.source}:{})})
    }
    const executions=cliKinds.map(id=>{
      const row=installed.find(r=>r.kind===id),supported=available&&kinds.includes(id),defaults={}
      for(const key of ['defaultModel','preferredModel','nextModel'])if(typeof row?.[key]==='string')defaults[key]=row[key]
      return {id,label:id==='kimi'?'Kimi Code':id==='claude'?'Claude Code':id==='codex'?'Codex':'Pi',available:supported&&(!installed.length||rowAvailable(row)),...defaults,notice:!available?'需安装支持 Team 接口的 Nexture CLI':!kinds.includes(id)?'此 CLI 的结构化结果接入尚未提供':row?.notice}
    })
    return {executions:[{id:'dsh',label:'DSH 原生智能体',available:dsh.available()},...executions],...(includeModels?{models}:{}),notice}
  }

  const disposePrompt=ctx.systemPrompt.section({name:'nexture-team:roles',order:1740,interpolate:false,text:guidance})
  const route=ctx.webServer.register({kind:'prefix',path:BASE,handler:async(req,res)=>{try{if(closing)throw new Error('Nexture Team is shutting down');const s=await ready();http??=createHandler(s,{requestGate:ctx.connection?.requestRejection?.bind(ctx.connection),catalog:()=>catalog(true)});await http(req,res)}catch(e){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}))}}})
  const defs=[
    ['team_catalog','Read compact active role catalog. query optionally matches longterm roles first. Default omits model discovery/lists; includeModels:true only when choosing a route. Never includes private memories.',{query:{type:'string'},includeModels:{type:'boolean'}},[],async(a)=>{const s=await ready();return {roles:(a.query?s.matchRoles(a.query):s.snapshot().roles.filter(r=>r.status==='active'&&r.enabled)).map(({id,name,type,execution,model,provider,skills,builtin,version})=>({id,name,type,execution,model,provider,skills,builtin,version})),...await catalog(a.includeModels===true)}}],
    ['team_role_draft','Create a role creation/update DRAFT, never approval. JSON role plus optional roleId. Role fields name,prompt,type:longterm|temporary,skills:[],execution:dsh|pi|codex|claude|kimi,model,provider,autoMemory,enabled. Next call team_confirm. User can edit in Team panel.',{draft:{type:'string'}},['draft'],async(a,exec)=>{const input=parse(a.draft);return (await ready()).draftRole({role:input.role,roleId:input.roleId,...caller(exec)})}],
    ['team_confirm','Confirm an exact stored draft/version in its original native chat. Task plans follow parent approval: ask shows a human card; never skips only the plan card; Auto has already host-reviewed this tool call. Missing/unknown policy falls back to humans. Role creation/updates and long-term memory rules ALWAYS require human confirmation. No model approval flags. Cancel means stop. Then team_start for an approved plan.',{id:{type:'string'},version:{type:'integer'}},['id','version'],async(a,exec)=>{const result=await confirmInChat({service:await ready(),questions:ctx.userQuestions,exec,id:a.id,version:a.version,isClosing:()=>closing,resolveConfirmation});return result.kind==='plan'?brief(result):result}],
    ['team_plan','Propose one unified team task draft in current chat/project. JSON title,requests:[{id,text,handling:direct|delegated|blocked,output? (direct),reason? (blocked)}],tasks:[{roleId,title,prompt,requestId,id?,dependsOn?:taskId[],execution?,model?,provider?,mode:read|write,criteria?}]. Source session/project come from live calling chat. Does not start work.',{plan:{type:'string'}},['plan'],async(a,exec)=>{const input=parse(a.plan);return brief(await (await ready()).proposePlan({title:input.title,tasks:input.tasks,requests:input.requests,...caller(exec)}))}],
    ['team_start','Start an approved plan once and return immediately. requestId optionally makes repeated tool delivery idempotent. Work continues independently; consume team_wait events with the returned cursor.',{id:{type:'string'},requestId:{type:'string'}},['id'],async(a,exec)=>{const s=await ready();original(s,a.id,exec);return s.start(a.id,{requestId:a.requestId})}],
    ['team_wait','Wait for any new plan/task event after cursor (maximum 60s; default 30s), not for the entire plan. Timeout leaves execution running. Deliver each independent completed result promptly and retain cursor to avoid replay.',{id:{type:'string'},after:{type:'integer',minimum:0},timeoutMs:{type:'integer',minimum:0,maximum:60000}},['id'],async(a,exec)=>{const s=await ready();original(s,a.id,exec);return s.wait(a.id,{after:a.after??0,timeoutMs:a.timeoutMs??30000})}],
    ['team_result','Read compact durable task summaries, request coverage, phases, usage, artifacts, native identities and full output file references. Use taskId to select one task. fullOutput:true explicitly returns its full text.',{id:{type:'string'},taskId:{type:'string'},fullOutput:{type:'boolean'}},['id'],async(a,exec)=>{const s=await ready();original(s,a.id,exec);return s.result(a.id,{taskId:a.taskId,fullOutput:a.fullOutput===true})}],
    ['team_retry_memory','Explicitly resume pending role memory organization for a settled plan in this original chat. Returns immediately; never reruns business tasks. Proposed long-term rules still require human confirmation.',{id:{type:'string'}},['id'],async(a,exec)=>{const s=await ready();original(s,a.id,exec);return s.retryMemory(a.id)}],
    ['team_reconcile','Observe an interrupted original CLI session for a late task-bound completion; never starts or resends work. Default/max wait 30s. DSH sessions without a host read API stay interrupted with an actionable diagnostic.',{id:{type:'string'},taskId:{type:'string'},timeoutMs:{type:'integer',minimum:0,maximum:30000}},['id'],async(a,exec)=>{const s=await ready();original(s,a.id,exec);return s.reconcile(a.id,{taskId:a.taskId,timeoutMs:a.timeoutMs??30000})}],
    ['team_run','Compatibility: start an approved plan once and briefly wait for new events (max 30s). Returns on progress; continue with team_wait using cursor. Never waits for the entire plan or retries uncertain execution.',{id:{type:'string'},requestId:{type:'string'},timeoutMs:{type:'integer',minimum:0,maximum:30000}},['id'],async(a,exec)=>{const s=await ready();original(s,a.id,exec);const current=s.plan(a.id);if(current.status==='approved')await s.start(a.id,{requestId:a.requestId});return s.wait(a.id,{after:s.result(a.id).cursor,timeoutMs:Math.min(a.timeoutMs??30000,30000)})}],
    ['team_status','Read compact plan state/result for this exact chat. Optional id selects one plan. Use team_wait for waiting and team_result fullOutput only when needed.',{id:{type:'string'}},[],async(a,exec)=>{const s=await ready();if(a.id){original(s,a.id,exec);return s.result(a.id)}return {plans:s.snapshot(caller(exec).sourceSession).plans.map(p=>s.result(p.id))}}],
    ['team_usage','Read reported parent-session usage separately from workers in this source chat. Unknown usage stays null; no character estimates or invented zeroes.',{},[],async(_a,exec)=>{const s=await ready(),source=caller(exec).sourceSession;return {parent:sessionUsage(exec.agent),workers:s.snapshot(source).plans.flatMap(p=>p.tasks.map(t=>({planId:p.id,taskId:t.id,requestId:t.requestId,nativeSession:t.nativeSession||null,usage:t.usage??null})))}}],
    ['team_consult','Ask one role a question without project changes. Role creation helper returns questions/configuration suggestions; root chat asks the human and saves/confirms drafts. Actual execution requires a plan. roleId is stable ID from @ token/catalog.',{roleId:{type:'string'},text:{type:'string'}},['roleId','text'],async(a,exec)=>{const s=await ready();roleAccess(s,a.roleId,exec);const r=s.role(a.roleId);const result=await s.consult(r.id,a.text,{...caller(exec),signal:exec.signal});return {...result,output:result.output?.slice(0,32000)}}],
    ['team_memory','Read relevant existing memory for a role; this tool cannot save/delete or approve rules. A delegated role may read only its own memory. Use task final team-memory suggestions for automatic experiences.',{roleId:{type:'string'}},['roleId'],async(a,exec)=>{const s=await ready(),c=caller(exec);roleAccess(s,a.roleId,exec);return {memories:selectMemories(s.memories(a.roleId,c.project),a.roleId,c.project,6000)}}],
  ]
  const disposers=defs.map(([name,description,properties,required,execute])=>ctx.tools.register({name,description,parameters:{type:'object',properties,required,additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},isConcurrencySafe:()=>true,timeoutMs:['team_start','team_wait','team_run','team_result','team_status','team_reconcile','team_retry_memory'].includes(name)?65000:360000,execute:async(a,exec)=>{if(closing)throw new Error('Team shutting down');return JSON.stringify(await execute(a,exec))}}))
  ctx.effect(()=>async()=>{closing=true;clearInterval(retryTimer);route();http?.dispose();disposePrompt();for(const off of disposers)off();await restoration;if(instance){try{await (await instance).dispose()}catch(error){ctx.logger?.warn?.(error.message)}}})
  ctx.logger?.info?.('Nexture Team ready; task plans follow parent approval policy; roles and long-term rules require human confirmation.')
}
