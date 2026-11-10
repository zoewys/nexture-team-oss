// Opaque host observation identity; native assistant progress cannot supply it.
export const runtimeWaitId=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\x00-\x1f\x7f]/.test(value)?value:null
export function runtimeProgressSignal(phase,summary,waitId) {
  const id=phase==='blocked'?runtimeWaitId(waitId):null
  return JSON.stringify([phase,summary,...id?[id]:[]])
}
export function savedBlockedSignal(value) {
  try {
    const previous=JSON.parse(value)
    if(!Array.isArray(previous)||![2,3].includes(previous.length)||previous[0]!=='blocked'||typeof previous[1]!=='string'||previous[1].length>1200)return null
    if(previous.length===3&&!runtimeWaitId(previous[2]))return null
    return runtimeProgressSignal(...previous)
  }catch{return null}
}
