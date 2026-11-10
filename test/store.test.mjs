import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Store} from '../src/store.mjs'
const seed={schema:1,roles:[],drafts:[],plans:[],memories:[],settings:{}}
test('two live services cannot overwrite the same state directory',async t=>{const dir=await mkdtemp(join(tmpdir(),'team-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));const a=await new Store(dir).init(seed);await assert.rejects(()=>new Store(dir).init(seed),/in use|占用/);await a.close();const b=await new Store(dir).init(seed);await b.close()})
test('stale process lock is recovered while corrupt state fails explicitly',async t=>{const dir=await mkdtemp(join(tmpdir(),'team-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(join(dir,'state.lock'),JSON.stringify({pid:2147483647,token:'stale'}));const a=await new Store(dir).init(seed);await a.close();await writeFile(join(dir,'state.json'),'{bad json');await assert.rejects(()=>new Store(dir).init(seed),/JSON|Unexpected|position/);await writeFile(join(dir,'state.json'),JSON.stringify(seed));const b=await new Store(dir).init(seed);await b.close()})
