# Nexture Team

Nexture Team 是一个 DeepSeek Harness（DSH）插件，用来建立可以跨项目复用的 Agent 团队。把开发、审查、调研等常用分工建成角色，就能在不同工作区继续使用同一套职责、提示词和 Skills。

- **角色与对话** — 支持长期和临时角色，可按用途分组。在同一个工作区里，每位角色都有可复用的独立对话，适合持续咨询同一个角色。
- **角色模型** — 每位角色可以独立选模型，也可以沿用主会话模型。启用 [External Agents](https://github.com/zoewys/dsh-external-agents) 0.2.0 后，可为角色选择 Kimi Code 或 Codex。
- **任务分工** — 在主会话提出分工，按该会话的审批设置执行。子任务可以并行，也可以按依赖执行。在「任务分工」查看执行角色、进度和结果。
- **本地记忆** — 可让角色积累自己的工作经验。记忆默认归该角色，项目记忆在匹配的项目中使用。

例如，先把功能实现交给开发角色，再让审查角色检查改动。下次进入这个工作区时，可以打开审查角色的对话，接着上次的讨论继续咨询。

## 演示视频

展示如何与每个角色单独对话、切换并继续以前的聊天，以及角色配置、本地记忆、任务分工和多模型搭配。

https://github.com/user-attachments/assets/90397028-3d88-41dd-98b4-5e8fe8210421

[下载 MP4（约 36 秒，静音）](https://raw.githubusercontent.com/zoewys/nexture-team-oss/main/docs/media/nexture-team-demo.mp4)

## 安装

需要 Node.js 20 或更新版本，以及支持插件的 DSH（`>=0.2.1-rc.3 <1.0.0-0`）。

```sh
git clone https://github.com/zoewys/nexture-team-oss.git
cd nexture-team-oss
npm ci
npm run build
npm pack
```

在 DSH 的「插件 → 添加插件」中选择生成的 `nexture-team-*.tgz`，启用插件和组件，再从侧栏打开「Nexture Team」。

## 使用

1. 在 DSH 中选择工作区并绑定主会话。从「团队总览」选择角色，点击「打开对话」，就能向角色咨询。
2. 在「角色资料 → 更改模型」里确认模型设置。新配置会用于角色的后续消息和新任务。
3. 在左下角打开「兼容主会话」，用 `@` 引用角色。可以请 Team 拟定角色或分工草案，并从这里发起项目任务。创建角色、修改职责或变更长期规则需要用户确认。

角色记忆默认归该角色，项目记忆仅在匹配的项目读取。关闭自动积累后，已有记忆仍可在角色资料中查看。角色、对话、记忆和任务状态默认保存在本机 `$DSH_HOME/nexture-team`，未设置 `DSH_HOME` 时使用 `~/.dsh/nexture-team`。插件配置 `stateDir` 可以指定其他目录。这些数据以明文保存在本机。

## 开发

```sh
npm ci
npm test
npm run build
npm run dev -- --port 5841 --seed
```

本地预览使用模拟任务。原生角色聊天、`@` 选择和真实任务执行需要 DSH 宿主。

使用 [MIT 许可证](LICENSE)。
