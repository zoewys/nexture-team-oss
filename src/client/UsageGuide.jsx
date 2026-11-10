import React,{useState} from 'react'
import {Button,Modal} from './components.jsx'

const steps=[
 {label:'认识团队',title:'把常做的事，交给固定的角色',body:<><p>Nexture Team 帮你保存角色的职责、工作习惯和经验，下次遇到同类任务可以继续找它。</p><p>直接使用 DSH 就能开始。只有需要调用本机 Codex、Claude Code 等助手时，才需要另外配置 Nexture CLI。</p></>},
 {label:'创建角色',title:'先从一个常用角色开始',body:<><p>点「创建角色」填写名字、职责和执行方式；也可以找内置的「角色顾问」，用对话整理角色草案。</p><p>例如：创建一个产品研究员，负责整理用户需求、比较方案，并说明建议的依据。</p><p>角色创建和修改都需要你确认，确认后才正式加入团队。</p></>},
 {label:'安排任务',title:'在原生对话里，直接找它',body:<><p>在 DSH 对话输入 <kbd>@</kbd> 选择角色，或在角色卡片上点「与他对话」。普通咨询可以直接聊。</p><p>需要多人配合时，说清楚目标和分工。任务计划按原对话的审批设置处理；在「任务分工」里查看执行情况和结果。</p></>},
 {label:'积累经验',title:'任务做完，经验留给角色',body:<><p>每个角色有自己的私有记忆。长期角色可跨项目复用，临时角色适合一次性任务。</p><p>在角色配置中可查看记忆，调整「自动积累」。关闭后停止新增，已有经验仍可读取；长期规则的变更需要你确认。</p><p>随时可从页面顶部的「使用说明」重新查看这份引导。</p></>},
]

export default function UsageGuide({onClose,onCreateRole}){
 const [index,setIndex]=useState(0),step=steps[index]
 return <Modal title="Nexture Team 使用说明" subtitle="从第一个角色开始，让团队越用越顺手。" onClose={onClose}>
  <div className="nt-modal-body nt-usage-guide">
   <ol className="nt-guide-steps" aria-label="使用步骤">{steps.map((item,i)=><li key={item.label}><button aria-current={index===i?'step':undefined} onClick={()=>setIndex(i)}><span>{i+1}</span>{item.label}</button></li>)}</ol>
   <section className="nt-guide-copy" aria-live="polite" aria-atomic="true"><small>第 {index+1} / {steps.length} 步</small><h3>{step.title}</h3>{step.body}</section>
   {index===1&&<Button onClick={onCreateRole}>去创建角色</Button>}
  </div>
  <footer className="nt-modal-foot nt-guide-foot"><Button onClick={onClose}>稍后再看</Button><div><Button disabled={index===0} onClick={()=>setIndex(i=>i-1)}>上一步</Button><Button primary onClick={()=>index===steps.length-1?onClose():setIndex(i=>i+1)}>{index===steps.length-1?'开始使用':'下一步'}</Button></div></footer>
 </Modal>
}
