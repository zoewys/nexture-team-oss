import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {TeamService} from '../src/service.mjs'
import {createHandler} from '../src/http.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2)
const option=(flag,fallback)=>{const index=args.indexOf(flag);return index<0?fallback:args[index+1]}
const port=Number(option('--port',process.env.PORT||'5841')),stateDir=resolve(option('--state-dir',resolve(root,'.local/dev-preview')))
const runtime={async run(task,{signal}) {await delay(800,undefined,{signal});return {stopReason:'completed',output:`本地开发预览 · 模拟结果\n\n${task.title}\n\n已验证任务分工和结果展示流程。该结果由预览运行时生成，未调用 DSH 或 CLI 模型。`}}}
const service=await new TeamService({stateDir,runtime}).init()
if(args.includes('--seed')&&service.snapshot().roles.length===2){
 for(const role of [{name:'产品研究员',prompt:'从真实需求出发，研究用户、竞品与产品机会，提供有依据的判断和可执行的建议。',skills:['research'],execution:'dsh',type:'longterm',autoMemory:true},{name:'前端工程师',prompt:'把清晰的产品需求转化为简洁、可维护的界面实现，关注交互细节与浏览器验证。',skills:[],execution:'dsh',type:'longterm',autoMemory:true},{name:'视觉设计师',prompt:'建立协调的视觉语言，以清晰的层次、留白和细节，让产品更易理解和使用。',skills:[],execution:'dsh',type:'longterm',autoMemory:true}]){const draft=await service.draftRole({role,sourceSession:'local-preview'});await service.confirm(draft.id,draft.version,{kind:'human'})}
}
const api=createHandler(service,{catalog:async()=>({executions:[{id:'dsh',label:'DSH（预览模拟）',available:true},{id:'pi',label:'Pi',available:false},{id:'codex',label:'Codex',available:false},{id:'claude',label:'Claude Code',available:false}],models:[]})})
const config=JSON.stringify({sourceSession:'local-preview',project:root}).replace(/</g,'\\u003c')
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nexture Team · 本地预览</title><style>html,body,#root{width:100%;height:100%;margin:0}body{font-family:Inter,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}button,input,textarea,select{font:inherit}</style></head><body><div id="root"></div><script>window.__TEAM_DEV__=${config}</script><script src="/dev.js"></script></body></html>`
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://127.0.0.1').pathname
 if(path.startsWith('/nexture-team/api'))return await api(req,res)
 res.setHeader('cache-control','no-store')
 if(path==='/'||path==='/index.html'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return}
 if(path==='/dev.js'){res.setHeader('content-type','text/javascript; charset=utf-8');res.end(await readFile(resolve(root,'client/dev.js')));return}
 if(path==='/favicon.ico'){res.writeHead(204);res.end();return}
 res.writeHead(404);res.end('Not found')
}catch(error){if(!res.headersSent)res.writeHead(500,{'content-type':'text/plain; charset=utf-8'});res.end(error.message)}})
server.listen(port,'127.0.0.1',()=>console.log(`Nexture Team preview: http://127.0.0.1:${port}\nLocal mock execution only; state: ${stateDir}\nNative chat and @ roles require the DSH host.`))
async function close(){server.close();api.dispose();await service.dispose();process.exit(0)}
process.once('SIGINT',close);process.once('SIGTERM',close)
