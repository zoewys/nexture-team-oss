import test from 'node:test'
import assert from 'node:assert/strict'
const {createHostNotifier,sessionUsage,promotePendingNotifications}=await import('../src/host-notifier.mjs').catch(()=>({}))
function fixture(){
  const sent=[],events=[]
  const agent={session:{header:{id:'original'},snapshotEvents:()=>events},inbox:{nextTurn:[],nextStep:[]},followup(message){sent.push(message);this.inbox.nextTurn.push(message)}}
  return {agent,sent,events,ctx:{agents:{get:id=>id==='original'?agent:undefined}}}
}
const event={id:'event-1',sourceSession:'original',planId:'plan',taskId:'fast',type:'task.completed',status:'completed',summary:'fast result'}
test('background result wakes only exact source with plugin attribution, never human authority',async()=>{
  assert.equal(typeof createHostNotifier,'function')
  const f=fixture();const notify=createHostNotifier(f.ctx)
  await notify(event)
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].source.kind,'nexture-team-event');assert.equal(f.sent[0].role,'user')
  assert.equal(f.sent[0].source.eventId,event.id);assert.match(f.sent[0].content[0].text,/fast result/)
  await assert.rejects(()=>notify({...event,id:'other',sourceSession:'missing'}),/source|原|unavailable/i)
})
test('concurrent and recreated notifier deduplicate pending and durable inbox messages',async()=>{
  const f=fixture();const notify=createHostNotifier(f.ctx)
  await Promise.all([notify(event),notify(event)]);assert.equal(f.sent.length,1)
  f.events.push({type:'user/message',data:f.sent[0]});f.agent.inbox.nextTurn=[]
  const result=await createHostNotifier(f.ctx)(event)
  assert.equal(result.duplicate,true);assert.equal(f.sent.length,1)
})
test('recovered session validates exact identity and does not fabricate prompt admission',async()=>{
  const f=fixture();let recovered
  const notify=createHostNotifier({sessionController:{agents:{async resolveAgent(id){recovered=id;return {agent:f.agent}}}}})
  await notify(event);assert.equal(recovered,'original');assert.equal(f.sent.length,1)
  await assert.rejects(()=>notify({...event,id:'bad',sourceSession:'different'}),/identity|source|match/i)
})
test('missing identity, unavailable host and throwing delivery remain retryable',async()=>{
  const f=fixture();const notify=createHostNotifier(f.ctx)
  await assert.rejects(()=>notify({...event,id:undefined}),/identity|event/i)
  f.agent.followup=()=>{throw new Error('not admitted')}
  await assert.rejects(()=>notify(event),/not admitted/)
  f.agent.followup=m=>f.sent.push(m);await notify(event);assert.equal(f.sent.length,1)
})
test('payload is bounded and worker data is clearly labelled, stage events remain attributable',async()=>{
  const f=fixture();await createHostNotifier(f.ctx)( {...event,summary:'x'.repeat(50000),artifacts:[{path:'/tmp/report.md'}]})
  const text=f.sent[0].content[0].text
  assert.ok(text.length<6000);assert.match(text,/report.md/);assert.match(text,/资料|data|output/i)
})
test('usage counts recorded main-session usage separately from child and unknown values',()=>{
  assert.equal(typeof sessionUsage,'function')
  const events=[{type:'assistant/message',data:{usage:{inputTokens:100,outputTokens:10,cachedInputTokens:80}}},{type:'assistant/message',data:{message:{}}}]
  const usage=sessionUsage({session:{header:{id:'parent'},snapshotEvents:()=>events}})
  assert.equal(usage.sourceSession,'parent');assert.equal(usage.inputTokens,100);assert.equal(usage.outputTokens,10);assert.equal(usage.cachedInputTokens,80);assert.equal(usage.missingCalls,1)
  assert.equal(sessionUsage({session:{header:{id:'empty'},snapshotEvents:()=>[]}}).inputTokens,null)
})
test('ordinary fork ancestry remains a valid notification destination',async()=>{
  const f=fixture();f.agent.session.header.parentSession='ancestor'
  await createHostNotifier(f.ctx)(event);assert.equal(f.sent.length,1)
  f.agent.session.header.origin='subagent'
  await assert.rejects(()=>createHostNotifier(f.ctx)({...event,id:'worker'}),/ordinary|source|subagent/i)
})
test('fork usage excludes inherited prefix using host own-sequence boundary',()=>{
  const events=[{seq:0,type:'assistant/message',data:{usage:{inputTokens:900,outputTokens:90}}},{seq:1,type:'assistant/message',data:{usage:{inputTokens:10,outputTokens:2}}}]
  const result=sessionUsage({session:{header:{id:'fork'},snapshotEvents:()=>events,isOwnSeq:seq=>seq>0}})
  assert.equal(result.inputTokens,10);assert.equal(result.outputTokens,2);assert.equal(result.recordedCalls,1)
})
test('stage notification retains reported phase and durable output reference',async()=>{
  const f=fixture();await createHostNotifier(f.ctx)({...event,type:'task.progress',phase:'testing',outputFile:'/tmp/task-progress.txt',summary:'正在运行验证'})
  const text=f.sent[0].content[0].text
  assert.match(text,/"stage":"testing"/);assert.match(text,/task-progress.txt/)
})
test('native DSH usage separates uncached tokens from cache reads and reports total input',()=>{
  const usage={inputTokens:2569,outputTokens:387,cacheReadTokens:31616,cacheWriteTokens:0,totalTokens:34572}
  const report=sessionUsage({session:{header:{id:'real-host'},snapshotEvents:()=>[{type:'assistant/message',data:{usage}}]}})
  assert.equal(report.cachedInputTokens,31616);assert.equal(report.uncachedInputTokens,2569)
  assert.equal(report.inputTokens,34185);assert.equal(report.totalTokens,34572);assert.equal(report.cacheWriteInputTokens,0)
})
test('running lead receives completion at the next step instead of waiting for next turn',async()=>{
  const f=fixture();f.agent.status='running';f.agent.steer=m=>{f.sent.push(m);f.agent.inbox.nextStep.push(m)}
  await createHostNotifier(f.ctx)(event)
  assert.equal(f.agent.inbox.nextTurn.length,0);assert.equal(f.agent.inbox.nextStep.length,1)
})
test('queued plugin events migrate through native steering while ordinary user queue stays intact',async()=>{
  assert.equal(typeof promotePendingNotifications,'function')
  const f=fixture();await createHostNotifier(f.ctx)(event)
  const user={id:'human',source:{kind:'user'},role:'user',content:[{type:'text',text:'my next task'}]}
  f.agent.inbox.nextTurn.push(user);f.agent.status='running'
  const calls=[];f.ctx.sessionController={async updateQueue(request){calls.push(request);const i=f.agent.inbox.nextTurn.findIndex(m=>m.id===request.itemId);f.agent.inbox.nextStep.push(f.agent.inbox.nextTurn.splice(i,1)[0]);return {accepted:true}}}
  const r=await promotePendingNotifications(f.ctx,f.agent)
  assert.equal(r.promoted,1);assert.equal(calls[0].action.kind,'steer');assert.equal(calls[0].sessionId,'original')
  assert.deepEqual(f.agent.inbox.nextTurn,[user]);assert.equal(f.agent.inbox.nextStep[0].source.eventId,event.id)
  await createHostNotifier(f.ctx)(event);assert.equal(f.sent.length,1);assert.equal(f.agent.inbox.nextStep.length,1)
})
test('queue promotion tolerates a turn finishing before steering and never removes user messages',async()=>{
  const f=fixture();await createHostNotifier(f.ctx)(event);f.agent.status='running'
  f.ctx.sessionController={async updateQueue(){throw Object.assign(new Error('turn ended'),{code:'session/steer-unavailable'})}}
  const result=await promotePendingNotifications(f.ctx,f.agent)
  assert.equal(result.promoted,0);assert.equal(f.agent.inbox.nextTurn.length,1)
})
