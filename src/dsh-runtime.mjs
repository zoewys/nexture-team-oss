import {realpath} from 'node:fs/promises'
import {isAbsolute} from 'node:path'
import {assertDshProvider} from './execution-route.mjs'

function abortError() {
  return Object.assign(new Error('DSH task cancelled'), {name:'AbortError',stopReason:'aborted'})
}

function resultWithSignal(result, signal) {
  return new Promise((resolve, reject) => {
    const settle = (finish,value) => {
      signal.removeEventListener('abort',abort)
      finish(value)
    }
    const abort = () => settle(reject,abortError())
    signal.addEventListener('abort', abort, {once:true})
    Promise.resolve(result).then(value => settle(resolve,value),error => settle(reject,error))
    if (signal.aborted) abort()
  })
}

/** One fresh host-owned spawn per task; the host keeps its permission/depth policies. */
export class DshRuntime {
  constructor(ctx) { this.ctx = ctx }

  available() {
    const service = this.ctx?.subagents
    if (typeof service?.startActivation !== 'function' && typeof service?.start !== 'function') return false
    return typeof service.list !== 'function' || service.list().includes('spawn')
  }

  async run(task, {role,prompt,project,sourceSession,signal = new AbortController().signal,onSession} = {}) {
    if (signal.aborted) throw abortError()
    if (!this.available()) throw new Error('DSH spawn runtime unavailable')
    if (!sourceSession) throw new Error('Exact source session is required for the parent agent')
    let parent = this.ctx.agents?.get?.(sourceSession)
    if (!parent) {
      const found = await this.ctx.sessionController?.agents?.resolveAgent?.(sourceSession)
      if (found?.error) throw new Error(`Cannot resolve source parent: ${found.error.message ?? String(found.error)}`, {cause:found.error})
      parent = found?.agent
    }
    if (!parent) throw new Error('Source session parent agent was not found')
    if ((parent.session?.header?.id ?? parent.id) !== sourceSession) throw new Error('Resolved parent does not match the source session')
    const cwd = parent.session?.header?.cwd
    if (!isAbsolute(project ?? '') || !isAbsolute(cwd ?? '')) throw new Error('Project and parent cwd must be absolute')
    const [canonicalProject,canonicalCwd] = await Promise.all([realpath(project),realpath(cwd)])
    if (canonicalProject !== canonicalCwd) throw new Error('Source parent cwd does not match the approved project')
    // task is the approved immutable snapshot; null explicitly means inherit the host route.
    const model = Object.hasOwn(task,'model') ? task.model : role?.model
    const provider = Object.hasOwn(task,'provider') ? task.provider : role?.provider
    if (Boolean(model) !== Boolean(provider)) throw new Error('DSH provider and model must both be supplied together')
    const inherited=provider?null:(parent.model?.current?.()??this.ctx.sessionController?.agents?.selectionFor?.(parent))
    assertDshProvider(provider||inherited?.provider)
    if (signal.aborted) throw abortError()
    const request = {parent,signal,label:role.name,prompt:[{type:'text',text:prompt}],persona:role.prompt}
    if (model && provider) request.agentOptions = {provider,model}
    const maxDepth = this.ctx.subagents.resolveMaxDepth?.()
    if (maxDepth !== undefined) request.maxDepth = maxDepth
    // The host validates provider capabilities and applies inherited authorization.
    // Current hosts own child activations and return results to this caller.
    // persona was removed from the new API: TeamService already includes the
    // approved role instructions, skills and private memory in prompt.
    const modern = typeof this.ctx.subagents.startActivation === 'function'
    const {signal: _signal,label: _label,persona: _persona,...activationRequest} = request
    const run = modern
      ? await this.ctx.subagents.startActivation({provider:'spawn',label:role.name,request:activationRequest,signal,delivery:'caller'})
      : await this.ctx.subagents.start('spawn',request)
    const nativeSession = modern ? run.childId : run.id
    let failure, output = '',usage=null
    try {
      // Observe result rejection immediately, including when onSession itself fails.
      const pending = Promise.resolve(run.result)
      pending.catch(() => {})
      if (!nativeSession) throw new Error('DSH returned no child session identity')
      await onSession?.(nativeSession)
      const result = await resultWithSignal(pending,signal)
      usage=result.usage??null
      output = (result.output ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n')
      if (result.stopReason !== 'completed') {
        const error = new Error(`DSH task ended with ${result.stopReason ?? 'unknown reason'}${result.diagnostic ? `: ${result.diagnostic}` : ''}`)
        Object.assign(error,{stopReason:result.stopReason,diagnostic:result.diagnostic,output})
        if (result.stopReason === 'aborted') error.name = 'AbortError'
        throw error
      }
      return {output,nativeSession,stopReason:'completed',usage}
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
      failure.nativeSession = nativeSession
      failure.output ??= output
      failure.usage??=usage
      throw failure
    } finally {
      try { await run.dispose() }
      catch (error) {
        if (failure) failure.disposalError = error
        else throw Object.assign(new Error(`DSH run disposal failed: ${error.message ?? error}`,{cause:error}),{nativeSession,output})
      }
    }
  }
}
