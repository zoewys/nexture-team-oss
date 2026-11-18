import test from 'node:test'
import assert from 'node:assert/strict'

test('editors share a pending model lookup and reuse it until refreshed', async () => {
  const {createExecutionCatalog} = await import('../src/client/execution-catalog.mjs')
  let calls = 0
  const catalog = {executions: [{id: 'pi', available: true}], models: []}
  const resource = createExecutionCatalog(async () => {
    calls++
    return catalog
  })
  assert.equal(calls, 0)
  const first = resource.load()
  assert.equal(resource.load(), first)
  await first
  await resource.load()
  assert.equal(calls, 1)
  assert.deepEqual(resource.getSnapshot(), {catalog, loading: false, error: null})
  await resource.load({force: true})
  assert.equal(calls, 2)
})

test('a stalled lookup times out, preserves prior choices and permits a retry', async () => {
  const {createExecutionCatalog} = await import('../src/client/execution-catalog.mjs')
  const catalog = {executions: [{id: 'codex', available: true}], models: [{id: 'saved-model'}]}
  let calls = 0
  let stalledSignal
  const resource = createExecutionCatalog(({signal}) => {
    if (++calls !== 2) return Promise.resolve(catalog)
    stalledSignal = signal
    return new Promise(() => {})
  }, {timeoutMs: 10})
  await resource.load()
  await resource.load({force: true})
  assert.equal(stalledSignal.aborted, true)
  const failed = resource.getSnapshot()
  assert.equal(failed.catalog, catalog)
  assert.equal(failed.loading, false)
  assert.match(failed.error.message, /超时/)
  await resource.load({force: true})
  assert.equal(calls, 3)
  assert.deepEqual(resource.getSnapshot(), {catalog, loading: false, error: null})
})
