import {isAbsolute} from 'node:path'
import {pathToFileURL} from 'node:url'
import {realpath} from 'node:fs/promises'

/** Select the host-loaded CLI entry without sharing state between module copies. */
export function createCliBridgeReader(cliModule='',{ctx}={}) {
  if(typeof cliModule!=='string')throw new Error('cliModule must be an absolute CLI entry path')
  const entry=cliModule.trim()
  if(entry&&!isAbsolute(entry))throw new Error('cliModule must be an absolute CLI entry path')
  const explicit=entry?pathToFileURL(entry).href:null
  return async()=>{
    const live=ctx?.reflect?.get?.('nextureCliTeam')
    if(live?.entry&&typeof live.getBridge==='function'){
      // Respect an explicit other installation; never use another scope's CLI.
      if(!entry||await realpath(entry)===await realpath(live.entry))return live.getBridge()||null
    }
    let target=explicit
    if(!target)try{target=import.meta.resolve('nexture-cli')}catch(error){
      // Missing optional package is supported; errors within a found package are not.
      if(error.code==='ERR_MODULE_NOT_FOUND')return null
      throw error
    }
    const module=await import(target)
    return module.getTeamBridge?.()||null
  }
}
