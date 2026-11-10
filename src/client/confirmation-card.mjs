const approvals=new Set(['确认创建','确认修改','确认执行','确认记住'])
// Markers wrap full instructions in new drafts. Old pending drafts remain
// readable as-is; no truncation, API read or mutable draft lookup is involved.
export function confirmationSections(detail) {
 const sections=[],pattern=/<!-- nexture-team:(metadata|instructions|content):(\d+) -->\n\n([\s\S]*?)\n\n<!-- \/nexture-team:\1:\2 -->/g
 let start=0
 for(const match of detail.matchAll(pattern)){
  if(match.index>start)sections.push({text:detail.slice(start,match.index),instructions:false,metadata:false})
  sections.push({text:match[3],instructions:match[1]==='instructions',metadata:match[1]==='metadata'});start=match.index+match[0].length
 }
 if(start<detail.length)sections.push({text:detail.slice(start),instructions:false,metadata:false})
 return sections.filter(section=>section.text.trim())
}
// Use the host's live answer channel. Other plugins, timed questions and
// unfamiliar contracts keep their native renderer.
export function selectTeamConfirmation({pendingInteraction:p}) {
 if(!p||p.questions?.length!==1||!['getSnapshot','subscribe','answer','dismiss'].every(k=>typeof p[k]==='function'))return null
 const q=p.questions[0]
 if(!/^nexture-team-.+-v\d+$/.test(q.id||'')||q.multiSelect||typeof q.detail!=='string'||q.options?.length!==2||!approvals.has(q.options[0].label)||q.options[1].label!=='返回调整'||p.getSnapshot().countdown)return null
 return p
}
export async function answerTeamConfirmation(p,label) {
 const state=p.getSnapshot()
 if(!selectTeamConfirmation({pendingInteraction:p})||p.review!==undefined||state.closed||!['waterfall','rpc'].includes(state.channel)||!p.questions[0].options.some(o=>o.label===label))throw new Error('这份草案当前不可提交，请重新打开确认卡。')
 return p.answer({answers:[{id:p.questions[0].id,selected:[label]}]})
}
