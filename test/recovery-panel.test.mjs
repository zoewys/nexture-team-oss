import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import vm from 'node:vm'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
test('interrupted tasks offer read-original recovery and pending memory offers separate retry',async()=>{
  const bundle=await build({entryPoints:['src/client/TasksPanel.jsx'],bundle:true,write:false,platform:'browser',format:'cjs',external:['react']})
  const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:()=>React})
  const plan={id:'p',title:'Recover',version:1,status:'interrupted',memoryStatus:'pending',tasks:[{id:'t',roleId:'r',title:'Original task',status:'interrupted',nativeSession:'original-cli',phase:'testing',summary:'正在验证'}]}
  const actions=[];const tree=module.exports.default({plans:[plan],roles:[],selected:'p',onAction:(...args)=>actions.push(args)})
  const html=renderToStaticMarkup(tree);assert.match(html,/读取原会话结果/);assert.match(html,/重试记忆整理/);assert.match(html,/正在验证/)
  const visit=node=>{if(!node||typeof node!=='object')return;const text=node.props?.children;if(node.props?.onClick&&JSON.stringify(text)==='"读取原会话结果"')node.props.onClick();if(node.props?.onClick&&JSON.stringify(text)==='"重试记忆整理"')node.props.onClick();React.Children.forEach(node.props?.children,visit)}
  visit(tree);assert.deepEqual(JSON.parse(JSON.stringify(actions)),[['retryMemory',{id:'p'}],['reconcile',{id:'p',taskId:'t',timeoutMs:30000}]])
})
