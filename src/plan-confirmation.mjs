// Same-process host lookup only. Never read policy from model-supplied arguments.
const service=(ctx,name)=>typeof ctx.get==='function'?ctx.get(name):ctx[name]
const builtins=new Set(['read-only','workspace-write','danger-full-access','auto','custom'])
const bounded=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!value.includes('\0')
export function createPlanConfirmationResolver(ctx){
  return async exec=>{
    const session=exec?.agent?.session,sourceSession=session?.header?.id
    if(!bounded(sourceSession))return null
    try{
      const approval=service(ctx,'approval'),presets=service(ctx,'permissionPresets')
      if(typeof approval?.effectivePolicy!=='function'||typeof presets?.current!=='function')return null
      const policy=await approval.effectivePolicy(session),preset=await presets.current(session)
      if(!['ask','never'].includes(policy)||!bounded(preset))return null
      let configured=false
      if(!builtins.has(preset)){
        const names=presets.names
        configured=Array.isArray(names)&&names.includes(preset)
        if(!configured&&typeof presets.specOf==='function'){
          const spec=await presets.specOf(preset)
          configured=Boolean(spec&&typeof spec==='object'&&!Array.isArray(spec))
        }
        if(!configured)return null
      }
      // Auto's tools/pre-execute hook has already reviewed this exact call.
      // Never skips only this plugin's plan card; it cannot grant escalation.
      if(policy==='never'||preset==='auto')return {kind:'parent-policy',sourceSession,policy,preset,...(configured?{presetSource:'configured'}:{})}
    }catch{}
    return null
  }
}

export function planAuthorization(actor,sourceSession){
  if(actor?.kind==='human')return {kind:'human'}
  if(actor?.kind!=='parent-policy'||!bounded(sourceSession)||actor.sourceSession!==sourceSession||!['ask','never'].includes(actor.policy)||!bounded(actor.preset)||(!builtins.has(actor.preset)&&actor.presetSource!=='configured')||(actor.policy!=='never'&&actor.preset!=='auto'))throw new Error('Invalid parent-policy plan authorization')
  return {kind:'parent-policy',sourceSession,policy:actor.policy,preset:actor.preset,...(!builtins.has(actor.preset)?{presetSource:'configured'}:{})}
}

// Keep in-flight decisions separate from CLI submission deduplication. The
// scope and version are validated by callers before joining this private map.
const pendingConfirmations=new WeakMap()
export function sharePlanConfirmation(service,sourceSession,id,version,operation){
  let pending=pendingConfirmations.get(service)
  if(!pending){pending=new Map();pendingConfirmations.set(service,pending)}
  const key=JSON.stringify([sourceSession,id,version])
  if(!pending.has(key)){
    const job=Promise.resolve().then(operation).finally(()=>{
      pending.delete(key)
      if(!pending.size)pendingConfirmations.delete(service)
    })
    pending.set(key,job)
  }
  return pending.get(key)
}
