# Session 管理与 AI 层

---

## 1. 核心概念

### 1.1 Session（会话）

Session 是 OpenClaw 的基本对话单元。每个独立的对话都有一个会话，存储：
- 对话历史（消息记录）
- 使用的 AI 模型
- 所属 Channel
- 参与的用户

### 1.2 Session Key（会话键）

Session Key 是会话的唯一标识符，格式为：

```
<channel>/<account>/<conversation>

示例：
  discord/server123/user456          # Discord 用户的 DM 会话
  discord/server123/channel789       # Discord 频道会话
  telegram/default/group_100001     # Telegram 群组会话
  webchat/default/main              # Web 控制台会话
  cli/default/main                  # CLI 会话
```

源码：`src/routing/session-key.ts`

### 1.3 Agent（代理）

Agent 是 AI 助手的实例。默认只有一个 Agent（`DEFAULT_AGENT_ID = "default"`），但可以配置多个 Agent，每个有不同的人格、模型、权限。

---

## 2. Session 存储

文件：`src/config/sessions.ts`（配置层）、`src/gateway/session-utils.ts`（运行时层）

### 2.1 存储位置

```
~/.openclaw/sessions/
    ├── sessions.db              # SQLite 主数据库（会话元数据）
    └── transcripts/             # 对话记录（JSON 文件，每个 session 一个）
        ├── discord%2Fserver123%2Fuser456.jsonl
        └── telegram%2Fdefault%2Fgroup_100001.jsonl
```

### 2.2 Session Entry 结构

```typescript
type SessionEntry = {
  sessionKey: string;       // 会话 Key（主键）
  agentId: string;          // 使用的 Agent ID
  createdAt: number;        // 创建时间戳
  updatedAt: number;        // 最后活动时间戳
  totalTokens?: number;     // 累计 Token 消耗
  model?: string;           // 当前使用的模型
  label?: string;           // 会话标签（用户设置）
  channelId?: string;       // 所属 Channel
  accountId?: string;       // Channel 账号 ID
};
```

### 2.3 Session 的 CRUD

```typescript
// 加载会话存储（Session Store）
const store = await loadSessionStore({
  storePath: resolveStorePath(stateDir),
  agentId: "default",
});

// 查找会话
const session = store.getSession(sessionKey);

// 创建/更新会话
await store.upsertSession({
  sessionKey,
  agentId: "default",
  updatedAt: Date.now(),
});

// 获取对话历史
const history = await loadSessionEntry(sessionKey);
```

---

## 3. 完整消息处理流程

### 3.1 入站消息流（Channel → AI → 回复）

```
Discord 用户发消息
    │
    ▼
discord Extension（extensions/discord/）
    │  接收 Discord 事件（discord.js）
    │  过滤（bot 消息、无权限等）
    ▼
Channel Plugin（src/channels/draft-stream-loop.ts）
    │
    ├── 1. 确定 Session Key
    │       resolveSessionKey(channelId, accountId, conversationId)
    │
    ├── 2. 防抖（避免快速连续消息）
    │       await debounce(50ms)
    │
    ├── 3. 加载/创建 Session
    │       session = await loadOrCreateSession(sessionKey)
    │
    ├── 4. 检查权限（allowlist、角色等）
    │       checkAllowlist(sender, config)
    │
    ├── 5. 构建消息上下文
    │       context = buildMessageContext(session, message)
    │
    └── 6. 提交到 Gateway 处理
            │
            ▼
        Gateway（src/gateway/server-chat.ts）
            │
            ├── 7. 加载对话历史
            │       history = await loadSessionTranscript(sessionKey)
            │
            ├── 8. 构建 AI 请求
            │       messages = [...history, userMessage]
            │
            ├── 9. 调用 AI 模型（流式）
            │       stream = await callModel(messages, model)
            │
            ├── 10. 流式转发给 Channel
            │       for await (delta of stream) {
            │         channel.sendDelta(delta)
            │       }
            │
            ├── 11. 持久化对话记录
            │       await persistSessionEvent(sessionKey, {
            │         role: "user", content: message
            │       })
            │       await persistSessionEvent(sessionKey, {
            │         role: "assistant", content: response
            │       })
            │
            └── 12. 更新 Session 元数据
                    updateSession(sessionKey, { totalTokens, updatedAt })
```

---

## 4. AI 模型调用层

### 4.1 模型引用格式

```typescript
// 模型 ID 格式
"claude-sonnet-4-6"           // 简短形式（自动匹配提供商）
"anthropic/claude-sonnet-4-6" // 完整形式（指定提供商）
"gpt-4o"                      // OpenAI 模型
"gemini-1.5-pro"              // Google 模型
```

### 4.2 模型解析

文件：`src/agents/model-selection.ts`

```typescript
// 从简短模型 ID 解析完整的模型引用
function resolveModelRef(modelId: string, config: OpenClawConfig) {
  // 1. 直接匹配提供商前缀（anthropic/xxx）
  if (modelId.includes("/")) {
    return parseModelRef(modelId);
  }

  // 2. 通过模型目录匹配（claude-* → anthropic）
  const provider = pluginRegistry.resolveProviderByModelId(modelId);
  if (provider) {
    return { provider: provider.id, model: modelId };
  }

  // 3. 使用默认提供商
  return { provider: config.agents?.defaults?.provider ?? "anthropic", model: modelId };
}
```

### 4.3 实际 API 调用

所有 AI 调用都经过 OpenAI 兼容接口（`openai` npm 包）：

```typescript
import OpenAI from "openai";

// 每个提供商创建自己的客户端
const client = new OpenAI({
  apiKey: config.providers.anthropic.apiKey,
  baseURL: "https://api.anthropic.com/v1",  // 提供商的 OpenAI 兼容端点
});

// 调用（流式）
const stream = await client.chat.completions.create({
  model: "claude-sonnet-4-6",
  messages: [...history, { role: "user", content: userMessage }],
  stream: true,
  max_tokens: 8096,
});

// 处理流
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content ?? "";
  if (delta) {
    sendToChannel(delta);  // 实时推送给用户
  }
}
```

---

## 5. Agent 系统

### 5.1 Agent 配置

Agent 可以在配置中定义多个：

```json5
{
  "agents": {
    "defaults": {
      "model": "claude-sonnet-4-6",
      "systemPrompt": "你是一个有帮助的助手。",
      "maxTokens": 8096,
    },
    "agents": {
      // 默认 Agent（所有 Channel 使用）
      "default": {
        "model": "claude-sonnet-4-6",
      },
      // 专用 Agent（如代码助手）
      "coder": {
        "model": "claude-opus-4-7",
        "systemPrompt": "你是一个专业的代码助手。",
        "agentDir": "~/my-project",  // 工作目录
      }
    }
  }
}
```

### 5.2 Agent 作用域

```typescript
// 解析会话对应的 Agent
function resolveAgentForSession(sessionKey: string, config: OpenClawConfig): string {
  // 1. 从 session key 解析显式 Agent ID
  const parsed = parseAgentSessionKey(sessionKey);
  if (parsed.agentId) return parsed.agentId;

  // 2. 根据 Channel 配置的 Agent 映射
  const channelAgent = config.channels?.[channelId]?.agent;
  if (channelAgent) return channelAgent;

  // 3. 默认 Agent
  return DEFAULT_AGENT_ID;
}
```

### 5.3 工具调用（Tool Use / Function Calling）

Agent 可以调用工具（MCP 工具、内置工具等）：

```typescript
// 内置工具列表（src/agents/tools 目录）
const builtinTools = [
  "read_file",          // 读取文件
  "write_file",         // 写入文件
  "run_command",        // 执行命令（需要批准）
  "web_search",         // 网页搜索
  "web_fetch",          // 抓取网页
];

// MCP 工具（通过 MCP 协议动态注册）
const mcpTools = await loadMcpTools(config.mcp);
```

---

## 6. 记忆系统（Memory）

文件：`src/memory/`、`src/plugins/memory-runtime.ts`

### 6.1 记忆类型

OpenClaw 支持两种记忆：

**会话记忆（Session Transcript）**
- 当前对话的完整历史
- 存储在 `~/.openclaw/sessions/transcripts/`
- 每次对话都发送给 AI 作为上下文

**长期记忆（Long-term Memory）**
- 跨会话的持久化记忆
- 存储在 SQLite + 向量数据库（`sqlite-vec`）
- 通过语义搜索检索相关记忆

### 6.2 上下文压缩（Compaction）

当对话历史太长（超过模型上下文窗口）时，触发压缩：

```typescript
// src/plugins/compaction-provider.ts
async function compactSession(sessionKey: string, config: OpenClawConfig) {
  const history = await loadFullHistory(sessionKey);

  if (history.tokens < config.agents?.compaction?.threshold) {
    return;  // 不需要压缩
  }

  // 让 AI 总结旧历史
  const summary = await summarizeHistory(history.old);

  // 替换为摘要 + 保留最近 N 条消息
  await replaceHistory(sessionKey, [
    { role: "system", content: `[历史摘要] ${summary}` },
    ...history.recent,
  ]);
}
```

---

## 7. 对话记录格式（Transcript）

会话记录以 JSONL 格式存储：

```jsonl
{"role":"user","content":"你好","timestamp":1704067200000,"sessionKey":"discord/..."}
{"role":"assistant","content":"你好！我是 OpenClaw。","timestamp":1704067201234,"model":"claude-sonnet-4-6","tokens":{"input":10,"output":8}}
{"role":"user","content":"OpenClaw 是什么？","timestamp":1704067210000}
{"role":"assistant","content":"OpenClaw 是一个个人 AI 助手...","timestamp":1704067212000}
```

---

## 8. 关键文件阅读顺序

1. `src/routing/session-key.ts`（全文，约 100 行）— 理解 Session Key 格式
2. `src/config/sessions.ts`（前 100 行）— 了解 Session Store 接口
3. `src/gateway/session-utils.ts`（前 100 行）— 运行时 Session 操作
4. `src/agents/model-selection.ts`（前 80 行）— 模型解析逻辑
5. `src/gateway/server-chat.ts`（前 80 行）— AI 调用主流程
6. `src/channels/draft-stream-loop.ts`（全文）— 消息处理主循环

---

## 下一步

完成本文后，去读 [07-advanced-topics.md](./07-advanced-topics.md)。
