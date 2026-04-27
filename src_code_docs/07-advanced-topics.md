# 高级主题

---

## 1. Hooks 系统

Hooks 是 OpenClaw 的事件驱动扩展机制，允许外部系统在 AI 处理链的关键节点注入逻辑。

### 1.1 Hooks 类型

```typescript
// src/plugins/hook-types.ts

// 插件 Hook（由插件注册，在进程内执行）
type PluginHook =
  | "before-agent-start"    // AI 开始处理消息前
  | "before-agent-reply"    // AI 生成回复前（可以修改回复）
  | "before-agent-finalize" // AI 完成回复后
  | "before-tool-call"      // 工具调用前（可以阻止）
  | "after-tool-call"       // 工具调用后
  | "message"               // 收到消息时（Channel 层）
  | "before-install"        // 插件安装前

// HTTP Hook（通过 Webhook 端点，外部 HTTP 服务）
// 配置：config.hooks[].url
```

### 1.2 配置 HTTP Hooks

```json5
{
  "hooks": [
    {
      "url": "https://my-server.com/webhook",
      "token": "my-secret-token",
      "events": ["message", "before-agent-reply"]
    }
  ]
}
```

### 1.3 插件 Hook 注册

```typescript
// extensions/discord/index.ts
export default defineBundledChannelEntry({
  // ...
  registerFull(api) {
    // 注册 before-agent-reply Hook
    api.hooks.beforeAgentReply(async (ctx) => {
      // 可以修改 AI 回复
      if (ctx.text.includes("禁止词")) {
        return { text: "（回复已被过滤）" };
      }
    });
  },
});
```

### 1.4 关键文件

- `src/plugins/hooks.ts` — Hook 注册和触发机制
- `src/gateway/hooks.ts` — HTTP Hook 处理
- `src/gateway/hooks-mapping.ts` — Hook 事件映射

---

## 2. Cron 定时任务

### 2.1 概述

OpenClaw 内置 Cron 调度器（基于 `croner`），支持定时向会话发送消息。

### 2.2 配置示例

```json5
{
  "cron": {
    "jobs": [
      {
        // 每天早上 8 点发送日报
        "schedule": "0 8 * * *",
        "sessionKey": "discord/server123/channel789",
        "message": "早上好！今天的任务是...",
      },
      {
        // 每 30 分钟检查一次
        "schedule": "*/30 * * * *",
        "sessionKey": "telegram/default/group100",
        "agent": "monitor-agent",
        "message": "/check-status",
      }
    ]
  }
}
```

### 2.3 实现原理

```
croner 触发定时任务
    │
    ▼
src/gateway/server-cron.ts → buildGatewayCronService()
    │  组装消息
    ▼
src/channels/ → sendMessageToSession()
    │  像普通消息一样处理
    ▼
AI 模型处理 → 回复 → Channel 发出
```

关键文件：
- `src/cron/` — Cron 任务定义和调度
- `src/gateway/server-cron.ts` — Gateway 层 Cron 服务

---

## 3. MCP（Model Context Protocol）

### 3.1 什么是 MCP

MCP 是 Anthropic 制定的开放协议，让 AI 模型能够安全地使用外部工具和数据源。

OpenClaw 支持两个方向：
- **MCP Client**：调用外部 MCP 服务器提供的工具
- **MCP Server**：暴露自己的工具供其他 AI 使用

### 3.2 配置 MCP 工具

```json5
{
  "mcp": {
    "servers": [
      {
        "id": "filesystem",
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
      },
      {
        "id": "my-api",
        "type": "sse",
        "url": "https://my-mcp-server.com/sse"
      }
    ]
  }
}
```

### 3.3 MCP HTTP 端点

OpenClaw Gateway 也暴露 MCP 兼容 HTTP 端点：

```
GET/POST /mcp  ← 其他 AI 客户端可以连接这里使用 OpenClaw 的工具
```

关键文件：
- `src/mcp/` — MCP 核心实现
- `src/gateway/mcp-http.ts` — MCP HTTP 端点

---

## 4. 语音系统（TTS & 实时语音）

### 4.1 文字转语音（TTS）

OpenClaw 支持多个 TTS 提供商：

| 提供商 | Extension | 特点 |
|--------|-----------|------|
| ElevenLabs | `extensions/elevenlabs/` | 高质量云端 |
| Azure TTS | `extensions/azure-speech/` | 微软云端 |
| Deepgram | `extensions/deepgram/` | 实时转录 |
| MLX TTS | `apps/macos-mlx-tts/` | macOS 本地推理 |

配置：
```json5
{
  "tts": {
    "provider": "elevenlabs",
    "voice": "Rachel",
  }
}
```

### 4.2 实时语音（Realtime Voice）

基于 OpenAI Realtime API 的实时语音对话：

```
用户说话（macOS/iOS/Android App）
    │
    ▼
实时语音识别（Whisper）
    │
    ▼
AI 处理（GPT-4o-realtime）
    │
    ▼
实时 TTS → 播放给用户
```

关键文件：
- `src/tts/` — TTS 抽象层
- `src/realtime-voice/` — 实时语音管道
- `src/realtime-transcription/` — 语音识别

---

## 5. Canvas 系统

Canvas 是 OpenClaw 的实时可交互 Web 内容渲染系统。

### 5.1 概念

Canvas 允许 AI 在对话中渲染和更新 HTML/Lit Web Components，用户可以实时交互。

### 5.2 技术实现

```
AI 生成 Canvas 内容（HTML/JSON）
    │
    ▼
src/canvas-host/ → CanvasHostServer
    │  通过 WebSocket 推送给客户端
    ▼
Web UI（ui/）→ 渲染 Canvas
    │
    ▼
用户交互（点击/输入）→ 事件回传给 AI
```

关键文件：
- `src/canvas-host/` — Canvas 宿主服务
- `ui/` — 前端渲染（Lit Web Components）
- `skills/canvas/` — Canvas 操作技能

---

## 6. 节点（Nodes）系统

Nodes 是连接到 Gateway 的移动设备（iOS、Android、macOS App）。

### 6.1 节点类型

```typescript
type NodeKind =
  | "ios"      // iOS App
  | "android"  // Android App
  | "macos"    // macOS App
  | "browser"  // 浏览器
  | "camera"   // 摄像头节点
  | "screen"   // 屏幕共享节点
```

### 6.2 节点配对

节点通过 QR 码或配对码与 Gateway 配对：

```
1. Gateway 生成配对码（src/pairing/）
2. 用户在 App 扫码
3. App 通过 WebSocket 连接到 Gateway
4. Gateway 验证并注册节点
```

关键文件：
- `src/node-host/` — 节点宿主
- `src/pairing/` — 配对逻辑
- `src/cli/nodes-cli.ts` — 节点管理 CLI
- `apps/ios/`、`apps/android/`、`apps/macos/` — 原生 App

---

## 7. 守护进程（Daemon）

### 7.1 daemon vs 直接运行

```
openclaw start      ← 前台运行，Ctrl+C 停止
openclaw daemon start ← 后台守护进程运行
openclaw daemon stop  ← 停止守护进程
openclaw daemon status ← 查看状态
```

### 7.2 实现机制

在 Linux/macOS 上使用 systemd user unit：

```ini
# ~/.config/systemd/user/openclaw.service（生成的）
[Service]
ExecStart=/usr/local/bin/openclaw start
Restart=on-failure
RestartSec=5
```

关键文件：
- `src/daemon/` — 守护进程管理
- `src/cli/daemon-cli/` — daemon 子命令

---

## 8. 安全系统

### 8.1 Gateway Secret

Gateway 的核心认证机制：

```
所有 WebSocket/HTTP 请求必须携带 Gateway Secret
    │
    └── Authorization: Bearer <secret>
        或 WebSocket 握手时通过 Token 参数
```

生成：`openclaw start` 首次运行自动生成随机 Secret。

### 8.2 工具执行审批

AI 工具调用（如执行命令）需要用户审批：

```
AI 想执行: rm -rf /tmp/test
    │
    ▼
src/gateway/node-invoke-system-run-approval.ts
    │  生成审批请求
    ▼
推送给所有已连接的客户端（App/Web UI）
    │
    ▼
用户点击「批准」或「拒绝」
    │
    ▼
    ├── 批准 → 执行命令 → 结果返回给 AI
    └── 拒绝 → AI 收到拒绝信息
```

### 8.3 Exec Policy（执行策略）

可以预配置允许/禁止的命令：

```json5
{
  "agents": {
    "defaults": {
      "execPolicy": {
        "allow": ["git *", "npm test"],
        "deny": ["rm -rf *", "sudo *"]
      }
    }
  }
}
```

---

## 9. 调试技巧

### 9.1 日志级别

```bash
OPENCLAW_LOG_LEVEL=debug openclaw start
```

### 9.2 关键环境变量

| 变量 | 说明 |
|------|------|
| `OPENCLAW_LOG_LEVEL` | 日志级别（error/warn/info/debug/trace） |
| `OPENCLAW_STATE_DIR` | 状态目录覆盖 |
| `OPENCLAW_CONFIG_PATH` | 配置文件路径覆盖 |
| `OPENCLAW_GATEWAY_PORT` | Gateway 端口覆盖 |
| `OPENCLAW_NIX_MODE=1` | Nix 模式 |
| `OPENCLAW_TEST_FAST=1` | 测试快速模式 |
| `NODE_DISABLE_COMPILE_CACHE=1` | 禁用编译缓存（调试用） |

### 9.3 诊断工具

```bash
openclaw system info      # 系统信息
openclaw logs             # 查看日志
openclaw dns              # DNS 诊断
openclaw gateway status   # Gateway 状态
```

---

## 10. 如何修改源码

### 10.1 开发工作流

```bash
# 1. 安装依赖
pnpm install

# 2. 构建（修改代码后运行）
pnpm build

# 3. 测试修改
node openclaw.mjs start

# 4. 运行单元测试
pnpm test

# 5. 类型检查
pnpm typecheck
```

### 10.2 常见修改场景

**修改配置 Schema**（添加新配置项）：
1. `src/config/schema.ts` — 添加 JSON Schema
2. `src/config/types.openclaw.ts` — 添加 TypeScript 类型
3. `src/config/zod-schema.ts` — 添加 Zod 验证

**添加新 CLI 命令**：
1. 创建 `src/cli/my-command-cli.ts`
2. 在 `src/cli/program.ts` 注册命令

**修改 AI 系统提示**：
- `src/agents/assistant-identity.ts` — 助手身份/系统提示

**添加新的 Channel 平台**：
1. 在 `extensions/` 下创建新目录
2. 参考 `extensions/discord/` 的结构实现
3. 创建 `openclaw.plugin.json` 声明插件

---

## 下一步

读完所有基础文档后，参考 [08-reading-plan.md](./08-reading-plan.md) 的每日计划，系统性地阅读源码。
