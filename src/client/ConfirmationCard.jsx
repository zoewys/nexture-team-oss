import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {MarkdownText} from '@deepseek-ai/dsh-client-ui-primitives'
import {answerTeamConfirmation,confirmationSections} from './confirmation-card.mjs'
import {Icon} from './icons.jsx'
const labels={code:{copyLabel:'复制',copiedLabel:'已复制',toolbarLabels:{codeLabel:'任务内容',wrapLabel:'换行',unwrapLabel:'取消换行'}},footnotes:'注释'}
export default function ConfirmationCard({matched}) {return <Card key={matched.key} pending={matched}/>}
function Card({pending}) {
 const card=useSyncExternalStore(pending.subscribe,pending.getSnapshot,pending.getSnapshot)
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[minimized,setMinimized]=useState(false)
 const locked=useRef(false),sentVia=useRef(null)
 const question=pending.questions[0],review=pending.review!==undefined,approve=question.options[0].label
 useEffect(()=>{if(sentVia.current==='waterfall'&&card.state==='continued'){sentVia.current=null;locked.current=false;setBusy('');setError('请求状态已变化，请检查草案后重新提交。')}},[card.state])
 async function answer(label) {
  if(locked.current)return
  locked.current=true;setBusy(label);setError('')
  const channel=pending.getSnapshot().channel;sentVia.current=channel
  try{await answerTeamConfirmation(pending,label);if(channel==='rpc'){await pending.dismiss();setBusy('');locked.current=false}}
  catch(e){sentVia.current=null;locked.current=false;setBusy('');setError(e.message)}
 }
 async function close(){if(locked.current)return;try{await pending.dismiss()}catch(e){setError(e.message)}}
 if(card.closed)return null
 const disabled=Boolean(busy)||!['waterfall','rpc'].includes(card.channel)
 return <div className="nt-confirm-seat"><section className="nt-confirm" aria-label="Nexture Team 草案确认">
  <header><div className="nt-confirm-heading"><div className="nt-confirm-eyebrow"><Icon name="team" size={14}/>{review?'Nexture Team · 已回答的草案':question.header}</div><h2>{question.question}</h2></div><div className="nt-confirm-tools"><button aria-label={minimized?'展开草案':'收起草案'} aria-expanded={!minimized} onClick={()=>setMinimized(v=>!v)}>{minimized?'⌃':'⌄'}</button><button aria-label="关闭草案确认卡" disabled={Boolean(busy)} onClick={close}>×</button></div></header>
  {!minimized&&<><div className="nt-confirm-body" tabIndex={0} role="region" aria-label="草案完整内容">{confirmationSections(question.detail).map((section,index)=>section.instructions?<details className="nt-confirm-instructions" key={index}><summary>查看完整任务说明</summary><MarkdownText text={section.text} variant="compact" labels={labels}/></details>:<div className={section.metadata?"nt-confirm-meta":"nt-confirm-prose"} key={index}><MarkdownText text={section.text} variant="compact" labels={labels}/></div>)}</div>{error&&<p className="nt-confirm-error" role="alert">{error}</p>}<footer><span>{review?(pending.review[0]?.selected?.join('、')||'未确认'):'请核对草案，确认后生效'}</span>{!review&&<div><button disabled={disabled} onClick={()=>answer('返回调整')}>{busy==='返回调整'?'提交中…':'返回调整'}</button><button className="nt-confirm-approve" disabled={disabled} onClick={()=>answer(approve)}>{busy===approve?'提交中…':approve}</button></div>}</footer></>}
 </section></div>
}
