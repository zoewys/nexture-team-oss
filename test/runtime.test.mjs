import test from 'node:test'
import assert from 'node:assert/strict'
import {realpath} from 'node:fs/promises'
const {DshRuntime} = await import('../src/dsh-runtime.mjs').catch(() => ({}))
const {CliRuntime} = await import('../src/cli-runtime.mjs').catch(() => ({}))
const project = await realpath('/tmp')
const role = {name:'Engineer',prompt:'Responsible for implementation',model:'default',provider:'default'}
const task = Object.freeze({id:'task-a',title:'Implement',execution:'dsh',model:'approved-model',provider:'approved-provider',criteria:['works']})
const context = {role,prompt:'Selected skills: frontend\nPrivate relevant memory\nImplement it',project,sourceSession:'source-a'}
function dsh(t, options = {}) {
 assert.equal(typeof DshRuntime,'function','DshRuntime must exist')
 const parent = {id:'source-a',session:{header:{id:'source-a',cwd:project}}}
 const calls = [], disposed = []
 const run = {id:'child-a',result:Promise.resolve({output:[{type:'text',text:'done'}],stopReason:'completed'}),async dispose(){disposed.push(true)}}
 const ctx = {agents:{get(id){assert.equal(id,'source-a');return parent}},subagents:{list:()=>['spawn'],resolveMaxDepth:()=>4,async start(...args){calls.push(args);return run}},...options}
 return {runtime:new DshRuntime(ctx),parent,calls,disposed,run,ctx}
}
test('DSH uses the exact source parent and approved model with no wrapper or tool widening', async t => {
 const f=dsh(t), signal=new AbortController().signal, ids=[]
 const result=await f.runtime.run(task,{...context,signal,onSession:id=>ids.push(id)})
 assert.deepEqual(f.calls,[['spawn',{parent:f.parent,signal,label:role.name,prompt:[{type:'text',text:context.prompt}],persona:role.prompt,agentOptions:{provider:task.provider,model:task.model},maxDepth:4}]])
 assert.deepEqual(result,{output:'done',nativeSession:'child-a',stopReason:'completed',usage:null})
 assert.deepEqual(ids,['child-a']);assert.equal(f.disposed.length,1)
})
test('DSH can resolve an unloaded exact parent and canonicalizes cwd aliases',async t=>{
 const f=dsh(t); f.parent.session.header.cwd='/tmp'
 f.ctx.agents.get=()=>undefined
 f.ctx.sessionController={agents:{async resolveAgent(id){assert.equal(id,'source-a');return {agent:f.parent}}}}
 await f.runtime.run(task,context);assert.equal(f.calls[0][1].parent,f.parent)
})
test('DSH rejects unknown or cross-project parent without spawning',async t=>{
 const f=dsh(t);f.parent.session.header.cwd='/'
 await assert.rejects(f.runtime.run(task,context),/project|cwd/i);assert.equal(f.calls.length,0)
 f.ctx.agents.get=()=>undefined;f.ctx.sessionController={agents:{async resolveAgent(){return {error:new Error('not found')}}}}
 await assert.rejects(f.runtime.run(task,context),/source|not found|parent/i);assert.equal(f.calls.length,0)
})
test('DSH availability reflects spawn provider and rejects incomplete model overrides',async t=>{
 const f=dsh(t);assert.equal(f.runtime.available(),true);f.ctx.subagents.list=()=>[];assert.equal(f.runtime.available(),false)
 f.ctx.subagents.list=()=>['spawn'];await assert.rejects(f.runtime.run({...task,provider:null},context),/provider.*model|model.*provider/i)
 assert.equal(f.calls.length,0);assert.equal(new DshRuntime({}).available(),false)
})
test('DSH retains failed-result diagnostics and always disposes the host run',async t=>{
 const f=dsh(t);f.run.result=Promise.resolve({output:[{type:'text',text:'partial'}],stopReason:'error',diagnostic:'provider failure'})
 await assert.rejects(f.runtime.run(task,context),e=>e.nativeSession==='child-a'&&e.output==='partial'&&/provider failure/.test(e.message))
 assert.equal(f.disposed.length,1)
})
test('DSH result rejection and disposal rejection preserve the primary failure',async t=>{
 const f=dsh(t);Object.defineProperty(f.run,'result',{get:()=>Promise.reject(new Error('result failed'))});f.run.dispose=async()=>{throw new Error('cleanup failed')}
 await assert.rejects(f.runtime.run(task,context),e=>e.nativeSession==='child-a'&&/result failed/.test(e.message)&&/cleanup failed/.test(e.disposalError?.message))
})
test('DSH cancellation propagates signal and disposes even when result stays pending',async t=>{
 const f=dsh(t),controller=new AbortController();f.run.result=new Promise(()=>{})
 const pending=f.runtime.run(task,{...context,signal:controller.signal,onSession:()=>controller.abort()})
 await assert.rejects(pending,e=>e.name==='AbortError'&&e.nativeSession==='child-a');assert.equal(f.disposed.length,1)
})
function cli(t, options={}) {
 assert.equal(typeof CliRuntime,'function','CliRuntime must exist')
 const calls={prepare:[],start:[],prompt:[],stop:[],output:0}
 const bridge={async prepare(input){calls.prepare.push(input);return {planId:'cli-plan',taskMap:{'task-a':'mapped-a','task-b':'mapped-b'}}},async start(input){calls.start.push(input);return {id:'cli-session'}},async prompt(input){calls.prompt.push(input);return {delivery:'submitted'}},async output(){calls.output++;return {source:'session',entries:[{role:'user',text:calls.prompt[0]?.text},{role:'assistant',text:'Implemented\nNEXTURE_TEAM_DONE_task-a',completion:true}]}},session(){return {activity:'idle',process:'alive'}},async stop(id){calls.stop.push(id)}}
 const runtime=new CliRuntime({getBridge:()=>bridge,pollMs:1,timeoutMs:30,...options})
 const cliTask={...task,execution:'codex',mode:'workspace-write'}
 const plan={id:'team-plan',title:'Plan',project,sourceSession:'source-a',tasks:[cliTask,{...cliTask,id:'task-b',execution:'pi'},task]}
 return {runtime,bridge,calls,cliTask,plan}
}
test('CLI is optional and bridge discovery stays dynamic',async t=>{
 assert.equal(typeof CliRuntime,'function','CliRuntime must exist');let bridge
 const runtime=new CliRuntime({getBridge:()=>bridge});assert.equal(await runtime.available(),false)
 bridge=cli(t).bridge;assert.equal(await runtime.available(),true);bridge=undefined;assert.equal(await runtime.available(),false)
 await assert.rejects(runtime.prepare({id:'p',tasks:[]}),/CLI|bridge/i)
})
test('CLI prepares one shared plan, excluding DSH tasks, with stable task mapping',async t=>{
 const f=cli(t);const [a,b]=await Promise.all([f.runtime.prepare(f.plan),f.runtime.prepare(f.plan)])
 assert.deepEqual(a,b);assert.equal(f.calls.prepare.length,1)
 assert.deepEqual(f.calls.prepare[0],{id:f.plan.id,title:f.plan.title,project,sourceSession:'source-a',tasks:f.plan.tasks.slice(0,2).map(x=>({id:x.id,title:x.title,kind:x.execution,model:x.model,mode:x.mode,criteria:x.criteria}))})
})
test('CLI starts mapped task once, dispatches prompt once, and only completes from bound assistant marker',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan),ids=[]
 const result=await f.runtime.run(f.cliTask,{...context,plan:f.plan,prepared,onSession:id=>ids.push(id)})
 assert.deepEqual(f.calls.start,[{planId:'cli-plan',taskId:'mapped-a'}]);assert.equal(f.calls.prompt.length,1)
 assert.equal(f.calls.prompt[0].id,'cli-session');assert.ok(f.calls.prompt[0].requestId);assert.ok(f.calls.prompt[0].text.includes(context.prompt));assert.ok(f.calls.prompt[0].text.includes('NEXTURE_TEAM_DONE_task-a'))
 assert.deepEqual(result,{output:'Implemented',nativeSession:'cli-session',stopReason:'completed',usage:null});assert.deepEqual(ids,['cli-session']);assert.deepEqual(f.calls.stop,[])
})
test('CLI never prepares automatically from run and uses a previously prepared shared plan',async t=>{
 const f=cli(t);await assert.rejects(f.runtime.run(f.cliTask,{...context,plan:f.plan}),/prepare|prepared/i);assert.equal(f.calls.start.length,0)
 await f.runtime.prepare(f.plan);await f.runtime.run(f.cliTask,{...context,plan:f.plan});assert.equal(f.calls.prepare.length,1)
})
test('CLI observes uncertain delivery without resending and recovers a task-bound final result',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan);f.bridge.prompt=async input=>{f.calls.prompt.push(input);return {delivery:'uncertain',reason:'lost acknowledgement'}}
 const result=await f.runtime.run(f.cliTask,{...context,prepared})
 assert.equal(result.output,'Implemented')
 assert.equal(f.calls.prompt.length,1);assert.equal(f.calls.output,1);assert.deepEqual(f.calls.stop,[])
})
test('CLI never mistakes old, foreign, tool, terminal, or idle output for completion',async t=>{
 for(const kind of ['old','foreign','tool','terminal','idle','later-user','nonfinal','pending']){
  const f=cli(t,{timeoutMs:7}),prepared=await f.runtime.prepare(f.plan)
  f.bridge.output=async()=>{const sent={role:'user',text:f.calls.prompt[0].text};const marker={role:'assistant',text:'bad\nNEXTURE_TEAM_DONE_task-a',completion:kind!=='nonfinal'};return {pending:kind==='pending',source:kind==='terminal'?'terminal':'session',entries:kind==='old'?[marker,sent]:kind==='foreign'?[sent,{...marker,text:'NEXTURE_TEAM_DONE_task-b'}]:kind==='tool'?[sent,{...marker,role:'tool'}]:kind==='idle'?[sent,{role:'assistant',text:'working'}]:kind==='later-user'?[sent,{role:'user',text:'Other work'},marker]:[sent,marker]}}
  await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared}),e=>e.nativeSession==='cli-session'&&/timed out|timeout/i.test(e.message),kind)
  assert.deepEqual(f.calls.stop,[])
 }
})
test('CLI cancellation alone stops native session; abort before startup creates nothing',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan),controller=new AbortController()
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal:controller.signal,onSession:()=>controller.abort()}),e=>e.name==='AbortError'&&e.nativeSession==='cli-session')
 assert.deepEqual(f.calls.stop,['cli-session']);assert.equal(f.calls.prompt.length,0)
 const aborted=AbortSignal.abort();await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal:aborted}),{name:'AbortError'});assert.equal(f.calls.start.length,1)
})
test('CLI failed startup is surfaced without retry; failed process cannot complete',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan);f.bridge.start=async input=>{f.calls.start.push(input);throw new Error('startup failed')}
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared}),/startup failed/);assert.equal(f.calls.start.length,1)
 f.bridge.start=async()=>({id:'cli-session'});f.bridge.output=async()=>({source:'session',entries:[]});f.bridge.session=()=>({process:'exited',activity:'idle'})
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared}),e=>e.nativeSession==='cli-session'&&/exited|failed|stopped/i.test(e.message))
})

test('DSH rejects a resolver returning another source session',async t=>{
 const f=dsh(t);f.parent.session.header.id='other-source'
 await assert.rejects(f.runtime.run(task,context),/source|session|parent/i);assert.equal(f.calls.length,0)
})
test('CLI rejects explicitly undelivered and unknown delivery acknowledgements',async t=>{
 for(const delivery of ['undelivered','invented']){
  const f=cli(t),prepared=await f.runtime.prepare(f.plan)
  f.bridge.prompt=async input=>{f.calls.prompt.push(input);return {delivery}}
  await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared}),/delivery|acknowledg/i)
  assert.equal(f.calls.prompt.length,1);assert.equal(f.calls.output,0)
 }
})
test('CLI cancellation interrupts stalled output and removes pending polls',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan),controller=new AbortController()
 f.bridge.output=async()=>{queueMicrotask(()=>controller.abort());return new Promise(()=>{})}
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal:controller.signal}),e=>e.name==='AbortError'&&e.nativeSession==='cli-session')
 assert.deepEqual(f.calls.stop,['cli-session'])
})
test('CLI timeout during uncertain prompt delivery reports native session without resending',async t=>{
 const f=cli(t,{timeoutMs:5}),prepared=await f.runtime.prepare(f.plan)
 f.bridge.prompt=async input=>{f.calls.prompt.push(input);return new Promise(()=>{})}
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared}),e=>e.nativeSession==='cli-session'&&/timed out|timeout/i.test(e.message))
 assert.equal(f.calls.prompt.length,1);assert.deepEqual(f.calls.stop,[])
})

test('DSH cancellation removes its abort listener even when the host result never settles',async t=>{
 const {getEventListeners}=await import('node:events')
 const f=dsh(t),controller=new AbortController();f.run.result=new Promise(()=>{})
 await assert.rejects(f.runtime.run(task,{...context,signal:controller.signal,onSession:()=>controller.abort()}),{name:'AbortError'})
 assert.equal(getEventListeners(controller.signal,'abort').length,0)
})
test('DSH host capability rejection is surfaced once without dropping approved options',async t=>{
 const f=dsh(t);f.ctx.subagents.start=async(...args)=>{f.calls.push(args);throw new Error('UNSUPPORTED_CAPABILITY persona')}
 await assert.rejects(f.runtime.run(task,context),/UNSUPPORTED_CAPABILITY/)
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].persona,role.prompt);assert.equal(f.disposed.length,0)
})

test('CLI prepare cancellation settles independently of a stalled bridge operation and never retransmits',async t=>{
 const f=cli(t,{timeoutMs:30}),controller=new AbortController()
 f.bridge.prepare=async input=>{f.calls.prepare.push(input);queueMicrotask(()=>controller.abort());return new Promise(()=>{})}
 await assert.rejects(f.runtime.prepare(f.plan,controller.signal),{name:'AbortError'})
 await assert.rejects(f.runtime.prepare(f.plan),{name:'AbortError'});assert.equal(f.calls.prepare.length,1)
})
test('CLI preparation has a deadline and retains a late prepared plan id for diagnosis',async t=>{
 const f=cli(t,{timeoutMs:5});let finish
 f.bridge.prepare=async input=>{f.calls.prepare.push(input);return new Promise(resolve=>{finish=resolve})}
 let error
 await assert.rejects(f.runtime.prepare(f.plan),e=>{error=e;return /timed out|timeout/i.test(e.message)})
 finish({planId:'late-plan'});await new Promise(resolve=>setImmediate(resolve))
 assert.equal(error.planId,'late-plan');await assert.rejects(f.runtime.prepare(f.plan),/timed out|timeout/i);assert.equal(f.calls.prepare.length,1)
})
test('CLI does not prepare or start when already cancelled',async t=>{
 const f=cli(t),signal=AbortSignal.abort()
 await assert.rejects(f.runtime.prepare(f.plan,signal),{name:'AbortError'});assert.equal(f.calls.prepare.length,0)
 const prepared=await f.runtime.prepare(f.plan)
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal}),{name:'AbortError'});assert.equal(f.calls.start.length,0)
})
test('CLI startup timeout settles without retry and reports a session that starts late',async t=>{
 const f=cli(t,{timeoutMs:5}),prepared=await f.runtime.prepare(f.plan),ids=[];let finish,error
 f.bridge.start=async input=>{f.calls.start.push(input);return new Promise(resolve=>{finish=resolve})}
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,onSession:id=>ids.push(id)}),e=>{error=e;return /timed out|timeout/i.test(e.message)})
 finish({id:'late-start'});await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(ids,['late-start']);assert.equal(error.nativeSession,'late-start');assert.equal(f.calls.start.length,1);assert.equal(f.calls.prompt.length,0);assert.deepEqual(f.calls.stop,[])
})
test('CLI startup cancellation settles then stops and reports the late session exactly once',async t=>{
 const f=cli(t,{timeoutMs:100}),prepared=await f.runtime.prepare(f.plan),controller=new AbortController(),ids=[];let finish,error
 f.bridge.start=async input=>{f.calls.start.push(input);queueMicrotask(()=>controller.abort());return new Promise(resolve=>{finish=resolve})}
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal:controller.signal,onSession:id=>ids.push(id)}),e=>{error=e;return e.name==='AbortError'})
 finish({id:'late-cancelled'});await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(ids,['late-cancelled']);assert.equal(error.nativeSession,'late-cancelled');assert.deepEqual(f.calls.stop,['late-cancelled']);assert.equal(f.calls.prompt.length,0)
 controller.abort();assert.equal(f.calls.stop.length,1)
})
test('CLI cancellation is bounded even when stopping the underlying session stalls',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan),controller=new AbortController()
 f.bridge.stop=async id=>{f.calls.stop.push(id);return new Promise(()=>{})}
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal:controller.signal,onSession:()=>controller.abort()}),{name:'AbortError'})
 assert.deepEqual(f.calls.stop,['cli-session'])
})
test('CLI preparation deadline includes stalled bridge discovery',async t=>{
 const f=cli(t,{timeoutMs:5,getBridge:()=>new Promise(()=>{})})
 await assert.rejects(f.runtime.prepare(f.plan),/timed out|timeout/i)
})

test('CLI cancellation exposes pending native cleanup without waiting for a stalled stop',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan),controller=new AbortController(),updates=[]
 f.bridge.stop=async id=>{f.calls.stop.push(id);return new Promise(()=>{})}
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal:controller.signal,onSession:()=>controller.abort(),onCleanup:update=>updates.push(update)}),e=>{
  assert.deepEqual(e.nativeCleanup,{status:'pending',phase:'stop',nativeSession:'cli-session'});return e.name==='AbortError'
 })
 assert.deepEqual(updates,[{status:'pending',phase:'stop',nativeSession:'cli-session'}]);assert.deepEqual(f.calls.stop,['cli-session'])
})
test('CLI late stop failure updates serializable cleanup metadata and preserves the stop error',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan),controller=new AbortController(),updates=[];let rejectStop,error
 f.bridge.stop=async()=>new Promise((resolve,reject)=>{rejectStop=reject})
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal:controller.signal,onSession:()=>controller.abort(),onCleanup:update=>updates.push(update)}),e=>{error=e;return e.name==='AbortError'})
 rejectStop(new Error('native stop denied'));await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(error.nativeCleanup,{status:'failed',phase:'stop',nativeSession:'cli-session',error:'native stop denied'})
 assert.equal(error.stopError.message,'native stop denied');assert.deepEqual(updates.map(x=>x.status),['pending','failed'])
 assert.equal(updates[0].status,'pending','callbacks receive immutable snapshots')
})
test('CLI completed native stop is reported separately from logical task cancellation',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan),controller=new AbortController(),updates=[];let finishStop,error
 f.bridge.stop=async()=>new Promise(resolve=>{finishStop=resolve})
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal:controller.signal,onSession:()=>controller.abort(),onCleanup:update=>updates.push(update)}),e=>{error=e;return e.name==='AbortError'})
 finishStop({process:'exited'});await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(error.nativeCleanup,{status:'stopped',phase:'stop',nativeSession:'cli-session'})
 assert.deepEqual(updates.map(x=>x.status),['pending','stopped']);assert.equal(error.name,'AbortError')
})
test('CLI aborted startup remains cleanup-pending until the late session is stopped',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan),controller=new AbortController(),updates=[];let finishStart,error
 f.bridge.start=async()=>{queueMicrotask(()=>controller.abort());return new Promise(resolve=>{finishStart=resolve})}
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal:controller.signal,onCleanup:update=>updates.push(update)}),e=>{error=e;return e.name==='AbortError'})
 assert.deepEqual(error.nativeCleanup,{status:'pending',phase:'startup',nativeSession:null})
 finishStart({id:'late-cleanup'});await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(updates,[{status:'pending',phase:'startup',nativeSession:null},{status:'pending',phase:'stop',nativeSession:'late-cleanup'},{status:'stopped',phase:'stop',nativeSession:'late-cleanup'}])
 assert.equal(error.nativeCleanup.status,'stopped');assert.deepEqual(f.calls.stop,['late-cleanup'])
})
test('CLI cleanup persistence callback rejection is handled without replacing cancellation',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan),controller=new AbortController();let error
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal:controller.signal,onSession:()=>controller.abort(),onCleanup:async()=>{throw new Error('store closed')}}),e=>{error=e;return e.name==='AbortError'})
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(error.cleanupReportError.message,'store closed');assert.equal(error.nativeCleanup.status,'stopped')
})

test('CLI late startup rejection replaces pending cleanup with an actionable failure',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan),controller=new AbortController(),updates=[];let rejectStart,error
 f.bridge.start=async()=>{queueMicrotask(()=>controller.abort());return new Promise((resolve,reject)=>{rejectStart=reject})}
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,signal:controller.signal,onCleanup:update=>updates.push(update)}),e=>{error=e;return e.name==='AbortError'})
 rejectStart(new Error('native startup identity unknown'));await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(error.nativeCleanup,{status:'failed',phase:'startup',nativeSession:null,error:'native startup identity unknown'})
 assert.deepEqual(updates.map(x=>x.status),['pending','failed']);assert.equal(f.calls.stop.length,0)
})

test('DSH current host uses caller-owned activation, childId, and approved context',async t=>{
 const f=dsh(t),signal=new AbortController().signal,ids=[]
 delete f.ctx.subagents.start
 f.ctx.subagents.startActivation=async spec=>{f.calls.push(spec);return {...f.run,id:undefined,childId:'modern-child'}}
 assert.equal(f.runtime.available(),true)
 const result=await f.runtime.run(task,{...context,signal,onSession:id=>ids.push(id)})
 assert.deepEqual(f.calls,[{provider:'spawn',label:role.name,signal,delivery:'caller',request:{parent:f.parent,prompt:[{type:'text',text:context.prompt}],agentOptions:{provider:task.provider,model:task.model},maxDepth:4}}])
 assert.deepEqual(result,{output:'done',nativeSession:'modern-child',stopReason:'completed',usage:null})
 assert.deepEqual(ids,['modern-child']);assert.equal(f.disposed.length,1)
})
test('DSH modern activation is preferred over legacy and disposes on cancellation',async t=>{
 const f=dsh(t),controller=new AbortController();f.run.result=new Promise(()=>{})
 f.ctx.subagents.start=()=>{throw new Error('legacy must not run')}
 f.ctx.subagents.startActivation=async()=>({...f.run,childId:'modern-child'})
 await assert.rejects(f.runtime.run(task,{...context,signal:controller.signal,onSession:()=>controller.abort()}),e=>e.name==='AbortError'&&e.nativeSession==='modern-child')
 assert.equal(f.disposed.length,1)
})
test('DSH modern host failure is preserved and never retried through legacy API',async t=>{
 const f=dsh(t);let starts=0
 f.ctx.subagents.startActivation=async()=>{starts++;throw new Error('host admission denied')}
 await assert.rejects(f.runtime.run(task,context),/host admission denied/)
 assert.equal(starts,1);assert.equal(f.calls.length,0)
})
test('CLI uncertain delivery with no matching input times out without resending or stopping',async t=>{
 const f=cli(t,{timeoutMs:12}),prepared=await f.runtime.prepare(f.plan)
 f.bridge.prompt=async input=>{f.calls.prompt.push(input);return {delivery:'uncertain',reason:'socket timeout'}}
 f.bridge.output=async()=>({source:'session',entries:[{role:'assistant',text:'stale\nNEXTURE_TEAM_DONE_task-a',completion:true}]})
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared}),/timed out/)
 assert.equal(f.calls.prompt.length,1);assert.deepEqual(f.calls.stop,[])
})

test('CLI execution observation timeout preserves owned partial output and running identity',async t=>{
 const f=cli(t,{timeoutMs:15}),prepared=await f.runtime.prepare(f.plan),updates=[]
 f.bridge.output=async()=>({source:'session',entries:[{role:'user',text:f.calls.prompt[0]?.text},{role:'assistant',text:'partial implementation',completion:false}]})
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,onProgress:p=>updates.push(p)}),e=>{
  assert.equal(e.output,'partial implementation');assert.equal(e.nativeSession,'cli-session');assert.equal(e.executionUncertain,true);assert.equal(e.stopReason,'observation_timeout');return true
 })
 assert.equal(updates.at(-1).output,'partial implementation');assert.equal(f.calls.prompt.length,1);assert.deepEqual(f.calls.stop,[])
})
test('DSH runtime exposes reported usage without inventing zero for unknown usage',async t=>{
 const f=dsh(t);f.run.result=Promise.resolve({output:[{type:'text',text:'answer'}],stopReason:'completed',usage:{inputTokens:17,outputTokens:5}})
 assert.deepEqual((await f.runtime.run(task,context)).usage,{inputTokens:17,outputTokens:5})
 f.run.result=Promise.resolve({output:[],stopReason:'completed'})
 assert.equal((await f.runtime.run(task,context)).usage,null)
})
test('CLI partial output never imports another turn or terminal-scrollback ownership',async t=>{
 const f=cli(t,{timeoutMs:10}),prepared=await f.runtime.prepare(f.plan)
 f.bridge.output=async()=>({source:'terminal',entries:[{role:'assistant',text:'UNOWNED SECRET'}]})
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared}),e=>e.output===''&&e.executionUncertain===true)
})

test('CLI known completion is returned even when progress persistence would stall',async t=>{const f=cli(t,{timeoutMs:10}),prepared=await f.runtime.prepare(f.plan);assert.equal((await f.runtime.run(f.cliTask,{...context,prepared,onProgress:()=>new Promise(()=>{})})).output,'Implemented')})
test('CLI reconciles original owned session after timeout without prepare, start or resend',async t=>{const f=cli(t,{timeoutMs:8}),prepared=await f.runtime.prepare(f.plan);let error,observation;f.bridge.output=async()=>({source:'session',entries:[{role:'user',text:f.calls.prompt[0]?.text},{role:'assistant',text:'partial',completion:false}]});await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,onObservation:x=>observation=x}),e=>{error=e;return e.executionUncertain});assert.equal(error.nativeObservation.nativeSession,'cli-session');assert.equal(observation.text,f.calls.prompt[0].text);f.bridge.output=async()=>({source:'session',entries:[{role:'user',text:observation.text},{role:'assistant',text:'Recovered\nNEXTURE_TEAM_DONE_task-a',completion:true}]});assert.equal((await f.runtime.reconcile(f.cliTask,{observation,timeoutMs:20})).output,'Recovered');assert.equal(f.calls.prepare.length,1);assert.equal(f.calls.start.length,1);assert.equal(f.calls.prompt.length,1)})

test('CLI reconcile restores scoped read-only membership before observing a persisted native session',async t=>{const f=cli(t);let recovered;f.bridge.recover=async input=>{recovered=input};const observation={nativeSession:'existing',taskId:'mapped-a',text:'original prompt',marker:'NEXTURE_TEAM_DONE_task-a'};f.bridge.output=async()=>{assert.ok(recovered);return {source:'session',entries:[{role:'user',text:'original prompt'},{role:'assistant',text:'late\nNEXTURE_TEAM_DONE_task-a',completion:true}]}};const result=await f.runtime.reconcile(f.cliTask,{observation,sourceSession:'source-a',parentPlanId:'team-plan'});assert.equal(result.output,'late');assert.deepEqual(recovered,{id:'existing',taskId:'mapped-a',sourceSession:'source-a',parentPlanId:'team-plan',text:'original prompt'});assert.equal(f.calls.start.length,0);assert.equal(f.calls.prompt.length,0)})

test('CLI timeout preserves bridge-owned visible partial text and native transcript artifact',async t=>{const f=cli(t,{timeoutMs:8}),prepared=await f.runtime.prepare(f.plan);f.bridge.output=async()=>({source:'session',entries:[{role:'user',text:f.calls.prompt[0]?.text}],partial:{role:'assistant',text:'visible partial',detail:false},artifacts:[{kind:'native-transcript',path:'/tmp/native-session.jsonl'}]});await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared}),e=>{assert.equal(e.output,'visible partial');assert.equal(e.artifacts[0].path,'/tmp/native-session.jsonl');return e.executionUncertain})})

test('CLI requests explicit stage reports and forwards owned reported phase changes without guessing completion',async t=>{const f=cli(t,{timeoutMs:100}),prepared=await f.runtime.prepare(f.plan),updates=[];let polls=0;f.bridge.output=async()=>{polls++;const entries=[{role:'user',text:f.calls.prompt[0]?.text}];if(polls>=4)return {source:'session',entries:[...entries,{role:'assistant',text:'done\nNEXTURE_TEAM_DONE_task-a',completion:true}]};return {source:'session',entries,partial:{role:'assistant',text:'visible work '+polls,detail:false},progress:[{phase:'implementing',summary:'Updating the requested component',source:'native-reported',verified:false},...(polls>=2?[{phase:'testing',summary:'Running the existing checks',source:'native-reported',verified:false}]:[]),{phase:'completed',summary:'Must never infer completion',source:'native-reported'}],artifacts:[{path:'/tmp/native.jsonl'}]}};const result=await f.runtime.run(f.cliTask,{...context,prepared,onProgress:p=>updates.push(p)});assert.match(f.calls.prompt[0].text,/<nexture-progress>/);assert.match(f.calls.prompt[0].text,/actual stage/);assert.deepEqual(updates.filter(p=>p.phase).map(p=>p.phase),['implementing','testing']);assert.equal(updates.find(p=>p.phase==='testing').summary,'Running the existing checks');assert.equal(updates.find(p=>p.phase==='testing').source,'native-reported');assert.equal(updates.find(p=>p.phase==='testing').verified,false);assert.equal(updates.find(p=>p.phase==='testing').artifacts[0].path,'/tmp/native.jsonl');assert.equal(result.stopReason,'completed')})
test('CLI never forwards progress from a foreign turn or guesses stages from ordinary output',async t=>{const f=cli(t,{timeoutMs:10}),prepared=await f.runtime.prepare(f.plan),updates=[];f.bridge.output=async()=>({source:'session',entries:[{role:'user',text:'foreign prompt'}],progress:[{phase:'testing',summary:'foreign test',source:'native-reported'}],partial:{role:'assistant',text:'implementing testing blocked',detail:false}});await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,onProgress:p=>updates.push(p)}),/timed out/);assert.deepEqual(updates,[])})

test('observed visible partial survives a stalled stage callback at observation deadline',async t=>{const f=cli(t,{timeoutMs:8}),prepared=await f.runtime.prepare(f.plan);f.bridge.output=async()=>({source:'session',entries:[{role:'user',text:f.calls.prompt[0]?.text}],partial:{role:'assistant',text:'already visible',detail:false},progress:[{phase:'testing',summary:'Running checks',source:'native-reported',verified:false}]});await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,onProgress:()=>new Promise(()=>{})}),e=>e.executionUncertain&&e.output==='already visible')})

test('CLI explicit native failure retains partial output and is never reported as completion or resent',async t=>{
 const f=cli(t),prepared=await f.runtime.prepare(f.plan)
 f.bridge.output=async()=>({source:'session',pending:false,entries:[{role:'user',text:f.calls.prompt[0]?.text}],partial:{role:'assistant',text:'visible partial'},failure:{kind:'failed',reason:'provider denied request'},observation:{state:'running'}})
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared}),e=>e.stopReason==='error'&&e.nativeTerminal===true&&!e.executionUncertain&&e.output==='visible partial'&&/provider denied/.test(e.message));assert.equal(f.calls.prompt.length,1);assert.deepEqual(f.calls.stop,[])
})
test('CLI reports runtime blocker/resume/reblock without settling, then interrupted observation remains recoverable',async t=>{
 const f=cli(t,{timeoutMs:200}),prepared=await f.runtime.prepare(f.plan),progress=[];let poll=0
 f.bridge.output=async()=>({source:'session',pending:false,entries:[{role:'user',text:f.calls.prompt[0]?.text}],observation:++poll<=2?{state:'blocked',reason:'approve command'}:poll===3?{state:'running'}:poll===4?{state:'blocked',reason:'approve command'}:{state:'interrupted',reason:'Native process suspended',definitive:false}})
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,onProgress:p=>progress.push(p)}),e=>e.executionUncertain&&e.stopReason==='interrupted'&&e.nativeObservation?.nativeSession==='cli-session')
 assert.deepEqual(progress.filter(p=>p.phase).map(p=>p.phase),['blocked','executing','blocked']);assert.equal(f.calls.prompt.length,1);assert.deepEqual(f.calls.stop,[])
})
test('CLI ignores failures from a different canonical turn and an owned final wins over process exit',async t=>{
 const f=cli(t,{timeoutMs:200}),prepared=await f.runtime.prepare(f.plan);let poll=0
 f.bridge.output=async()=>++poll===1?{source:'session',entries:[{role:'user',text:'another turn'}],failure:{kind:'failed',reason:'foreign'}}:{source:'session',entries:[{role:'user',text:f.calls.prompt[0].text},{role:'assistant',text:'accepted final\nNEXTURE_TEAM_DONE_task-a',completion:true}],observation:{state:'interrupted',reason:'exited'}}
 const result=await f.runtime.run(f.cliTask,{...context,prepared});assert.equal(result.output,'accepted final');assert.equal(result.stopReason,'completed')
})

test('CLI explicit stopped stage wins over missing pane lifecycle and stale native failure',async t=>{
 const f=cli(t,{timeoutMs:200}),prepared=await f.runtime.prepare(f.plan)
 f.bridge.output=async()=>({source:'session',entries:[{role:'user',text:f.calls.prompt[0]?.text}],stage:'stopped',notice:'Native CLI deliberately stopped',failure:{kind:'failed',reason:'earlier failure'},observation:{state:'interrupted',reason:'pane no longer exists'}})
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared}),e=>e.stopReason==='stopped'&&e.nativeTerminal===true&&!e.executionUncertain&&/deliberately stopped/.test(e.message));assert.equal(f.calls.prompt.length,1)
})

test('three independent reconciliations preserve runtime blocked resume and reblock transitions',async t=>{
 const f=cli(t,{pollMs:1000}),observation={nativeSession:'existing',taskId:'mapped-a',text:'original prompt',marker:'NEXTURE_TEAM_DONE_task-a'},saved={...f.cliTask},progress=[]
 let state='blocked'
 f.bridge.output=async()=>({source:'session',pending:false,entries:[{role:'user',text:observation.text}],observation:{state,reason:state==='blocked'?'approve the original command':undefined}})
 const observe=()=>f.runtime.reconcile(saved,{observation,timeoutMs:20,onProgress:update=>{if(update.phase){progress.push(update);saved.phase=update.phase;saved.phaseSource=update.source;saved.runtimeProgressSignal=JSON.stringify([update.phase,update.summary])}}})
 for(const next of ['blocked','running','blocked']){state=next;await assert.rejects(observe(),error=>error.stopReason==='observation_timeout')}
 assert.deepEqual(progress.map(p=>p.phase),['blocked','executing','blocked']);assert.equal(f.calls.prepare.length,0);assert.equal(f.calls.start.length,0);assert.equal(f.calls.prompt.length,0)
 state='running';await assert.rejects(observe(),error=>error.stopReason==='observation_timeout');const count=progress.length;await assert.rejects(observe(),error=>error.stopReason==='observation_timeout');assert.equal(progress.length,count)
})

test('CLI consecutive blocked child identities notify separately and survive independent reconciliations',async t=>{
 const f=cli(t,{pollMs:1000}),observation={nativeSession:'existing',taskId:'mapped-a',text:'original prompt',marker:'NEXTURE_TEAM_DONE_task-a'},saved={...f.cliTask},progress=[]
 let waitId='wait-a'
 f.bridge.output=async()=>({source:'session',pending:false,entries:[{role:'user',text:observation.text}],observation:{state:'blocked',reason:'权限或问题确认',waitId}})
 const observe=()=>f.runtime.reconcile(saved,{observation,timeoutMs:20,onProgress:update=>{if(update.phase){progress.push(update);saved.runtimeProgressSignal=JSON.stringify([update.phase,update.summary,...update.waitId?[update.waitId]:[]])}}})
 for(const child of ['wait-a','wait-a','wait-b','wait-b']){waitId=child;await assert.rejects(observe(),error=>error.stopReason==='observation_timeout')}
 assert.deepEqual(progress.map(p=>p.waitId),['wait-a','wait-b']);assert.equal(f.calls.start.length,0);assert.equal(f.calls.prompt.length,0)
})

test('CLI continuous observation distinguishes consecutive confirmations without a running snapshot',async t=>{
 const f=cli(t,{timeoutMs:200}),prepared=await f.runtime.prepare(f.plan),progress=[]
 let poll=0
 f.bridge.output=async()=>({source:'session',pending:false,entries:[{role:'user',text:f.calls.prompt[0]?.text}],observation:++poll<=2?{state:'blocked',reason:'权限或问题确认',waitId:'wait-a'}:poll<=4?{state:'blocked',reason:'权限或问题确认',waitId:'wait-b'}:{state:'interrupted',reason:'fixture observation ended'}})
 await assert.rejects(f.runtime.run(f.cliTask,{...context,prepared,onProgress:p=>progress.push(p)}),e=>e.stopReason==='interrupted')
 assert.deepEqual(progress.filter(p=>p.phase).map(p=>[p.phase,p.waitId]),[['blocked','wait-a'],['blocked','wait-b']]);assert.equal(f.calls.prompt.length,1);assert.equal(f.calls.stop.length,0)
})

test('persisted runtime blockers accept both signal formats and reject malformed wait identities',async()=>{
 const {savedBlockedSignal}=await import('../src/runtime-progress.mjs')
 for(const fields of [['blocked','needs input'],['blocked','needs input','opaque-wait-id']])assert.equal(savedBlockedSignal(JSON.stringify(fields)),JSON.stringify(fields))
 for(const fields of [['executing','running'],['blocked','needs input',''],['blocked','needs input',1],['blocked','needs input','x'.repeat(129)],['blocked','needs input','line\nbreak'],['blocked','needs input','wait','extra']])assert.equal(savedBlockedSignal(JSON.stringify(fields)),null)
})

test('CLI preparation carries only the stored plan authorization in a detached snapshot',async()=>{
 const seen=[],authorization={kind:'parent-policy',sourceSession:'source-a',policy:'never',preset:'danger-full-access'},runtime=new CliRuntime({getBridge:()=>({prepare:async input=>{seen.push(input);return{planId:'cli'}},start(){},prompt(){},output(){}})})
 const plan={id:'team',title:'Stored',project:'/tmp',sourceSession:'source-a',authorization,tasks:[{id:'work',title:'Read',execution:'pi',mode:'read',criteria:'ok'}]}
 await runtime.prepare(plan);assert.deepEqual(seen[0].authorization,authorization);authorization.policy='ask';assert.equal(seen[0].authorization.policy,'never')
})

test('DSH rejects direct-chat providers before spawning, including inherited parent routes',async t=>{
 const f=dsh(t)
 for(const provider of ['nexture-codex-cli','nexture-codex-terminal','nexture-pi-terminal','nexture-claude-terminal','nexture-grok-terminal','nexture-agy-terminal','nexture-kimi-terminal']){
  await assert.rejects(f.runtime.run({...task,provider},context),/直接聊天|直聊/)
  f.parent.model={current:()=>({provider,model:'test-model'})}
  await assert.rejects(f.runtime.run({...task,model:'',provider:''},context),/直接聊天|直聊/)
 }
 assert.equal(f.calls.length,0)
})
