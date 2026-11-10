import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import vm from 'node:vm'
import {build} from 'esbuild'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {TeamService} from '../src/service.mjs'
import {apply} from '../src/plugin.mjs'
import {draftDetail} from '../src/confirmation.mjs'
import {hasPendingTasks} from '../src/client/model.mjs'

const human={kind:'human'}
async function fixture(t,runtime){
 const stateDir=await mkdtemp(join(tmpdir(),'team-kimi-'))
 const cleanup=[]
 const service=await new TeamService({stateDir,runtime}).init()
 t.after(async()=>{await Promise.all(cleanup.map(fn=>fn?.()));await service.dispose();await rm(stateDir,{recursive:true,force:true})})
 return {service,stateDir,cleanup}
}
async function createRole(service,execution='dsh'){
 const draft=await service.draftRole({role:{name:'Worker',prompt:'Read the approved fixture',execution,autoMemory:false},sourceSession:'root'})
 return service.confirm(draft.id,draft.version,human)
}
async function plugin(t,{bridge,models=[]}={}){
 const {service,stateDir,cleanup}=await fixture(t)
 const role=await createRole(service)
 // Restore a saved Kimi role independently of the role editor's normalization.
 await service.store.update(d=>{d.roles.find(r=>r.id===role.id).execution='kimi'})
 await service.dispose()
 const tools=new Map()
 const ctx={
  reflect:{get:name=>name==='nextureCliTeam'?{entry:'/fixture/active-cli.mjs',getBridge:()=>bridge}:undefined},
  tools:{register(def){tools.set(def.name,def);return()=>{}}},webServer:{register(){return()=>{}}},systemPrompt:{section(){return()=>{}}},effect(fn){cleanup.push(fn())},
  userQuestions:{ask:async({questions})=>({answers:[{id:questions[0].id,selected:['确认执行']}]})},
  subagents:{list:()=>['spawn'],start(){assert.fail('Kimi must not fall back to DSH')}},
  sessionController:{modelCatalog:async()=>({groups:models})},
 }
 apply(ctx,{stateDir})
 const exec={agent:{session:{header:{id:'root',cwd:stateDir}}},signal:new AbortController().signal}
 const call=async(name,args={})=>JSON.parse(await tools.get(name).execute(args,exec))
 return {call,tools,role,stateDir}
}
function bridgeFixture(){
 const calls={prepare:[],start:[],prompt:[]}
 const bridge={kinds:['kimi'],catalog:async()=>[{kind:'kimi',available:true}],
  async prepare(plan){calls.prepare.push(plan);return {planId:'native-plan'}},
  async start(input){calls.start.push(input);return {id:'native-kimi'}},
  async prompt(input){calls.prompt.push(input)},
  async output(){const text=calls.prompt.at(-1).text;return {source:'session',entries:[{role:'user',text},{role:'assistant',text:'KIMI_REPLY\n'+text.trimEnd().split('\n').at(-1),completion:true}]}}
 }
 return {bridge,calls}
}

test('Kimi role and plan overrides keep the approved execution and model',async t=>{
 const {service}=await fixture(t),role=await createRole(service,'kimi')
 assert.equal(role.execution,'kimi')
 const plan=await service.proposePlan({title:'Read',sourceSession:'root',project:'/tmp',tasks:[{roleId:role.id,title:'Read',prompt:'Read',model:'kimi-for-coding'}]})
 assert.equal(plan.tasks[0].execution,'kimi');assert.equal(plan.tasks[0].model,'kimi-for-coding')
 const dsh=await createRole(service)
 const override=await service.proposePlan({title:'Override',sourceSession:'root',project:'/tmp',tasks:[{roleId:dsh.id,title:'Read',prompt:'Read',execution:'kimi'}]})
 assert.equal(override.tasks[0].execution,'kimi')
})

test('Kimi execution catalog uses the active bridge kinds and installed availability',async t=>{
 const {bridge}=bridgeFixture(),p=await plugin(t,{bridge})
 let catalog=await p.call('team_catalog')
 assert.deepEqual(catalog.executions.find(e=>e.id==='kimi'),{id:'kimi',label:'Kimi Code',available:true})
 bridge.kinds=['codex']
 catalog=await p.call('team_catalog')
 assert.equal(catalog.executions.find(e=>e.id==='kimi').available,false)
 assert.match(catalog.executions.find(e=>e.id==='kimi').notice,/结构化结果/)
 bridge.kinds=['kimi'];bridge.catalog=async()=>[{kind:'kimi',available:false}]
 catalog=await p.call('team_catalog',{includeModels:true})
 assert.equal(catalog.executions.find(e=>e.id==='kimi').available,false)
})

test('active CLI catalog models retain execution identity without becoming DSH providers',async t=>{
 const {bridge}=bridgeFixture()
 bridge.kinds=['pi','codex','kimi']
 const rows=[
  {kind:'kimi',available:true,models:[{id:'kimi-for-coding',label:'Kimi coding',source:'Kimi 配置',provider:'must-not-forward'}],defaultModel:'kimi-for-coding',preferredModel:'kimi-for-coding',nextModel:'kimi-for-coding'},
  {kind:'pi',available:true,models:[{id:'anthropic/sonnet',label:'Sonnet',source:'Pi 配置'}],defaultModel:'anthropic/sonnet'},
  {kind:'codex',available:true,models:[{id:'gpt-test',label:'GPT test',source:'Codex 缓存'}],defaultModel:'gpt-test'},
  {kind:'claude',available:true,models:[{id:'unsupported',label:'Not in bridge kinds'}]},
 ]
 let discoveries=0;bridge.catalog=async()=>{discoveries++;return rows}
 const p=await plugin(t,{bridge,models:[{id:'dsh-provider',models:[{id:'gpt-test',name:'DSH GPT'}]}]})
 const compact=await p.call('team_catalog');assert.equal(compact.models,undefined);assert.equal(discoveries,0)
 const catalog=await p.call('team_catalog',{includeModels:true})
 assert.deepEqual(catalog.models,[
  {execution:'dsh',provider:'dsh-provider',id:'gpt-test',label:'DSH GPT'},
  {execution:'kimi',id:'kimi-for-coding',label:'Kimi coding',source:'Kimi 配置'},
  {execution:'pi',id:'anthropic/sonnet',label:'Sonnet',source:'Pi 配置'},
  {execution:'codex',id:'gpt-test',label:'GPT test',source:'Codex 缓存'},
 ])
 assert.equal(catalog.executions.find(e=>e.id==='kimi').defaultModel,'kimi-for-coding')
 rows[0].available=false;rows[0].executable='/fixture/kimi'
 const unavailable=await p.call('team_catalog',{includeModels:true})
 assert.equal(unavailable.executions.find(e=>e.id==='kimi').available,false)
 assert.equal(unavailable.models.some(m=>m.execution==='kimi'),false)
})

test('Kimi plan and consultation reuse the CLI runtime without DSH execution',async t=>{
 const {bridge,calls}=bridgeFixture(),p=await plugin(t,{bridge})
 const plan=await p.call('team_plan',{plan:JSON.stringify({title:'Read fixture',tasks:[{roleId:p.role.id,title:'Read',prompt:'Read fixture',execution:'kimi',model:'kimi-for-coding'}]})})
 assert.equal(plan.tasks[0].execution,'kimi')
 assert.equal(calls.start.length,0,'proposing the plan does not execute it')
 const result=await p.call('team_consult',{roleId:p.role.id,text:'Read fixture'})
 assert.equal(result.output,'KIMI_REPLY');assert.equal(result.nativeSession,'native-kimi')
 assert.equal(calls.prepare.length,1);assert.equal(calls.prepare[0].tasks[0].kind,'kimi')
 assert.equal(calls.prepare[0].tasks[0].mode,'read');assert.equal(calls.start.length,1);assert.equal(calls.prompt.length,1)
 await p.call('team_confirm',{id:plan.id,version:plan.version})
 const started=await p.call('team_start',{id:plan.id,requestId:'kimi-once'})
 let update=started
 for(let i=0;i<20&&!['completed','failed'].includes(update.status);i++)update=await p.call('team_wait',{id:plan.id,after:update.cursor,timeoutMs:1000})
 const full=await p.call('team_result',{id:plan.id,fullOutput:true})
 assert.equal(full.status,'completed');assert.equal(full.tasks[0].output,'KIMI_REPLY')
 assert.equal(full.tasks[0].nativeSession,'native-kimi');assert.equal(await readFile(full.tasks[0].outputFile,'utf8'),'KIMI_REPLY')
 await p.call('team_start',{id:plan.id,requestId:'kimi-once'})
 assert.equal(calls.prepare.length,2);assert.equal(calls.start.length,2);assert.equal(calls.prompt.length,2)
 assert.equal(calls.prepare[1].tasks[0].kind,'kimi');assert.equal(calls.prepare[1].tasks[0].model,'kimi-for-coding')
})

test('unavailable Kimi refuses plans and consultation without fallback or admission',async t=>{
 const {bridge,calls}=bridgeFixture();bridge.kinds=['codex']
 const p=await plugin(t,{bridge})
 const plan={title:'Read',tasks:[{roleId:p.role.id,title:'Read',prompt:'Read'}]}
 await assert.rejects(p.call('team_plan',{plan:JSON.stringify(plan)}),/执行方式不可用/)
 await assert.rejects(p.call('team_consult',{roleId:p.role.id,text:'Read'}),/执行方式不可用/)
 assert.equal(calls.prepare.length,0);assert.equal(calls.start.length,0);assert.equal(calls.prompt.length,0)
 const disk=JSON.parse(await readFile(join(p.stateDir,'state.json'),'utf8'))
 assert.equal(disk.plans.length,0);assert.equal(disk.roles.find(r=>r.id===p.role.id).execution,'kimi')
})

test('missing optional CLI keeps Kimi unavailable without changing its saved role',async t=>{
 const p=await plugin(t),catalog=await p.call('team_catalog')
 assert.equal(catalog.executions.find(e=>e.id==='kimi').available,false)
 const plan={title:'Read',tasks:[{roleId:p.role.id,title:'Read',prompt:'Read'}]}
 await assert.rejects(p.call('team_plan',{plan:JSON.stringify(plan)}),/执行方式不可用/)
 await assert.rejects(p.call('team_consult',{roleId:p.role.id,text:'Read'}),/执行方式不可用/)
 const disk=JSON.parse(await readFile(join(p.stateDir,'state.json'),'utf8'))
 assert.equal(disk.plans.length,0);assert.equal(disk.roles.find(r=>r.id===p.role.id).execution,'kimi')
})

test('Kimi terminal provider is hidden and rejected for DSH roles',async t=>{
 const {service}=await fixture(t)
 await assert.rejects(service.draftRole({role:{name:'Invalid DSH',prompt:'Read',execution:'dsh',provider:'nexture-kimi-terminal',model:'kimi-for-coding'}}),/直接聊天/)
 const p=await plugin(t,{models:[{id:'nexture-kimi-terminal',models:[{id:'kimi-for-coding'}]},{id:'dsh-provider',models:[{id:'model'}]}]})
 const catalog=await p.call('team_catalog',{includeModels:true})
 assert.deepEqual(catalog.models.map(m=>m.provider),['dsh-provider'])
})

test('Kimi background recovery reads its owned interrupted result once without redispatch',async t=>{
 let reads=0
 const {service}=await fixture(t,{run(){assert.fail('Recovery must not run business work')},async reconcile(task,context){reads++;assert.equal(task.execution,'kimi');assert.equal(context.observation.nativeSession,'native-kimi');return {output:'Recovered Kimi result',stopReason:'completed',nativeSession:'native-kimi'}}})
 const role=await createRole(service),plan=await service.proposePlan({title:'Recover',sourceSession:'root',project:'/tmp',tasks:[{id:'work',roleId:role.id,title:'Read',prompt:'Read'}]})
 await service.confirm(plan.id,plan.version,human)
 await service.store.update(d=>{const p=d.plans.find(p=>p.id===plan.id),task=p.tasks[0];p.status='interrupted';task.execution='kimi';task.status='interrupted';task.nativeSession='native-kimi';task.nativeObservation={nativeSession:'native-kimi',text:'owned prompt',marker:'NEXTURE_TEAM_DONE_work'}})
 await Promise.all([service.scanInterrupted(),service.scanInterrupted()]);await service.scanInterrupted()
 assert.equal(reads,1);assert.equal(service.result(plan.id).status,'completed');assert.equal(service.result(plan.id,{fullOutput:true}).tasks[0].output,'Recovered Kimi result')
})

test('Kimi read-only recovery keeps panel polling active only for owned uncancelled work',()=>{
 const task={status:'interrupted',execution:'kimi',nativeObservation:{nativeSession:'native-kimi',text:'owned prompt'}}
 assert.equal(hasPendingTasks([{status:'interrupted',tasks:[task]}]),true)
 assert.equal(hasPendingTasks([{status:'cancelled',tasks:[task]}]),false)
 assert.equal(hasPendingTasks([{status:'interrupted',tasks:[{...task,nativeObservation:null}]}]),false)
})

test('Kimi Code is shown on role, plan confirmation and task results',async()=>{
 const role={id:'r',name:'Worker',type:'longterm',skills:[],prompt:'Read',execution:'kimi',autoMemory:false}
 assert.match(draftDetail({kind:'role',role}),/\| 执行 \| Kimi Code \|/)
 const plan={id:'p',title:'Read',version:1,status:'completed',project:'/tmp',tasks:[{id:'work',roleId:role.id,roleSnapshot:role,title:'Read',prompt:'Read',execution:'kimi',status:'completed'}]}
 assert.match(draftDetail({kind:'plan',...plan}),/\| 执行 \| Kimi Code/)
 const result=await build({entryPoints:['src/client/TasksPanel.jsx'],bundle:true,write:false,platform:'browser',format:'cjs',external:['react']})
 const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:()=>React})
 assert.match(renderToStaticMarkup(React.createElement(module.exports.default,{plans:[plan],roles:[role],selected:'p'})),/>Kimi Code</)
})
