import test from 'node:test'
import assert from 'node:assert/strict'
import {createPlanConfirmationResolver} from '../src/plan-confirmation.mjs'

const exec=()=>({agent:{session:{header:{id:'root',cwd:'/tmp'}}},signal:new AbortController().signal})
for(const [policy,preset,expected] of [['ask','workspace-write',null],['never','danger-full-access','parent-policy'],['ask','auto','parent-policy'],['never','auto','parent-policy'],['unknown','auto',null]])test(`resolver ${policy}/${preset} uses only the live calling session`,async()=>{
 const e=exec(),seen=[]
 const resolve=createPlanConfirmationResolver({get(name){return name==='approval'?{effectivePolicy(s){seen.push(s);return policy}}:{current(s){seen.push(s);return preset}}}})
 const actor=await resolve(e)
 assert.equal(actor?.kind??null,expected);assert.ok(seen.every(s=>s===e.agent.session))
 if(actor)assert.deepEqual(actor,{kind:'parent-policy',sourceSession:'root',policy,preset})
})
test('missing, throwing, malformed services and forged JSON permissions fall back to human',async()=>{
 for(const ctx of [{},{approval:{effectivePolicy:()=> 'never'}},{get(){throw Error('gone')}},{approval:{effectivePolicy:()=>{throw Error('gone')}},permissionPresets:{current:()=> 'auto'}},{approval:{effectivePolicy:()=> 'never'},permissionPresets:{current:()=>null}},{approval:{effectivePolicy:()=> 'unknown'},permissionPresets:{current:()=> 'auto'}}])assert.equal(await createPlanConfirmationResolver(ctx)({...exec(),approval:'never',preset:'auto',sourceSession:'forged'}),null)
 assert.equal(await createPlanConfirmationResolver({approval:{effectivePolicy:()=> 'never'},permissionPresets:{current:()=> 'auto'}})({sourceSession:'root',policy:'never'}),null)
})

import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {apply} from '../src/plugin.mjs'
import {TeamService} from '../src/service.mjs'
import {confirmInChat} from '../src/confirmation.mjs'
async function fixture(t,{policy='ask',preset='workspace-write',host=true,onPolicy}={}){
 const dir=await mkdtemp(join(tmpdir(),'team-parent-plan-')),tools=new Map(),cleanups=[];let asked=0,reads=0
 const e=exec();e.agent.session.header.cwd=dir
 const ctx={subagents:{list:()=>['spawn'],start(){throw Error('confirmation-only fixture must not execute')}},tools:{register(d){tools.set(d.name,d);return()=>{}}},webServer:{register(){return()=>{}}},systemPrompt:{section(){return()=>{}}},connection:{requestRejection:()=>403},effect(fn){cleanups.push(fn())},userQuestions:{async ask({questions}){asked++;return{answers:[{id:questions[0].id,selected:[questions[0].options[0].label]}]}}}}
 if(host)ctx.get=name=>name==='approval'?{async effectivePolicy(session){assert.equal(session,e.agent.session);reads++;await onPolicy?.();return policy}}:name==='permissionPresets'?{current(session){assert.equal(session,e.agent.session);return preset}}:undefined
 apply(ctx,{stateDir:dir})
 const close=()=>cleanups[0]();t.after(async()=>{await close();await rm(dir,{recursive:true,force:true})})
 const call=async(name,a,context=e)=>JSON.parse(await tools.get(name).execute(a,context))
 const plan={title:'Parent plan',sourceSession:'forged',approval:'never',preset:'auto',approved:true,tasks:[{roleId:'builtin-creator',title:'Read',mode:'read',prompt:'Reply ok'}]}
 return{dir,e,ctx,call,plan,close,asked:()=>asked,reads:()=>reads,disk:async()=>JSON.parse(await readFile(join(dir,'state.json'),'utf8')),propose:()=>call('team_plan',{plan:JSON.stringify(plan)})}
}
for(const [policy,preset,kind] of [['ask','workspace-write','human'],['never','danger-full-access','parent-policy'],['ask','auto','parent-policy'],['never','auto','parent-policy']])test(`Team ${policy}/${preset} confirms exact plan through parent policy`,async t=>{
 const f=await fixture(t,{policy,preset}),p=await f.propose()
 assert.equal((await f.call('team_confirm',{id:p.id,version:p.version,approved:true,policy:'never'})).status,'approved')
 const stored=(await f.disk()).plans[0]
 assert.deepEqual(stored.authorization,kind==='human'?{kind}:{kind,sourceSession:'root',policy,preset});assert.equal(f.asked(),kind==='human'?1:0)
 await assert.rejects(()=>f.call('team_confirm',{id:p.id,version:p.version}),/version|已处理/);assert.equal(f.asked(),kind==='human'?1:0)
})
test('Team unknown and missing host policy keep human cards and ignore model flags',async t=>{
 for(const options of [{host:false},{policy:'unknown',preset:'auto'},{policy:'never',onPolicy:()=>{throw Error('unavailable')}}]){
  const f=await fixture(t,options),p=await f.propose();await f.call('team_confirm',{id:p.id,version:1,policy:'never',preset:'auto'});assert.equal(f.asked(),1);assert.deepEqual((await f.disk()).plans[0].authorization,{kind:'human'})
 }
})
test('Team foreign scope and stale version reject before reading host callbacks',async t=>{
 const f=await fixture(t,{policy:'never'}),p=await f.propose()
 await assert.rejects(()=>f.call('team_confirm',{id:p.id,version:1},{...f.e,agent:{session:{header:{id:'foreign'}}}}),/chat|对话/)
 await assert.rejects(()=>f.call('team_confirm',{id:p.id,version:2}),/version/);assert.equal(f.reads(),0);assert.equal(f.asked(),0)
})
test('Team role creation and long-term memory always use human questions, even in Auto/never',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'team-parent-human-')),service=await new TeamService({stateDir:dir}).init()
 t.after(async()=>{await service.dispose();await rm(dir,{recursive:true,force:true})})
 const role=await service.draftRole({sourceSession:'root',role:{name:'Worker',prompt:'Work'}})
 const memory={id:'rule',kind:'memory-rule',version:1,status:'proposed',roleId:'builtin-creator',roleVersion:1,sourceSession:'root',text:'Rule',source:'test'}
 await service.store.update(d=>{d.drafts.push(memory)})
 let asked=0,reads=0
 for(const draft of [role,memory]){
  const args={service,exec:exec(),id:draft.id,version:1,resolveConfirmation:async()=>{reads++;return{kind:'parent-policy',sourceSession:'root',policy:'never',preset:'auto'}},questions:{async ask({questions}){asked++;return{answers:[{id:questions[0].id,selected:[questions[0].options[0].label]}]}}}}
  await assert.rejects(()=>service.confirm(draft.id,1,{kind:'parent-policy',sourceSession:'root',policy:'never',preset:'auto'}),/human/)
  await confirmInChat(args);assert.deepEqual(service.draft(draft.id).authorization,{kind:'human'})
 }
 assert.equal(asked,2);assert.equal(reads,0);assert.equal(service.memories('builtin-creator')[0].kind,'rule')
})
test('Team cancellation, shutdown and stale policy resolution cannot approve plans',async t=>{
 for(const action of ['before','abort','dispose','stale','source']){
  const dir=await mkdtemp(join(tmpdir(),'team-parent-lifecycle-')),service=await new TeamService({stateDir:dir}).init(),e=exec(),controller=new AbortController();e.signal=controller.signal
  t.after(async()=>{await service.dispose();await rm(dir,{recursive:true,force:true})})
  const p=await service.proposePlan({title:'Guard',project:dir,sourceSession:'root',tasks:[{roleId:'builtin-creator',title:'Read',prompt:'ok'}]})
  let closing=false,reads=0;if(action==='before')controller.abort()
  const resolveConfirmation=async()=>{reads++;if(action==='abort')controller.abort();if(action==='dispose'){closing=true;await service.dispose()}if(action==='stale'||action==='source')await service.store.update(d=>{if(action==='stale')d.plans[0].version++;else d.plans[0].sourceSession='foreign'});return{kind:'parent-policy',sourceSession:'root',policy:'never',preset:'auto'}}
  await assert.rejects(()=>confirmInChat({service,exec:e,id:p.id,version:1,isClosing:()=>closing,resolveConfirmation}),/abort|shutting|version|chat|对话/)
  assert.equal(service.plan(p.id).status,'proposed');if(action==='before')assert.equal(reads,0)
 }
})
test('Team human late answers after shutdown cannot approve roles or memory',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'team-parent-late-')),service=await new TeamService({stateDir:dir}).init()
 t.after(async()=>{await service.dispose();await rm(dir,{recursive:true,force:true})})
 const role=await service.draftRole({sourceSession:'root',role:{name:'Worker',prompt:'Work'}});let closing=false
 await assert.rejects(()=>confirmInChat({service,exec:exec(),id:role.id,version:1,isClosing:()=>closing,questions:{async ask({questions}){closing=true;return{answers:[{id:questions[0].id,selected:['确认创建']}]}}}}),/shutting/)
 assert.equal(service.draft(role.id).status,'proposed')
})
test('Team parent authorization validates source, policy, preset, exact version and queued cancellation',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'team-parent-validation-')),service=await new TeamService({stateDir:dir}).init()
 t.after(async()=>{await service.dispose();await rm(dir,{recursive:true,force:true})})
 const p=await service.proposePlan({title:'Guard',project:dir,sourceSession:'root',tasks:[{roleId:'builtin-creator',title:'Read',prompt:'ok'}]}),actor={kind:'parent-policy',sourceSession:'root',policy:'never',preset:'danger-full-access'}
 for(const bad of [{...actor,sourceSession:'foreign'},{...actor,policy:'unknown'},{...actor,policy:'ask'},{...actor,preset:null},{kind:'model',approved:true}])await assert.rejects(()=>service.confirm(p.id,1,bad),/authorization/)
 await assert.rejects(()=>service.confirm(p.id,2,actor),/version/)
 const controller=new AbortController();let release;const gate=new Promise(r=>release=r);service.store.update(()=>gate)
 const pending=service.confirm(p.id,1,actor,()=>controller.signal.throwIfAborted());controller.abort();release();await assert.rejects(()=>pending,/abort/);assert.equal(service.plan(p.id).status,'proposed')
 await service.confirm(p.id,1,{kind:'human'});assert.deepEqual(service.plan(p.id).authorization,{kind:'human'})
})

test('unknown preset names fall back to human; configured host presets retain provenance',async()=>{
 const host=presets=>({approval:{effectivePolicy:()=> 'never'},permissionPresets:presets})
 assert.equal(await createPlanConfirmationResolver(host({current:()=> 'unknown-preset'}))(exec()),null)
 for(const preset of ['read-only','workspace-write','danger-full-access','auto','custom'])assert.equal((await createPlanConfirmationResolver(host({current:()=>preset}))(exec())).preset,preset)
 for(const presets of [{current:()=> 'company-review',names:['company-review']},{current:()=> 'company-review',specOf:name=>name==='company-review'?{sandbox:'workspace-write',approval:'never'}:undefined}]){
  const authorization=await createPlanConfirmationResolver(host(presets))(exec())
  assert.deepEqual(authorization,{kind:'parent-policy',sourceSession:'root',policy:'never',preset:'company-review',presetSource:'configured'})
  const {planAuthorization}=await import('../src/plan-confirmation.mjs')
  assert.deepEqual(planAuthorization(JSON.parse(JSON.stringify(authorization)),'root'),authorization)
  await assert.rejects(async()=>planAuthorization({...authorization,presetSource:undefined},'root'),/authorization/)
 }
})

test('Team concurrent same-plan retries share one human card and exact-version decision',async t=>{
 const f=await fixture(t),p=await f.propose(),pending=[]
 f.ctx.userQuestions.ask=({questions})=>new Promise(resolve=>pending.push(()=>resolve({answers:[{id:questions[0].id,selected:['确认执行']}]})))
 const outcomes=Promise.allSettled([f.call('team_confirm',{id:p.id,version:1}),f.call('team_confirm',{id:p.id,version:1})])
 for(let i=0;i<50&&pending.length<1;i++)await new Promise(r=>setTimeout(r,2))
 await new Promise(resolve=>setImmediate(resolve));const asked=pending.length;pending.forEach(resolve=>resolve())
 const results=await outcomes;assert.equal(asked,1);assert.ok(results.every(r=>r.status==='fulfilled'));assert.deepEqual(results[0].value,results[1].value);assert.equal(results[0].value.status,'approved')
})

test('shared Team confirmation checks each waiter lifecycle and source before joining',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'team-parent-waiters-')),service=await new TeamService({stateDir:dir}).init()
 t.after(async()=>{await service.dispose();await rm(dir,{recursive:true,force:true})})
 const p=await service.proposePlan({title:'Shared decision',project:dir,sourceSession:'root',tasks:[{roleId:'builtin-creator',title:'Read',prompt:'ok'}]})
 let release,entered,asked=0,closing=false,reads=0;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r),controller=new AbortController()
 const args={service,exec:exec(),id:p.id,version:1,resolveConfirmation:async()=>{reads++;return null},questions:{async ask({questions}){asked++;entered();await gate;return{answers:[{id:questions[0].id,selected:['确认执行']}]}}}}
 const first=confirmInChat(args);await ready
 const cancelled=confirmInChat({...args,exec:{...exec(),signal:controller.signal}}),closed=confirmInChat({...args,isClosing:()=>closing})
 await assert.rejects(()=>confirmInChat({...args,exec:{agent:{session:{header:{id:'foreign'}}}}}),/chat|对话/)
 const outcomes=Promise.allSettled([first,cancelled,closed]);controller.abort();closing=true;release();const results=await outcomes
 assert.equal(results[0].status,'fulfilled');assert.match(results[1].reason.message,/abort/i);assert.match(results[2].reason.message,/shutting/);assert.equal(asked,1);assert.equal(reads,1);assert.equal(service.plan(p.id).status,'approved')
})
test('shared Team failed confirmation is cleaned up for an explicit later call',async t=>{
 const f=await fixture(t),p=await f.propose();let asked=0
 f.ctx.userQuestions.ask=async({questions})=>{asked++;if(asked===1)throw Error('ASK_CANCELLED');return{answers:[{id:questions[0].id,selected:['确认执行']}]}}
 const results=await Promise.allSettled([f.call('team_confirm',{id:p.id,version:1}),f.call('team_confirm',{id:p.id,version:1})]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(asked,1)
 assert.equal((await f.call('team_confirm',{id:p.id,version:1})).status,'approved');assert.equal(asked,2)
})
