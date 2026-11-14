import {randomBytes} from 'node:crypto'
export const BASE='/nexture-team/api'
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data))}
export function createHandler(service,{requestGate,catalog=async()=>({executions:[{id:'dsh',label:'DSH 原生智能体',available:true}],models:[]})}={}){
  const tokens=new Map(),human={kind:'human'}
  const handler=async(req,res)=>{try{
    const gate=requestGate?.(req);if(gate){send(res,gate,{error:'DSH access denied'});return}
    const host=req.headers.host
    if(host&&!requestGate&&!['localhost','127.0.0.1','[::1]'].includes(new URL('http://'+host).hostname)){send(res,403,{error:'Untrusted host'});return}
    if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin!==undefined&&new URL(req.headers.origin).host!==host){send(res,403,{error:'Cross-site request denied'});return}
    const url=new URL(req.url,'http://localhost'),path=url.pathname
    for(const [key,at] of tokens)if(Date.now()-at>24*3600000)tokens.delete(key)
    if(req.method==='GET'&&path===BASE+'/bootstrap'){if(tokens.size>=256){send(res,429,{error:'Too many clients'});return}const token=randomBytes(32).toString('hex');tokens.set(token,Date.now());send(res,200,{token});return}
    const token=req.headers['x-team-token'];if(!tokens.has(token)){send(res,403,{error:'请重新连接 Team 面板'});return}tokens.set(token,Date.now())
    if(req.method==='GET'){
      if(path===BASE+'/state')send(res,200,service.snapshot(url.searchParams.has('sourceSession')?url.searchParams.get('sourceSession'):undefined))
      else if(path===BASE+'/catalog')send(res,200,await catalog(url.searchParams.get('sourceSession')))
      else if(path===BASE+'/memory')send(res,200,{memories:service.memories(url.searchParams.get('roleId'),url.searchParams.has('project')?url.searchParams.get('project'):undefined)})
      else send(res,404,{error:'Unknown Team route'});return
    }
    if(req.method!=='POST'||path!==BASE){send(res,405,{error:'Method not allowed'});return}
    if(!req.headers['content-type']?.startsWith('application/json')){send(res,415,{error:'JSON required'});return}
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>256*1024){send(res,413,{error:'Request too large'});return}chunks.push(chunk)}
    const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));let result
    switch(b.action){
      case 'draftRole':result=await service.draftRole(b);break
      case 'confirm':result=await service.confirm(b.id,b.version,human);break
      case 'reject':result=await service.reject(b.id,b.version,human);break
      case 'archiveRole':result=await service.archiveRole(b.roleId,b.version,human);break
      case 'promoteRole':result=await service.promoteRole(b.roleId,b.version,human);break
      case 'saveRoleGroup':result=await service.saveRoleGroup(b,human);break
      case 'moveRoles':result=await service.moveRoles(b,human);break
      case 'deleteRoleGroup':result=await service.deleteRoleGroup(b.groupId,human);break
      case 'settings':result=await service.settings(b,human);break
      case 'memoryUpsert':result=await service.memoryUpsert(b.roleId,b.memory,human);break
      case 'memoryDelete':result=await service.memoryDelete(b.roleId,b.id,human);break
      case 'proposePlan':result=await service.proposePlan(b);break
      case 'run':result=await service.run(b.id);break
      case 'reconcile':result=await service.reconcile(b.id,{taskId:b.taskId,timeoutMs:Math.min(b.timeoutMs??30000,30000)});break
      case 'retryMemory':result=await service.retryMemory(b.id);break
      case 'cancel':result=await service.cancel(b.id);break
      default:throw new Error('Unknown Team action')
    }
    send(res,200,result)
  }catch(e){if(!res.headersSent)send(res,400,{error:e.message})}}
  handler.dispose=()=>tokens.clear();return handler
}
