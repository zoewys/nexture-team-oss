import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createCliBridgeReader} from '../src/cli-bridge.mjs'

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'team-cli-module-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const source='let current=null; export const getTeamBridge=()=>current; export const bind=value=>{current=value}'
  const installed=join(dir,'installed.mjs'),active=join(dir,'active.mjs')
  await Promise.all([writeFile(installed,source),writeFile(active,source)])
  return {dir,installed,active}
}

test('explicit active CLI shares its live bridge instead of the inactive installed copy',async t=>{
  const {installed,active}=await fixture(t)
  const old=await import(pathToFileURL(installed).href),live=await import(pathToFileURL(active).href)
  const bridge={version:1,kinds:['codex'],prepare(){},start(){},prompt(){},output(){}}
  live.bind(bridge)
  assert.equal(old.getTeamBridge(),null)
  const read=createCliBridgeReader(active)
  assert.equal(await read(),bridge)
  live.bind(null)
  assert.equal(await read(),null)
  const replacement={...bridge,version:2}
  live.bind(replacement)
  assert.equal(await read(),replacement)
})

test('broken explicit CLI entry never falls back to an installed package',async t=>{
  const {dir}=await fixture(t)
  await assert.rejects(createCliBridgeReader(join(dir,'missing.mjs')),/missing\.mjs/)
})

test('CLI entry must be absolute so resolution cannot silently select another package',()=>{
  assert.throws(()=>createCliBridgeReader('./another-copy.mjs'),/absolute|绝对/)
})

test('a missing dependency inside an explicit CLI entry is reported',async t=>{
  const {dir}=await fixture(t),entry=join(dir,'broken.mjs')
  await writeFile(entry,"import 'nexture-missing-transitive-dependency'; export const getTeamBridge=()=>null")
  await assert.rejects(createCliBridgeReader(entry),/nexture-missing-transitive-dependency/)
})

test('default lookup permits an absent optional CLI package',async()=>{
  assert.equal(await createCliBridgeReader()(),null)
})

test('host service shares live CLI across module copies, remains scoped and honors explicit entry',async t=>{
 const {active,installed}=await fixture(t),bridge={kinds:['codex']};let live={entry:active,getBridge:()=>bridge}
 const ctx={reflect:{get(name){assert.equal(name,'nextureCliTeam');return live}}}
 assert.equal(await createCliBridgeReader(active,{ctx})(),bridge)
 assert.equal(await createCliBridgeReader('',{ctx})(),bridge)
 assert.equal(await createCliBridgeReader(installed,{ctx})(),null)
 live=null;assert.equal(await createCliBridgeReader(active,{ctx})(),null)
})
