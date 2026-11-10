import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {build} from 'esbuild'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

test('client registers native role source and global panel without adding a chat tab',async()=>{
 const result=await build({entryPoints:['src/client/plugin.jsx'],bundle:true,write:false,platform:'browser',format:'cjs',external:['react','@deepseek-ai/dsh-client-ui-primitives'],define:{__TEAM_CSS__:'""'}})
 const registrations=[],sources=[],effects=[],module={exports:{}}
 const context={module,exports:module.exports,require(name){if(name==='@deepseek-ai/dsh-client-ui-primitives')return {MarkdownText:()=>null};assert.equal(name,'react');return React},document:{querySelector:()=>null,createElement:()=>({dataset:{}}),head:{append(){}}},window:{}}
 vm.runInNewContext(result.outputFiles[0].text,context)
 const {apply,inject}=module.exports
 assert.ok(inject.includes('inputTriggers'))
 const slots={register(options,Component){registrations.push({options,Component});return()=>{}},inject(name,callback){const result=callback();if(result?.[Symbol.iterator])for(const _ of result){/* materialize host slot effects */}}}
 apply({slots,inputTriggers:{registerSource(source){sources.push(source);return()=>{sources.pop()}}},effect(callback){effects.push(callback())}})
 assert.equal(sources[0].name,'nexture-team')
 assert.equal(sources[0].trigger,'@')
 assert.ok(!registrations.some(r=>r.options.name==='conversation.view'),'Team must not add an extra chat tab')
 const main=registrations.find(r=>r.options.name==='main')
 assert.equal(main.options.key,'nexture-team')
 assert.equal(main.options.children['nexture-team.chat'].scope,'session-maybe')
 assert.ok(registrations.some(r=>r.options.name==='nexture-team.chat'))
 const confirmation=registrations.find(r=>r.options.name==='conversation.composer')
 assert.ok(confirmation);assert.equal(confirmation.options.select({pendingInteraction:{questions:[]}}),null)
 for(const dispose of effects)dispose?.()
 assert.equal(sources.length,0)
})

test('active task polling and focus refresh reuse the initial execution catalog',async()=>{
 const result=await build({entryPoints:['src/client/App.jsx'],bundle:true,write:false,platform:'browser',format:'cjs',external:['react']})
 const effects=[],intervals=[],events=new Map(),module={exports:{}},calls={state:0,catalog:0},catalogUpdates=[]
 let resolveInitialCatalog
 const hooks={
  createElement:(type,props,...children)=>({type,props,children}),
  useState(initial){const value=typeof initial==='function'?initial():initial;return [value?.settings&&Array.isArray(value.roles)?{...value,plans:[{id:'active-plan',status:'running',tasks:[]}]}:value,next=>{if(value?.executions)catalogUpdates.push(next)}]},
  useEffect:effect=>effects.push(effect),useCallback:fn=>fn,useRef:value=>({current:value}),useSyncExternalStore:()=>null,
 }
 const context={module,exports:module.exports,require(name){assert.equal(name,'react');return hooks},window:{addEventListener:(name,handler)=>events.set(name,handler),removeEventListener:name=>events.delete(name)},document:{hidden:false},AbortController,setInterval:handler=>{intervals.push(handler);return intervals.length},clearInterval(){},setTimeout,clearTimeout}
 vm.runInNewContext(result.outputFiles[0].text,context)
 const api={state:async()=>{calls.state++;return {roles:[],drafts:[],plans:[{id:'active-plan',status:'running',tasks:[]}],settings:{}}},catalog:async()=>{calls.catalog++;return calls.catalog===1?new Promise(resolve=>{resolveInitialCatalog=resolve}):{executions:[],models:[]}}}
 const tree=module.exports.default({api,sourceSession:'chat-1'})
 const cleanups=effects.map(effect=>effect())
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(calls.catalog,1,'initial load discovers the catalog')
 assert.equal(intervals.length,1)
 intervals[0]();await new Promise(resolve=>setImmediate(resolve))
 events.get('focus')();await new Promise(resolve=>setImmediate(resolve))
 assert.equal(calls.state,3,'polling and focus both update task state')
 assert.equal(calls.catalog,1,'background refresh never repeats provider discovery')
 resolveInitialCatalog({executions:[{id:'dsh',available:true}],models:[]});await new Promise(resolve=>setImmediate(resolve))
 assert.equal(catalogUpdates.length,1,'initial catalog is retained even when task state refreshed while discovery was pending')
 function findRefresh(node){if(!node||typeof node!=='object')return;return node.props?.['aria-label']==='刷新团队数据'?node:[...(node.children||[]).flat()].map(findRefresh).find(Boolean)}
 const refresh=findRefresh(tree)
 assert.ok(refresh)
 refresh.props.onClick();await new Promise(resolve=>setImmediate(resolve))
 assert.equal(calls.catalog,2,'explicit manual refresh can discover changed executors')
 for(const cleanup of cleanups)if(typeof cleanup==='function')cleanup()
})


test('cancelled tasks show pending or failed native cleanup without claiming the process stopped',async()=>{
 const result=await build({entryPoints:['src/client/TasksPanel.jsx'],bundle:true,write:false,platform:'browser',format:'cjs',external:['react']})
 const module={exports:{}}
 vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:()=>React})
 const plan={id:'p',title:'Cancel tasks',version:1,status:'cancelled',tasks:[{id:'a',title:'A',roleId:'r',status:'cancelled',nativeCleanup:{status:'pending',phase:'stop',nativeSession:'cli-a'}},{id:'b',title:'B',roleId:'r',status:'cancelled',nativeCleanup:{status:'failed',phase:'startup',nativeSession:'cli-b',error:'native stop timeout'}}]}
 const html=renderToStaticMarkup(React.createElement(module.exports.default,{plans:[plan],roles:[],selected:'p'}))
 assert.match(html,/原生会话停止中，请检查 Nexture CLI/)
 assert.match(html,/原生会话停止失败，请检查 Nexture CLI/)
 assert.match(html,/native stop timeout/)
 assert.match(html,/cli-a/)
 assert.match(html,/cli-b/)
})

test('existing roles open a full detail page with role-bound memory and draft confirmation',async()=>{
 const result=await build({entryPoints:['src/client/RoleEditor.jsx'],bundle:true,write:false,platform:'browser',format:'cjs',external:['react']})
 const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:()=>React})
 const role={id:'role-a',name:'研究员',type:'longterm',prompt:'只读研究',skills:[],execution:'dsh',autoMemory:false,enabled:true}
 const html=renderToStaticMarkup(React.createElement(module.exports.default,{inline:true,role,catalog:{executions:[{id:'dsh'}]},api:{},sourceSession:'chat',onClose(){}}))
 assert.ok(!html.includes('<dialog'),'role details are a full page, not an editing popup')
 assert.match(html,/返回角色列表/);assert.match(html,/form="nt-role-form-role-a"/);assert.match(html,/预览修改草案/)
 assert.match(html,/记忆与经验/);assert.match(html,/研究员的记忆范围/);assert.ok(!html.includes('所属角色'))
 assert.ok(!html.includes('确认更新'),'viewing details never silently approves an edit')
})

test('task assignments show the execution-time role even after rename or removal',async()=>{
 const result=await build({entryPoints:['src/client/TasksPanel.jsx'],bundle:true,write:false,platform:'browser',format:'cjs',external:['react']})
 const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:()=>React})
 const plan={id:'p',title:'推广任务',version:1,status:'completed',project:'/tmp/project',tasks:[{id:'a',title:'寻找渠道',roleId:'r',roleSnapshot:{id:'r',name:'外链推广执行'},status:'completed',execution:'pi',prompt:'完整任务要求',output:'核查结果'},{id:'b',title:'复核证据',roleId:'removed',roleSnapshot:{id:'removed',name:'证据审核员'},status:'completed',execution:'dsh',prompt:'复核',dependsOn:['a']}]}
 const html=renderToStaticMarkup(React.createElement(module.exports.default,{plans:[plan],roles:[{id:'r',name:'已改名的新角色'}],selected:'p'}))
 assert.ok(html.includes('执行角色'));assert.ok(!html.includes('已改名的新角色'));assert.ok(!html.includes('>removed<'))
 assert.ok(html.indexOf('外链推广执行')<html.indexOf('<article'),'list shows role assignment before opening a task')
 assert.match(html,/前置任务/);assert.match(html,/aria-label="任务列表"/);assert.match(html,/aria-label="分工详情"/)
 assert.match(html,/完整任务要求/);assert.match(html,/核查结果/)
})
