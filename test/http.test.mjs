import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {TeamService} from '../src/service.mjs'
const {createHandler}=await import('../src/http.mjs').catch(()=>({}))
async function server(t){assert.equal(typeof createHandler,'function');const dir=await mkdtemp(join(tmpdir(),'team-http-'));const service=await new TeamService({stateDir:dir}).init();const handler=createHandler(service);const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{handler.dispose();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})});const base=`http://127.0.0.1:${server.address().port}/nexture-team/api`;const bootstrap=await fetch(base+'/bootstrap').then(r=>r.json());return {service,base,token:bootstrap.token}}
test('HTTP requires browser token and blocks cross-site writes',async t=>{const {base,token}=await server(t);assert.equal((await fetch(base+'/state')).status,403);assert.equal((await fetch(base,{method:'POST',headers:{'content-type':'application/json','x-team-token':token,origin:'https://evil.example'},body:JSON.stringify({action:'settings',memoryManagerEnabled:false})})).status,403);assert.equal((await fetch(base+'/bootstrap',{headers:{'sec-fetch-site':'cross-site'}})).status,403)})
test('human panel can review draft then confirm exact version',async t=>{const {base,token,service}=await server(t);const post=async body=>{const r=await fetch(base,{method:'POST',headers:{'content-type':'application/json','x-team-token':token},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}};const d=await post({action:'draftRole',role:{name:'tester',prompt:'test things'}});assert.equal(d.status,200);assert.equal(service.snapshot().roles.length,2);assert.equal((await post({action:'confirm',id:d.body.id,version:99})).status,400);assert.equal((await post({action:'confirm',id:d.body.id,version:1})).status,200);assert.equal(service.snapshot().roles.length,3);assert.equal((await post({action:'confirm',id:d.body.id,version:1})).status,400)})

test('authenticated recovery actions reach read-only reconciliation and asynchronous memory retry',async t=>{const {base,token,service}=await server(t),calls=[];service.run=()=>{throw new Error('business tasks must never be redispatched')};service.reconcile=async(id,options)=>{calls.push({action:'reconcile',id,options});return {id,status:'interrupted'}};service.retryMemory=async id=>{calls.push({action:'retryMemory',id});return {id,memoryStatus:'running'}};const post=body=>fetch(base,{method:'POST',headers:{'content-type':'application/json','x-team-token':token},body:JSON.stringify(body)});assert.equal((await post({action:'reconcile',id:'plan',taskId:'task',timeoutMs:90000})).status,200);assert.equal((await post({action:'retryMemory',id:'plan'})).status,200);assert.deepEqual(calls,[{action:'reconcile',id:'plan',options:{taskId:'task',timeoutMs:30000}},{action:'retryMemory',id:'plan'}]);assert.equal((await fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'retryMemory',id:'plan'})})).status,403)})

test('role groups are saved through the authenticated Team panel without altering role data', async t => {
  const {base, token, service} = await server(t)
  const post = async body => {
    const response = await fetch(base, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-team-token': token},
      body: JSON.stringify(body),
    })
    return [response.status, await response.json()]
  }
  const read = () => fetch(base + '/state', {headers: {'x-team-token': token}}).then(r => r.json())

  const draft = await service.draftRole({role: {name: '研究员', prompt: '做调研'}})
  const otherDraft = await service.draftRole({role: {name: '编辑', prompt: '做编辑'}})
  const actor = {kind: 'human'}
  const role = await service.confirm(draft.id, draft.version, actor)
  const other = await service.confirm(otherDraft.id, otherDraft.version, actor)
  const memory = await service.memoryUpsert(role.id, {text: '保留现有记忆'}, actor)
  const original = await read()
  assert.deepEqual(original.roleGroups, [])

  const [created, group] = await post({action: 'saveRoleGroup', name: '  日常运营  '})
  assert.equal(created, 200)
  assert.equal(group.name, '日常运营')
  assert.equal((await post({action: 'saveRoleGroup', name: '日常运营'}))[0], 400)
  assert.equal((await post({action: 'saveRoleGroup', name: '未分组'}))[0], 400)
  assert.equal((await post({action: 'moveRoles', groupId: group.id, roleIds: [role.id, 'unknown']}))[0], 400)
  assert.deepEqual((await read()).roleGroups[0].roleIds, [])
  assert.equal((await post({action: 'moveRoles', groupId: group.id, roleIds: [role.id, other.id]}))[0], 200)

  const [secondCreated, second] = await post({action: 'saveRoleGroup', name: '内容'})
  assert.equal(secondCreated, 200)
  assert.equal((await post({action: 'moveRoles', groupId: second.id, roleIds: [other.id]}))[0], 200)
  assert.equal((await post({action: 'saveRoleGroup', groupId: group.id, name: '运营'}))[0], 200)
  assert.deepEqual((await read()).roleGroups, [
    {id: group.id, name: '运营', roleIds: [role.id]},
    {id: second.id, name: '内容', roleIds: [other.id]},
  ])

  assert.equal((await post({action: 'moveRoles', groupId: null, roleIds: [other.id]}))[0], 200)
  assert.equal((await post({action: 'deleteRoleGroup', groupId: group.id}))[0], 200)
  const final = await read()
  assert.deepEqual(final.roleGroups, [{id: second.id, name: '内容', roleIds: []}])
  assert.deepEqual(final.roles, original.roles)
  assert.deepEqual(service.memories(role.id), [memory])

  const saved = JSON.parse(await readFile(service.store.file, 'utf8'))
  assert.deepEqual(saved.roleGroups, final.roleGroups)
})
