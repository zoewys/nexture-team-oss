const catalogs = new WeakMap()

export function executionCatalogFor(api) {
  if (!catalogs.has(api)) catalogs.set(api, createExecutionCatalog(options => api.catalog(options)))
  return catalogs.get(api)
}

export function createExecutionCatalog(request, {ttlMs = 60_000, timeoutMs = 20_000} = {}) {
  let snapshot = {catalog: null, loading: false, error: null}
  let freshUntil = 0
  let pending
  const listeners = new Set()

  function publish(next) {
    snapshot = {...snapshot, ...next}
    for (const listener of listeners) listener()
  }

  function load({force = false} = {}) {
    if (pending) return pending
    if (!force && (snapshot.error || Date.now() < freshUntil)) return Promise.resolve()

    const controller = new AbortController()
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('模型目录读取超时'))
        controller.abort()
      }, timeoutMs)
    })

    pending = Promise.race([
      Promise.resolve().then(() => request({signal: controller.signal})),
      timeout,
    ]).then(catalog => {
      freshUntil = Date.now() + ttlMs
      publish({catalog, error: null})
    }, error => {
      publish({error})
    }).finally(() => {
      clearTimeout(timer)
      pending = undefined
      publish({loading: false})
    })

    publish({loading: true, error: null})
    return pending
  }

  return {
    load,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
