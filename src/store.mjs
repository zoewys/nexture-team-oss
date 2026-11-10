import {mkdir,readFile,writeFile,rename,chmod,rm,open} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'

export class Store {
  constructor(dir){this.dir=dir;this.file=join(dir,'state.json');this.lock=join(dir,'state.lock');this.token=randomUUID();this.queue=Promise.resolve();this.closed=false}
  async init(initial){
    await mkdir(this.dir,{recursive:true,mode:0o700});await chmod(this.dir,0o700)
    await this.acquire()
    try{this.data=JSON.parse(await readFile(this.file,'utf8'));if(this.data.schema!==1||!['roles','drafts','plans','memories'].every(k=>Array.isArray(this.data[k])))throw new Error('Unsupported or damaged Team state');await chmod(this.file,0o600)}
    catch(e){if(e.code!=='ENOENT'){await this.close();throw e}this.data=structuredClone(initial);try{await this.persist(this.data)}catch(error){await this.close();throw error}}
    return this
  }
  async acquire(){
    const create=async()=>{const h=await open(this.lock,'wx',0o600);try{await h.writeFile(JSON.stringify({pid:process.pid,token:this.token}))}finally{await h.close()}}
    try{await create();return}catch(e){if(e.code!=='EEXIST')throw e}
    const busy=()=>new Error('Team state is in use / 正被其他实例占用')
    let recovery
    try{
      recovery=await open(this.lock+'.recover','wx',0o600)
      let old;try{old=JSON.parse(await readFile(this.lock,'utf8'))}catch{throw busy()}
      if(!Number.isSafeInteger(old.pid)||old.pid<=0)throw busy()
      try{process.kill(old.pid,0);throw busy()}catch(e){if(e.code!=='ESRCH')throw busy()}
      await rm(this.lock,{force:true});try{await create()}catch(e){if(e.code==='EEXIST')throw busy();throw e}
    }catch(e){if(e.code==='EEXIST')throw busy();throw e}
    finally{if(recovery){await recovery.close();await rm(this.lock+'.recover',{force:true})}}
  }
  async persist(data){const temp=this.file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,this.file)}finally{await rm(temp,{force:true})}}
  update(fn){if(this.closed)return Promise.reject(new Error('Team store closed'));const op=this.queue.then(async()=>{const next=structuredClone(this.data),result=await fn(next);await this.persist(next);this.data=next;return structuredClone(result)});this.queue=op.catch(()=>{});return op}
  async close(){await this.queue;this.closed=true;try{const lock=JSON.parse(await readFile(this.lock,'utf8'));if(lock.token===this.token)await rm(this.lock,{force:true})}catch(e){if(e.code!=='ENOENT')throw e}}
}
