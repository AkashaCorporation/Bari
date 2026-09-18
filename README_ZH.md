<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/wordmark-light.svg">
    <img src="docs/assets/wordmark-light.svg" alt="Bari" width="760">
  </picture>
</p>

<h1 align="center">Bari</h1>
<p align="center">轻快的终端编码代理。自带模型，或使用托管账号与订阅。</p>
<p align="center">
  <a href="#快速开始">Get started</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/examples.md">Examples</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>
<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>
<p align="center">
  <img src="docs/assets/source-preview.svg" alt="Source preview">
  <img src="docs/assets/node.svg" alt="Compatibility: Node.js 22.19+, 24.2+, 25, and 26">
  <a href="LICENSE-STATUS.md"><img src="docs/assets/license.svg" alt="First-party default license: MIT"></a>
  <a href="https://www.npmjs.com/package/@akashacorporation/bari"><img src="https://img.shields.io/npm/v/@akashacorporation/bari" alt="npm version"></a>
</p>

在终端里读懂项目、修改代码并运行测试。使用 MiniMax 账号、OpenCode Go 订阅或自己的 API Key，把搜索、插件和多模态工具接入同一个工作流。

[![Bari TUI 预览：修复失败测试并跑通](docs/assets/tui-demo.png)](docs/demo.md)

<p align="center"><a href="docs/demo.md">查看预览并体验示例 →</a> · 终端界面示意图</p>

## 快速开始

### 1. 安装 Bari

需要 **Node.js 22.19+（22.x）、24.2+（24.x）、25 或 26**：

```bash
npm install -g @akashacorporation/bari
bari --version
```

想直接运行最新源码，请见[从源码构建](#从源码构建)。

### 2. 登录账号或配置 API Key

中国大陆账号运行：

```bash
bari login
```

Global 账号运行：

```bash
bari login --region global
```

在浏览器中完成登录，再启动 `bari`，通过 `/status` 检查账号、通过 `/provider` 选择模型。退出登录使用 `bari logout`。

Token Plan 需要账号和可用额度。用户数据默认存储在 `~/.bari`；已有 `~/.minimax-code` 配置时继续沿用旧目录，直到 `~/.bari` 出现。可用 `BARI_DATA_DIR` 覆盖。MiniMax 账号文档（支持的服务商之一）见 [agent.minimax.io/docs](https://agent.minimax.io/docs/cli/quick-start)。

<details>
<summary>使用自己的 API Key（BYOK）</summary>

BYOK 无需先登录 MiniMax。先在当前 shell 中设置 `MCODE_PROVIDER_API_KEY`，再添加提供方；将下方示例地址和模型名替换为实际配置：

```bash
bari provider add --name my-provider --base-url https://example.com/v1 \
  --api-format openai-completions --model my-model \
  --api-key-env MCODE_PROVIDER_API_KEY
bari
```

支持 `openai-completions`、`openai-responses` 和 `anthropic-messages`。可选元数据参数（`--context`、`--max-output`、`--effort low,high,max`）用于声明模型的真实上下文与推理档位；不带这些参数时运行时会套用保守默认值。新提供方需先 `bari provider test` 才能被选中。连接测试、单次模型切换及环境变量设置见 [模型示例](docs/examples.md#2-choose-your-own-model)。OpenCode Go 订阅用户可直接使用内置预设，见 [OpenCode Go 示例](docs/examples.md#opencode-go)。

</details>

### 3. 完成第一个任务

进入要处理的项目目录：

```bash
cd /path/to/your/project
bari
```

在 TUI 中描述任务，也可以在启动时直接提交：

```bash
bari "Find a failing test, fix the implementation, and run the relevant tests."
```

使用 `bari init .` 生成或更新 `AGENTS.md` 项目指导。任务中应说明期望结果、修改边界和验证方式。

| 入口 | 命令 | 适用场景 |
| --- | --- | --- |
| 交互式 TUI | `bari [prompt]` | 探索代码、持续对话、审阅修改与权限确认。 |
| Headless | `bari exec [prompt]` | Shell、CI、批处理与评测。 |
| ACP | `bari acp` | 支持 Agent Client Protocol 的编辑器与客户端。 |

### 继续之前的工作

```bash
# 恢复当前工作区最近的会话
bari --continue

# 打开会话选择器
bari --session
```

在 TUI 中输入 `/sessions` 查找历史会话，输入 `/help` 查看完整命令与快捷键。

| 操作 | 快捷键 |
| --- | --- |
| 发送消息，或在任务运行中调整当前响应 | `Enter` |
| 在任务运行中将后续消息加入队列 | `Alt+Enter` |
| 在输入框中换行 | `Shift+Enter` |
| 引用工作区文件或目录 | `@` |
| 切换 Plan Mode | `Shift+Tab` |
| 切换权限模式 | `Alt+M` |
| 关闭面板或中断正在运行的任务 | `Esc` |

## 可以做什么

| 场景 | 使用方式 |
| --- | --- |
| **修改与验证代码** | 读取文件、编辑 diff、执行 Shell 和测试；通过权限与沙箱控制工具执行。 |
| **选择模型** | MiniMax 账号或 Token Plan、OpenCode Go 订阅，或兼容 OpenAI、Anthropic 格式的自定义提供方。 |
| **搜索与多模态** | 内置搜索、内置媒体工具、MCP 和托管连接器；按账号权限和服务额度使用。 |
| **延续工作** | 会话恢复、任务规划、子 Agent、官方 / 本地 / GitHub 插件与内置 Skills。 |
| **接入工作流** | Headless CLI 用于脚本任务，ACP 用于兼容的编辑器和客户端。 |

账号、更新、反馈与诊断能力也在。托管工具需要网络和相应授权，详细边界见 [能力与服务边界](docs/tui-capabilities.md)。

## 试一试

在示例目录启动 TUI，输入：

> Read clamp.mjs and clamp.test.mjs. Run node --test to reproduce the failure, fix clamp without changing the tests, then run the tests again.

这个 [可复现的小项目](examples/clamp) 就是上方演示使用的任务。[更多示例](docs/examples.md) 包括切换模型、执行真实搜索，以及使用自己的图片输入。

## 从源码构建

开发 Bari 或运行本仓库源码需要 Git、Node.js **22.19+（22 系列）、24.2+（24 系列）、25 或 26**，以及 **pnpm 9.12.0**。

```bash
git clone https://github.com/AkashaCorporation/Bari.git
cd Bari
pnpm install --frozen-lockfile
pnpm build
pnpm bari
```

首次构建需要联网；依赖和经过校验的内置工具包均来自公共 npm。pnpm 安装、系统依赖和更新方法见[源码安装指南](docs/installation.md)。

从源码目录运行时，将上方示例中的 `bari` 替换为 `pnpm bari`。要在自己的项目中工作，先切换到项目目录，再运行构建产物：

```bash
node /absolute/path/to/Bari/dist/cli.js
```

本仓库目标为 **0.4.12 上游源码基线**。安装上游已发布的包与构建本仓库是两条独立路径，版本一致不代表构建来源完全相同，详见[版本与证据基线](docs/open-source-status.md#version-and-evidence-baseline)。

## 文档与贡献

- [安装与更新](docs/installation.md) · [使用示例](docs/examples.md) · [TUI 状态栏](packages/tui/docs/status-line-config.md)
- [贡献指南](CONTRIBUTING.md) · [报告 Bug / 提出建议](https://github.com/AkashaCorporation/Bari/issues/new/choose) · [报告安全问题](SECURITY.md)
- [全部文档](docs/README.md)：架构、能力对照、验证记录、源码同步和发布流程。

项目文档以英文为主，本页为首页的简体中文译文。

目前仅接受仓库协作者提交代码和文档 Pull Request。如果你不是协作者，但有想法或方案，欢迎先通过 [Issue](https://github.com/AkashaCorporation/Bari/issues/new/choose) 讨论。请在报告中移除密钥、账号信息和私人项目内容。

## 问题反馈

本仓库用于提交 Bari 的问题。公开源码范围为终端 TUI、Headless CLI 和 ACP。CLI 问题请注明 `bari --version`、运行入口与最小复现。报告中请移除凭据和私人项目内容。[报告问题或提问](https://github.com/AkashaCorporation/Bari/issues/new/choose)。

## 许可

第一方代码默认采用 [MIT](LICENSE)；文件或子包已有独立声明时保留原许可。依赖、资源与 `mcode-tools` 的许可分别见 [第三方声明](THIRD_PARTY_NOTICES.md) 和 [许可状态](LICENSE-STATUS.md)。
