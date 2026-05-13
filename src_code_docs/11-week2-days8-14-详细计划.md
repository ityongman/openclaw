# 第二周详细学习计划（Day 8-14）

> 目标：深入理解 Gateway 核心——启动流程、HTTP/WebSocket 服务、Channel 管理、配置热加载、安全机制
>
> 前提：已完成第一周，能成功构建项目并理解配置系统

---

## Day 8 — Gateway 启动流程 (5h)

### 学习目标

- 理解 Gateway 从 `startGatewayServer()` 调用到服务器就绪的完整 7 个阶段
- 理解 `AbortController` 实现优雅关闭
- 能跟踪启动日志定位到每个阶段

---

### 序列图：Gateway 启动 7 阶段

```mermaid
sequenceDiagram
    participant cli as gateway-cli.ts
    participant server as gateway/server.ts
    participant impl as server.impl.ts
    participant http as node:http
    participant ws as WebSocket
    participant plugins as 插件系统
    participant health as 健康检查

    cli->>server: startGatewayServer(port, opts)
    server->>impl: 懒加载 startGatewayServer
    
    Note over impl: Phase 1: Bootstrap 网络运行时
    impl->>impl: 初始化 AbortController（优雅关闭信号）
    impl->>impl: 注册 SIGTERM/SIGINT 信号处理器
    
    Note over impl: Phase 2: 加载启动配置快照
    impl->>impl: loadConfig()（读取 openclaw.json）
    
    Note over impl: Phase 3: 插件引导
    impl->>plugins: bootstrapPluginRegistry()
    plugins-->>impl: PluginRegistry（已注册所有插件）
    
    Note over impl: Phase 4: 创建运行时状态
    impl->>http: http.createServer(handleRequest)
    impl->>ws: new WebSocketServer({ noServer: true })
    impl->>impl: 创建 GatewayRuntimeState
    
    Note over impl: Phase 5: 启动早期运行时
    impl->>health: 启动健康检查服务
    impl->>impl: 启动 mDNS/Bonjour 服务发现
    
    Note over impl: Phase 6: 附加 WebSocket 处理器
    impl->>ws: 注册 connection/error 事件
    
    Note over impl: Phase 7: 开始监听
    impl->>http: server.listen(port)
    http-->>impl: listening 事件
    impl-->>cli: GatewayServer（已就绪）
```

---

### 详细任务清单

#### 任务 1：阅读 `04-gateway-server.md` (1h)

**阅读范围**：`src_code_docs/04-gateway-server.md` 全文

---

#### 任务 2：精读 `src/gateway/server.ts` (20m)

**阅读范围**：`src/gateway/server.ts` 全文（18 行）

**关键代码**：

```typescript
// src/gateway/server.ts L7-12（懒加载包装器）
export async function startGatewayServer(
  ...args: Parameters<typeof startGatewayServerImpl>
): ReturnType<typeof startGatewayServerImpl> {
  // 懒加载：只有在执行 start 命令时才加载大型的 server.impl.ts
  const { startGatewayServer: impl } = await import("./server.impl.js");
  return impl(...args);
}
```

**理解重点**：
- `Parameters<T>` — TypeScript 内置类型工具，提取函数参数类型
- `ReturnType<T>` — 提取函数返回值类型
- `...args` — 展开参数（rest/spread 语法）
- 这个文件本质是一个**薄包装层**，只做懒加载，不含实际逻辑

---

#### 任务 3：精读 `src/gateway/server.impl.ts` 前 100 行（imports + 类型定义）(1h)

**阅读范围**：`src/gateway/server.impl.ts` L1-291

**关键类型定义**：

```typescript
// src/gateway/server.impl.ts L221-223
type GatewayServer = {
  port: number;
  close: () => Promise<void>;  // 关闭服务器的函数
};

// src/gateway/server.impl.ts L225-283（GatewayServerOptions 关键字段）
type GatewayServerOptions = {
  signal?: AbortSignal;    // 关闭信号（可选）
  config?: OpenClawConfig; // 预加载的配置（可选）
  onReady?: () => void;    // 就绪回调
  // ... 更多选项
};
```

**AbortController 机制**（重要，后续代码频繁使用）：

```typescript
// AbortController 用于取消异步操作 / 优雅关闭
const controller = new AbortController();  // 创建控制器
const { signal } = controller;              // 获取信号对象

// 监听取消信号
signal.addEventListener("abort", () => {
  console.log("收到关闭信号，开始清理...");
});

// 触发关闭（例如 SIGTERM 时）
controller.abort();  // → 触发所有 addEventListener("abort") 回调
```

---

#### 任务 4：精读 `startGatewayServer` 函数（7 个阶段）(1.5h)

**阅读范围**：`src/gateway/server.impl.ts` L292-1002

**逐阶段理解**：

**Phase 1: Bootstrap 网络运行时 (L296)**
```typescript
// 初始化 AbortController
const gatewayAbortController = new AbortController();
const { signal: gatewaySignal } = gatewayAbortController;

// 注册操作系统信号处理（优雅关闭）
process.once("SIGTERM", () => gatewayAbortController.abort());
process.once("SIGINT",  () => gatewayAbortController.abort());
```

**Phase 2: 加载启动配置快照 (L313-318)**
```typescript
// 如果调用者没有传入 config，则从文件加载
const config = opts.config ?? loadConfig();
```

**Phase 3: 插件引导 (L403-432)**
```typescript
// 扫描并注册所有已安装的插件
const pluginRegistry = await bootstrapPluginRegistry(config);
// pluginRegistry 包含所有已加载的插件实例
```

**Phase 4: 创建运行时状态 (L527-607)**
```typescript
// 创建 HTTP 服务器
const httpServer = http.createServer();

// 创建 WebSocket 服务器（不独立监听，依附于 HTTP 服务器）
const wsServer = new WebSocketServer({ noServer: true });

// 组装运行时状态（贯穿整个 Gateway 生命周期的对象）
const runtimeState: GatewayRuntimeState = {
  config,
  httpServer,
  wsServer,
  pluginRegistry,
  signal: gatewaySignal,
  // ...
};
```

**Phase 7: 开始监听 (L894-927)**
```typescript
// 开始监听端口
await new Promise<void>((resolve, reject) => {
  httpServer.listen(port, () => {
    console.log(`Gateway 监听在端口 ${port}`);
    resolve();
  });
  httpServer.once("error", reject);
});
```

---

#### 任务 5：精读 `src/gateway/server-startup-early.ts` (0.5h)

**阅读范围**：`src/gateway/server-startup-early.ts` 全文

**理解重点**：
- 早期运行时（Early Runtime）启动了哪些服务？
- 健康检查服务如何注册？
- mDNS/Bonjour 服务发现如何工作？

---

### Debug 实操：跟踪 Gateway 启动日志

```bash
# 设置调试日志级别，观察每个阶段的日志
OPENCLAW_LOG_LEVEL=debug node openclaw.mjs start 2>&1 | head -50
```

**在 `server.impl.ts` 关键位置添加阶段日志**：

```typescript
// src/gateway/server.impl.ts L292（Phase 1 之前）
console.error("[server.impl] Phase 1: Bootstrapping gateway runtime...");

// L313（Phase 2 之前）
console.error("[server.impl] Phase 2: Loading config snapshot...");

// L403（Phase 3 之前）
console.error("[server.impl] Phase 3: Plugin bootstrap...");

// L894（Phase 7 之前）
console.error("[server.impl] Phase 7: Starting to listen on port", port);
```

构建后运行：
```bash
pnpm build && node openclaw.mjs start 2>&1 | grep "\[server.impl\]"
```

---

### 知识检验

1. `GatewayServer` 类型有哪两个字段？
2. `AbortController.abort()` 被调用时，已注册的 `abort` 事件监听器何时执行？
3. `server.ts` 为什么只有 18 行？它的作用是什么？

---

## Day 9 — HTTP/WebSocket 服务 (5h)

### 学习目标

- 理解 Gateway HTTP 路由的完整处理流程
- 理解 WebSocket 握手升级（HTTP Upgrade）
- 理解 Bearer Token 认证机制

---

### 序列图：HTTP 请求处理流程

```mermaid
sequenceDiagram
    participant client as HTTP 客户端
    participant http as Node.js HTTP 服务器
    participant handler as handleRequest()
    participant auth as auth.ts
    participant route as 路由分发

    client->>http: POST /v1/chat/completions
    http->>handler: req, res
    handler->>handler: 解析请求路径
    handler->>auth: authorizeGatewayConnect(req)
    auth->>auth: 提取 Authorization 头
    auth->>auth: 比较 Bearer token 与 gateway.secret
    alt 认证通过
        auth-->>handler: AuthResult { success: true }
        handler->>route: 匹配路由 /v1/chat/completions
        route->>route: 处理 AI 请求
        route-->>client: 200 OK (流式响应)
    else 认证失败
        auth-->>handler: AuthResult { success: false }
        handler-->>client: 401 Unauthorized
    end
```

---

### 序列图：WebSocket 升级握手

```mermaid
sequenceDiagram
    participant client as WebSocket 客户端
    participant http as HTTP 服务器
    participant upgrade as attachGatewayUpgradeHandler
    participant auth as auth.ts
    participant ws as WebSocketServer

    client->>http: GET /ws (带 Upgrade: websocket 头)
    http->>upgrade: upgrade 事件（req, socket, head）
    upgrade->>upgrade: 提取 URL 中的 token 参数
    upgrade->>auth: authorizeGatewayConnect({ token, surface: "ws-control-ui" })
    alt token 有效
        auth-->>upgrade: 认证通过
        upgrade->>ws: wss.handleUpgrade(req, socket, head, (wsClient) => ...)
        ws-->>client: 101 Switching Protocols
        ws->>ws: emit("connection", wsClient)
    else token 无效
        auth-->>upgrade: 认证失败
        upgrade->>socket: socket.destroy()（关闭连接）
    end
```

---

### 详细任务清单

#### 任务 1：精读 `src/gateway/server-http.ts` 前 100 行 (1.5h)

**阅读范围**：`src/gateway/server-http.ts` L1-469（路由定义部分）

**关键路由列表**（在代码中找到每条路由的处理逻辑）：

```
GET  /health           → 健康检查，返回 { status: "ok", version: "x.x.x" }
GET  /v1/models        → 列出可用 AI 模型（OpenAI 兼容）
POST /v1/chat/completions → AI 对话（OpenAI 兼容）
GET/POST /mcp          → MCP 协议端点
GET  /canvas/          → Canvas 渲染服务
GET  /api/*            → REST API（前端控制台使用）
```

**路由判断辅助函数**（`src/gateway/server-http.ts` L197-237）：

```typescript
// 请求路径判断函数
function isHealthPath(url: string): boolean {
  return url === "/health" || url.startsWith("/health?");
}
function isApiPath(url: string): boolean {
  return url.startsWith("/api/");
}
function isOpenAiCompatPath(url: string): boolean {
  return url.startsWith("/v1/");
}
```

**`handleRequest` 的整体结构**（L527-801）：

```typescript
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url ?? "/";

  // 1. /health 端点不需要认证
  if (isHealthPath(url)) {
    return handleHealth(req, res);
  }

  // 2. 所有其他请求需要认证
  const authResult = await authorizeGatewayConnect({
    req,
    config,
    surface: "http",
  });

  if (!authResult.success) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // 3. 路由分发
  if (isOpenAiCompatPath(url)) {
    return handleOpenAiCompat(req, res, authResult);
  }
  if (isApiPath(url)) {
    return handleApi(req, res, authResult);
  }
  // ...
}
```

---

#### 任务 2：精读 `src/gateway/auth.ts` (1h)

**阅读范围**：`src/gateway/auth.ts` L1-529

**关键类型定义**：

```typescript
// src/gateway/auth.ts L32-48
type GatewayAuthResult = {
  success: boolean;
  // 认证成功时包含：
  userId?: string;
  sessionId?: string;
  // 认证失败时包含：
  error?: string;
  statusCode?: number;
};

// src/gateway/auth.ts L55
type GatewayAuthSurface = "http" | "ws-control-ui";

// src/gateway/auth.ts L50-83
type AuthorizeGatewayConnectParams = {
  req: http.IncomingMessage;
  config: OpenClawConfig;
  surface: GatewayAuthSurface;
  token?: string;  // WebSocket 握手时通过 URL 参数传入
};
```

**认证核心逻辑**（L361-510）：

```typescript
// src/gateway/auth.ts L361-394
async function authorizeGatewayConnect(
  params: AuthorizeGatewayConnectParams
): Promise<GatewayAuthResult> {
  // 调用核心认证（分离设计，便于测试）
  return authorizeGatewayConnectCore(params);
}

// src/gateway/auth.ts L396-510
async function authorizeGatewayConnectCore(
  params: AuthorizeGatewayConnectParams
): Promise<GatewayAuthResult> {
  const { req, config, token } = params;

  // 方式 1：从 Authorization 头提取 Bearer token
  const authHeader = req.headers["authorization"] ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  // 方式 2：URL 中的 token 参数（WebSocket 用）
  const urlToken = token;

  const providedToken = bearerToken ?? urlToken;

  // 比较 token 与配置中的 gateway.secret
  if (providedToken === config.gateway.secret) {
    return { success: true };
  }

  return { success: false, error: "Invalid token", statusCode: 401 };
}
```

**接口调用关系**：

```
authorizeGatewayConnect(params: AuthorizeGatewayConnectParams)
  → Promise<GatewayAuthResult>
  
  调用方:
    handleRequest [server-http.ts:530]        ← HTTP 请求认证
    attachGatewayUpgradeHandler [server-http.ts:806] ← WebSocket 升级认证
```

---

#### 任务 3：精读 `src/gateway/server-ws-runtime.ts` 前 80 行 (1h)

**阅读范围**：`src/gateway/server-ws-runtime.ts` L1-80

**WebSocket 连接管理**：

```typescript
// WebSocket 连接后的处理流程
wss.on("connection", (wsClient, req) => {
  // 1. 为每个客户端创建会话
  const clientSession = createWsClientSession(wsClient, req);

  // 2. 注册消息处理器
  wsClient.on("message", (data) => {
    handleWsMessage(clientSession, data);
  });

  // 3. 注册断开处理器
  wsClient.on("close", () => {
    removeWsClientSession(clientSession.id);
  });
});
```

---

#### 任务 4：精读 `src/gateway/auth-rate-limit.ts` (1.5h)

**阅读范围**：`src/gateway/auth-rate-limit.ts` 全文

**理解重点**：
- 限流算法（滑动窗口 or 令牌桶？）
- 被限流时返回 429 Too Many Requests
- 如何防止暴力破解 gateway secret

---

### Debug 实操：测试 HTTP 认证

```bash
# 启动 Gateway（使用测试配置）
OPENCLAW_LOG_LEVEL=debug node openclaw.mjs start &
GATEWAY_PID=$!

# 等待启动
sleep 2

# 1. 测试健康检查（不需要 token）
curl -s http://localhost:18789/health | python3 -m json.tool

# 2. 测试无 token 访问（应该返回 401）
curl -s -o /dev/null -w "%{http_code}" http://localhost:18789/api/status

# 3. 测试带正确 token 的访问
curl -s -H "Authorization: Bearer test-secret-change-me" \
  http://localhost:18789/api/status | python3 -m json.tool

# 停止 Gateway
kill $GATEWAY_PID
```

**预期结果**：
- `/health` → 200 + `{"status":"ok",...}`
- `/api/status`（无 token）→ 401
- `/api/status`（有 token）→ 200 + 状态信息

---

### 知识检验

1. HTTP 请求 `/health` 需要 Bearer token 认证吗？（答：不需要）
2. WebSocket 连接时，token 通过什么方式传递？（答：URL 查询参数）
3. `GatewayAuthSurface` 有哪两个值？分别用于什么场景？

---

## Day 10 — Channel 管理器 (5h)

### 学习目标

- 理解 Gateway 如何管理 Channel 插件的生命周期
- 理解 Channel 的健康监控和自动重连
- 理解指数退避（Exponential Backoff）算法

---

### 序列图：Channel 生命周期管理

```mermaid
stateDiagram-v2
    [*] --> IDLE: Channel 注册
    IDLE --> STARTING: Gateway 启动 Channel
    STARTING --> RUNNING: Channel.start() 成功
    STARTING --> FAILED: Channel.start() 抛出错误
    RUNNING --> FAILED: Channel 意外断开
    FAILED --> STARTING: 退避后重试
    RUNNING --> STOPPING: Gateway 关闭信号
    STOPPING --> [*]: Channel.stop() 完成
    FAILED --> [*]: 达到最大重试次数
```

---

### 详细任务清单

#### 任务 1：精读 `src/gateway/server-channels.ts` 前 150 行 (1.5h)

**阅读范围**：`src/gateway/server-channels.ts` L1-150

**关键函数**：

```typescript
// Channel 管理器的核心职责
class ChannelManager {
  // 存储所有 Channel 的状态
  private channels: Map<string, ChannelRuntime> = new Map();

  // 启动所有配置的 Channel
  async startAll(config: OpenClawConfig, signal: AbortSignal): Promise<void> {
    for (const [channelId, channelConfig] of Object.entries(config.channels ?? {})) {
      await this.startChannel(channelId, channelConfig, signal);
    }
  }

  // 启动单个 Channel（带重试逻辑）
  async startChannel(
    id: string,
    config: ChannelConfig,
    signal: AbortSignal
  ): Promise<void> {
    const plugin = this.pluginRegistry.getChannelPlugin(id);
    if (!plugin) {
      console.warn(`Channel plugin "${id}" not found`);
      return;
    }

    // 创建 Channel 运行时
    const runtime = createChannelRuntime(id, plugin, config);
    this.channels.set(id, runtime);

    // 异步启动（不等待）
    this.runChannelWithRetry(runtime, signal);
  }
}
```

**`ChannelRuntime` 状态结构**：

```typescript
type ChannelRuntime = {
  id: string;
  plugin: ChannelPlugin;
  state: "idle" | "starting" | "running" | "failed" | "stopping";
  retryCount: number;
  lastError?: Error;
};
```

---

#### 任务 2：阅读 `src/infra/backoff.ts` (1h)

**阅读范围**：`src/infra/backoff.ts` 全文

**指数退避算法**（核心概念）：

```typescript
// 指数退避：失败后等待时间指数增长
function calculateBackoffDelay(
  retryCount: number,
  options: BackoffOptions = {}
): number {
  const {
    initialDelayMs = 1000,    // 第一次重试等 1 秒
    multiplier = 2,           // 每次翻倍
    maxDelayMs = 30000,       // 最长等 30 秒
    jitter = true,            // 添加随机抖动（避免惊群效应）
  } = options;

  // 计算基础延迟：1000, 2000, 4000, 8000, 16000, 30000(上限)
  const baseDelay = Math.min(
    initialDelayMs * Math.pow(multiplier, retryCount),
    maxDelayMs
  );

  // 添加抖动（±20%）
  if (jitter) {
    return baseDelay * (0.8 + Math.random() * 0.4);
  }
  return baseDelay;
}
```

**为什么需要退避？**

```
没有退避（危险）:
  Channel 断开 → 立即重试 → 立即断开 → 立即重试...（无限循环，消耗 CPU）

有退避（正确）:
  第1次失败 → 等 1s → 重试
  第2次失败 → 等 2s → 重试
  第3次失败 → 等 4s → 重试
  ...
  第6次失败 → 等 30s → 重试（不再增加）
```

**Debug 实操**：测试退避算法：

```bash
node --input-type=module << 'EOF'
function calculateBackoff(retryCount, max = 30000) {
  const base = Math.min(1000 * Math.pow(2, retryCount), max);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

console.log("退避延迟示例（ms）：");
for (let i = 0; i < 8; i++) {
  console.log(`  重试 ${i+1}: ${calculateBackoff(i)}ms`);
}
EOF
```

---

#### 任务 3：精读 `src/gateway/channel-health-monitor.ts` (1.5h)

**阅读范围**：`src/gateway/channel-health-monitor.ts` 全文

**健康监控原理**：

```typescript
// 定期检查所有 Channel 的健康状态
class ChannelHealthMonitor {
  private intervalId?: NodeJS.Timeout;

  start(interval: number = 30000) {
    this.intervalId = setInterval(() => {
      this.checkAllChannels();
    }, interval);
  }

  private async checkAllChannels() {
    for (const [id, runtime] of this.channels) {
      if (runtime.state === "running") {
        try {
          await runtime.plugin.healthCheck?.();
        } catch (err) {
          console.error(`Channel ${id} health check failed:`, err);
          runtime.state = "failed";
          this.scheduleRestart(id);
        }
      }
    }
  }
}
```

---

#### 任务 4：阅读 `src/gateway/server-runtime-state.ts` (1h)

**阅读范围**：`src/gateway/server-runtime-state.ts` 全文

**`GatewayRuntimeState` 是贯穿整个 Gateway 生命周期的核心对象**：

```typescript
// GatewayRuntimeState 的主要字段（示意）
type GatewayRuntimeState = {
  config: OpenClawConfig;          // 当前运行时配置
  httpServer: http.Server;         // HTTP 服务器实例
  wsServer: WebSocketServer;       // WebSocket 服务器实例
  pluginRegistry: PluginRegistry;  // 插件注册表
  channelManager: ChannelManager;  // Channel 管理器
  signal: AbortSignal;             // 关闭信号
  port: number;                    // 监听端口
};
```

---

### 知识检验

1. 当一个 Channel 连接断开时，重试前会等多久（第一次）？
2. 指数退避中"抖动"的作用是什么？
3. `ChannelRuntime.state` 有哪几种状态？

---

## Day 11 — 配置热加载与 Hooks (5h)

### 学习目标

- 理解 Gateway 运行时如何处理配置变更（不重启服务）
- 理解 Plugin Hook（进程内）和 HTTP Hook（外部 Webhook）的区别
- 理解 Cron 定时任务的触发机制

---

### 序列图：配置热加载流程

```mermaid
sequenceDiagram
    participant user as 用户/API
    participant io as config/io.ts
    participant listener as 配置变更监听器
    participant handler as server-reload-handlers.ts
    participant channels as ChannelManager
    participant hooks as HooksRuntime

    user->>io: mutateConfigFile(updater函数)
    io->>io: 读取当前配置
    io->>io: 调用 updater(current) 生成新配置
    io->>io: 验证新配置（Zod）
    io->>io: 原子写入文件（先写临时文件，再重命名）
    io->>listener: 通知所有 registerConfigWriteListener 注册的回调
    listener->>handler: onConfigChanged(changedPaths, newConfig)
    
    handler->>handler: 分析哪些字段变更了
    alt gateway.port 变更
        handler->>handler: 警告：端口变更需要重启
    end
    alt providers.anthropic 变更
        handler->>handler: 更新 AI 提供商配置
    end
    alt channels.discord 变更
        handler->>channels: 重启 discord Channel
    end
    alt hooks 变更
        handler->>hooks: 重新加载 Hook 配置
    end
```

---

### 序列图：HTTP Hook 触发流程

```mermaid
sequenceDiagram
    participant gateway as Gateway
    participant hooks as gateway/hooks.ts
    participant external as 外部 HTTP 服务

    gateway->>hooks: triggerHook("message", { text, sessionKey })
    hooks->>hooks: 查找配置中 events 包含 "message" 的所有 Hook
    
    loop 对每个匹配的 Hook 配置
        hooks->>external: POST hook.url（JSON 请求体）
        Note right of external: Authorization: Bearer <hook.token>
        external-->>hooks: 200 OK（可选：返回修改后的数据）
        hooks->>hooks: 如果响应包含修改，应用到原始数据
    end
    
    hooks-->>gateway: 处理后的数据（或原始数据）
```

---

### 详细任务清单

#### 任务 1：精读 `src/gateway/server-reload-handlers.ts` (1h)

**阅读范围**：`src/gateway/server-reload-handlers.ts` 全文

**核心模式**：

```typescript
// 注册配置变更监听（在 Gateway 启动时调用）
function registerGatewayReloadHandlers(runtimeState: GatewayRuntimeState) {
  registerConfigWriteListener(async (notification) => {
    const { changedPaths, newConfig } = notification;

    // 根据变更的配置路径决定如何响应
    if (changedPaths.some(p => p.startsWith("channels."))) {
      // Channel 配置变更 → 重启受影响的 Channel
      await runtimeState.channelManager.applyConfigUpdate(newConfig);
    }

    if (changedPaths.some(p => p.startsWith("hooks"))) {
      // Hook 配置变更 → 重新加载 Hook
      runtimeState.hooksRuntime.reload(newConfig.hooks ?? []);
    }
  });
}
```

**接口调用关系**：

```
registerGatewayReloadHandlers(runtimeState) [server-reload-handlers.ts]
  └── registerConfigWriteListener(callback) [config/io.ts]
        └── callback 在 writeConfigFile() 后被调用
```

---

#### 任务 2：精读 `src/gateway/hooks.ts` 前 100 行 (1h)

**阅读范围**：`src/gateway/hooks.ts` L1-100

**HTTP Hook 数据结构**：

```typescript
// 配置中的 Hook 定义
type HookConfig = {
  url: string;                    // Webhook 目标 URL
  token?: string;                 // 认证 token（可选）
  events: HookEvent[];            // 监听的事件列表
  timeout?: number;               // 超时（毫秒，默认 5000）
};

// 发送给 Webhook 的数据
type HookPayload = {
  event: HookEvent;               // 事件类型
  timestamp: number;              // Unix 时间戳
  sessionKey?: string;            // 会话 Key
  text?: string;                  // 消息文本
  metadata?: Record<string, unknown>;
};
```

---

#### 任务 3：精读 `src/gateway/hooks-mapping.ts` (1h)

**阅读范围**：`src/gateway/hooks-mapping.ts` 全文

**理解 Hook 类型到处理函数的映射关系**：

```typescript
// Hook 事件类型
type HookEvent =
  | "message"              // 收到新消息
  | "before-agent-reply"   // AI 生成回复前
  | "before-agent-start"   // AI 开始处理前
  | "before-tool-call"     // 工具调用前
  | "after-tool-call"      // 工具调用后
  | "before-agent-finalize"; // AI 完成回复后

// 映射：事件 → 触发时机
const HOOK_EVENT_MAP: Record<HookEvent, string> = {
  "message": "Channel 收到用户消息",
  "before-agent-reply": "AI 生成文本之前（可修改回复）",
  // ...
};
```

---

#### 任务 4：浏览 `src/plugins/hooks.ts` (1h)

**阅读范围**：`src/plugins/hooks.ts` 全文

**Plugin Hook 的注册方式**（与 HTTP Hook 的区别）：

```typescript
// 插件注册 Hook 的 API
const api: PluginApi = {
  hooks: {
    // 注册 before-agent-reply Hook（在进程内同步执行）
    beforeAgentReply(handler: BeforeAgentReplyHandler) {
      hookRegistry.register("before-agent-reply", handler);
    },

    // 注册 before-tool-call Hook
    beforeToolCall(handler: BeforeToolCallHandler) {
      hookRegistry.register("before-tool-call", handler);
    },
  }
};

// 插件使用方式（在 extensions/discord/index.ts 中）：
api.hooks.beforeAgentReply(async (ctx) => {
  if (ctx.text.includes("敏感词")) {
    return { text: "（内容已过滤）" };
  }
  // 返回 undefined 表示不修改
});
```

**插件 Hook vs HTTP Hook 对比**：

| 特性 | 插件 Hook（Plugin Hook） | HTTP Hook |
|------|------------------------|-----------|
| 执行位置 | Gateway 进程内 | 外部 HTTP 服务 |
| 延迟 | 毫秒级 | 网络延迟 |
| 配置方式 | 插件代码注册 | `config.hooks[]` |
| 可修改响应 | 是 | 是 |
| 超时处理 | 无（同步） | 5s 默认超时 |

---

#### 任务 5：阅读 `src/gateway/server-cron.ts` (1h)

**阅读范围**：`src/gateway/server-cron.ts` 全文

**Cron 定时任务原理**：

```typescript
// 定时任务启动
function buildGatewayCronService(config: OpenClawConfig): CronService {
  const jobs = config.cron?.jobs ?? [];

  return {
    start() {
      for (const job of jobs) {
        // 使用 croner 库解析 cron 表达式
        const cronJob = new Cron(job.schedule, async () => {
          // 触发时，向指定会话发送消息（像普通消息一样处理）
          await sendMessageToSession({
            sessionKey: job.sessionKey,
            text: job.message,
            agentId: job.agent ?? DEFAULT_AGENT_ID,
          });
        });
      }
    }
  };
}
```

**Cron 表达式速查**：

```
# 格式：分 时 日 月 周
"0 8 * * *"    # 每天 8:00
"*/30 * * * *" # 每 30 分钟
"0 9 * * 1"    # 每周一 9:00
"0 0 1 * *"    # 每月 1 日 0:00
```

---

### 知识检验

1. `mutateConfigFile()` 写入文件后会触发什么？
2. Plugin Hook 和 HTTP Hook 的主要区别是什么？
3. 触发 "before-agent-reply" Hook 时，可以做什么操作？

---

## Day 12 — Gateway 安全与服务发现 (4h)

### 学习目标

- 理解 Gateway 的安全路径设计
- 理解 mDNS/Bonjour 服务发现机制
- 理解健康状态管理

---

### 序列图：mDNS 服务发现

```mermaid
sequenceDiagram
    participant gateway as Gateway
    participant mdns as mDNS/Bonjour
    participant network as 本地网络
    participant app as 手机 App

    gateway->>mdns: 注册服务 (_openclaw._tcp, port=18789)
    mdns->>network: 广播 mDNS 记录
    
    app->>network: 查询 _openclaw._tcp 服务
    network->>app: 返回 Gateway IP:Port
    app->>gateway: WebSocket 连接 ws://192.168.1.x:18789/ws
```

---

### 详细任务清单

#### 任务 1：精读 `src/gateway/security-path.ts` (1h)

**阅读范围**：`src/gateway/security-path.ts` 全文

**理解重点**：
- 为什么某些路径需要特殊的安全处理？
- `trusted-proxy` 模式如何工作？（信任内部请求）

---

#### 任务 2：精读 `src/gateway/server-discovery-runtime.ts` (1h)

**阅读范围**：`src/gateway/server-discovery-runtime.ts` 全文

**mDNS 注册原理**：

```typescript
// 注册 mDNS 服务
async function startServiceDiscovery(port: number) {
  // 广播 openclaw 服务到局域网
  const service = mdns.createAdvertisement(
    mdns.tcp("openclaw"),  // 服务类型：_openclaw._tcp
    port,                  // 端口
    {
      name: "OpenClaw Gateway",
      txt: { version: VERSION }  // 附加文本记录
    }
  );
  service.start();
}
```

---

#### 任务 3：阅读 `src/gateway/server/health-state.ts` (1h)

**阅读范围**：`src/gateway/server/health-state.ts` 全文

**健康状态数据结构**：

```typescript
type GatewayHealthState = {
  status: "starting" | "ready" | "degraded" | "stopping";
  startedAt: number;         // Unix 时间戳
  version: string;           // 软件版本
  channelCount: number;      // 运行中的 Channel 数量
  uptime: number;            // 运行时间（秒）
};
```

**`/health` 端点响应示例**：

```json
{
  "status": "ready",
  "version": "1.0.0",
  "startedAt": 1704067200000,
  "channelCount": 2,
  "uptime": 3600
}
```

---

#### 任务 4：阅读 `src/gateway/server-maintenance.ts` (1h)

**阅读范围**：`src/gateway/server-maintenance.ts` 全文

**定时维护任务**：
- 清理过期的 WebSocket 连接
- 清理过期的 rate-limit 计数器
- 定期写入健康统计

---

### 知识检验

1. `/health` 端点返回的 `status` 有哪几种值？
2. mDNS 广播的服务类型是什么？
3. 手机 App 如何通过 mDNS 发现局域网内的 Gateway？

---

## Day 13 — 实践：修改健康检查端点 (5h)

### 学习目标

- 综合运用第二周所学，完成一个实际的代码修改
- 给 `/health` 端点添加新字段

---

### 任务：给 `/health` 添加 `channelCount` 字段

**目标**：当访问 `/health` 时，返回结果中包含当前运行中的 Channel 数量。

**实施步骤**：

**步骤 1**：找到健康检查处理函数

```bash
# 搜索 handleHealth 函数定义
grep -n "handleHealth\|health" src/gateway/server-http.ts | head -20
```

**步骤 2**：找到 ChannelManager 获取数量的方法

```bash
# 搜索 channels 相关方法
grep -n "getRunningCount\|channelCount\|size" src/gateway/server-channels.ts | head -20
```

**步骤 3**：修改健康检查响应

```typescript
// 在 handleHealth 函数中添加 channelCount
async function handleHealth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  runtimeState: GatewayRuntimeState  // 需要传入运行时状态
) {
  const channelCount = runtimeState.channelManager.getRunningChannelCount();

  const healthData = {
    status: runtimeState.healthState.status,
    version: VERSION,
    uptime: Math.floor((Date.now() - runtimeState.startedAt) / 1000),
    channelCount,  // 新增字段
  };

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(healthData));
}
```

**步骤 4**：构建并测试

```bash
pnpm build
node openclaw.mjs start &
sleep 2
curl -s http://localhost:18789/health | python3 -m json.tool
kill %1
```

**预期输出**：
```json
{
  "status": "ready",
  "version": "x.x.x",
  "uptime": 2,
  "channelCount": 0
}
```

---

## Day 14 — 巩固与测试文件阅读 (5h)

### 学习目标

- 阅读 Gateway 相关的测试文件，理解测试覆盖的场景
- 巩固第二周所学的所有概念

---

### 任务：阅读测试文件标题和结构

```bash
# 找到 gateway 目录下的所有测试文件
find src/gateway -name "*.test.ts" | sort
```

**对每个测试文件**，重点阅读：
1. `describe()` 块的名称（描述被测试的功能）
2. `it()` / `test()` 块的名称（描述具体测试场景）
3. 测试的 `expect()` 断言（验证什么行为）

**阅读 `src/gateway/auth.test.ts` 示例**：

```typescript
describe("authorizeGatewayConnect", () => {
  it("returns success for valid Bearer token", async () => {
    const result = await authorizeGatewayConnect({
      req: mockRequest({ headers: { authorization: "Bearer correct-token" } }),
      config: mockConfig({ gateway: { secret: "correct-token" } }),
      surface: "http",
    });
    expect(result.success).toBe(true);
  });

  it("returns failure for wrong token", async () => {
    const result = await authorizeGatewayConnect({
      req: mockRequest({ headers: { authorization: "Bearer wrong-token" } }),
      config: mockConfig({ gateway: { secret: "correct-token" } }),
      surface: "http",
    });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);
  });

  it("returns success for health endpoint without token", async () => {
    // /health 不需要认证
    ...
  });
});
```

**运行测试**：

```bash
# 运行所有 Gateway 测试
pnpm test src/gateway/

# 运行单个测试文件
pnpm test src/gateway/auth.test.ts
```

---

### 第二周总结检验

1. **Gateway 启动**：能说出 7 个阶段各做什么吗？
2. **HTTP 服务**：`handleRequest` 函数的第一个分支是什么？
3. **认证机制**：Bearer token 从请求的哪个头部提取？
4. **WebSocket**：WS 连接如何与 HTTP Upgrade 请求关联？
5. **Channel 重试**：第 5 次失败后等待多久重试？（约 16-24s，含抖动）
6. **配置热加载**：`mutateConfigFile()` 写入后，谁会收到通知？
7. **mDNS**：服务类型是什么，手机 App 如何发现 Gateway？

---

## 附录：第二周关键文件速查

```
src/gateway/server.ts            # 薄包装（18行），懒加载 server.impl.ts
src/gateway/server.impl.ts       # Gateway 启动主函数（1002行）
  L221-223  GatewayServer 类型
  L225-283  GatewayServerOptions 类型
  L292      startGatewayServer 函数开始
  L296      Phase 1: 网络运行时引导
  L313      Phase 2: 配置加载
  L403      Phase 3: 插件引导
  L527      Phase 4: 运行时状态创建
  L694      Phase 5: 早期运行时
  L864      Phase 6: WebSocket 处理器
  L894      Phase 7: 开始监听

src/gateway/server-http.ts       # HTTP 服务（959行）
  L197-237  路由路径判断函数
  L470      createGatewayHttpServer
  L527      handleRequest（HTTP 请求处理器）
  L806      attachGatewayUpgradeHandler（WebSocket 升级）

src/gateway/auth.ts              # 认证（529行）
  L32-48    GatewayAuthResult 类型
  L50-83    AuthorizeGatewayConnectParams 类型
  L361      authorizeGatewayConnect()
  L396      authorizeGatewayConnectCore()

src/gateway/server-channels.ts  # Channel 管理器（前150行重点）
src/infra/backoff.ts             # 指数退避
src/gateway/channel-health-monitor.ts  # 健康监控
src/gateway/server-runtime-state.ts    # 运行时状态对象
src/gateway/server-reload-handlers.ts  # 配置热加载
src/gateway/hooks.ts             # HTTP Hooks
src/gateway/hooks-mapping.ts     # Hook 事件映射
src/plugins/hooks.ts             # 插件 Hooks
src/gateway/server-cron.ts       # Cron 定时任务
src/gateway/security-path.ts     # 安全路径
src/gateway/server-discovery-runtime.ts  # mDNS 服务发现
src/gateway/server/health-state.ts      # 健康状态
```
