<p align="center">
  <img src="Bari.png" alt="Bari - AkashaCorporation harness" width="720">
</p>

<h1 align="center">Bari</h1>
<p align="center">面向软件工程的 AI Agent 工作台，为安全研究与逆向工程而生。</p>
<p align="center">
  <a href="#快速开始">开始使用</a> |
  <a href="docs/README.md">文档</a> |
  <a href="docs/examples.md">示例</a> |
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>
<p align="center"><a href="README.md">English</a> | <strong>中文</strong></p>
<p align="center">
  <img src="docs/assets/node.svg" alt="兼容性: Node.js 22.19+, 24.2+, 25, 26">
  <a href="LICENSE-STATUS.md"><img src="docs/assets/license.svg" alt="第一方默认许可: MIT"></a>
  <a href="https://www.npmjs.com/package/@akashacorporation/bari"><img src="https://img.shields.io/npm/v/@akashacorporation/bari" alt="npm version"></a>
</p>

Bari 是 AkashaCorporation 的终端 Agent 工作台。它从 MiniMax Code 分叉而来，并朝着一个目标持续演进：让编码 Agent 成为**合法网络安全与逆向工程**工作的一线工具。你可以自带模型（BYOK），也可以使用 OpenCode Go 订阅，并与一支真正懂行的 Agent 团队协作。

[![Bari TUI 预览：修复失败测试并通过](docs/assets/tui-demo.png)](docs/demo.md)

## Agent 团队

四个内置专家随 Bari 发布。任何会话都可以通过 `task` 委派工作给它们，按名字召唤：

| Agent | 用途 |
| --- | --- |
| **orion** | 跨领域的大任务：拆解、路由给专家、整合结论 |
| **june** | 编译后的 C/C++ 二进制：反汇编、提升、反编译、HexCore 流水线 |
| **vera** | 授权范围内的安全挖掘：侦察、上下文构建、变体分析、误报核验、如实评估严重性 |
| **papi** | Android 应用、APK、Gradle 构建、NDK、APK 内的原生库 |
| explore / worker / verifier | 通用的只读梳理、生产执行与评审角色 |

把自有 agent 放到 `~/.bari/agents/<name>/agent.md`，它们会进入同一张名册。

## 自进化

Bari 从自己的工作中学习。以下技能由提示词显式触发：

- `/dream` 把近期会话与既有记忆整合为更小、更真实的持久记忆（Agent 作用域的记忆存放在数据目录，命令行同样可用）。
- `/distill` 在会话历史中寻找重复的人工流程，并通过既有技能工具打包成技能。
- `compose-next` 把完成的任务转成下一步提示建议。

只读的 `history` 工具可以在一轮对话内检索会话历史，让结论有据可查。

## 快速开始

### 1. 安装 Bari

需要 **Node.js 22.19+（22.x）、24.2+（24.x）、25 或 26**：

```bash
npm install -g @akashacorporation/bari
bari --version
```

想直接运行最新源码，参见[从源码构建](#从源码构建)。

### 2. 自带模型（推荐）

BYOK 不需要托管登录。先在当前 shell 里设置 `MCODE_PROVIDER_API_KEY`，然后添加 provider。把示例的 URL 和模型名换成你的：

```bash
bari provider add --name my-provider --base-url https://example.com/v1 \
  --api-format openai-completions --model my-model \
  --api-key-env MCODE_PROVIDER_API_KEY --use
bari
```

支持的 API 格式：`openai-completions`、`openai-responses`、`anthropic-messages`。可选元数据参数（`--context`、`--max-output`、`--effort low,high,max`）用来声明模型真实的上下文与推理档位；不填则使用保守默认值。加上 `--use` 后，保存并选中前会先测试第一个模型，连接失败不会保存。`/model` 会列出全部已配置模型，也可以从 provider 的 `/models` 端点刷新模型目录。环境变量配置、连接检查与单次运行的模型覆盖见[模型示例](docs/examples.md#2-choose-your-own-model)。OpenCode Go 订阅用户可使用 [OpenCode Go 示例](docs/examples.md#opencode-go)中的内置预设。

<details>
<summary>托管账号与 Token Plan</summary>

中国大陆账号：

```bash
bari login
```

Global 账号：

```bash
bari login --region global
```

在浏览器完成登录后，打开 `bari`，用 `/status` 查看账号、用 `/provider` 选择模型，`bari logout` 退出登录。Token Plan 需要账号有可用额度。MiniMax 账号文档（受支持的 provider 之一）见 [agent.minimax.io/docs](https://agent.minimax.io/docs/cli/quick-start)。

</details>

用户数据默认存放在 `~/.bari`；已有的 `~/.minimax-code` 配置会在 `~/.bari` 出现前继续沿用。可用 `BARI_DATA_DIR` 覆盖。

### 3. 运行第一个任务

进入目标项目：

```bash
cd /path/to/your/project
bari
```

在 TUI 里描述任务，或在启动时直接提交：

```bash
bari "Find a failing test, fix the implementation, and run the relevant tests."
```

用 `bari init .` 生成或更新 `AGENTS.md` 项目指引：写清预期结果、允许改动的范围、以及如何验证任务。

| 入口 | 命令 | 用途 |
| --- | --- | --- |
| 交互式 TUI | `bari [prompt]` | 读代码、继续会话、审阅变更与权限 |
| Headless | `bari exec [prompt]` | Shell 脚本、CI、批量任务与评测 |
| ACP | `bari acp` | 支持 Agent Client Protocol 的编辑器与客户端 |

### 继续之前的工作

```bash
# 恢复当前工作区最近一次会话
bari --continue

# 打开会话选择器
bari --session
```

在 TUI 内，用 `/sessions` 查找历史会话，用 `/help` 查看全部命令与快捷键。

| 操作 | 快捷键 |
| --- | --- |
| 发送消息或引导运行中的任务 | `Enter` |
| 任务运行时排队后续指令 | `Alt+Enter` |
| 插入换行 | `Shift+Enter` |
| 引用工作区文件或目录 | `@` |
| 切换 Plan Mode | `Shift+Tab` |
| 切换权限模式 | `Alt+M` |
| 关闭面板或中断运行中的任务 | `Esc` |

## 你能做什么

| 任务 | 能力 |
| --- | --- |
| **编辑并验证代码** | 读文件、看 diff、跑 shell 命令与测试，并用权限与沙箱控制工具执行 |
| **安全地研究目标** | 结论都落在工具结果上，核验真伪，PoC 保持可逆、限定在授权范围 |
| **选择模型** | 自带 OpenAI/Anthropic 兼容 provider、OpenCode Go 订阅，或托管账号 |
| **检索与多媒体** | 内置搜索、多媒体工具、MCP 与托管连接器（依赖账号权限与服务额度） |
| **持续推进工作** | 恢复会话、计划任务、委派给 Agent 团队，用插件与技能扩展工作台 |
| **接入工作流** | headless CLI 跑脚本化任务，或通过 ACP 接入兼容编辑器与客户端 |

账号能力、更新、反馈与诊断同样内置。托管工具需要网络与相应授权。详见[能力与服务边界](docs/tui-capabilities.md)。

## 试一试

在示例项目的副本里启动 TUI，输入：

> Read clamp.mjs and clamp.test.mjs. Run node --test to reproduce the failure, fix clamp without changing the tests, then run the tests again.

这个[小而可复现的项目](examples/clamp)就是上方演示的任务。更多[示例](docs/examples.md)涵盖切换模型、调用搜索、使用自己的图片输入。

## 从源码构建

开发 Bari 或运行源码检出，需要 Git、**Node.js 22.19+（22.x）、24.2+（24.x）、25 或 26**，以及 **pnpm 9.12.0**。

```bash
git clone https://github.com/AkashaCorporation/Bari.git
cd Bari
pnpm install --frozen-lockfile
pnpm build
pnpm bari
```

首次构建需要联网。依赖与带完整性校验的内置工具包来自公共 npm。pnpm 安装、系统依赖与更新见[源码安装指南](docs/installation.md)。

在源码目录内用 `pnpm bari` 代替示例里的 `bari`。要操作自己的项目，进入项目目录并启动构建好的 CLI：

```bash
node /absolute/path/to/Bari/dist/cli.js
```

Bari 从 MiniMax Code 上游分叉而来，为第三方同步保留其源码基线；参见[源码同步](docs/source-sync.md)与[版本与证据基线](docs/open-source-status.md#version-and-evidence-baseline)。安装上游发布的包与构建本检出是两条独立路径。

## 文档与贡献

- [安装与更新](docs/installation.md) | [示例](docs/examples.md) | [TUI 状态栏](packages/tui/docs/status-line-config.md)
- [贡献指南](CONTRIBUTING.md) | [报告问题或提议](https://github.com/AkashaCorporation/Bari/issues/new/choose) | [报告安全问题](SECURITY.md)
- [全部文档](docs/README.md)：架构、能力覆盖、验证记录、源码同步与发布准备。

文档以英文为主，本页是[英文 README](README.md)的中文对照。

目前代码与文档的 PR 仅接受仓库协作者。如果你不是协作者但有想法或提议，请先[开 issue](https://github.com/AkashaCorporation/Bari/issues/new/choose)讨论。请在报告中去除密钥、账号信息与私有项目内容。

## 支持

本仓库承接 Bari 的问题反馈。已发布源码覆盖终端 TUI、headless CLI 与 ACP。报 CLI 问题时请附上 `bari --version`、所用界面与最小复现，并去除凭据与私有项目内容。[报告问题或提问](https://github.com/AkashaCorporation/Bari/issues/new/choose)。

## 许可与致谢

第一方代码默认采用 [MIT](LICENSE)。既有文件级与包级许可保持不变。Bari 分叉自 [MiniMax Code](https://github.com/MiniMax-AI/minimax-code)；`compose-next`、`dream`、`distill` 三个技能改编自 [MiMo Code](https://github.com/XiaomiMiMo/MiMo-Code)。依赖、资产与 `mcode-tools` 的详情见[第三方声明](THIRD_PARTY_NOTICES.md)与[许可状态](LICENSE-STATUS.md)。

Bari 面向合法的安全研究、防御性工作，以及经授权目标上的逆向工程。内置 Agent 的提示词中已包含授权范围纪律，请在你的使用中保持这一边界。
