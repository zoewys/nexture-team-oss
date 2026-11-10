import test from 'node:test'
import assert from 'node:assert/strict'
import { roleMention, activeRoles, roleFromForm, taskFromRole, createRoleSource, insertRole, statusLabels, hasPendingTasks, editableTasks, assertTaskDependencies } from '../src/client/model.mjs'
import { createTeamApi } from '../src/client/api.mjs'

test('role mentions preserve stable identity and strip label delimiters',()=>{
 assert.equal(roleMention({id:'role-1',name:'研究 [顾问]\n'}),'@[研究 顾问](nexture-role:role-1)')
 assert.equal(roleMention({id:'role-1',name:'新名字'}),'@[新名字](nexture-role:role-1)')
})
test('native role candidates exclude archived and disabled roles, and serialize stable tokens',async()=>{
 const roles=[{id:'a',name:'设计师',status:'active',enabled:true,type:'longterm',prompt:'视觉设计'},{id:'b',name:'归档',status:'archived',enabled:true},{id:'c',name:'关闭',enabled:false}]
 assert.equal(activeRoles(roles).length,1)
 const source=createRoleSource({state:async()=>({roles})})
 assert.equal(source.trigger,'@')
 const rows=await source.candidates({sessionId:'s'},{query:'设计',signal:new AbortController().signal})
 assert.equal(rows.length,1)
 const picked=source.onPick({candidate:rows[0],action:'pick'})
 assert.equal(picked.insert.source,'nexture-team')
 assert.equal(picked.insert.ref,'@[设计师](nexture-role:a)')
 assert.equal(await source.codec.serialize(picked.insert.ref),'@[设计师](nexture-role:a)')
 assert.equal((await source.candidates({sessionId:'s'},{query:'missing'})).length,0)
})
test('role form uses temporary memory default, explicit skills and empty inherited model',()=>{
 assert.deepEqual(roleFromForm({name:'  Writer ',type:'temporary',prompt:' Write ',skills:'a, b\na',execution:'dsh',model:'',provider:'',autoMemory:false}),{name:'Writer',type:'temporary',prompt:'Write',skills:['a','b'],execution:'dsh',model:'',provider:'',autoMemory:false,enabled:true})
 const task=taskFromRole({id:'r',name:'Writer',execution:'dsh',model:'',provider:''})
 assert.equal(task.roleId,'r');assert.equal(task.mode,'read');assert.equal(task.model,'')
})
test('talking to role only inserts native draft and never submits it',()=>{
 let text,submitted=false
 const actions={captureInsertion:()=>({draftRev:2}),insertText:(value,span)=>{assert.equal(span.draftRev,2);text=value;return true},submit:()=>{submitted=true}}
 assert.equal(insertRole(actions,{id:'r',name:'Writer'}),true)
 assert.equal(text,'@[Writer](nexture-role:r) ')
 assert.equal(submitted,false)
 assert.equal(insertRole(null,{id:'r',name:'Writer'}),false)
})
test('API bootstraps once and authenticates reads and mutations with token',async()=>{
 const calls=[]
 const api=createTeamApi(async(url,opts={})=>{calls.push({url,opts});return Response.json(url.endsWith('/bootstrap')?{token:'secret'}:url.includes('/state')?{roles:[]}:{ok:true})})
 await Promise.all([api.state('chat 1'),api.catalog()]);await api.action('confirm',{id:'d',version:2})
 assert.equal(calls.filter(c=>c.url.endsWith('/bootstrap')).length,1)
 assert.equal(calls[1].opts.headers['X-Team-Token'],'secret')
 assert.ok(calls.some(c=>c.url.endsWith('/state?sourceSession=chat%201')))
 const mutation=calls.find(c=>c.opts.method==='POST')
 assert.deepEqual(JSON.parse(mutation.opts.body),{action:'confirm',id:'d',version:2})
 assert.equal(mutation.opts.credentials,'same-origin')
})
test('API preserves human-readable errors without successful empty state fallback',async()=>{
 const api=createTeamApi(async url=>url.endsWith('/bootstrap')?Response.json({token:'t'}):Response.json({error:'草案已变更，请刷新'},{status:409}))
 await assert.rejects(api.state(),/草案已变更/)
})

test('dependency-blocked tasks describe the missing prerequisite in Chinese',()=>{
 assert.equal(statusLabels.blocked,'前置未完成')
})

test('native stop cleanup keeps polling after a plan is cancelled',()=>{
 assert.equal(hasPendingTasks([{status:'running',tasks:[]}]),true)
 assert.equal(hasPendingTasks([{status:'cancelled',tasks:[{nativeCleanup:{status:'pending'}}]}]),true)
 assert.equal(hasPendingTasks([{status:'cancelled',tasks:[{nativeCleanup:{status:'stopped'}}]}]),false)
 assert.equal(hasPendingTasks([{status:'failed',tasks:[{nativeCleanup:{status:'failed',error:'stop timeout'}}]}]),false)
})

test('editing a dependency plan preserves task identity and ordering while dropping execution records',()=>{
 const original=[{id:'research',roleId:'r1',title:'Research',prompt:'Find evidence',execution:'dsh',model:'',provider:'',mode:'read',criteria:'Sources',dependsOn:[],status:'completed',output:'private result'},{id:'build',roleId:'r2',title:'Build',prompt:'Implement findings',execution:'dsh',model:'',provider:'',mode:'write',criteria:'Works',dependsOn:['research'],status:'queued'}]
 const drafts=editableTasks(original)
 drafts[1].title='Build revised scope'
 assert.equal(drafts[0].id,'research')
 assert.deepEqual(drafts[1].dependsOn,['research'])
 assert.equal(drafts[0].output,undefined)
 assert.doesNotThrow(()=>assertTaskDependencies(drafts))
 drafts[1].dependsOn.push('other')
 assert.deepEqual(original[1].dependsOn,['research'],'draft changes do not mutate the stored plan')
})
test('removing a prerequisite blocks the plan with a clear task-specific error',()=>{
 const original=[{id:'research',title:'调研'},{id:'build',title:'实现',dependsOn:['research']}]
 assert.throws(()=>assertTaskDependencies([original[1]],original),/实现.*调研.*恢复/)
 assert.doesNotThrow(()=>assertTaskDependencies([],original))
})

test('recoverable interrupted CLI tasks keep background UI polling active',async()=>{
 const {hasPendingTasks}=await import('../src/client/model.mjs')
 assert.equal(hasPendingTasks([{status:'interrupted',tasks:[{status:'interrupted',execution:'pi',nativeObservation:{nativeSession:'native',text:'owned'}}]}]),true)
 assert.equal(hasPendingTasks([{status:'cancelled',tasks:[{status:'interrupted',execution:'pi',nativeObservation:{nativeSession:'native',text:'owned'}}]}]),false)
 assert.equal(hasPendingTasks([{status:'interrupted',tasks:[{status:'interrupted',execution:'dsh',nativeSession:'dsh-child'}]}]),false)
})
