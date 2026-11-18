# Nexture Team

Nexture Team 是一个 DSH 插件，用来管理角色、分配任务和保存角色记忆。可以使用 DSH 原生智能体执行，也可以安装 Nexture CLI 连接本机的编程终端。

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

1. 从「团队总览」选择角色，点击「打开对话」。同一个工作区里，每位角色复用自己的对话记录。发送消息需要绑定一个 DSH 主会话。
2. 在「角色资料 → 更改模型」里，可以为角色选择模型，或沿用主会话模型。安装外部 Agent 插件 0.2.0 后，可用 Kimi Code 和 Codex 的 ACP 模型运行 DSH 原生角色。确认更改后，新消息和新任务会使用保存的模型。
3. 在左下角打开「兼容主会话」，可以用 `@` 引用角色，也可以请 Team 提出创建角色、修改职责或任务分工的草案。角色创建、修改和长期规则变更需要用户确认。任务分工沿用主会话的审批设置。

角色对话用于咨询。需要执行项目任务时，在兼容主会话提出分工。任务支持并行，也可以声明前置依赖。

角色记忆默认归该角色，项目记忆仅在匹配的项目读取。关闭自动积累后，已有记忆仍可在角色资料中查看。角色、对话、记忆和任务状态默认保存在本机 `$DSH_HOME/nexture-team`，未设置 `DSH_HOME` 时使用 `~/.dsh/nexture-team`。插件配置 `stateDir` 可以指定其他目录。这些数据以明文保存在本机。

## 可选的 Nexture CLI 联动

仅使用 DSH 原生角色时，单独安装 Nexture Team 即可。要把任务交给本机 CLI，请在同一个 DSH profile 安装并启用 [Nexture CLI 公开版](https://github.com/zoewys/nexture-cli-oss)。在角色或任务设置里选择 Pi、Codex 或 Kimi Code，实际可用选项由 CLI 提供的活动桥接决定。终端、接管和 CLI 原生权限由 Nexture CLI 管理。

源码开发时，如果 DSH 通过绝对路径加载 CLI，可以在 Team 插件的本机配置中设置 `cliModule`，指向同一份 CLI 的 `src/console-plugin.mjs` 绝对路径。普通插件安装通过宿主服务发现 CLI。

## 开发

```sh
npm ci
npm test
npm run build
npm run dev -- --port 5841 --seed
```

本地预览使用模拟任务。原生角色聊天、`@` 选择和真实任务执行需要 DSH 宿主。

使用 [MIT 许可证](LICENSE)。
