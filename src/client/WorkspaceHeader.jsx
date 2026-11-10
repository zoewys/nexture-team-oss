import React from 'react'
import {Icon} from './icons.jsx'
export default function WorkspaceHeader({items,selected,onNavigate,children}) {
 return <header className="nt-workspace-header"><div className="nt-workspace-brand"><Icon name="team" size={21}/><span>Nexture <b>Team</b></span></div><nav className="nt-workspace-nav" aria-label="团队导航">{items.map(item=><button key={item.id} aria-label={item.label} aria-current={selected===item.id?'page':undefined} className={`nt-nav ${selected===item.id?'selected':''}`} onClick={()=>onNavigate(item.id)}><Icon name={item.icon} size={17}/><span>{item.label}</span>{item.count!==undefined&&<em>{item.count}</em>}</button>)}</nav><div className="nt-workspace-actions nt-actions">{children}</div></header>
}
