# OpenClaw 源码学习指南

> 目标：4~6 小时/天，最长 1 个月，达到熟悉并可修改源码的水平
> 读者背景：Java、Python、Go，TypeScript 不熟悉

---

## 文档索引

| 文档 | 内容 | 建议阅读时间 |
|------|------|------------|
| [00-typescript-primer.md](./00-typescript-primer.md) | TypeScript 速查手册（面向 Java/Python 程序员，兼顾 Go） | 第 1 天 |
| [01-project-structure.md](./01-project-structure.md) | 项目结构与构建系统 | 第 2 天 |
| [02-entry-and-cli.md](./02-entry-and-cli.md) | 入口链与 CLI 命令注册 | 第 3~4 天 |
| [03-config-system.md](./03-config-system.md) | 配置系统 | 第 5~6 天 |
| [04-gateway-server.md](./04-gateway-server.md) | Gateway 服务器核心 | 第 7~10 天 |
| [05-channel-plugin-system.md](./05-channel-plugin-system.md) | Channel 与插件系统 | 第 11~15 天 |
| [06-session-and-ai.md](./06-session-and-ai.md) | Session 管理与 AI 层 | 第 16~20 天 |
| [07-advanced-topics.md](./07-advanced-topics.md) | 高级主题（Hooks/Cron/Voice/Canvas） | 第 21~28 天 |
| [08-reading-plan.md](./08-reading-plan.md) | 完整每日阅读计划（含推荐文件列表） | 全程参考 |

---

## 架构一句话总结

```
用户消息 → 聊天平台（Discord/Telegram/...）
         → Extension（适配器，运行在子进程）
         → Gateway（WebSocket，主服务）
         → Session（会话状态）
         → AI Model（OpenAI/Claude/...）
         → 回复原路返回
```

---

## 如何使用这份文档

1. **按顺序阅读**：文档之间有依赖关系，建议不要跳读
2. **边读边跑**：每天打开对应源文件，对照文档理解
3. **用 `grep` 验证**：文档里提到的类/函数，自己去源码里找到确认
4. **修改实验**：第 3 周起可以尝试小改动（改日志级别、改配置默认值等）

---

## 快速定位关键文件

```
# 启动入口
openclaw.mjs                    ← CLI 可执行文件
src/entry.ts                    ← TypeScript 主入口
src/cli/run-main.ts             ← CLI 分发逻辑

# Gateway 核心
src/gateway/server.impl.ts      ← Gateway 服务器实现（最复杂的文件）
src/gateway/server-startup.ts   ← 启动流程
src/gateway/server-channels.ts  ← Channel 管理器

# 配置系统
src/config/config.ts            ← 配置加载/读写核心
src/config/schema.ts            ← 配置 JSON Schema
src/config/types.openclaw.ts    ← 配置类型定义

# 插件系统
src/plugins/runtime.ts          ← 插件运行时
src/plugins/loader.ts           ← 插件加载器
src/plugins/manifest.ts         ← 插件 Manifest 定义

# Channel 层
src/channels/session.ts         ← Channel 会话
src/channels/draft-stream-loop.ts ← 消息处理主循环

# Extensions（各平台适配器）
extensions/discord/             ← Discord 适配器（推荐第一个读）
extensions/anthropic/           ← Anthropic 模型适配器
```
