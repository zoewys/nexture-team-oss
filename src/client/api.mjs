export function createTeamApi(fetcher=(...args)=>fetch(...args),base='/nexture-team/api') {
 let tokenPromise
 async function read(response) {
  let body
  try {body=await response.json()}catch{throw new Error(`服务响应异常（${response.status}），请刷新重试。`)}
  if(!response.ok) {const error=new Error(typeof body.error==='string'?body.error:body.error?.message||body.message||`请求失败（${response.status}）`);error.status=response.status;throw error}
  return body
 }
 function token() {
  if(!tokenPromise)tokenPromise=fetcher(`${base}/bootstrap`,{credentials:'same-origin',headers:{Accept:'application/json'}}).then(read).then(body=>{if(!body.token)throw new Error('面板认证失败，请刷新重试。');return body.token}).catch(error=>{tokenPromise=undefined;throw error})
  return tokenPromise
 }
 async function request(path,{signal,action,params}={}) {
  const auth=await token()
  const response=await fetcher(`${base}${path}`,{method:action?'POST':'GET',credentials:'same-origin',signal,headers:{Accept:'application/json','X-Team-Token':auth,...(action?{'Content-Type':'application/json'}:{})},...(action?{body:JSON.stringify({action,...params})}:{})})
  if(response.status===401||response.status===403)tokenPromise=undefined
  return read(response)
 }
 return {state:(session,options={})=>request(`/state${session?`?sourceSession=${encodeURIComponent(session)}`:''}`,options),catalog:options=>request('/catalog',options),memory:(roleId,project,options={})=>request(`/memory?roleId=${encodeURIComponent(roleId)}${project?`&project=${encodeURIComponent(project)}`:''}`,options),action:(action,params={})=>request('',{action,params})}
}
export const teamApi=createTeamApi()
