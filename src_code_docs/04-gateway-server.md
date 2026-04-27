# Gateway 服务器核心

---

## 1. Gateway 是什么

Gateway 是 OpenClaw 的心脏：一个同时提供 HTTP 和 WebSocket 服务的服务器。

```
┌─────────────────────────────────────────────────────────────────┐
│                      Gateway 服务器                              │
│                                                                  │
│  HTTP 服务 (默认端口 18789)                                      │
│  ├── /api/*         ← REST API（配置、会话、模型等）             │
│  ├── /hook/*        ← Webhook 入站（外部事件触发）              │
│  ├── /canvas/*      ← Canvas WebSocket                          │
│  ├── /mcp           ← MCP HTTP 协议端点                         │
│  └── /              ← 控制台 Web UI                             │
│                                                                  │
│  WebSocket 服务 (同端口)                                         │
│  ├── /              ← 客户端连接（iOS/Android/macOS App）        │
│  └── /channel/*     ← Extension（Channel 适配器）连接           │
│                                                                  │
│  内部模块                                                        │
│  ├── ChannelManager ← 管理所有已连接的 Channel                   │
│  ├── SessionStore   ← 会话状态存储                              │
│  ├── PluginRuntime  ← 插件运行时                                │
│  ├── CronService    ← 定时任务调度                              │
│  └── ModelCatalog   ← AI 模型目录                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Gateway 启动流程

### 2.1 触发链

```
openclaw start
    └── src/cli/gateway-cli.ts → startGatewayFromCli()
            └── src/gateway/server.ts → startGatewayServer()
                    └── src/gateway/server.impl.ts → startGatewayServer() 实现
```

### 2.2 启动阶段（server.impl.ts）

Gateway 启动分为多个有序阶段：

```
阶段 1: 配置加载
    loadGatewayStartupConfigSnapshot()  ← 读取配置快照
    prepareGatewayStartupConfig()       ← 验证、填充默认值

阶段 2: 插件初始化
    prepareGatewayPluginBootstrap()     ← 加载插件清单
    loadPluginRegistry()                ← 构建插件注册表

阶段 3: HTTP/WebSocket 服务器启动
    createHttpServer() / createHttpsServer()  ← 创建 HTTP 服务
    new WebSocketServer()               ← 创建 WebSocket 服务
    server.listen(port)                 ← 开始监听端口

阶段 4: 早期运行时（Early Runtime）
    startGatewayEarlyRuntime()
        ├── startGatewayDiscovery()     ← mDNS/广域网发现
        ├── startGatewayMaintenanceTimers() ← 心跳/清理定时器
        └── primeRemoteSkillsCache()    ← 预热技能缓存

阶段 5: Channel 启动
    createChannelManager()              ← 创建 Channel 管理器
    startAllChannels()                  ← 逐个启动已配置的 Channel

阶段 6: 后附加运行时（Post-Attach Runtime）
    startGatewayPostAttachRuntime()
        ├── buildGatewayCronService()   ← 启动 Cron 服务
        ├── activateGatewayScheduledServices() ← 激活计划服务
        └── startGatewayRuntimeServices() ← 启动运行时服务

阶段 7: 就绪
    gateway.ready()                     ← 通知所有等待方 Gateway 已就绪
    打印启动日志（端口、URL 等）
```

---

## 3. HTTP 服务层

文件：`src/gateway/server-http.ts`

### 3.1 请求路由

Gateway 的 HTTP 请求处理是手写路由（不用 Express），性能更高：

```typescript
// 伪代码展示路由逻辑
function handleRequest(req, res) {
  const { pathname } = new URL(req.url, base);

  if (pathname.startsWith("/api/")) {
    return handleApiRequest(req, res);
  }
  if (pathname.startsWith("/hook/")) {
    return handleHookRequest(req, res);  // Webhook 入站
  }
  if (pathname === "/mcp") {
    return handleMcpRequest(req, res);   // MCP 协议
  }
  if (pathname.startsWith("/canvas/")) {
    return handleCanvasRequest(req, res);
  }
  // 默认：Web UI 静态文件
  return handleControlUiRequest(req, res);
}
```

### 3.2 认证机制

所有 HTTP 请求都需要通过认证：

```typescript
// src/gateway/auth.ts
async function authorizeHttpGatewayConnect(req, config) {
  // 1. 本地直连（127.0.0.1）且无 Token → 有限访问
  if (isLocalDirectRequest(req) && !hasAuthToken(req)) {
    return { ok: true, scope: "limited" };
  }

  // 2. Bearer Token 验证
  const token = extractBearerToken(req);
  if (await verifyToken(token, config.gateway.secret)) {
    return { ok: true, scope: "full" };
  }

  return { ok: false, error: "Unauthorized" };
}
```

---

## 4. WebSocket 层

文件：`src/gateway/server-ws-runtime.ts`

### 4.1 两类 WebSocket 连接

```
WebSocket 连接
    │
    ├── Extension 连接（Channel 适配器）
    │   路径：/channel/<channelId>
    │   认证：Channel Token
    │   协议：JSON-RPC 风格的消息协议
    │   流向：Extension → Gateway（入站消息）
    │          Gateway → Extension（指令/回复）
    │
    └── 客户端连接（iOS/Android App、Web UI）
        路径：/（根路径）
        认证：Gateway Secret Token
        协议：Gateway 事件协议
        流向：App → Gateway（用户操作）
               Gateway → App（状态更新、AI 回复）
```

### 4.2 WebSocket 消息格式

Gateway 使用自定义的 JSON 消息协议：

```typescript
// 客户端 → Gateway（请求）
{
  type: "chat.send",       // 消息类型
  sessionKey: "abc123",    // 会话 Key
  payload: {
    text: "你好，OpenClaw！"
  }
}

// Gateway → 客户端（事件推送）
{
  type: "chat.delta",      // 流式 AI 回复片段
  sessionKey: "abc123",
  payload: {
    delta: "你好！我是 OpenClaw",
    done: false
  }
}
```

---

## 5. Channel 管理器

文件：`src/gateway/server-channels.ts`

### 5.1 职责

Channel 管理器负责管理所有 Channel（聊天平台适配器）的生命周期：

```typescript
type ChannelRuntimeStore = {
  aborts: Map<string, AbortController>;  // 每个 Channel 的取消控制器
  starting: Map<string, Promise<void>>;  // 正在启动的 Channel
  tasks: Map<string, Promise<unknown>>;  // Channel 运行任务
  runtimes: Map<string, ChannelAccountSnapshot>;  // Channel 运行状态
};
```

### 5.2 Channel 生命周期

```
配置中启用 discord
    │
    ▼
createChannelManager() 发现 discord 插件
    │
    ▼
startChannel("discord")
    ├── 加载 discord 插件代码（动态 import）
    ├── 创建 AbortController（用于停止）
    ├── 启动 discord Extension 进程
    │   └── Extension 通过 WebSocket 连接回 Gateway
    └── 注册到 runtimes Map
            │
    ┌───────┴───────┐
    │   运行中       │
    │  处理消息/回复  │
    └───────┬───────┘
            │ 出错或配置变更
            ▼
    重启策略（指数退避）
    CHANNEL_RESTART_POLICY = {
      initialMs: 5000,    // 初次等待 5s
      maxMs: 300000,      // 最长等待 5min
      factor: 2,          // 指数增长
      jitter: 0.1,        // 10% 随机抖动
    }
    MAX_RESTART_ATTEMPTS = 10
```

---

## 6. 运行时状态

文件：`src/gateway/server-runtime-state.ts`

Gateway 维护大量运行时状态，主要分为：

```typescript
// 聊天运行时状态（每个正在进行的对话）
chatRunState: Map<sessionKey, RunState>
chatAbortControllers: Map<sessionKey, AbortController>  // 用于中断 AI 回复
chatRunBuffers: Map<sessionKey, string[]>   // 流式输出缓冲

// Channel 状态
channelRuntimes: Map<channelId, ChannelStatus>

// 节点（移动设备）状态
nodeRegistry: Map<nodeId, NodeState>

// 会话状态
sessionCache: Map<sessionKey, SessionState>
```

---

## 7. 关键服务模块

### 7.1 Cron 服务

文件：`src/gateway/server-cron.ts`

```typescript
// Gateway 内置 Cron 服务（处理用户设置的定时任务）
const cronService = buildGatewayCronService({
  config,
  sendMessage: (sessionKey, text) => { /* 发送定时消息到 Channel */ },
});
```

### 7.2 健康检查

文件：`src/gateway/server/health-state.ts`

```
GET /health → { status: "ok", version: "...", channels: [...] }
```

### 7.3 服务发现

文件：`src/gateway/server-discovery-runtime.ts`

Gateway 通过以下方式让移动 App 发现它：
- **mDNS/Bonjour**：局域网自动发现
- **宽域发现**：通过配置的域名发现
- **Tailscale**：通过 Tailscale 网络发现

### 7.4 配置热加载

文件：`src/gateway/server-reload-handlers.ts`

```typescript
// 注册配置变更监听
startManagedGatewayConfigReloader({
  onConfigChange: async (newConfig, changedPaths) => {
    // 重启受影响的 Channel
    if (changedPaths.includes("discord")) {
      await channelManager.restartChannel("discord");
    }
    // 更新运行时配置
    updateRuntimeConfig(newConfig);
  }
});
```

---

## 8. Gateway 与 Extension 的通信协议

Extension（`extensions/` 下的插件）通过 WebSocket 与 Gateway 通信：

```
Extension 进程                    Gateway 进程
    │                                  │
    │── WebSocket 连接 ──────────────>│
    │                                  │ 验证 Channel Token
    │<── 握手确认 ─────────────────── │
    │                                  │
    │                                  │ 用户发送消息
    │<── { type: "message.inbound" } ─│
    │                                  │
    │  处理消息（调用平台 API）         │
    │                                  │
    │── { type: "reply.text", ... } ──>│
    │                                  │ 通过 Channel API 发送回复
```

---

## 9. Hooks 系统

文件：`src/gateway/hooks.ts`

Hooks 允许外部系统在 Gateway 事件上注入逻辑：

```typescript
// 支持的 Hook 端点
POST /hook/message         ← 消息到达时触发
POST /hook/agent           ← Agent 调用时触发
POST /hook/wake            ← 唤醒会话时触发

// 认证：每个 Hook 需要 Token
Authorization: Bearer <hook-token>
```

---

## 10. 关键文件阅读顺序

1. `src/gateway/server.ts`（很短，约 20 行）— 公共入口
2. `src/gateway/server.impl.ts`（前 100 行的 import）— 了解依赖关系
3. `src/gateway/server-startup-early.ts`（全文，约 150 行）— 启动流程
4. `src/gateway/server-channels.ts`（前 150 行）— Channel 管理
5. `src/gateway/server-http.ts`（前 60 行，看路由结构）
6. `src/gateway/auth.ts`（全文）— 认证逻辑

---

## 下一步

完成本文后，去读 [05-channel-plugin-system.md](./05-channel-plugin-system.md)。
