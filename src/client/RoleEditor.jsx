import React,{useState} from 'react'
import {Badge,Button,ErrorNotice,ExecutionFields,Field,Modal,RoleAvatar,Toggle} from './components.jsx'
import {roleFromForm} from './model.mjs'
import MemoryPanel from './MemoryPanel.jsx'
import {Icon} from './icons.jsx'
const blank={name:'',type:'longterm',prompt:'',skills:[],execution:'dsh',model:'',provider:'',autoMemory:true,enabled:true}
export default function RoleEditor({role,draft:initialDraft,catalog,sourceSession,api,onChanged,onClose,inline=false,onTalk}) {
 const [draft,setDraft]=useState(initialDraft||null),[editing,setEditing]=useState(!initialDraft),[value,setValue]=useState({...blank,...(initialDraft?.role||role),skills:(initialDraft?.role?.skills||role?.skills||[]).join(', ')}),[busy,setBusy]=useState(false),[error,setError]=useState(null)
 const roleId=draft?.roleId||role?.id
 const change=patch=>setValue(v=>({...v,...patch}))
 async function save(e) {
  e.preventDefault();setBusy(true);setError(null)
  try {const result=await api.action('draftRole',{role:roleFromForm(value),...(roleId?{roleId}:{}),sourceSession});const next=result.draft||result;setDraft(next);setEditing(false);if(draft&&draft.id!==next.id)await api.action('reject',{id:draft.id,version:draft.version});await onChanged()}catch(err){setError(err)}finally{setBusy(false)}
 }
 async function decide(action) {
  setBusy(true);setError(null)
  try {await api.action(action,{id:draft.id,version:draft.version});await onChanged();onClose()}catch(err){setError(err)}finally{setBusy(false)}
 }
 const preview=draft?.role||value
 const Frame=inline?RolePage:Modal
 const reset=()=>setValue({...blank,...role,skills:(role?.skills||[]).join(', ')})
 const formId='nt-role-form-'+(roleId||'new')
 return <Frame inline={inline} role={role} editing={editing} busy={busy} formId={formId} onReset={reset} onTalk={onTalk} title={editing?(roleId?'调整角色':'创建团队角色'):'确认角色草案'} subtitle={editing?'定义职责、执行方式与记忆习惯。保存后会生成待确认草案。':`版本 ${draft?.version||1} · 确认后${roleId?'更新角色配置':'加入你的团队'}`} onClose={onClose}>
  <ErrorNotice error={error}/>
  {editing?<form id={formId} onSubmit={save}><div className="nt-modal-body"><div className="nt-form-grid"><Field label="角色名称"><input autoFocus required maxLength={80} value={value.name} placeholder="如：产品研究员" onChange={e=>change({name:e.target.value})}/></Field><Field label="角色类型"><select value={value.type} onChange={e=>change({type:e.target.value,autoMemory:e.target.value==='longterm'})}><option value="longterm">长期角色</option><option value="temporary">临时角色</option></select></Field></div><Field label="职责与提示词" hint="写清这个角色擅长什么、如何工作，以及你希望的交付标准。"><textarea required rows={6} value={value.prompt} placeholder="你是一位善于寻找真实需求的产品研究员……" onChange={e=>change({prompt:e.target.value})}/></Field><Field label="Skills" hint="填写宿主中已安装的 Skill 名称，以逗号或换行分隔。"><textarea rows={2} value={value.skills} placeholder="如：research, code-review" onChange={e=>change({skills:e.target.value})}/></Field><ExecutionFields value={value} onChange={change} catalog={catalog}/><Toggle label="自动积累记忆" description="保存这个角色的私有经验。关闭后仍可读取已有记忆。" checked={value.autoMemory} onChange={autoMemory=>change({autoMemory})}/>{roleId&&<Toggle label="启用角色" description="关闭后不出现在 @ 候选中。" checked={value.enabled!==false} onChange={enabled=>change({enabled})}/>}</div>{!inline&&<footer className="nt-modal-foot"><Button type="button" onClick={onClose}>取消</Button><Button primary type="submit" disabled={busy}>{busy?'正在生成…':'预览角色草案'}</Button></footer>}</form>:<><div className="nt-modal-body"><div className="nt-role-preview"><RoleAvatar role={preview} large/><div><h3>{preview.name}</h3><span>{preview.type==='temporary'?'临时角色 · 任务完成后归档':'长期角色 · 跨项目复用'}</span></div><Badge status="proposed"/></div><dl className="nt-review"><dt>职责与提示词</dt><dd className="nt-prewrap">{preview.prompt}</dd><dt>Skills</dt><dd>{preview.skills?.length?preview.skills.join('、'):'未指定 · 使用宿主可用工具'}</dd><dt>执行方式 / 模型</dt><dd>{catalog.executions?.find(e=>e.id===preview.execution)?.label||preview.execution} / {preview.model||'沿用 DSH 默认模型'}{preview.provider&&` · ${preview.provider}`}</dd><dt>自动积累记忆</dt><dd>{preview.autoMemory?'开启 · 经验仅归这个角色':'关闭 · 已有记忆仍可读取'}</dd></dl><p className="nt-info">请检查草案。角色职责和长期规则需要你的确认才会生效。</p></div><footer className="nt-modal-foot"><Button danger onClick={()=>decide('reject')} disabled={busy}>拒绝草案</Button><div className="nt-actions"><Button icon="edit" onClick={()=>setEditing(true)} disabled={busy}>编辑草案</Button><Button primary icon="check" onClick={()=>decide('confirm')} disabled={busy}>{busy?'处理中…':roleId?'确认更新':'确认创建'}</Button></div></footer></>}
 {inline&&role&&<MemoryPanel key={role.id} role={role} api={api}/>}
 </Frame>
}

function RolePage({role,editing,busy,formId,onReset,onTalk,onClose,title,children}) {
 return <section className="nt-role-detail"><header className="nt-detail-header"><div className="nt-detail-title"><button className="nt-icon-button" aria-label="返回角色列表" onClick={onClose}><Icon name="back"/></button><RoleAvatar role={role}/><div><h1>{role.name}</h1><p>角色详情 · {role.type==='temporary'?'临时角色':'长期角色'}{role.builtin?' · 内置助手':''}</p></div></div><div className="nt-actions"><Button icon="chat" disabled={!role.enabled||role.status==='archived'} onClick={onTalk}>与他对话</Button>{editing&&<><Button icon="refresh" disabled={busy} onClick={onReset}>重置</Button><Button primary form={formId} type="submit" disabled={busy}>{busy?'正在生成…':'预览修改草案'}</Button></>}</div></header>{!editing&&<div className="nt-detail-preview-label">{title}</div>}{children}</section>
}
