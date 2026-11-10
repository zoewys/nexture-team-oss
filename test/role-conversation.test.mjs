import test from 'node:test'
import assert from 'node:assert/strict'
import {openRoleConversation} from '../src/client/role-conversation.mjs'

function host({result='applied',failCreate=false}={}) {
 const calls=[],drafts=new Map([['old',{text:'keep my draft',references:[]}]]),binding={sessionId:'fresh'},ctx={
  sessions:{async create(options){calls.push(['create',options]);if(failCreate)throw new Error('offline');return 'fresh'},async using(id,options,fn){calls.push(['retain',id]);try{return await fn({binding})}finally{calls.push(['release',id])}}},
  conversation:{input:{requestDraftInitialization(target,options){calls.push(['draft',target.sessionId]);if(result==='applied')drafts.set(target.sessionId,options.prompt);return result}}},
  workspaces:{list:{getSnapshot:()=>({items:[{workspaceId:'project',path:'/project',sessionIds:[]}]})}},
  uiWorkspace:{openSession(id){calls.push(['open',id])}},
 }
 return {ctx,calls,drafts}
}
const role={id:'role-1',name:'研究员'}
test('talk creates a fresh native session and a semantic role chip without touching the old draft',async()=>{
 const {ctx,calls,drafts}=host()
 assert.equal(await openRoleConversation(ctx,role,'/project'),'fresh')
 assert.deepEqual(calls,[['create',{workspaceId:'project'}],['retain','fresh'],['draft','fresh'],['open','fresh'],['release','fresh']])
 assert.equal(drafts.get('old').text,'keep my draft')
 const draft=drafts.get('fresh'),ref=draft.references[0]
 assert.equal(ref.source,'nexture-team');assert.equal(ref.ref,'@[研究员](nexture-role:role-1)')
 assert.equal(draft.text.slice(ref.offset,ref.offset+ref.length),ref.clipboardText)
 assert.equal(ref.label,'研究员');assert.equal(ref.appearance,'session')
})
test('each click asks for a new session even if a blank session exists',async()=>{
 const {ctx,calls}=host()
 await openRoleConversation(ctx,role,'/project');await openRoleConversation(ctx,role,'/project')
 assert.deepEqual(calls.filter(c=>c[0]==='create'),[['create',{workspaceId:'project'}],['create',{workspaceId:'project'}]])
})
test('failed creation or blocked draft preparation never opens another session',async()=>{
 for(const options of [{failCreate:true},{result:'blocked'},{result:'preserved'}]){
  const {ctx,calls}=host(options)
  await assert.rejects(openRoleConversation(ctx,role,'/project'))
  assert.ok(!calls.some(c=>c[0]==='open'))
 }
})
test('global panel resolves the current workspace even when its hidden composer has no project',async()=>{
 const {ctx,calls}=host()
 ctx.uiWorkspace.selection={getSnapshot:()=>({sessionId:'old'})}
 ctx.workspaces.list.getSnapshot=()=>({items:[{workspaceId:'current',path:'/current',sessionIds:['old']}]})
 ctx.sessions.list={getSnapshot:()=>({byId:{old:{cwd:'/current',updatedAt:1}}})}
 await openRoleConversation(ctx,role)
 assert.deepEqual(calls[0],['create',{workspaceId:'current'}])
})
test('sessionless panel uses the most recently active workspace',async()=>{
 const {ctx,calls}=host()
 ctx.workspaces={list:{getSnapshot:()=>({items:[{workspaceId:'a',sessionIds:['old']},{workspaceId:'b',sessionIds:['recent']}]})}}
 ctx.sessions.list={getSnapshot:()=>({byId:{old:{updatedAt:1},recent:{updatedAt:2}}})}
 await openRoleConversation(ctx,role)
 assert.deepEqual(calls[0],['create',{workspaceId:'b'}])
})

test('missing workspace fails before creating an unusable session',async()=>{const {ctx,calls}=host();ctx.workspaces.list.getSnapshot=()=>({items:[]});await assert.rejects(openRoleConversation(ctx,role),/工作区/);assert.equal(calls.length,0)})
