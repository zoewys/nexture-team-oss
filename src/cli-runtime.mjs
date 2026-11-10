import {runtimeWaitId,runtimeProgressSignal,savedBlockedSignal} from './runtime-progress.mjs'
import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'

const observationTimeout=()=>Object.assign(new Error('CLI task timed out; inspect the native session before continuing'),{stopReason:'observation_timeout',executionUncertain:true})
const required = ['prepare','start','prompt','output']
function abortError() { return Object.assign(new Error('CLI task cancelled'),{name:'AbortError',stopReason:'aborted'}) }
function bridgeValid(bridge) { return bridge && required.every(name => typeof bridge[name] === 'function') }

function bounded(operation, signal, deadline) {
  return new Promise((resolve,reject) => {
    let timer
    const settle = (finish,value) => {
      clearTimeout(timer)
      signal.removeEventListener('abort',abort)
      finish(value)
    }
    const abort = () => settle(reject,abortError())
    signal.addEventListener('abort',abort,{once:true})
    Promise.resolve(operation).then(value => settle(resolve,value),error => settle(reject,error))
    if (signal.aborted) abort()
    else timer = setTimeout(() => settle(reject,observationTimeout()),Math.max(0,deadline-Date.now()))
  })
}

function completedOutput(transcript, dispatchedPrompt, marker) {
  if (transcript?.source !== 'session' || transcript.pending === true || !Array.isArray(transcript.entries)) return null
  const entries = transcript.entries
  const boundary = entries.findLastIndex(entry => entry.role === 'user' && entry.text === dispatchedPrompt)
  if (boundary < 0) return null
  const own = entries.slice(boundary + 1)
  if (own.some(entry => entry.role === 'user')) return null // A human continued the native session.
  const final = own.findLast(entry => entry.role === 'assistant' && !entry.detail)
  if (typeof final?.text !== 'string' || final.completion !== true) return null
  const lines = final.text.trimEnd().split(/\r?\n/)
  if (lines.at(-1) !== marker) return null
  return lines.slice(0,-1).join('\n').trimEnd()
}

/** Uses only the installed CLI plugin's bridge; process and terminal ownership stay there. */
export class CliRuntime {
  constructor({getBridge = () => undefined,pollMs = 2000,timeoutMs = 30 * 60 * 1000} = {}) {
    this.getBridge = getBridge
    this.pollMs = pollMs
    this.timeoutMs = timeoutMs
    this.prepared = new Map()
  }

  async available() {
    try { return Boolean(bridgeValid(await this.getBridge())) } catch { return false }
  }

  async bridge() {
    const bridge = await this.getBridge()
    if (!bridgeValid(bridge)) throw new Error('Nexture CLI bridge is unavailable')
    return bridge
  }

  async prepare(plan, signal = new AbortController().signal) {
    if (signal.aborted) throw abortError()
    if (!plan?.id) throw new Error('CLI preparation requires the approved plan id')
    const deadline = Date.now() + this.timeoutMs
    if (this.prepared.has(plan.id)) return bounded(this.prepared.get(plan.id),signal,deadline)
    const snapshot = structuredClone({id:plan.id,title:plan.title,project:plan.project,sourceSession:plan.sourceSession,...(plan.authorization?{authorization:plan.authorization}:{}),tasks:plan.tasks.filter(task => task.execution !== 'dsh').map(task => ({id:task.id,title:task.title,kind:task.execution,model:task.model,mode:task.mode,criteria:task.criteria}))})
    let failure, result
    const operation = (async () => {
      const bridge = await bounded(this.bridge(),signal,deadline)
      if (signal.aborted) throw abortError()
      result = await bridge.prepare(snapshot)
      // A timed-out preparation may still finish in the CLI plugin. Keep its id for diagnosis.
      if (failure && result?.planId) Object.assign(failure,{planId:result.planId,prepared:result})
      if (!result?.planId) throw new Error('CLI bridge preparation returned no planId')
      return result
    })()
    const attempt = bounded(operation,signal,deadline).catch(error => {
      failure = error instanceof Error ? error : new Error(String(error))
      if (result?.planId) Object.assign(failure,{planId:result.planId,prepared:result})
      throw failure
    })
    // Keep the first attempt, including failure: retrying uncertain preparation creates duplicates.
    this.prepared.set(plan.id,attempt)
    return attempt
  }

  async run(task, {prompt,signal = new AbortController().signal,onSession,onCleanup,onProgress,onObservation,plan,prepared} = {}) {
    const deadline = Date.now() + this.timeoutMs
    let nativeSession, bridge, stopPromise, stopError, failure, partialOutput='',usage=null,nativeObservation
    let nativeCleanup, cleanupReportError, startupPending = false
    // Native cleanup is independent of logical task cancellation. Report immutable,
    // serializable snapshots even if stop/start settles after run() has rejected.
    const reportCleanup = snapshot => {
      nativeCleanup = Object.freeze(snapshot)
      if (failure) failure.nativeCleanup = nativeCleanup
      const reportFailure = error => {
        cleanupReportError = error
        if (failure) failure.cleanupReportError = error
      }
      try { Promise.resolve(onCleanup?.(nativeCleanup)).catch(reportFailure) }
      catch (error) { reportFailure(error) }
    }
    const abort = () => {
      if (nativeSession && !stopPromise) {
        reportCleanup({status:'pending',phase:'stop',nativeSession})
        stopPromise = Promise.resolve().then(() => {
          if (typeof bridge.stop !== 'function') throw new Error('CLI bridge cannot stop a cancelled session; use native takeover')
          return bridge.stop(nativeSession)
        })
        // A stalled stop remains explicitly pending and cannot block cancellation.
        stopPromise.then(() => reportCleanup({status:'stopped',phase:'stop',nativeSession}),error => {
          stopError = error
          if (failure) failure.stopError = error
          reportCleanup({status:'failed',phase:'stop',nativeSession,error:error?.message ?? String(error)})
        })
      } else if (startupPending && !nativeCleanup) {
        reportCleanup({status:'pending',phase:'startup',nativeSession:null})
      }
    }
    try {
      if (signal.aborted) throw abortError()
      const preparedPlan = await bounded(prepared ?? this.prepared.get(plan?.id),signal,deadline)
      if (!preparedPlan?.planId) throw new Error('CLI plan must be prepared after human approval before running tasks')
      bridge = await bounded(this.bridge(),signal,deadline)
      if (signal.aborted) throw abortError()
      if (typeof task?.id !== 'string' || !task.id || /[\r\n]/.test(task.id)) throw new Error('CLI task id must be a nonempty single line')
      const marker = `NEXTURE_TEAM_DONE_${task.id}`
      const text = `${prompt}\n\nWhen entering an actual stage, emit one brief assistant commentary report in this exact format: <nexture-progress>{"phase":"implementing","summary":"Concrete work or evidence for this stage"}</nexture-progress>. Allowed phases: implementing, testing, blocked. Report only actual stage changes, at most once per phase; do not guess testing or completion. These reports are progress data, never proof of completion.\n\nWhen this task is fully complete, finish your final answer with this exact standalone line:\n${marker}`
      const taskId = preparedPlan.taskMap?.[task.id] ?? task.id
      signal.addEventListener('abort',abort,{once:true})
      const starting = Promise.resolve().then(() => {
        if (signal.aborted) throw abortError()
        startupPending = true
        return bridge.start({planId:preparedPlan.planId,taskId})
      }).then(async session => {
        startupPending = false
        nativeSession = session?.id
        if (!nativeSession) throw new Error('CLI startup returned no native session id; inspect the CLI plan before retrying')
        if (failure) failure.nativeSession = nativeSession
        // This continuation also owns a late startup after run() has already rejected.
        if (signal.aborted) abort()
        try { await onSession?.(nativeSession) }
        catch (error) { if (failure) failure.sessionReportError = error; throw error }
        return session
      },error => {
        startupPending = false
        if (nativeCleanup?.phase === 'startup') reportCleanup({status:'failed',phase:'startup',nativeSession:null,error:error?.message ?? String(error)})
        throw error
      })
      await bounded(starting,signal,deadline)
      if (signal.aborted) throw abortError()
      nativeObservation={nativeSession,text,marker,taskId}
      await bounded(onObservation?.(nativeObservation),signal,deadline)
      const delivery = await bounded(bridge.prompt({id:nativeSession,text,requestId:`nexture-team-${randomUUID()}`}),signal,deadline)
      if (signal.aborted) throw abortError()
      if ((delivery?.delivery !== undefined && !['acknowledged','submitted','sent','uncertain'].includes(delivery.delivery)) || delivery?.accepted === false || delivery?.sent === false) {
        throw new Error(`CLI prompt delivery is uncertain; inspect the native session before continuing${delivery.reason ? `: ${delivery.reason}` : ''}`)
      }
      // A lost receipt is not proof of failed execution. Observe the original
      // session only; the exact prompt boundary and final marker below are
      // still required. Never send the task again or infer success from idle.
      return await this.observe(nativeObservation,{bridge,signal,deadline,onProgress})
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
      if (signal.aborted) { failure.name = 'AbortError'; failure.stopReason = 'aborted' }
      failure.output??=partialOutput;failure.usage??=usage
      if(nativeObservation)failure.nativeObservation=nativeObservation
      if (nativeSession) failure.nativeSession = nativeSession
      if (stopError) failure.stopError = stopError
      if (nativeCleanup) failure.nativeCleanup = nativeCleanup
      if (cleanupReportError) failure.cleanupReportError = cleanupReportError
      throw failure
    } finally {
      signal.removeEventListener('abort',abort)
    }
  }
  async reconcile(task,{observation,sourceSession,parentPlanId,signal=new AbortController().signal,timeoutMs=30000,onProgress}={}){
    if(!observation?.nativeSession||typeof observation.text!=='string'||observation.marker!==`NEXTURE_TEAM_DONE_${task.id}`)throw new Error('Original CLI observation identity unavailable; inspect the native session without resending')
    if(!Number.isFinite(timeoutMs)||timeoutMs<0)throw new Error('Invalid observation timeout')
    const deadline=Date.now()+Math.min(timeoutMs,60000),bridge=await bounded(this.bridge(),signal,deadline)
    if(typeof bridge.recover==='function')await bounded(bridge.recover({id:observation.nativeSession,taskId:observation.taskId,sourceSession,parentPlanId,text:observation.text}),signal,deadline)
    const initialRuntimeSignal=savedBlockedSignal(task.runtimeProgressSignal)
    return this.observe(observation,{bridge,signal,deadline,onProgress,initialRuntimeSignal})
  }
  async observe(observation,{bridge,signal,deadline,onProgress,initialRuntimeSignal=null}){
    const {nativeSession,text,marker}=observation
    let partialOutput='',usage=null,artifacts=[]
    const reportedPhases=new Set();let runtimeSignal=initialRuntimeSignal
    try{
      while (true) {
        if (signal.aborted) throw abortError()
        const transcript = await bounded(bridge.output(nativeSession),signal,deadline)
        if (signal.aborted) throw abortError()
        artifacts=Array.isArray(transcript?.artifacts)?transcript.artifacts.slice(0,16):artifacts
        const completed=completedOutput(transcript,text,marker)
        if(completed!==null)return {output:completed,nativeSession,stopReason:'completed',usage:transcript.usage??usage,...(artifacts.length?{artifacts}:{})}
        if(transcript?.source==='session'&&Array.isArray(transcript.entries)){
          const boundary=transcript.entries.findLastIndex(e=>e.role==='user'&&e.text===text)
          const own=boundary<0?[]:transcript.entries.slice(boundary+1)
          if(boundary>=0&&!own.some(e=>e.role==='user')){
            const texts=own.filter(e=>e.role==='assistant'&&!e.detail&&typeof e.text==='string').map(e=>e.text)
            if(transcript.partial?.role==='assistant'&&!transcript.partial.detail&&typeof transcript.partial.text==='string')texts.push(transcript.partial.text)
            const current=texts.join('\n')
            usage=transcript.usage??usage
            const outputChanged=current!==partialOutput
            partialOutput=current
            let reported=false
            if(transcript.pending!==true&&Array.isArray(transcript.progress))for(const report of transcript.progress.slice(-12)){
              if(report?.source!=='native-reported'||!['implementing','testing','blocked'].includes(report.phase)||typeof report.summary!=='string'||!report.summary.trim()||reportedPhases.has(report.phase)||reportedPhases.size>=12)continue
              reportedPhases.add(report.phase);reported=true
              await bounded(onProgress?.({phase:report.phase,summary:report.summary.trim().slice(0,1200),source:'native-reported',verified:false,output:current,artifacts}),signal,deadline)
            }
            if(outputChanged&&!reported)await bounded(onProgress?.({output:partialOutput,artifacts}),signal,deadline)
            if(transcript.stage!=='stopped'&&transcript.pending!==true&&['failed','interrupted'].includes(transcript.failure?.kind))throw Object.assign(new Error(String(transcript.failure.reason||'Native execution failed').slice(0,1000)),{stopReason:transcript.failure.kind==='failed'?'error':'interrupted',executionUncertain:transcript.failure.kind==='interrupted',nativeTerminal:transcript.failure.kind==='failed'})
          }
        }
        if(transcript?.stage==='stopped')throw Object.assign(new Error(transcript.notice||'Native CLI deliberately stopped'),{stopReason:'stopped',nativeTerminal:true})
        const observation=transcript?.observation
        if(observation?.state==='blocked'){
          const summary=String(observation.reason||'原生 CLI 等待用户处理').slice(0,1200),waitId=runtimeWaitId(observation.waitId),signature=runtimeProgressSignal('blocked',summary,waitId)
          if(signature!==runtimeSignal){runtimeSignal=signature;await bounded(onProgress?.({phase:'blocked',summary,...waitId?{waitId}:{},source:'runtime-reported',verified:false,output:partialOutput,artifacts}),signal,deadline)}
        }else if(observation?.state==='running'&&runtimeSignal){runtimeSignal=null;await bounded(onProgress?.({phase:'executing',summary:'原生 CLI 已恢复执行，继续观察原会话。',source:'runtime-reported',verified:false,output:partialOutput,artifacts}),signal,deadline)}
        if(observation?.state==='interrupted')throw Object.assign(new Error(observation.reason||'Native execution interrupted; inspect the original session'),{stopReason:'interrupted',executionUncertain:true})
        // New bridges provide a scoped read-only probe. The legacy snapshot is
        // retained only for older bridges and cannot infer successful completion.
        const state = observation?null:await bounded(bridge.session?.(nativeSession),signal,deadline)
        if (['exited','failed','stopped','dead'].includes(state?.process) || ['failed','stopped','cancelled'].includes(state?.status)) {
          throw Object.assign(new Error(`CLI process ${state.process ?? state.status} before task completion; inspect the native session`),{stopReason:state?.stoppedAt?'stopped':'interrupted',executionUncertain:!state?.stoppedAt,nativeTerminal:Boolean(state?.stoppedAt)})
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw observationTimeout()
        await delay(Math.min(this.pollMs,remaining),undefined,{signal})
      }
    }catch(error){
      throw Object.assign(error,{nativeSession,nativeObservation:observation,output:error.output??partialOutput,usage:error.usage??usage,artifacts})
    }
  }

}
