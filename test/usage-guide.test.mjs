import test from 'node:test'
import assert from 'node:assert/strict'
import {createUsageGuide, guideStorageKey, isNewWorkspace} from '../src/client/usage-guide.mjs'
const fresh = {roles:[{id:'creator',builtin:'creator'},{id:'memory',builtin:'memory'}],drafts:[],plans:[]}
const existing = {...fresh,roles:[...fresh.roles,{id:'my-role'}]}
function store() {const data=new Map();return {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)}}
test('waits for valid successful state and only opens once',()=>{
 const guide=createUsageGuide(()=>store())
 assert.equal(guide.takeFirstLook(null),false)
 assert.equal(guide.takeFirstLook({}),false)
 assert.equal(guide.takeFirstLook(fresh,{enabled:false}),false)
 assert.equal(guide.takeFirstLook(fresh),true)
 assert.equal(guide.takeFirstLook(fresh),false)
})
test('does not interrupt existing users, even after they empty the workspace',()=>{
 const guide=createUsageGuide(()=>store())
 assert.equal(isNewWorkspace(existing),false)
 assert.equal(guide.takeFirstLook(existing),false)
 assert.equal(guide.takeFirstLook(fresh),false)
 assert.equal(isNewWorkspace({...fresh,plans:[{id:'plan-1'}]}),false)
})
test('remembers seen state across mounts; opening help manually also counts',()=>{
 const storage=store()
 assert.equal(createUsageGuide(()=>storage).takeFirstLook(fresh),true)
 assert.equal(storage.getItem(guideStorageKey),'seen')
 assert.equal(createUsageGuide(()=>storage).takeFirstLook(fresh),false)
 const manualStorage=store(),guide=createUsageGuide(()=>manualStorage)
 guide.markSeen()
 assert.equal(createUsageGuide(()=>manualStorage).takeFirstLook(fresh),false)
})
test('storage errors do not prevent using the plugin or repeat the tour on this page',()=>{
 for(const storage of [()=>{throw Error('denied')},()=>({getItem(){throw Error('denied')},setItem(){throw Error('full')}}),()=>undefined]){
  const guide=createUsageGuide(storage)
  assert.equal(guide.takeFirstLook(fresh),true)
  assert.doesNotThrow(()=>guide.markSeen())
  assert.equal(guide.takeFirstLook(fresh),false)
 }
})

test('role drafts also count as existing work',()=>assert.equal(isNewWorkspace({...fresh,drafts:[{id:'draft-1'}]}),false))
