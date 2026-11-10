const directProviders=new Set(['nexture-codex-cli','nexture-codex-terminal','nexture-claude-terminal','nexture-pi-terminal','nexture-grok-terminal','nexture-agy-terminal','nexture-kimi-terminal'])
export const isDirectProvider=provider=>directProviders.has(provider)
export function assertDshProvider(provider){
 if(isDirectProvider(provider))throw Error('该模型接口仅支持直接聊天，不能执行 Team 角色任务。请使用角色的 CLI 执行方式，或选择支持 DSH 子任务的模型；未启动任务。')
}
