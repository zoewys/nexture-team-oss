export function installStyles() {
 const existing=document.querySelector('style[data-nexture-team]')
 if(existing){existing.textContent=__TEAM_CSS__;return}
 const style=document.createElement('style');style.dataset.nextureTeam='';style.textContent=__TEAM_CSS__;document.head.append(style)
}
