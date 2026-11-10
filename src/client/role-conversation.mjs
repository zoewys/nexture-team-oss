import {roleMention} from './model.mjs'

/** Always allocate a fresh session; never reuse a blank with an existing draft. */
export async function openRoleConversation(ctx,role,project) {
 const ref=roleMention(role)
 const prompt={text:`${ref} `,references:[{source:'nexture-team',ref,label:role.name,appearance:'session',clipboardText:ref,offset:0,length:ref.length}]}
 const sessionId=await ctx.sessions.create(conversationTarget(ctx,project))
 await ctx.sessions.using(sessionId,{source:'nexture-team:role-conversation'},async({binding})=>{
  const result=ctx.conversation.input.requestDraftInitialization(binding,{prompt})
  if(result!=='applied')throw new Error('无法在新对话中填入角色，请重试。')
  ctx.uiWorkspace.openSession(sessionId)
 })
 return sessionId
}

function conversationTarget(ctx,project) {
 const current=ctx.uiWorkspace.selection?.getSnapshot().sessionId
 const summaries=ctx.sessions.list?.getSnapshot().byId||{}
 const items=ctx.workspaces?.list.getSnapshot().items||[]
 const cwd=project||summaries[current]?.cwd
 const active=items.find(item=>cwd&&item.path===cwd)||items.find(item=>item.sessionIds.includes(current))
 const latest=active||[...items].sort((a,b)=>lastUsed(b)-lastUsed(a))[0]
 if(latest)return {workspaceId:latest.workspaceId}
 throw new Error('请先在 DSH 中添加工作区，再与角色对话。')
 function lastUsed(item){return Math.max(0,...item.sessionIds.map(id=>summaries[id]?.updatedAt||0))}
}
