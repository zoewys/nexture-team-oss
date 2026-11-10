import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {build} from 'esbuild'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

const result=await build({entryPoints:['src/client/components.jsx'],bundle:true,write:false,platform:'browser',format:'cjs',external:['react']})
const module={exports:{}}
vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:()=>({...React,useId:()=>':test:'})})
const catalog={executions:[{id:'dsh',available:true},{id:'pi',available:true},{id:'codex',available:true},{id:'kimi',available:true,defaultModel:'kimi-shared'}],models:[
 {execution:'dsh',provider:'host',id:'shared',label:'Host shared'},
 {execution:'kimi',id:'shared',label:'Kimi shared'},
 {execution:'pi',id:'pi-model',label:'Pi model'},
 {execution:'codex',id:'codex-model',label:'Codex model'},
]}
function fields(execution,extra={}){
 const calls=[]
 const tree=module.exports.ExecutionFields({value:{execution,provider:'',model:'',...extra},catalog,onChange:patch=>calls.push({...patch})})
 const nodes=[]
 const walk=node=>{if(!node||typeof node!=='object')return;nodes.push(node);React.Children.forEach(node.props?.children,walk)}
 walk(tree)
 return {tree,calls,nodes,model:nodes.find(node=>node.type==='input'&&node.props.list),select:nodes.find(node=>node.type==='select')}
}

test('each execution field offers only its own models and hides CLI provider fields',()=>{
 for(const [execution,expected] of [['dsh','Host shared'],['kimi','Kimi shared'],['pi','Pi model'],['codex','Codex model']]){
  const f=fields(execution),list=f.nodes.find(node=>node.type==='datalist')
  assert.ok(list,'model suggestions belong to the field, not the global mixed catalog')
  const options=f.nodes.filter(node=>node.type==='option'&&node.props.children===expected)
  assert.equal(options.length,1)
  const html=renderToStaticMarkup(f.tree)
  for(const label of ['Host shared','Kimi shared','Pi model','Codex model'])assert.equal(html.includes(label),label===expected)
  assert.equal(html.includes('沿用默认 Provider'),execution==='dsh')
  assert.equal(f.model.props.list,list.props.id)
 }
})

test('CLI known and handwritten model choices clear DSH provider identity',()=>{
 for(const execution of ['kimi','pi','codex']){
  const f=fields(execution,{provider:'old-host'})
  for(const model of ['shared','custom-model']){
   f.model.props.onChange({target:{value:model}})
   assert.deepEqual(f.calls.at(-1),{model,provider:''})
  }
 }
})

test('DSH model pairing ignores CLI models with the same ID and accepts legacy catalogs',()=>{
 const f=fields('dsh');f.model.props.onChange({target:{value:'shared'}})
 assert.deepEqual(f.calls.at(-1),{model:'shared',provider:'host'})
 const legacy={...catalog,models:[{provider:'legacy-host',id:'legacy-model'}]},calls=[]
 const tree=module.exports.ExecutionFields({value:{execution:'dsh'},catalog:legacy,onChange:patch=>calls.push({...patch})})
 const walk=node=>{if(!node||typeof node!=='object')return;if(node.type==='input'&&node.props.list)node.props.onChange({target:{value:'legacy-model'}});React.Children.forEach(node.props?.children,walk)}
 walk(tree);assert.deepEqual(calls,[{model:'legacy-model',provider:'legacy-host'}])
})

test('changing execution clears the previous route before selecting a new model',()=>{
 for(const [from,to] of [['dsh','kimi'],['kimi','dsh'],['pi','codex']]){
  const f=fields(from,{provider:'host',model:'previous-model'})
  f.select.props.onChange({target:{value:to}})
  assert.deepEqual(f.calls.at(-1),{execution:to,model:'',provider:''})
 }
})
