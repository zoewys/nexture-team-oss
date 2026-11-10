import test from 'node:test'
import assert from 'node:assert/strict'
import {selectTeamConfirmation,answerTeamConfirmation} from '../src/client/confirmation-card.mjs'
function pending(overrides={}) {
 const calls=[]
 return {questions:[{id:'nexture-team-plan-1-v2',header:'Nexture Team · 任务分工',question:'测试',detail:'完整详情',options:[{label:'确认执行'},{label:'返回调整'}]}],getSnapshot:()=>({closed:false,channel:'waterfall'}),subscribe(){},answer:answer=>calls.push(answer),dismiss(){},calls,...overrides}
}
test('only exact Team confirmations replace the native question card',()=>{
 const p=pending();assert.equal(selectTeamConfirmation({pendingInteraction:p}),p)
 for(const patch of [{questions:[{...p.questions[0],id:'cli-plan-1-v2'}]},{questions:[{...p.questions[0],options:[{label:'确认执行'},{label:'其他选项'}]}]},{getSnapshot:()=>({countdown:{remaining:10}})},{questions:[...p.questions,...p.questions]},{questions:[{...p.questions[0],multiSelect:true}]}])assert.equal(selectTeamConfirmation({pendingInteraction:pending(patch)}),null)
})
test('buttons answer the exact native question without approving on the HTTP API',async()=>{
 const p=pending();await answerTeamConfirmation(p,'确认执行');assert.deepEqual(p.calls,[{answers:[{id:p.questions[0].id,selected:['确认执行']}]}])
 const back=pending();await answerTeamConfirmation(back,'返回调整');assert.equal(back.calls[0].answers[0].selected[0],'返回调整')
 for(const patch of [{review:[]},{getSnapshot:()=>({closed:true,channel:'waterfall'})},{getSnapshot:()=>({channel:'none'})}]){const stale=pending(patch);await assert.rejects(()=>answerTeamConfirmation(stale,'确认执行'));assert.equal(stale.calls.length,0)}
 await assert.rejects(()=>answerTeamConfirmation(p,'确认创建'));assert.equal(p.calls.length,1)
})

test('draft review keeps complete Markdown instructions and groups execution metadata',async()=>{
 const {draftDetail}=await import('../src/confirmation.mjs')
 const prompt='## 存量事实\n\n- 保留 `site-id`\n- 不重复提交\n\n最后的验收要求'
 const detail=draftDetail({kind:'plan',project:'/tmp/a|b',tasks:[{id:'a',roleSnapshot:{name:'研究员'},title:'核查',execution:'pi',model:'test',mode:'read',prompt,criteria:'输出证据'},{id:'b',roleSnapshot:{name:'审核员'},title:'复核',execution:'dsh',mode:'read',prompt:'复核结论',criteria:'标注风险',dependsOn:['a']}]})
 assert.ok(detail.includes(prompt));assert.match(detail,/\| 执行 \| Pi/);assert.match(detail,/\| 前置任务 \| 任务 1/);assert.ok(detail.includes('/tmp/a\\|b'));assert.ok(detail.includes('输出证据'))
})

test('long instructions are collapsible without truncating content or treating prompt tables as metadata',async()=>{
 const {confirmationSections}=await import('../src/client/confirmation-card.mjs')
 const {draftDetail}=await import('../src/confirmation.mjs')
 const prompt='## 完整说明\n\n| 列一 | 列二 |\n| --- | --- |\n| a | b |\n\n最后一行'
 const detail=draftDetail({kind:'plan',project:'/tmp',tasks:[{roleSnapshot:{name:'研究员'},title:'核查',execution:'dsh',mode:'read',prompt,criteria:'可追溯'}]})
 const sections=confirmationSections(detail)
 assert.equal(sections.filter(s=>s.instructions).length,1)
 assert.equal(sections.find(s=>s.instructions).text,prompt)
 assert.equal(confirmationSections('旧版详情')[0].text,'旧版详情')
})

test('code, role tables and marker-like text remain complete in review sections',async()=>{
 const {draftDetail}=await import('../src/confirmation.mjs'),{confirmationSections}=await import('../src/client/confirmation-card.mjs')
 const prompt='`a < b && c > d`\n\n```html\n<span>example & text</span>\n```\n\n<!-- /nexture-team:instructions:0 -->\n\n| 职责 | 要求 |\n| --- | --- |\n| 研究 | 核查 |'
 const role={name:'研究员',type:'longterm',skills:[],execution:'dsh',prompt,autoMemory:false}
 const parts=confirmationSections(draftDetail({kind:'role',role}))
 assert.equal(parts.filter(p=>p.metadata).length,1)
 assert.ok(parts.some(p=>!p.metadata&&p.text.includes(prompt)))
 const task=confirmationSections(draftDetail({kind:'plan',project:'/tmp',tasks:[{roleSnapshot:role,title:'研究',prompt,execution:'dsh',mode:'read'}]})).find(p=>p.instructions)
 assert.equal(task.text,prompt)
 assert.equal(confirmationSections(prompt)[0].metadata,false)
})
