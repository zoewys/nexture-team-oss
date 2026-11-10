import React,{useEffect} from 'react'
import TeamApp from './App.jsx'
import {teamApi} from './api.mjs'
import {composerBridge} from './composer.mjs'
import {openRoleConversation} from './role-conversation.mjs'
import {createRoleSource} from './model.mjs'
import {Icon} from './icons.jsx'
import {installStyles} from './style.mjs'
import ConfirmationCard from './ConfirmationCard.jsx'
import {selectTeamConfirmation} from './confirmation-card.mjs'
export const inject=['slots','layout','uiConversation','inputTriggers','sessions','conversation','uiWorkspace','workspaces']
function FixedChatView({renderSlot}) {return renderSlot('conversation.session',{view:'chat'})}
function EmbeddedChat({sessionId,useSession,useConversation,useSessions,inputActions,renderFactorySlot}) {
 const session=useSession(s=>s),conversation=useConversation(s=>s),project=useSessions(s=>sessionId?s.byId[sessionId]?.cwd:undefined)
 useEffect(()=>composerBridge.connect({sessionId,inputActions,project}),[sessionId,inputActions,project])
 const active=Boolean(conversation?.activeTargets?.size||session&&!session.blank&&!session.awaitingFirstTurn||session?.running)
 const blank=!session||!conversation||!active&&!session.promptAttempted
 const settling=Boolean(sessionId&&blank&&session?.openState==='loading'),hero=!sessionId||blank&&session?.openState==='open'
 return <div className="nt-dsh-chat">{renderFactorySlot('conversation.content',{variant:'embedded',phase:settling?'settling':hero?'hero':'active',hero},{slots:{views:FixedChatView}})}</div>
}
function Panel({renderSlot,onTalk}) {return <TeamApp onTalk={onTalk} chat={renderSlot('nexture-team.chat',{})}/>}

function TeamIcon(){return <Icon name="team" size={20}/>}
export function apply(ctx) {
 installStyles()
 ctx.slots.inject('conversation.composer',()=>ctx.slots.register({name:'conversation.composer',priority:-10,select:selectTeamConfirmation},ConfirmationCard))
 ctx.effect(()=>ctx.inputTriggers.registerSource(createRoleSource(teamApi)),'nexture-team: role mentions')
 ctx.slots.inject('main',function*(){yield ctx.slots.register({name:'main',key:'nexture-team',inject:()=>({onTalk:(role,project)=>openRoleConversation(ctx,role,project)}),children:{'nexture-team.chat':{kind:'single',scope:'session-maybe'}}},Panel);yield ctx.slots.register({name:'nexture-team.chat'},EmbeddedChat)})
 ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'nexture-team',order:1,label:()=> 'Nexture Team'},TeamIcon))
}
