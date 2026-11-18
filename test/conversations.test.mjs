import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TeamService } from '../src/service.mjs'
import { DshRuntime } from '../src/dsh-runtime.mjs'
async function fixture(t, runtime) {
  const dir = await mkdtemp(join(tmpdir(), 'team-chat-'))
  const s = await new TeamService({ stateDir: dir, runtime }).init()
  t.after(async () => {
    await s.dispose()
    await rm(dir, { recursive: true, force: true })
  })
  return s
}
const scope = { sourceSession: 'parent', project: process.cwd() }

test('running role conversation exposes only scoped native tool activity before its reply', async (t) => {
  const events = []
  const parent = { session: { header: { id: 'parent', cwd: scope.project } } }
  const child = { session: { snapshotEvents: () => events } }
  let release
  const result = new Promise((resolve) => { release = resolve })
  const runtime = new DshRuntime({
    agents: new Map([['parent', parent], ['child', child]]),
    subagents: {
      async startActivation() {
        return { childId: 'child', result, dispose() {} }
      }
    }
  })
  const s = await fixture(t, runtime)
  const role = s.snapshot().roles[0]
  const sent = await s.chats.send({ roleId: role.id, text: '查看规格', requestId: 'activity', ...scope })
  const current = () => s.chats.list(scope.project)[0]
  const time = Date.now()
  try {
    // Wait for DshRuntime to resolve the project path and bind the child.
    for (let attempt = 0; !s.chats.binding('child') && attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 4))
    }
    assert.ok(s.chats.binding('child'))
    events.push({ type: 'tool/call', time, data: { callId: 'read-1', name: 'read', arguments: '/private/internal' } })
    assert.deepEqual(current().activity, { phase: 'tool', tool: 'read', toolCount: 1, at: time })
    assert.equal(s.chats.list('/other').length, 0)

    events.push({ type: 'approval/asked', time: time + 1, data: { id: 'approval-1' } })
    assert.equal(current().activity.phase, 'approval')
    events.push({ type: 'approval/decided', time: time + 2, data: { id: 'approval-1' } })
    events.push({
      type: 'tool/result', time: time + 3,
      data: { message: { toolCallId: 'read-1', content: [{ type: 'text', text: 'internal tool output' }] } }
    })
    assert.deepEqual(current().activity, { phase: 'waiting', tool: 'read', toolCount: 1, at: time + 3 })
    assert.deepEqual(current().messages.map((message) => message.type), ['user'])
  } finally {
    release({ stopReason: 'completed', output: [{ type: 'text', text: '看过了' }] })
    await s.chats.wait(sent.id)
  }
  assert.equal(current().activity, undefined)
  assert.equal(current().messages.at(-1).text, '看过了')
})

test('role conversation reports Kimi quota failure from the native turn when DSH omits the diagnostic', async (t) => {
  const parent = { session: { header: { id: 'parent', cwd: scope.project } } }
  const message = 'Kimi Code 已达到当前 5 小时用量上限。'
  const child = { session: { snapshotEvents: () => [{
    type: 'turn/end',
    data: { reason: { kind: 'error', error: { code: 'EXTERNAL_AGENT_QUOTA_EXHAUSTED', message } } }
  }] } }
  const s = await fixture(t, new DshRuntime({
    agents: new Map([['parent', parent], ['child', child]]),
    subagents: {
      async startActivation() {
        return { childId: 'child', result: Promise.resolve({ stopReason: 'error', output: [] }), dispose() {} }
      }
    }
  }))
  const role = s.snapshot().roles[0]
  const sent = await s.chats.send({ roleId: role.id, text: '查看进度', requestId: 'quota', ...scope })
  await s.chats.wait(sent.id)
  const row = s.chats.list(scope.project)[0]
  assert.equal(row.status, 'failed')
  assert.equal(row.error, message)
  assert.deepEqual(row.messages.map((entry) => entry.type), ['user'])
})

test('role conversations reuse identity, persist and reject duplicate/in-flight sends', async (t) => {
  let release,
    calls = 0
  const gate = new Promise((r) => (release = r))
  const s = await fixture(t, {
    async run() {
      calls++
      await gate
      return { output: '答复', stopReason: 'completed' }
    }
  })
  const role = s.snapshot().roles[0],
    a = await s.chats.open(role.id, scope),
    b = await s.chats.open(role.id, scope)
  assert.equal(a.id, b.id)
  const sent = await s.chats.send({ roleId: role.id, text: '问题', requestId: 'one', ...scope })
  await s.chats.send({ roleId: role.id, text: '问题', requestId: 'one', ...scope })
  await assert.rejects(
    () => s.chats.send({ roleId: role.id, text: '重复', requestId: 'two', ...scope }),
    /回复中/
  )
  release()
  await s.chats.wait(sent.id)
  const final = s.chats.list(scope.project)[0]
  assert.equal(final.status, 'idle')
  assert.deepEqual(
    final.messages.map((m) => m.text),
    ['问题', '答复']
  )
  assert.equal(calls, 1)
  assert.equal(s.chats.list('/another-project').length, 0)
})
test('unbound or inactive roles cannot send; errors retain user message and surface failure', async (t) => {
  const s = await fixture(t, {
      async run() {
        throw new Error('执行方式不可用')
      }
    }),
    r = s.snapshot().roles[0]
  await assert.rejects(
    () => s.chats.send({ roleId: r.id, text: 'x', requestId: 'x', project: scope.project }),
    /请先在 DSH/
  )
  const c = await s.chats.send({ roleId: r.id, text: 'x', requestId: 'x', ...scope })
  await s.chats.wait(c.id)
  assert.equal(s.chats.list(scope.project)[0].status, 'failed')
  assert.match(s.chats.list(scope.project)[0].error, /不可用/)
})
test('peer consultation produces a report and read-only record in originating conversation', async (t) => {
  let s
  s = await fixture(t, {
    async run(task, c) {
      if (task.roleId === s.snapshot().roles[0].id) {
        await c.onSession?.('role-native')
        await s.chats.contact('role-native', s.snapshot().roles[1].id, '请核对')
        return { output: '已核对', stopReason: 'completed' }
      }
      return { output: '核对结果', stopReason: 'completed' }
    }
  })
  const a = s.snapshot().roles[0],
    c = await s.chats.send({ roleId: a.id, text: '请检查', requestId: 'a', ...scope })
  await s.chats.wait(c.id)
  const report = s.chats.list(scope.project)[0].messages.find((m) => m.type === 'report')
  assert.ok(report)
  const record = s.chats.record(report.recordId, scope.project)
  assert.deepEqual(
    record.messages.map((m) => m.text),
    ['请核对', '核对结果']
  )
  assert.throws(() => s.chats.record(report.recordId, '/other'), /不存在/)
  assert.equal(s.chats.list(scope.project).length, 1)
})

import { roleSections } from '../src/client/conversation-model.mjs'
test('overview respects stored roleGroups.roleIds and ungrouped roles', () => {
  const roles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(
    roleSections(roles, [{ id: 'g', name: '工程', roleIds: ['b', 'missing'] }]).map((g) => [
      g.name,
      g.roles.map((r) => r.id)
    ]),
    [
      ['工程', ['b']],
      ['未分组', ['a', 'c']]
    ]
  )
})
test('restart preserves messages and interrupts pending sends without dispatching again', async (t) => {
  const s = await fixture(t, {
      async run() {
        throw Error('must not run')
      }
    }),
    r = s.snapshot().roles[0]
  const c = await s.chats.open(r.id, scope)
  await s.store.update((d) => {
    const row = d.conversations.find((x) => x.id === c.id)
    row.status = 'sending'
    row.messages.push({ id: 'pending', type: 'user', text: '未完成', requestId: 'pending' })
  })
  await s.dispose()
  const next = await new TeamService({
    stateDir: s.store.dir,
    runtime: {
      async run() {
        assert.fail('must not redispatch')
      }
    }
  }).init()
  t.after(() => next.dispose())
  assert.equal(next.chats.list(scope.project)[0].status, 'interrupted')
  assert.equal(next.chats.list(scope.project)[0].messages[0].text, '未完成')
  assert.equal((await next.chats.open(r.id, scope)).id, c.id)
})
test('send admitted concurrently with shutdown never starts a late consultation', async (t) => {
  let calls = 0
  const s = await fixture(t, {
      async run() {
        calls++
        return { output: 'unexpected' }
      }
    }),
    r = s.snapshot().roles[0]
  const sent = s.chats.send({ roleId: r.id, text: 'late', requestId: 'late', ...scope })
  const outcome = sent.catch((e) => e)
  await s.dispose()
  await outcome
  assert.equal(calls, 0)
})

test('long conversation context stays bounded and retains newest message', async (t) => {
  const prompts = []
  const s = await fixture(t, {
      async run(_task, c) {
        prompts.push(c.prompt)
        return { output: '旧答复'.repeat(4000), stopReason: 'completed' }
      }
    }),
    r = s.snapshot().roles[0]
  for (let n = 0; n < 3; n++) {
    const c = await s.chats.send({
      roleId: r.id,
      text: '问题'.repeat(9000) + '最新' + n,
      requestId: 'long-' + n,
      ...scope
    })
    await s.chats.wait(c.id)
    assert.equal(s.chats.list(scope.project)[0].status, 'idle')
  }
  assert.equal(prompts.length, 3)
  assert.ok(prompts.every((p) => p.length < 23000))
  assert.match(prompts[2], /最新2/)
})

test('invalid peer does not lock later contacts; peer session gets only its own role binding', async (t) => {
  let s, peerId
  s = await fixture(t, {
    async run(task, c) {
      if (task.roleId !== peerId) {
        await c.onSession('origin-native')
        await assert.rejects(() => s.chats.contact('origin-native', 'missing', '无效角色'), /Role|role|角色/)
        await s.chats.contact('origin-native', peerId, '有效咨询')
        return { output: '完成', stopReason: 'completed' }
      }
      assert.equal(c.sourceSession, 'parent')
      await c.onSession?.('peer-native')
      assert.equal(s.chats.roleBinding('peer-native').roleId, peerId)
      return { output: '意见', stopReason: 'completed' }
    }
  })
  const [origin, peer] = s.snapshot().roles
  peerId = peer.id
  const c = await s.chats.send({ roleId: origin.id, text: '咨询', requestId: 'peers', ...scope })
  await s.chats.wait(c.id)
  assert.equal(s.chats.list(scope.project)[0].status, 'idle')
  assert.equal(s.chats.roleBinding('peer-native'), undefined)
})
