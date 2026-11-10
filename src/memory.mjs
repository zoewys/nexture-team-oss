export function selectMemories(rows,roleId,project,budget=6000,query=''){
  const terms=query.toLowerCase().split(/\s+/).filter(Boolean)
  const score=m=>(m.project?2:0)+terms.filter(t=>m.text.toLowerCase().includes(t)).length
  const eligible=rows.filter(m=>m.roleId===roleId&&(!m.project||m.project===project)).sort((a,b)=>score(b)-score(a)||(b.updatedAt||'').localeCompare(a.updatedAt||''))
  const selected=[];let size=0
  for(const row of eligible){if(size+row.text.length>budget)continue;selected.push(structuredClone(row));size+=row.text.length}
  return selected
}
export function parseMemorySuggestions(text){
  const suggestions=[],output=String(text||'').replace(/<team-memory>([\s\S]*?)<\/team-memory>/g,(_,body)=>{try{const a=JSON.parse(body);if(Array.isArray(a))suggestions.push(...a.slice(0,8))}catch{}return ''}).trim()
  const valid=suggestions.filter(x=>x&&typeof x.text==='string'&&x.text.trim()&&x.text.length<=1200&&['experience','rule'].includes(x.kind)).slice(0,8).map(x=>({text:x.text.trim(),kind:x.kind}))
  return {output,experiences:valid.filter(x=>x.kind==='experience'),rules:valid.filter(x=>x.kind==='rule')}
}
