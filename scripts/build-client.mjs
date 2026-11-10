import {build} from 'esbuild'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {resolve,dirname} from 'node:path'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const css=await readFile(resolve(root,'src/client/styles.css'),'utf8')
const options={absWorkingDir:root,bundle:true,platform:'browser',target:'chrome120',jsx:'transform',minify:true,define:{'process.env.NODE_ENV':'"production"',__TEAM_CSS__:JSON.stringify(css)},logLevel:'info'}
await mkdir(resolve(root,'client'),{recursive:true})
const plugin=await build({...options,entryPoints:['src/client/plugin.jsx'],format:'cjs',external:['react','react-dom','react/jsx-runtime','@deepseek-ai/dsh-client-ui-primitives'],write:false})
await writeFile(resolve(root,'client/client.js'),`window.__ModuleLoader__.load({id:'nexture-team',factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${plugin.outputFiles[0].text}\nreturn module.exports;}});\n`)
await build({...options,entryPoints:['src/client/dev.jsx'],format:'iife',outfile:'client/dev.js'})
console.log('Built DSH client/client.js and standalone client/dev.js')
