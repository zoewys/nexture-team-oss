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

1. 选择「创建角色」，设置职责、提示词、Skills、执行方式、模型和记忆开关。预览后确认创建。
2. 在 DSH 对话中输入 `@` 选择角色，也可以从角色卡点击「与他对话」。简单咨询可以直接回答。
3. 对需要执行的工作，DSH 会先提出分工，再按原对话的审批设置确认和派发。角色创建、修改和长期规则变更需要用户确认。
4. 在「任务分工」查看进度、结果和执行会话。任务可以独立并行，也可以声明前置依赖。

角色记忆默认归该角色，项目记忆仅在匹配的项目读取。关闭自动积累后，已有记忆仍可查看和编辑。角色、记忆和任务状态默认保存在本机 `$DSH_HOME/nexture-team`，未设置 `DSH_HOME` 时使用 `~/.dsh/nexture-team`。插件配置 `stateDir` 可以指定其他目录。这些数据以明文保存在本机。

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
