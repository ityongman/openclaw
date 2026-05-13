# OpenClaw 源码学习指南

> **2 分钟扫读即可上手**。深读章节在底部"文档索引"表里。
> 读者背景：Java、Python、Go 已熟，TypeScript 不熟。

---

## Overview

OpenClaw 是一个**多通道 AI 网关 + Agent 平台**：把聊天平台（Discord / Telegram / iMessage / WebUI / 移动端...）的消息汇聚到一个本地 Gateway 进程，由可插拔的 **Provider 插件**（Anthropic / OpenAI / Google / 本地模型）驱动 AI 对话，并以**流式**方式回写到原平台。所有插件以 monorepo 子包的形式存在于 [extensions/](../extensions/)，运行时再被 Gateway 动态加载。

仓库实际产物分三层：

1. 一个 npm 包 `openclaw`（CLI + Gateway 主进程）
2. 60+ 个 `extensions/*` 插件（Channel 与 Provider）
3. UI 控制台 + Android / iOS / macOS 原生客户端

---

## Tech Stack

| 层 | 技术 | 版本 / 备注 |
|---|---|---|
| Runtime | Node.js | `>=22.14.0` |
| Language | TypeScript（ESM、`strict: true`） | tsconfig target `ES2022` |
| Package Manager | pnpm | `10.33.0`（在 `package.json` 的 `packageManager` 锁定） |
| Workspace | pnpm workspace | 成员：`.`、`ui`、`packages/*`、`extensions/*` |
| Type Check | **tsgo**（`@typescript/native-preview`） | 仅走 `pnpm tsgo*`，**禁止 `tsc --noEmit`** |
| Bundler | tsdown（基于 Rolldown） | 输出 `dist/` |
| Lint | oxlint | 通过 `pnpm lint:*` 包装 |
| Format | **oxfmt** | **不是 Prettier**（AGENTS.md 明确） |
| Test | Vitest | colocated `*.test.ts`、e2e `*.e2e.test.ts` |
| Validation | zod / 内部 schema helpers | 用于外部边界 |
| AI Protocol | Model Context Protocol (MCP) + 自有 Channel/Provider 协议 | — |
| 当前包版本 | `2026.4.26` | CalVer |

---

## Architecture（一句话版）

```
聊天平台用户  →  Channel Extension（discord/telegram/...）
              →  Gateway HTTP+WebSocket 主进程
              →  Channel Manager（路由/生命周期）
              →  draft-stream-loop（防抖、合并、allowlist）
              →  Session（SQLite + JSONL 历史）
              →  Provider Extension（anthropic/openai/...）
              →  流式 token 原路返回
```

完整图示见 [08-system-architecture-and-flows.md](./08-system-architecture-and-flows.md)（5 张 Mermaid：整体架构 / 启动时序 / 消息端到端 / 插件加载生命周期 / Session Key 路由）。

---

## Key Entry Points

| 文件 | 作用 |
|---|---|
| [openclaw.mjs](../openclaw.mjs) | npm `bin` 文件，Node 版本守卫 + 编译缓存 + 加载 dist |
| [src/entry.ts](../src/entry.ts) | 主入口；标题、env 标准化、Windows argv、子进程 bridge、版本快路径 |
| [src/cli/run-main.ts](../src/cli/run-main.ts) | CLI 启动主流程（`runCli`），dotenv、profile、容器目标解析 |
| [src/cli/](../src/cli/) | Commander 命令树（90+ 子命令文件，每个命令一个 `*-cli.ts`） |
| [src/cli/gateway-cli.ts](../src/cli/gateway-cli.ts) | `start` 命令处理器 → 启动 Gateway |
| [src/gateway/server.impl.ts](../src/gateway/server.impl.ts) | Gateway 实现核心 |
| [src/gateway/server-startup.ts](../src/gateway/server-startup.ts) | 启动编排（HTTP/WS/Channel/插件） |
| [src/gateway/server-channels.ts](../src/gateway/server-channels.ts) | Channel 管理器 |
| [src/channels/draft-stream-loop.ts](../src/channels/draft-stream-loop.ts) | 消息处理主循环（防抖+流式回写） |
| [src/config/io.ts](../src/config/io.ts) / [src/config/config.ts](../src/config/config.ts) | 配置加载/读写 |

---

## Directory Map

```
openclaw/
├── openclaw.mjs           # CLI bin shim
├── src/                   # 核心 TS 源（主要阅读区域）
│   ├── entry.ts           # 启动入口
│   ├── cli/               # Commander 命令树（90+ 子命令）
│   ├── gateway/           # HTTP / WebSocket / Channel Manager
│   ├── channels/          # Channel 抽象层（消息生命周期）
│   ├── plugins/           # 插件 loader / registry / manifest
│   ├── plugin-sdk/        # 插件开发 SDK（300+ 子模块入口）
│   ├── config/            # 配置 schema、IO、迁移、doctor
│   ├── agents/            # 多 Agent / 模型解析 / 上下文裁剪
│   ├── memory/            # 记忆系统 SDK
│   ├── mcp/               # Model Context Protocol 实现
│   ├── acp/               # Agent Client Protocol
│   ├── hooks/ cron/ daemon/ tts/ realtime-voice/ canvas-host/
│   └── infra/             # env / log / 错误处理
├── extensions/            # 60+ 插件（workspace 成员）
│   ├── discord/ telegram/ slack/ imessage/ matrix/ ...   # Channel
│   ├── anthropic/ openai/ google/ ...                    # Provider
│   └── browser/ github/ ...                              # Tool/Service
├── packages/              # 内部共享库（plugin-sdk、memory-host-sdk、plugin-package-contract）
├── ui/                    # Web 控制台前端（Lit + Vite）
├── apps/                  # 原生客户端（android/ios/macos/macos-mlx-tts）—— 不在 workspace 里
├── skills/                # 用户可调用的 AI 技能脚本
├── docs/                  # 用户文档源（Astro / Starlight）
├── test/                  # 跨包集成测试
└── qa/                    # QA 工具
```

⚠️ Workspace 与目录是两码事：`pnpm-workspace.yaml` 列出 `["." , "ui", "packages/*", "extensions/*"]`——**`extensions/*` 在 workspace 内**，`apps/*` **不在**。

---

## Conventions（摘自 [AGENTS.md](../AGENTS.md)，关键 7 条）

1. **TS ESM、strict**：避免 `any`，外部边界用 zod 或现有 schema helpers；`unknown` + 窄化适配优于 `any`
2. **类型检查走 `tsgo`**：禁止新增 `tsc --noEmit` / `typecheck` / `check:types`
3. **格式化用 oxfmt**：不要用 Prettier；命令 `pnpm format` / `pnpm format:check`
4. **测试 colocated**：`*.test.ts` 同目录；e2e 用 `*.e2e.test.ts`；示例模型名 `sonnet-4.6`、`gpt-5.4`
5. **命名**：产品/UI/文档说 **"OpenClaw" / "plugin / plugins"**；CLI/包/路径/配置用 `openclaw`；`extensions/` 是内部目录名，不是用户面向词
6. **核心 vs 插件边界**：核心保持 extension-agnostic；插件只能通过 `openclaw/plugin-sdk/*`、`api.ts`、`runtime-api.ts` 跨入核心；插件不得 import 核心 `src/**` 或其他插件 `src/**`
7. **提交**：通过 `scripts/committer "<msg>" <file...>` 提交，自动格式化暂存文件；提交风格 conventional-ish

更详细的边界规则、changelog 规范、CI 等待矩阵等在 [AGENTS.md](../AGENTS.md)。

---

## Common Tasks

| 想做的事 | 命令 |
|---|---|
| 安装依赖 | `pnpm install` |
| 启动 dev 模式 | `pnpm dev` |
| 跑 CLI（在仓库内） | `pnpm openclaw <subcommand>` |
| 构建 | `pnpm build` |
| Gateway 开发模式 | `pnpm gateway:dev` |
| 全部测试 | `pnpm test` |
| 仅变更测试 | `pnpm test:changed` |
| 串行测试（资源敏感） | `pnpm test:serial` |
| 类型检查（核心） | `pnpm tsgo:core` |
| 类型检查（变更） | `pnpm check:test-types` |
| Lint（变更门控的一部分） | `pnpm lint` |
| 格式化检查 / 修复 | `pnpm format:check` / `pnpm format` |
| **变更门控**（推送前默认跑） | `pnpm check:changed` |
| **全量门控**（落 main 前） | `pnpm check` |
| 文档列表 | `pnpm docs:list` |
| 检查导入循环 | `pnpm check:import-cycles` |

> 注意：`pnpm typecheck`、`pnpm check:types` **不存在**——AGENTS.md 明确禁止此类命名。一律走 `tsgo*` 系列或 `check:changed`。

---

## Where to look — 速查表

| 我想... | 去看 |
|---|---|
| 加一个 CLI 子命令 | `src/cli/<feat>-cli.ts` + 在 commander 注册（参考已有 `*-cli.ts`） |
| 改 Gateway 启动逻辑 | [src/gateway/server-startup.ts](../src/gateway/server-startup.ts)、[server.impl.ts](../src/gateway/server.impl.ts)、[server-startup-early.ts](../src/gateway/server-startup-early.ts) |
| 改 HTTP 路由 / 中间件 | [src/gateway/server-http.ts](../src/gateway/server-http.ts)、`server-aux-handlers.ts` |
| 改 WebSocket 运行时 | [src/gateway/server-ws-runtime.ts](../src/gateway/server-ws-runtime.ts) |
| 改 Channel 管理器 | [src/gateway/server-channels.ts](../src/gateway/server-channels.ts) |
| 改消息处理主循环 | [src/channels/draft-stream-loop.ts](../src/channels/draft-stream-loop.ts) |
| 改 Session Key 解析 / 路由 | `src/gateway/server-session-key.ts`、`src/routing/` |
| 改 AI 调用 / 流式 | [src/gateway/server-chat.ts](../src/gateway/server-chat.ts) |
| 加一个聊天通道（如 Discord 类） | `extensions/<id>/`，参考 [extensions/discord/](../extensions/discord/) |
| 加一个 AI 提供商 | `extensions/<id>/`，参考 [extensions/anthropic/](../extensions/anthropic/) 或 [extensions/openai/](../extensions/openai/) |
| 改插件加载 | `src/plugins/loader.ts`、`plugin-registry.ts`、`manifest.ts`、`bundled-plugin-scan.ts` |
| 改配置 schema / 默认值 | `src/config/schema.ts`、`defaults.ts`、`types.openclaw.ts`；写入走 `io.ts` |
| 改 MCP 端点 | [src/gateway/mcp-http.ts](../src/gateway/mcp-http.ts) + `src/mcp/` |
| 改 Hooks | [src/gateway/hooks.ts](../src/gateway/hooks.ts) + `src/hooks/` |
| 改 Cron / 定时 | `src/cron/`、`src/gateway/server-cron.test.ts` |
| Web 控制台 | [ui/](../ui/)（Lit + Vite） |
| 原生 App | [apps/android/](../apps/android/)、[apps/ios/](../apps/ios/)、[apps/macos/](../apps/macos/) |

---

## 学习路径

**第一次接触？** 按这个顺序 4~6 小时入门：

1. 本页（5 分钟，掌握全局）
2. [00-typescript-primer.md](./00-typescript-primer.md)（30~60 分钟，TS 速查；Java/Python/Go 视角）
3. [08-system-architecture-and-flows.md](./08-system-architecture-and-flows.md)（30 分钟，5 张 Mermaid 图）
4. [01-project-structure.md](./01-project-structure.md)（30 分钟，构建系统细节）
5. [02-entry-and-cli.md](./02-entry-and-cli.md)（60 分钟，CLI 启动链逐行）

**想系统读完？** 跟随 30~35 天阅读计划：[09-reading-plan.md](./09-reading-plan.md)，按周细化 [10](./10-week1-days1-7-详细计划.md) → [11](./11-week2-days8-14-详细计划.md) → [12](./12-week3-days15-21-详细计划.md) → [13](./13-week4-week5-详细计划.md)。

---

## 文档索引

| 序号 | 文档 | 内容 | 阅读时机 |
|------|------|------|------------|
| —  | 本页（README） | Onboarding Guide：架构 / 入口 / 速查 | 第 1 天 + 随时回查 |
| 00 | [00-typescript-primer.md](./00-typescript-primer.md) | TypeScript 速查（Java/Python/Go 视角） | 第 1 天 |
| 01 | [01-project-structure.md](./01-project-structure.md) | 项目结构与构建系统（详细版） | 第 2 天 |
| 02 | [02-entry-and-cli.md](./02-entry-and-cli.md) | 入口链与 CLI 命令注册（含逐行启动链路） | 第 3~4 天 |
| 03 | [03-config-system.md](./03-config-system.md) | 配置系统 | 第 5~6 天 |
| 04 | [04-gateway-server.md](./04-gateway-server.md) | Gateway 服务器核心 | 第 7~10 天 |
| 05 | [05-channel-plugin-system.md](./05-channel-plugin-system.md) | Channel 与插件系统 | 第 11~15 天 |
| 06 | [06-session-and-ai.md](./06-session-and-ai.md) | Session 管理与 AI 层 | 第 16~20 天 |
| 07 | [07-advanced-topics.md](./07-advanced-topics.md) | 高级主题（Hooks / Cron / Voice / Canvas） | 第 21~28 天 |
| 08 | [08-system-architecture-and-flows.md](./08-system-architecture-and-flows.md) | 系统架构图与完整业务执行流程（5 张 Mermaid） | 随时查阅 |
| 09 | [09-reading-plan.md](./09-reading-plan.md) | 完整 30 天阅读计划 | 随时查阅 |
| 10 | [10-week1-days1-7-详细计划.md](./10-week1-days1-7-详细计划.md) | 第一周：TS 基础、项目结构、CLI 入口 | Day 1-7 |
| 11 | [11-week2-days8-14-详细计划.md](./11-week2-days8-14-详细计划.md) | 第二周：Gateway 启动、HTTP/WS | Day 8-14 |
| 12 | [12-week3-days15-21-详细计划.md](./12-week3-days15-21-详细计划.md) | 第三周：Channel/插件、消息处理、Provider | Day 15-21 |
| 13 | [13-week4-week5-详细计划.md](./13-week4-week5-详细计划.md) | 第四、五周：Session/AI、Hooks/Cron/MCP、综合实践 | Day 22-35 |

---

## 怎么用这份文档

1. **本页 = 全局地图**，先扫一遍掌握"在哪改、在哪查"
2. **按文档顺序深读**，章节间有依赖（例如 04 依赖 02 的入口链）
3. **边读边跑**：每打开一个章节，把对应源文件用 IDE 打开对照
4. **`grep` 验证**：文档提到的类/函数自己 `pnpm grep` / `Grep` 找一遍，怀疑漂移就读源代码
5. **小改动实验**：第 3 周起改日志级别、配置默认值，跑 `pnpm check:changed` 验证
6. **认准 [AGENTS.md](../AGENTS.md)**：所有命令、约定、CI 规则的权威源；本文档是它的"导读层"
