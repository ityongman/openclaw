# 每日阅读计划

> 4~6 小时/天，最长 1 个月，循序渐进从浅到深

---

## 第一周：基础层（TypeScript + 工具链 + 入口）

### Day 1 — TypeScript 语言基础（4h）

**目标**：消除 TypeScript 陌生感，能读懂基本语法

| 时间 | 内容 | 操作 |
|------|------|------|
| 1h | 阅读 [00-typescript-primer.md](./00-typescript-primer.md) | 通读，遇到不懂的打开 IDE 验证 |
| 1h | 阅读 `src/infra/env.ts` | 约 50 行，简单文件，感受 TS 风格 |
| 1h | 阅读 `src/infra/errors.ts` | 约 60 行，理解错误处理模式 |
| 1h | 阅读 `src/version.ts` + `src/utils.ts` | 简单工具文件，建立信心 |

**检验**：你能在不看文档的情况下，看懂这段代码是做什么的：
```typescript
export function isTruthyEnvValue(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}
```

---

### Day 2 — 项目结构与构建（4h）

**目标**：搞清楚项目怎么组织，代码怎么运行

| 时间 | 内容 | 操作 |
|------|------|------|
| 1h | 阅读 [01-project-structure.md](./01-project-structure.md) | 通读 |
| 30m | 阅读 `package.json` 的 scripts 字段 | 了解所有构建命令 |
| 30m | 阅读 `tsdown.config.ts` | 了解打包配置 |
| 1h | 执行 `pnpm install && pnpm build` | 跑通构建 |
| 1h | 执行 `node openclaw.mjs --help` | 看到 CLI 帮助，验证构建成功 |

---

### Day 3 — 入口链（4h）

**目标**：完全搞懂 `openclaw start` 从执行到 Gateway 启动的完整调用链

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 30m | 阅读 [02-entry-and-cli.md](./02-entry-and-cli.md) | 文档 |
| 1h | 精读 `openclaw.mjs` | 根目录 |
| 1h | 精读 `src/entry.ts` | 全文 |
| 1.5h | 精读 `src/cli/run-main.ts` | 重点 `runCli()` 函数 |
| 30m | 阅读 `src/cli/route.ts` | 了解快速路由 |

**动手**：在 `runCli()` 第一行加 `console.log(">>> runCli called with:", argv.slice(2))`，构建后运行验证调用。

---

### Day 4 — CLI 命令树（5h）

**目标**：理解所有 CLI 命令是如何注册和执行的

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 浏览 `src/cli/program.ts` | 看命令注册结构 |
| 1h | 精读 `src/cli/gateway-cli.ts` | start 命令入口 |
| 1h | 浏览 `src/cli/daemon-cli.ts` | daemon 命令 |
| 1h | 浏览 `src/cli/plugins-cli.ts` | 插件管理命令 |
| 1h | 阅读 `src/cli/command-registration-policy.ts` | 命令注册策略 |

---

### Day 5 — 配置系统（6h）

**目标**：完全理解配置如何加载、验证、热更新

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 阅读 [03-config-system.md](./03-config-system.md) | 文档 |
| 1h | 精读 `src/config/paths.ts` | 全文，理解路径约定 |
| 1h | 精读 `src/config/io.ts`（前 150 行） | loadConfig、writeConfigFile |
| 1h | 精读 `src/config/env-substitution.ts` | 环境变量替换 |
| 1h | 浏览 `src/config/types.openclaw.ts` | 配置类型总览 |
| 1h | 阅读 `src/config/validation.ts` | Zod 验证 |

**动手**：找到你本地的 `~/.openclaw/openclaw.json`，对照 `types.openclaw.ts` 理解每个字段。

---

### Day 6~7 — 巩固周（周末，各 4h）

- **Day 6**：复习 Day 1~5 的内容，写下你对整体架构的理解（不超过一页）
- **Day 7**：尝试完成一个小任务：在 `openclaw config` 命令下添加一个 `config echo` 子命令，打印当前配置的 Gateway 端口

---

## 第二周：Gateway 核心

### Day 8 — Gateway 启动流程（5h）

**目标**：理解 Gateway 从启动到就绪的每一个步骤

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 阅读 [04-gateway-server.md](./04-gateway-server.md) | 文档 |
| 1h | 精读 `src/gateway/server.ts`（20 行） | 公共入口 |
| 1.5h | 精读 `src/gateway/server.impl.ts`（前 100 行 import + startGatewayServer 函数） | 启动主函数 |
| 1.5h | 精读 `src/gateway/server-startup-early.ts` | 早期运行时启动 |

---

### Day 9 — HTTP/WebSocket 服务（5h）

**目标**：理解 Gateway 如何处理 HTTP 请求和 WebSocket 连接

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1.5h | 精读 `src/gateway/server-http.ts`（前 100 行） | HTTP 路由 |
| 1h | 精读 `src/gateway/auth.ts` | 认证机制 |
| 1h | 精读 `src/gateway/server-ws-runtime.ts`（前 80 行） | WebSocket 处理 |
| 1.5h | 精读 `src/gateway/auth-rate-limit.ts` | 限流机制 |

---

### Day 10 — Channel 管理器（5h）

**目标**：理解 Gateway 如何管理 Channel 的生命周期

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1.5h | 精读 `src/gateway/server-channels.ts`（前 150 行） | Channel 管理器 |
| 1h | 阅读 `src/infra/backoff.ts` | 指数退避实现 |
| 1.5h | 精读 `src/gateway/channel-health-monitor.ts` | Channel 健康监控 |
| 1h | 阅读 `src/gateway/server-runtime-state.ts` | 运行时状态 |

---

### Day 11 — 配置热加载与 Hooks（5h）

**目标**：理解配置变更如何在不重启的情况下生效

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 精读 `src/gateway/server-reload-handlers.ts` | 热加载处理器 |
| 1h | 精读 `src/gateway/hooks.ts`（前 100 行） | HTTP Hooks |
| 1h | 精读 `src/gateway/hooks-mapping.ts` | Hook 映射 |
| 1h | 浏览 `src/plugins/hooks.ts` | 插件 Hook 注册 |
| 1h | 阅读 `src/gateway/server-cron.ts` | Cron 服务 |

---

### Day 12 — Gateway 安全与服务发现（4h）

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 精读 `src/gateway/security-path.ts` | 安全路径 |
| 1h | 精读 `src/gateway/server-discovery-runtime.ts` | 服务发现 |
| 1h | 阅读 `src/gateway/server/health-state.ts` | 健康状态 |
| 1h | 阅读 `src/gateway/server-maintenance.ts` | 维护定时器 |

---

### Day 13~14 — 巩固周（周末）

- **Day 13**：在 Gateway 的健康检查端点（`/health`）加一个新字段（如当前 Channel 数量）
- **Day 14**：阅读 `src/gateway/` 目录中所有 `test` 文件的标题，了解测试覆盖的场景

---

## 第三周：Channel 与插件系统

### Day 15 — 插件架构全览（5h）

**目标**：理解插件从清单到运行时的完整生命周期

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 阅读 [05-channel-plugin-system.md](./05-channel-plugin-system.md) | 文档 |
| 1h | 精读 `src/plugins/manifest.ts`（前 80 行） | 清单解析 |
| 1h | 精读 `src/plugins/plugin-registry.ts`（前 80 行） | 插件注册表 |
| 1h | 精读 `src/plugins/loader.ts`（前 80 行） | 插件加载器 |
| 1h | 精读 `src/plugins/install.ts`（前 60 行） | 插件安装 |

---

### Day 16 — Discord Extension 深入（6h）

**目标**：完全读懂一个真实的 Extension（Discord）

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 30m | 阅读 `extensions/discord/openclaw.plugin.json` | 清单 |
| 30m | 阅读 `extensions/discord/index.ts` | 入口 |
| 2h | 精读 `extensions/discord/src/channel.ts`（前 150 行） | Channel 插件核心 |
| 1h | 阅读 `extensions/discord/src/accounts.ts` | 账号管理 |
| 1h | 阅读 `extensions/discord/src/outbound-adapter.ts` | 消息发送 |
| 1h | 浏览 `extensions/discord/src/` 其他文件 | 快速扫描 |

---

### Day 17 — Channel 消息处理主循环（5h）

**目标**：理解消息从到达到 AI 回复的完整处理链

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1.5h | 精读 `src/channels/draft-stream-loop.ts` | 消息处理主循环 |
| 1h | 精读 `src/channels/draft-stream-controls.ts` | 流式控制 |
| 1h | 精读 `src/channels/run-state-machine.ts` | 运行状态机 |
| 1.5h | 阅读 `src/channels/session.ts` | Channel 会话 |

---

### Day 18 — Plugin SDK（5h）

**目标**：理解插件开发者使用的工具集

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 浏览 `packages/plugin-sdk/` 目录结构 | 了解 SDK 模块 |
| 1h | 精读 `packages/plugin-sdk/src/channel-core.ts` | Channel 核心 API |
| 1h | 阅读 `packages/plugin-sdk/src/status-helpers.ts` | 状态工具 |
| 1h | 阅读 `packages/plugin-sdk/src/target-resolver-runtime.ts` | 目标解析 |
| 1h | 对比 Discord 和 Telegram Extension 的结构差异 | `extensions/telegram/` |

---

### Day 19 — 提供商插件（AI 模型）（5h）

**目标**：理解 AI 模型提供商插件的实现

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 30m | 阅读 `extensions/anthropic/openclaw.plugin.json` | Anthropic 清单 |
| 1h | 阅读 `extensions/anthropic/` 核心文件 | 提供商实现 |
| 1h | 精读 `src/plugins/provider-runtime.ts`（前 80 行） | 提供商运行时 |
| 1h | 阅读 `src/model-catalog/` | 模型目录 |
| 1.5h | 阅读 `src/gateway/openai-http.ts`（前 100 行） | OpenAI 兼容 API |

---

### Day 20~21 — 巩固周（周末）

- **Day 20**：挑战：阅读 `extensions/telegram/` 并对比 Discord，写出两者的主要区别
- **Day 21**：在 `extensions/discord/src/channel.ts` 中找到消息过滤逻辑，理解什么情况下消息会被忽略

---

## 第四周：Session 与 AI 层

### Day 22 — Session 管理（5h）

**目标**：理解会话的存储、加载和生命周期管理

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 阅读 [06-session-and-ai.md](./06-session-and-ai.md) | 文档 |
| 1h | 精读 `src/routing/session-key.ts` | Session Key 格式 |
| 1h | 精读 `src/config/sessions.ts`（前 100 行） | Session Store |
| 1h | 精读 `src/gateway/session-utils.ts`（前 100 行） | 运行时操作 |
| 1h | 阅读 `src/gateway/session-lifecycle-state.ts` | 生命周期状态 |

---

### Day 23 — AI 模型调用（5h）

**目标**：理解 AI 请求从构建到发送到流式接收的完整过程

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 精读 `src/agents/model-selection.ts`（前 80 行） | 模型解析 |
| 1.5h | 精读 `src/gateway/server-chat.ts`（前 150 行） | AI 调用主流程 |
| 1h | 阅读 `src/agents/context.ts` | 上下文管理 |
| 1.5h | 阅读 `src/auto-reply/` 关键文件 | 自动回复系统 |

---

### Day 24 — Agent 系统（5h）

**目标**：理解多 Agent 配置和工具调用

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 阅读 `src/agents/agent-scope.ts` | Agent 作用域 |
| 1h | 阅读 `src/agents/model-catalog.ts` | 模型目录 |
| 1h | 精读 `src/gateway/node-invoke-system-run-approval.ts` | 命令执行审批 |
| 1h | 阅读 `src/gateway/tools-invoke-http.ts` | 工具调用 HTTP |
| 1h | 浏览 `src/agents/` 其他文件 | 快速扫描 |

---

### Day 25 — 记忆与上下文压缩（4h）

**目标**：理解长期记忆和对话压缩机制

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 阅读 `src/memory/` 目录 | 记忆系统 |
| 1h | 精读 `src/plugins/compaction-provider.ts` | 上下文压缩 |
| 1h | 阅读 `src/plugins/memory-runtime.ts` | 记忆运行时 |
| 1h | 阅读 `src/gateway/session-archive.fs.ts` | 会话归档 |

---

### Day 26~27 — 巩固周（周末）

- **Day 26**：修改系统提示（`src/agents/`），给助手添加一个自定义的自我介绍
- **Day 27**：理解 Agent 并发控制：找到限制同一会话同时只有一个 AI 请求在处理的代码

---

## 第五周：高级主题

### Day 28 — MCP 协议（4h）

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 阅读 [07-advanced-topics.md](./07-advanced-topics.md) MCP 部分 | 文档 |
| 1h | 精读 `src/mcp/` 核心文件 | MCP 实现 |
| 1h | 阅读 `src/gateway/mcp-http.ts` | MCP HTTP 端点 |
| 1h | 配置一个本地 MCP 工具（如 filesystem）并测试 | 实践 |

---

### Day 29 — Hooks 深入（4h）

| 时间 | 内容 | 文件位置 |
|------|------|---------|
| 1h | 精读 `src/plugins/hooks.ts` | Hook 机制 |
| 1h | 精读 `src/plugins/wired-hooks-*.test.ts`（挑几个看）| 理解 Hook 触发场景 |
| 1h | 尝试给 Discord Extension 添加一个简单的 `before-agent-reply` Hook | 实践 |
| 1h | 阅读 `src/gateway/hooks.ts`（HTTP Hook） | HTTP Hooks |

---

### Day 30 — 综合实践（6h）

**最终挑战**：完成以下三个任务之一

**任务 A（简单）**：
给 `openclaw start` 命令添加一个 `--verbose` 标志，启动时打印更详细的配置信息。

**任务 B（中等）**：
在 Discord Extension 中，给 Bot 添加一个 `/ping` 命令响应，当用户在 Discord 输入 `/ping` 时，Bot 直接回复 `pong!`（不经过 AI）。

**任务 C（较难）**：
添加一个新的配置项 `gateway.startupMessage`，Gateway 启动成功后在所有已配置的 Channel 中发送这条消息。

---

## 参考：文件速查表

### 最重要的 50 个文件（按重要性排序）

```
1.  src/entry.ts                              # TypeScript 主入口
2.  src/cli/run-main.ts                       # CLI 分发核心
3.  src/config/paths.ts                       # 路径约定
4.  src/config/io.ts                          # 配置读写
5.  src/config/types.openclaw.ts              # 配置类型
6.  src/gateway/server.ts                     # Gateway 公共入口
7.  src/gateway/server.impl.ts                # Gateway 实现
8.  src/gateway/server-startup-early.ts       # 启动流程
9.  src/gateway/server-http.ts                # HTTP 服务
10. src/gateway/auth.ts                       # 认证
11. src/gateway/server-ws-runtime.ts          # WebSocket
12. src/gateway/server-channels.ts            # Channel 管理
13. src/gateway/server-chat.ts                # AI 调用
14. src/gateway/hooks.ts                      # HTTP Hooks
15. src/routing/session-key.ts                # Session Key
16. src/config/sessions.ts                    # Session 存储
17. src/gateway/session-utils.ts              # Session 运行时
18. src/agents/model-selection.ts             # 模型选择
19. src/agents/context.ts                     # 上下文管理
20. src/channels/draft-stream-loop.ts         # 消息处理主循环
21. src/plugins/manifest.ts                   # 插件清单
22. src/plugins/plugin-registry.ts            # 插件注册表
23. src/plugins/loader.ts                     # 插件加载
24. src/plugins/runtime.ts                    # 插件运行时
25. src/plugins/hooks.ts                      # 插件 Hooks
26. src/plugins/compaction-provider.ts        # 对话压缩
27. src/plugins/memory-runtime.ts             # 记忆运行时
28. extensions/discord/openclaw.plugin.json   # Discord 清单
29. extensions/discord/index.ts               # Discord 入口
30. extensions/discord/src/channel.ts         # Discord Channel
31. extensions/anthropic/openclaw.plugin.json # Anthropic 清单
32. src/cli/program.ts                        # Commander 命令树
33. src/cli/gateway-cli.ts                    # gateway 命令
34. src/cli/plugins-cli.ts                    # plugins 命令
35. src/cli/daemon-cli.ts                     # daemon 命令
36. src/gateway/server-runtime-state.ts       # 运行时状态
37. src/gateway/server-reload-handlers.ts     # 热加载
38. src/gateway/server-cron.ts                # Cron 服务
39. src/gateway/server-discovery-runtime.ts   # 服务发现
40. src/gateway/openai-http.ts                # OpenAI 兼容 API
41. src/gateway/mcp-http.ts                   # MCP HTTP
42. src/mcp/                                  # MCP 核心
43. src/infra/env.ts                          # 环境变量
44. src/infra/errors.ts                       # 错误处理
45. src/logging/subsystem.ts                  # 日志系统
46. src/config/env-substitution.ts            # 环境变量替换
47. src/config/validation.ts                  # 配置验证
48. src/config/zod-schema.ts                  # Zod Schema
49. packages/plugin-sdk/src/channel-core.ts   # SDK Channel 核心
50. openclaw.mjs                              # CLI 可执行入口
```

---

## 每日阅读技巧

1. **先看 import**：文件头部的 import 列表告诉你这个文件依赖哪些模块
2. **搜索导出**：`export function` / `export class` 告诉你这个文件对外提供什么
3. **找测试文件**：对应的 `.test.ts` 文件里的 describe/it 名称描述了函数的行为
4. **顺着类型走**：不懂一个函数参数的类型，跳到类型定义看字段
5. **用 grep 追踪**：某个函数在哪里被调用，用 `grep -r "functionName" src/` 查找
6. **不要死磕**：看不懂的先跳过，继续往前，很多时候后面的上下文会帮助理解前面的
