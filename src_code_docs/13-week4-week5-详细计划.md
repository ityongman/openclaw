# 第四、五周详细学习计划（Day 22-35）

> 目标：掌握 Session 管理与 AI 调用层，再拓展到高级主题（Hooks/Cron/MCP/Memory）
>
> 前提：已完成第一至三周，理解 Gateway 启动流程、Channel/插件系统和消息处理主循环

---

## 第四周（Day 22-28）：Session 管理与 AI 调用层

---

## Day 22 — Session Key 与会话路由 (5h)

### 学习目标

- 理解 Session Key 的格式：`agent:<agentId>:<rest>`
- 理解如何从 Channel/Account/Conversation 构建 Session Key
- 能在代码中追踪一条消息是如何被路由到正确 Session 的

---

### 流程图：Session Key 生成与路由

```mermaid
flowchart LR
    A["收到消息\nchannelId=discord\naccountId=server123\nconversationId=user456"]

    A --> B["routing/session-key.ts\ntoAgentStoreSessionKey()"]

    B --> C{"requestKey 是否为空\n或等于 'main'?"}
    C -->|"是"| D["buildAgentMainSessionKey()\nagent:main:main"]
    C -->|"否"| E["agent:<agentId>:<requestKey>"]

    D --> F["SessionKey 字符串\n'agent:main:main'"]
    E --> F

    F --> G{"sessions.db\n会话是否存在?"}
    G -->|"存在"| H["读取 JSONL 对话历史\ntranscripts/<encoded-key>.jsonl"]
    G -->|"不存在"| I["upsertSession()\n写入 SQLite"]

    H --> J["恢复消息数组\n[{role:'user',...},...]"]
    I --> J

    J --> K["agents/context.ts\n裁剪至模型上下文窗口"]
    K --> L["拼接最终 messages 数组\n发送给 AI"]
```

---

### 详细任务清单

#### 任务 1：阅读 `06-session-and-ai.md` (1h)

**阅读范围**：`src_code_docs/06-session-and-ai.md` 全文

**理解重点**：
- Session Key 格式（`agent:<agentId>:<rest>`）
- Session 存储的两层结构（SQLite 元数据 + JSONL 对话记录）
- 12 步消息处理流程（从 Channel 到 AI 到持久化）

---

#### 任务 2：精读 `src/routing/session-key.ts` (1h)

**阅读范围**：`src/routing/session-key.ts` 全文（约 150 行）

**关键常量**：

```typescript
// src/routing/session-key.ts L21-22
export const DEFAULT_AGENT_ID = "main";
export const DEFAULT_MAIN_KEY = "main";
```

**核心函数 `toAgentStoreSessionKey()`**：

```typescript
// src/routing/session-key.ts L54-72
export function toAgentStoreSessionKey(params: {
  agentId: string;
  requestKey: string | undefined | null;
  mainKey?: string | undefined;
}): string {
  const raw = (params.requestKey ?? "").trim();
  const lowered = normalizeLowercaseStringOrEmpty(raw);
  if (!raw || lowered === DEFAULT_MAIN_KEY) {
    // 空 key 或 "main" → 默认会话
    return buildAgentMainSessionKey({ agentId: params.agentId, mainKey: params.mainKey });
  }
  const parsed = parseAgentSessionKey(raw);
  if (parsed) {
    // 已经是 agent:xxx:xxx 格式 → 规范化
    return `agent:${parsed.agentId}:${parsed.rest}`;
  }
  // 普通 key → 添加 agent: 前缀
  return `agent:${normalizeAgentId(params.agentId)}:${lowered}`;
}
```

**对 Java 程序员**：Session Key 相当于 JPA 的复合主键（`@IdClass`），只是用 `:`分隔符拼接而非对象。  
**对 Python 程序员**：Session Key 相当于 `f"agent:{agent_id}:{main_key}"` 的字符串 ID，用于 dict 键查找。

**Session Key 格式示例**：

| 场景 | Session Key |
|------|------------|
| 默认 Discord 会话 | `agent:main:main` |
| 指定 Agent | `agent:coder:main` |
| 特定线程 | `agent:main:thread-123` |
| Cron 任务 | `agent:main:cron:daily-report` |

---

#### 任务 3：精读 `src/sessions/session-key-utils.ts` (1h)

**阅读范围**：前 80 行

**关键函数 `parseAgentSessionKey()`**：

```typescript
// src/sessions/session-key-utils.ts（约 L1-60）
// 解析 "agent:main:main" → { agentId: "main", rest: "main" }
export function parseAgentSessionKey(
  key: string | undefined | null
): ParsedAgentSessionKey | null {
  const raw = (key ?? "").trim();
  if (!raw.startsWith("agent:")) return null;

  const rest = raw.slice("agent:".length);
  const colonIdx = rest.indexOf(":");
  if (colonIdx < 0) return null;

  return {
    agentId: rest.slice(0, colonIdx),
    rest: rest.slice(colonIdx + 1),
  };
}
```

**辅助判断函数**：

```typescript
isCronSessionKey(key)    // "agent:main:cron:xxx" → true
isAcpSessionKey(key)     // "agent:main:acp:xxx" → true（子 Agent）
isSubagentSessionKey(key) // 深度 > 1 的子 Agent
getSubagentDepth(key)    // 嵌套深度（0=顶层, 1=一级子Agent...）
```

---

#### 任务 4：运行实验 (1h)

打开 Node.js REPL，手动验证 Session Key 逻辑：

```bash
cd d:/workspace/llmWorkspace/openclaw
node --input-type=module <<'EOF'
import { toAgentStoreSessionKey, parseAgentSessionKey } from "./src/routing/session-key.js";

// 验证默认 key
console.log(toAgentStoreSessionKey({ agentId: "main", requestKey: null }));
// 期望: "agent:main:main"

// 验证已有 agent: 前缀
console.log(toAgentStoreSessionKey({ agentId: "main", requestKey: "agent:coder:thread1" }));
// 期望: "agent:coder:thread1"

// 验证解析
console.log(parseAgentSessionKey("agent:main:some-thread"));
// 期望: { agentId: "main", rest: "some-thread" }
EOF
```

---

#### Day 22 检验题

1. `agent:main:main` 中，三个部分分别是什么含义？
2. 什么情况下 `parseAgentSessionKey()` 返回 `null`？
3. Cron 任务的 Session Key 格式是什么？

---

## Day 23 — Session 存储（SQLite + JSONL）(5h)

### 学习目标

- 理解 Session 元数据（SQLite）和对话记录（JSONL）的分层存储设计
- 能读取并理解 `~/.openclaw/sessions/transcripts/*.jsonl` 格式
- 理解 `loadSessionEntry()` 和 `persistSessionEvent()` 的完整流程

---

### 序列图：Session 读写流程

```mermaid
sequenceDiagram
    participant loop as draft-stream-loop.ts
    participant utils as gateway/session-utils.ts
    participant store as config/sessions.ts
    participant sqlite as sessions.db
    participant jsonl as transcripts/*.jsonl

    Note over loop,jsonl: 读取阶段（收到消息时）

    loop->>utils: loadSessionEntry(sessionKey)
    utils->>store: loadSessionStore(storePath)
    store->>sqlite: SELECT * FROM sessions WHERE key=?
    sqlite-->>store: SessionEntry (或 null)
    store-->>utils: sessionStore

    alt 会话不存在
        utils->>store: upsertSession({sessionKey, agentId, createdAt})
        store->>sqlite: INSERT OR REPLACE INTO sessions
    end

    utils->>jsonl: readFileSync(transcriptPath)
    jsonl-->>utils: JSONL 文本行
    utils->>utils: 解析每行 JSON → Message[]
    utils-->>loop: { session, messages }

    Note over loop,jsonl: 写入阶段（AI 回复完成后）

    loop->>utils: persistSessionEvent(sessionKey, userMsg)
    utils->>jsonl: appendFileSync(transcriptPath, JSON.stringify(msg)+'\n')

    loop->>utils: persistSessionEvent(sessionKey, assistantMsg)
    utils->>jsonl: appendFileSync(transcriptPath, JSON.stringify(msg)+'\n')

    loop->>utils: updateSession(sessionKey, {totalTokens, updatedAt})
    utils->>store: upsertSession({...metadata})
    store->>sqlite: INSERT OR REPLACE INTO sessions
```

---

### 详细任务清单

#### 任务 1：精读 `src/gateway/session-utils.ts` (1.5h)

**阅读范围**：`src/gateway/session-utils.ts` 前 120 行

**关键函数列表**：

| 函数名 | 作用 | 调用时机 |
|--------|------|---------|
| `loadSessionEntry()` | 加载 Session 元数据 + 对话历史 | 收到消息时 |
| `persistSessionEvent()` | 追加一条消息到 JSONL | AI 回复后 |
| `updateSession()` | 更新 SQLite 元数据（token 计数等）| AI 回复后 |
| `resolveTranscriptPath()` | 计算 JSONL 文件路径 | 内部使用 |

**对话记录路径计算逻辑**：

```typescript
// transcriptPath = ~/.openclaw/sessions/transcripts/<encoded-key>.jsonl
function resolveTranscriptPath(sessionKey: string, stateDir: string): string {
  // Session Key 中 "/" 被 URL 编码为 "%2F"
  const encoded = encodeURIComponent(sessionKey);
  return path.join(stateDir, "sessions", "transcripts", `${encoded}.jsonl`);
}
// 例：
// "agent:main:main" → ~/.openclaw/sessions/transcripts/agent%3Amain%3Amain.jsonl
```

**对 Java 程序员**：`persistSessionEvent` 相当于 `entityManager.persist()` 但追加写文件而非数据库行。  
**对 Python 程序员**：相当于 `with open(path, 'a') as f: f.write(json.dumps(msg) + '\n')`。

---

#### 任务 2：精读 `src/config/sessions.ts` (1h)

**阅读范围**：前 100 行

**SessionEntry 类型**：

```typescript
// src/config/sessions.ts（约 L20-50）
type SessionEntry = {
  sessionKey: string;    // 主键
  agentId: string;       // 使用的 Agent ID
  createdAt: number;     // Unix 毫秒时间戳
  updatedAt: number;
  totalTokens?: number;  // 累计消耗 token 数
  model?: string;        // 当前模型
  label?: string;        // 用户设置的标签
  channelId?: string;
  accountId?: string;
};
```

**Session Store 接口（SQLite 封装）**：

```typescript
interface SessionStore {
  getSession(sessionKey: string): SessionEntry | undefined;
  listSessions(options?: { limit?: number; offset?: number }): SessionEntry[];
  upsertSession(entry: Partial<SessionEntry> & { sessionKey: string }): void;
  deleteSession(sessionKey: string): void;
}
```

---

#### 任务 3：查看真实存储文件 (1h)

```bash
# 查看 SQLite sessions 数据库（如果已经运行过 openclaw）
ls ~/.openclaw/sessions/

# 查看对话记录文件列表
ls ~/.openclaw/sessions/transcripts/

# 读取一个对话记录
head -5 ~/.openclaw/sessions/transcripts/*.jsonl 2>/dev/null || echo "还没有对话记录"
```

**JSONL 格式示例**：

```jsonl
{"role":"user","content":"你好","timestamp":1704067200000,"sessionKey":"agent:main:main"}
{"role":"assistant","content":"你好！我是 OpenClaw。","timestamp":1704067201234,"model":"claude-sonnet-4-6","tokens":{"input":10,"output":8}}
{"role":"user","content":"OpenClaw 是什么？","timestamp":1704067210000}
{"role":"assistant","content":"OpenClaw 是一个个人 AI 助手...","timestamp":1704067212000}
```

每一行都是独立的合法 JSON 对象，可以用 `jq` 处理：

```bash
# 统计一个会话的消息数
cat ~/.openclaw/sessions/transcripts/agent%3Amain%3Amain.jsonl | wc -l

# 查看最后 5 条消息
tail -5 ~/.openclaw/sessions/transcripts/agent%3Amain%3Amain.jsonl | python3 -m json.tool
```

---

#### 任务 4：上下文压缩机制 (1h)

**阅读范围**：`src/plugins/compaction-provider.ts` 前 60 行

**触发条件**：对话历史超过模型上下文窗口（默认约 100K tokens）

```typescript
// 压缩流程
async function compactSession(sessionKey: string) {
  const history = await loadFullHistory(sessionKey);
  if (history.tokens < COMPACTION_THRESHOLD) return;  // 未达阈值

  // 用 AI 对旧消息生成摘要
  const summary = await summarizeHistory(history.old);

  // 替换为：[摘要] + [最近 N 条]
  await replaceHistory(sessionKey, [
    { role: "system", content: `[历史摘要] ${summary}` },
    ...history.recent,  // 保留最近的完整消息
  ]);
}
```

**对 Java 程序员**：类似 `Pageable` 截断历史，但这里用 AI 摘要替代直接截断。  
**对 Python 程序员**：类似 `history[-N:]` 截断，但更智能——先摘要旧内容再保留最近的。

---

#### Day 23 检验题

1. Session Key `agent:main:main` 对应的 JSONL 文件名是什么？
2. 为什么对话记录用 JSONL 而不是直接存 SQLite？
3. 上下文压缩什么时候触发？压缩后历史格式有什么变化？

---

## Day 24 — AI 模型调用层 (5h)

### 学习目标

- 理解从 Session Key → 模型解析 → OpenAI API 调用的完整链路
- 理解 `server-chat.ts` 如何协调 Session、模型、流式输出
- 能追踪一次 AI 调用的完整代码路径

---

### 序列图：AI 调用完整链路

```mermaid
sequenceDiagram
    participant loop as draft-stream-loop.ts
    participant chat as gateway/server-chat.ts
    participant model as agents/model-selection.ts
    participant ctx as agents/context.ts
    participant provider as extensions/anthropic/
    participant api as Anthropic API

    loop->>chat: handleChatMessage(sessionKey, message, channel)

    chat->>model: resolveAgentConfig(sessionKey, config)
    model-->>chat: { model: "claude-sonnet-4-6", systemPrompt: "..." }

    chat->>ctx: buildContextMessages(sessionKey, message)
    ctx->>ctx: loadTranscript() → 加载历史
    ctx->>ctx: truncateToContextWindow() → 裁剪至 token 上限
    ctx-->>chat: Message[] (含历史+新消息)

    chat->>provider: callModelStream(messages, modelRef)
    provider->>provider: new OpenAI({ baseURL: anthropicURL })
    provider->>api: POST /v1/chat/completions (stream: true)
    api-->>provider: SSE stream

    loop
        provider-->>chat: StreamChunk { delta: "..." }
        chat->>loop: channel.sendDelta(delta)
        loop-->>loop: 更新 Discord/Telegram 消息
    end

    provider-->>chat: stream 结束
    chat->>chat: persistSessionEvent(userMsg)
    chat->>chat: persistSessionEvent(assistantMsg)
    chat->>chat: updateSession({ totalTokens })
```

---

### 详细任务清单

#### 任务 1：精读 `src/gateway/server-chat.ts` (2h)

**阅读范围**：前 120 行

**核心流程**：

```typescript
// src/gateway/server-chat.ts（主处理函数，简化）
async function handleChannelChat(
  sessionKey: string,
  userMessage: string,
  channel: ChannelRuntime,
  config: OpenClawConfig,
): Promise<void> {
  // 1. 解析 Agent 配置（模型、systemPrompt、maxTokens 等）
  const agentConfig = resolveAgentConfig(sessionKey, config);

  // 2. 构建消息上下文（历史 + 新消息，裁剪至 token 上限）
  const messages = await buildContextMessages(sessionKey, userMessage, agentConfig);

  // 3. 发送心跳（防止长时间等待被超时）
  const heartbeat = startHeartbeat(channel);

  try {
    // 4. 流式调用 AI
    const stream = await callModelStream(messages, agentConfig);

    // 5. 实时转发 delta 给用户
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) await channel.sendDelta(delta);
    }
  } finally {
    heartbeat.stop();
  }

  // 6. 持久化
  await persistSessionEvent(sessionKey, { role: "user", content: userMessage });
  await persistSessionEvent(sessionKey, { role: "assistant", content: fullResponse });
  await updateSession(sessionKey, { totalTokens: usage.total_tokens });
}
```

**心跳机制**：

```typescript
// 防止长时间 AI 生成导致用户以为机器人崩溃
function startHeartbeat(channel: ChannelRuntime): { stop(): void } {
  const timer = setInterval(() => {
    channel.sendTypingIndicator();  // Discord: "机器人正在输入..."
  }, 5000);
  return { stop: () => clearInterval(timer) };
}
```

---

#### 任务 2：精读模型解析逻辑 (1.5h)

**阅读范围**：`src/agents/agent-runtime-config.ts` 前 80 行 + `src/agents/agent-scope-config.ts` 前 60 行

**模型 ID 解析**：

```typescript
// 模型引用格式
type ModelRef = {
  provider: string;  // "anthropic" | "openai" | "google"
  model: string;     // "claude-sonnet-4-6" | "gpt-4o" | "gemini-1.5-pro"
};

function resolveModelRef(modelId: string, config: OpenClawConfig): ModelRef {
  // 1. 完整格式 "anthropic/claude-sonnet-4-6"
  if (modelId.includes("/")) {
    const [provider, model] = modelId.split("/", 2);
    return { provider, model };
  }

  // 2. 通过插件注册表匹配（claude-* → anthropic）
  const provider = pluginRegistry.resolveProviderByModelId(modelId);
  if (provider) return { provider: provider.id, model: modelId };

  // 3. 使用默认提供商
  return { provider: config.agents?.defaults?.provider ?? "anthropic", model: modelId };
}
```

**Agent 配置层级（优先级从高到低）**：

```
请求级覆盖（--model 参数）
    ↓
Agent 配置（config.agents.agents.main.model）
    ↓
Agent 默认值（config.agents.defaults.model）
    ↓
系统默认值（"claude-sonnet-4-6"）
```

---

#### 任务 3：理解 OpenAI 兼容接口 (1.5h)

**阅读范围**：`extensions/anthropic/src/provider.ts` 前 80 行

所有 AI 提供商都通过 OpenAI 兼容接口调用：

```typescript
// extensions/anthropic/src/provider.ts（简化）
import OpenAI from "openai";

export class AnthropicProvider implements ProviderPlugin {
  private client: OpenAI;

  constructor(config: AnthropicConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: "https://api.anthropic.com/v1",  // Anthropic 的 OpenAI 兼容端点
      defaultHeaders: {
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "tools-2024-04-04",
      },
    });
  }

  async *streamChat(messages: Message[], model: string): AsyncIterable<StreamDelta> {
    const stream = await this.client.chat.completions.create({
      model,
      messages,
      stream: true,
      max_tokens: 8096,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) yield { content: delta };
    }
  }
}
```

**对 Java 程序员**：`AnthropicProvider` 实现了 `ProviderPlugin` 接口，类似于 Java 的依赖注入策略模式。  
**对 Python 程序员**：类似 `class AnthropicProvider(ProviderProtocol):`，通过鸭子类型满足接口。

---

#### Day 24 检验题

1. 模型 ID `"claude-sonnet-4-6"` 是如何解析到 `anthropic` 提供商的？
2. 心跳机制的作用是什么？每隔多少秒发一次？
3. `for await (const chunk of stream)` 中，如果 AI 返回 500 错误，代码怎么处理？

---

## Day 25 — 流式响应完整链路 (5h)

### 学习目标

- 理解 SSE（Server-Sent Events）流式响应格式
- 理解 delta 如何从 AI API 流向用户界面
- 能在代码中追踪流式响应的每一步

---

### 流程图：流式 Token 传播链

```mermaid
flowchart TD
    A["Anthropic API\nSSE: data: {choices:[{delta:{content:'你'}}]}"]
    A -->|"AsyncIterable chunks"| B

    subgraph provider["extensions/anthropic/src/provider.ts"]
        B["for await chunk of stream\n解析 delta.content"]
        B --> C["yield { content: '你' }"]
    end

    C -->|"yield"| D

    subgraph chat["src/gateway/server-chat.ts"]
        D["for await delta of providerStream\n累积到 buffer"]
        D --> E["channel.sendDelta('你')\n推送给 Channel 运行时"]
    end

    E -->|"WebSocket 帧"| F

    subgraph discord_ext["extensions/discord/src/"]
        F["收到 delta 事件"]
        F --> G["messageBuffer += '你'\n防抖 100ms 后 message.edit()"]
    end

    G -->|"Discord API\nPATCH /channels/{id}/messages/{id}"| H(["用户看到消息逐字更新"])
```

---

### 详细任务清单

#### 任务 1：理解 SSE 格式 (1h)

SSE（Server-Sent Events）是 HTTP 流式响应的标准格式：

```
HTTP/1.1 200 OK
Content-Type: text/event-stream

data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"你"},"index":0}]}

data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"好"},"index":0}]}

data: {"id":"chatcmpl-xxx","choices":[{"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

`openai` npm 包已封装好 SSE 解析，`for await (const chunk of stream)` 直接迭代解析后的对象。

**对 Java 程序员**：SSE 类似 Spring WebFlux 的 `Flux<ServerSentEvent<String>>`。  
**对 Python 程序员**：类似 `requests.get(url, stream=True)` + `r.iter_lines()`，但 openai SDK 封装更高层。

---

#### 任务 2：精读 Discord Extension 的流式更新 (1.5h)

**阅读范围**：`extensions/discord/src/outbound-adapter.ts` 全文（约 80 行）

**防抖更新策略**：

```typescript
// extensions/discord/src/outbound-adapter.ts（简化）
class DiscordOutboundAdapter {
  private buffer = "";
  private debounceTimer: NodeJS.Timeout | null = null;
  private message: Message | null = null;

  async sendDelta(delta: string): Promise<void> {
    this.buffer += delta;

    // 防抖：100ms 内多个 delta 合并为一次 Discord API 调用
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flushBuffer(), 100);
  }

  private async flushBuffer(): Promise<void> {
    if (!this.buffer) return;
    if (!this.message) {
      // 首次发送：创建新消息
      this.message = await this.channel.send(this.buffer);
    } else {
      // 后续更新：编辑现有消息
      await this.message.edit(this.buffer);
    }
  }

  async finalize(): Promise<void> {
    // 清除防抖，立即刷新最终内容
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    await this.flushBuffer();
  }
}
```

**为什么要防抖？** Discord API 有速率限制（约 5次/秒），直接每 token 更新一次会触发 429 Too Many Requests。

---

#### 任务 3：追踪流式链路 (1.5h)

用 `grep` 追踪 `sendDelta` 的调用链：

```bash
# 找出 sendDelta 的定义和调用
grep -n "sendDelta" src/gateway/server-chat.ts
grep -n "sendDelta" packages/plugin-sdk/src/channel-core.ts
grep -n "sendDelta\|onDelta" extensions/discord/src/outbound-adapter.ts
```

**完整调用链**（按调用顺序）：

```
server-chat.ts        channel.sendDelta(delta)
    ↓
server-channels.ts    ChannelRuntime.sendDelta()
    ↓ WebSocket 帧
discord Extension     outbound-adapter.ts sendDelta()
    ↓ 防抖 100ms
Discord API           PATCH /messages/{id}
    ↓
用户看到更新
```

---

#### 任务 4：错误处理与中断 (1h)

**AbortController 中断流式响应**：

```typescript
// 用户发送了新消息时，中断当前正在生成的响应
const controller = new AbortController();

const stream = await client.chat.completions.create(
  { model, messages, stream: true },
  { signal: controller.signal }  // 传入 AbortSignal
);

// 新消息到来时中断
onNewMessage(() => controller.abort());
```

**对 Java 程序员**：`AbortController` ≈ `Future.cancel(true)` 或 `Thread.interrupt()`。  
**对 Python 程序员**：`AbortController` ≈ `asyncio.Task.cancel()` 或 `threading.Event`。

---

#### Day 25 检验题

1. 为什么 Discord Extension 用防抖而不是直接每 token 更新一次？
2. 用户突然发新消息时，旧的 AI 响应流会怎么处理？
3. SSE 格式中 `data: [DONE]` 表示什么？

---

## Day 26 — Memory 系统与长期记忆 (5h)

### 学习目标

- 理解 OpenClaw 的两种记忆：会话记忆 vs 长期记忆
- 了解 sqlite-vec 向量数据库的工作原理
- 理解记忆的写入、检索和注入流程

---

### 流程图：记忆系统架构

```mermaid
flowchart TD
    A["收到消息"] --> B["draft-stream-loop.ts"]

    B --> C{"检索长期记忆?"}
    C -->|"是"| D["memory-runtime.ts\nsearchMemory(query, topK=5)"]
    D --> E["sqlite-vec\n向量相似度搜索\n余弦距离"]
    E --> F["返回相关记忆片段\n[{content: '用户喜欢...', score: 0.92}]"]
    F --> G["注入 system prompt"]

    C -->|"否"| G

    G --> H["构建最终 messages\n[system, ...history, ...memories, user]"]
    H --> I["AI 调用"]

    I -->|"AI 回复完成"| J["memory-runtime.ts\nextractAndStoreMemory()"]
    J --> K["LLM 从对话中提取关键事实"]
    K --> L["embed(facts) → 向量"]
    L --> M["sqlite-vec\nINSERT INTO memories"]
```

---

### 详细任务清单

#### 任务 1：理解向量记忆概念 (1h)

**核心概念**：

| 概念 | 说明 | Python 类比 |
|------|------|------------|
| Embedding | 文本 → 数字向量（如 1536 维）| `numpy.array([0.1, 0.2, ...])` |
| 余弦相似度 | 两个向量的夹角余弦，越接近 1 越相似 | `np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))` |
| sqlite-vec | SQLite 扩展，支持向量列和 kNN 查询 | `FAISS.IndexFlatIP` 的 SQLite 版本 |
| Top-K 检索 | 找最相似的 K 条记忆 | `sorted(memories, key=similarity)[-K:]` |

**对 Java 程序员**：`sqlite-vec` 类似 Spring AI 的 `VectorStore`，但基于本地 SQLite 而非 Pinecone/Redis。

---

#### 任务 2：精读 `src/plugins/memory-runtime.ts` (2h)

**阅读范围**：前 80 行

**核心接口**：

```typescript
// src/plugins/memory-runtime.ts（简化）
interface MemoryRuntime {
  // 检索相关记忆
  searchMemory(
    query: string,
    options: { agentId: string; topK?: number }
  ): Promise<MemoryEntry[]>;

  // 存储新记忆
  storeMemory(
    content: string,
    options: { agentId: string; sessionKey: string }
  ): Promise<void>;

  // 关闭连接（进程退出时）
  close(): Promise<void>;
}

type MemoryEntry = {
  id: string;
  content: string;      // 记忆文本（如 "用户是 Python 程序员"）
  agentId: string;
  score: number;        // 相似度分数（0-1）
  createdAt: number;
};
```

---

#### 任务 3：精读 `src/memory/root-memory-files.ts` (1h)

**阅读范围**：全文（约 50 行）

这个文件管理 `~/.openclaw/memory/` 目录下的记忆文件：

```typescript
// src/memory/root-memory-files.ts
const MEMORY_DIR = path.join(STATE_DIR, "memory");

// 根级记忆（不属于特定 Agent 的全局记忆）
function getRootMemoryPath(): string {
  return path.join(MEMORY_DIR, "root.md");
}

// Agent 级记忆
function getAgentMemoryPath(agentId: string): string {
  return path.join(MEMORY_DIR, "agents", agentId, "memory.md");
}
```

**目录结构**：

```
~/.openclaw/memory/
    ├── root.md                    # 全局记忆（对所有 Agent 可见）
    └── agents/
        ├── main/
        │   └── memory.md          # main Agent 的记忆
        └── coder/
            └── memory.md          # coder Agent 的记忆
```

---

#### Day 26 检验题

1. 向量记忆和会话记忆（JSONL）的区别是什么？
2. `searchMemory()` 返回的 `score` 值范围是多少？越大越好还是越小越好？
3. 什么情况下不需要长期记忆？

---

## Day 27 — Agent 系统与 Tool Use (5h)

### 学习目标

- 理解多 Agent 配置：如何在同一个 Gateway 中运行多个 Agent
- 理解工具调用（Tool Use / Function Calling）的完整流程
- 了解 ACP（Agent Control Protocol）用于子 Agent 嵌套

---

### 序列图：工具调用流程

```mermaid
sequenceDiagram
    participant user as 用户
    participant chat as server-chat.ts
    participant api as AI API
    participant tool as 工具执行器

    user->>chat: "查一下今天天气"
    chat->>api: messages + tools: [{name:"web_search",...}]

    api-->>chat: tool_use: {name:"web_search", input:{query:"今天天气"}}

    chat->>tool: executeToolCall("web_search", {query:"今天天气"})
    tool->>tool: 执行工具（HTTP 请求 / 命令 / 文件操作）
    tool-->>chat: { result: "北京今天晴，25°C" }

    chat->>api: messages + tool_result: [{content:"北京今天晴，25°C"}]
    api-->>chat: "根据查询结果，北京今天晴，气温25°C..."
    chat-->>user: 流式回复
```

---

### 详细任务清单

#### 任务 1：理解多 Agent 配置 (1h)

```json5
// ~/.openclaw/openclaw.json 多 Agent 配置示例
{
  "agents": {
    "defaults": {
      "model": "claude-sonnet-4-6",
      "maxTokens": 8096
    },
    "agents": {
      // 默认 Agent（所有 Channel）
      "main": {
        "model": "claude-sonnet-4-6",
        "systemPrompt": "你是一个有帮助的助手。"
      },
      // 专用代码 Agent
      "coder": {
        "model": "claude-opus-4-7",
        "systemPrompt": "你是一个专业的代码助手，只回答编程相关问题。",
        "agentDir": "~/my-project"
      }
    }
  }
}
```

**路由到不同 Agent**：

```
Discord 消息 → Session Key: agent:main:main → main Agent（默认）
Hooks 请求   → Session Key: agent:coder:main → coder Agent（显式指定）
```

---

#### 任务 2：精读工具定义 (1.5h)

**阅读范围**：`src/agents/bash-tools.ts` 前 60 行 + `src/agents/bash-tools.schemas.ts`

**工具定义格式**（OpenAI Tool 格式）：

```typescript
// 工具定义
const bashTool = {
  type: "function" as const,
  function: {
    name: "bash",
    description: "Execute a bash command and return output",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute"
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 120000)"
        }
      },
      required: ["command"]
    }
  }
};
```

**工具安全策略**：

```typescript
// src/agents/bash-tools.exec-approval-request.ts（简化）
// 某些工具执行前需要用户批准
async function maybeRequestApproval(command: string): Promise<boolean> {
  if (isCommandSafeToRunAutomatically(command)) return true;

  // 发送批准请求给用户
  const approved = await channel.requestApproval({
    title: "执行命令?",
    content: command,
    timeout: 30000,
  });
  return approved;
}
```

---

#### 任务 3：ACP 子 Agent 嵌套 (1.5h)

**阅读范围**：`src/agents/acp-spawn.ts` 前 60 行

ACP（Agent Control Protocol）允许 Agent 启动子 Agent：

```typescript
// 主 Agent 生成子 Agent
const childAgentResult = await spawnSubAgent({
  agentId: "coder",      // 子 Agent ID
  task: "重构 foo.ts 中的 calculateTotal 函数",
  context: currentContext,
  sessionKey: buildChildSessionKey(parentSessionKey),  // agent:coder:acp:xxx
});
```

**Session Key 嵌套格式**：

```
父 Agent:   agent:main:main
子 Agent:   agent:coder:acp:main-xxx   (depth=1)
孙 Agent:   agent:helper:acp:coder-xxx (depth=2)
```

`isSubagentSessionKey()` 和 `getSubagentDepth()` 可以判断嵌套深度。

---

#### Day 27 检验题

1. 如何让某个 Discord 频道使用 `coder` Agent 而不是默认 `main` Agent？
2. 工具调用的完整循环是什么（用户消息 → 工具调用 → 结果 → AI 最终回复）？
3. 子 Agent 的 Session Key 格式和普通 Session Key 有什么区别？

---

## Day 28 — 综合实践：修改 AI 行为 (5h)

### 学习目标

- 能独立修改 Agent 配置改变 AI 行为
- 能添加一个简单的内置工具
- 能通过 Hooks API 向 AI 注入外部消息

---

### 实践任务

#### 任务 1：修改系统提示 (1h)

```json5
// ~/.openclaw/openclaw.json
{
  "agents": {
    "agents": {
      "main": {
        "model": "claude-sonnet-4-6",
        "systemPrompt": "你是一个专注于 TypeScript 的代码助手。\n当用户问关于 Python 或 Java 的问题时，先用 TypeScript 给出答案，再提供对应语言版本。"
      }
    }
  }
}
```

**验证**：重启 Gateway 后，问 AI "怎么实现冒泡排序"，观察回答是否先给 TypeScript 版本。

---

#### 任务 2：修改日志级别观察 AI 调用 (1h)

```bash
# 设置 DEBUG 日志级别，观察完整的 API 请求/响应
OPENCLAW_LOG_LEVEL=debug node openclaw.mjs start 2>&1 | grep -i "chat\|token\|model"
```

观察：
- 每次 AI 调用的模型名称
- 输入/输出 token 计数
- 流式响应的每个 chunk

---

#### 任务 3：通过 Hooks API 发送消息 (2h)

配置 Hooks（见 Day 29），然后：

```bash
# 通过 HTTP POST 向 AI 发送消息（无需 Discord 等平台）
curl -X POST http://localhost:18789/hooks \
  -H "Authorization: Bearer your-hook-token" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "总结今天的天气预报",
    "sessionKey": "agent:main:main"
  }'
```

---

#### 任务 4：第四周总结检验 (1h)

1. **Session Key**：`agent:coder:thread-123` 的三个部分分别是什么？
2. **JSONL 路径**：Session Key `agent:main:main` 对应的文件路径是什么？
3. **模型解析**：`"claude-opus-4-7"` 会被路由到哪个 Provider？
4. **流式防抖**：Discord Extension 为什么每 100ms 才更新一次消息？
5. **工具调用**：AI 调用工具后，结果如何反馈给 AI？（下一轮 `messages` 格式）

---

## 第五周（Day 29-35）：高级主题

---

## Day 29 — Hooks 引擎 (5h)

### 学习目标

- 理解 Hooks 的设计：通过 HTTP POST 向 AI 发送消息
- 能配置 Hooks 并发送第一条请求
- 理解 Hooks 的 Session 路由和安全策略

---

### 流程图：Hooks 执行流程

```mermaid
flowchart TD
    A["外部服务\nHTTP POST /hooks\n{message: '...', sessionKey: '...'}"]

    A -->|"Authorization: Bearer <token>"| B

    subgraph gw["src/gateway/hooks.ts"]
        B["resolveHooksConfig(config)\n验证 token"]
        B --> C{"token 匹配?"}
        C -->|"否"| Z1(["401 Unauthorized"])
        C -->|"是"| D["resolveSessionPolicy()\n确定 Session Key"]
        D --> E["resolveAgentId()\n确定 Agent"]
        E --> F["processHookRequest()\n构建消息上下文"]
    end

    F --> G["server-chat.ts\nhandleChannelChat()"]
    G --> H["AI 生成响应"]
    H --> I["持久化 + 返回响应"]
    I -->|"JSON 响应"| A
```

---

### 详细任务清单

#### 任务 1：精读 `src/gateway/hooks.ts` (2h)

**阅读范围**：前 120 行

**配置 Hooks**：

```json5
// ~/.openclaw/openclaw.json
{
  "hooks": {
    "enabled": true,
    "token": "my-secret-hook-token",   // 必填：认证 token
    "path": "/hooks",                   // 可选：自定义路径（默认 /hooks）
    "defaultSessionKey": "agent:main:main",  // 可选：默认 Session
    "mappings": [
      // 可选：URL 路径 → Session 映射
      {
        "path": "/hooks/discord-report",
        "sessionKey": "agent:main:discord-daily"
      }
    ]
  }
}
```

**`resolveHooksConfig()` 函数**（`src/gateway/hooks.ts:49`）：

```typescript
export function resolveHooksConfig(cfg: OpenClawConfig): HooksConfigResolved | null {
  if (cfg.hooks?.enabled !== true) return null;

  const token = normalizeOptionalString(cfg.hooks?.token);
  if (!token) throw new Error("hooks.enabled requires hooks.token");

  return {
    basePath: cfg.hooks?.path ?? DEFAULT_HOOKS_PATH,   // "/hooks"
    token,
    maxBodyBytes: cfg.hooks?.maxBodyBytes ?? DEFAULT_HOOKS_MAX_BODY_BYTES,  // 256KB
    mappings: resolveHookMappings(cfg.hooks),
    agentPolicy: resolveAgentPolicy(cfg),
    sessionPolicy: resolveSessionPolicy(cfg),
  };
}
```

---

#### 任务 2：测试 Hooks API (2h)

**步骤 1**：配置 Hooks（修改 `~/.openclaw/openclaw.json` 添加 `hooks` 配置）

**步骤 2**：重启 Gateway

**步骤 3**：发送测试请求

```bash
# 基础请求
curl -X POST http://localhost:18789/hooks \
  -H "Authorization: Bearer my-secret-hook-token" \
  -H "Content-Type: application/json" \
  -d '{"message": "用一句话介绍自己"}' \
  | python3 -m json.tool

# 指定 Session Key（使用独立会话）
curl -X POST http://localhost:18789/hooks \
  -H "Authorization: Bearer my-secret-hook-token" \
  -H "Content-Type: application/json" \
  -d '{"message": "你好", "sessionKey": "agent:main:hook-test"}'
```

---

#### 任务 3：理解 Hooks 安全模型 (1h)

| 安全措施 | 实现 |
|---------|------|
| Token 认证 | `Authorization: Bearer <token>` 必须匹配配置 |
| Session 隔离 | `allowedSessionKeyPrefixes` 限制可访问的 Session |
| Agent 白名单 | `allowedAgentIds` 限制可使用的 Agent |
| Body 大小限制 | `maxBodyBytes`（默认 256KB）防止超大请求 |
| 幂等性 | 可传 `idempotencyKey` 防止重复处理 |

---

#### Day 29 检验题

1. Hooks Token 存储在哪里？如何轮换？
2. `allowedSessionKeyPrefixes: ["agent:main:hook-"]` 有什么安全作用？
3. Hook 请求的响应格式是什么（JSON 结构）？

---

## Day 30 — Cron 系统 (5h)

### 学习目标

- 理解 OpenClaw Cron 的工作原理（定时任务触发 AI）
- 能配置一个每天运行的 Cron Job
- 理解 Cron 隔离 Agent 机制（防止 Cron 污染常规会话）

---

### 流程图：Cron 执行流程

```mermaid
sequenceDiagram
    participant svc as cron/service.ts
    participant schedule as cron/schedule.ts
    participant delivery as cron/delivery.ts
    participant agent as cron/isolated-agent.ts
    participant chat as server-chat.ts

    Note over svc: Gateway 启动时加载所有 Cron Jobs

    loop 每分钟检查
        svc->>schedule: getNextFireTime(job)
        schedule-->>svc: nextFireAt（Unix 时间戳）

        alt 到达触发时间
            svc->>delivery: buildDeliveryPlan(job)
            delivery-->>svc: DeliveryPlan（消息内容、目标 Session）

            svc->>agent: runIsolatedCronAgent(plan)
            agent->>agent: buildCronSessionKey(jobId)\n"agent:main:cron:daily-report"
            agent->>chat: handleChannelChat(cronSessionKey, message)
            chat-->>agent: AI 响应

            agent->>svc: 记录执行结果（run-log.ts）
        end
    end
```

---

### 详细任务清单

#### 任务 1：配置第一个 Cron Job (1.5h)

```json5
// ~/.openclaw/openclaw.json
{
  "cron": {
    "jobs": [
      {
        "id": "daily-summary",              // Job ID（唯一）
        "schedule": "0 9 * * *",           // 标准 cron 格式：每天 9:00
        "message": "请生成今天的工作计划摘要",   // 发送给 AI 的消息
        "agentId": "main",                 // 使用的 Agent
        "channel": {                        // 可选：回复到指定 Channel
          "id": "discord",
          "accountId": "server123",
          "conversationId": "user456"
        }
      }
    ]
  }
}
```

**Cron 表达式格式**（标准 5 字段）：

```
分 时 日 月 周
0  9  *  *  *    每天 9:00
*/5 * * * *      每 5 分钟
0 0 * * 1        每周一 0:00
0 9 * * 1-5      工作日 9:00
```

---

#### 任务 2：精读 `src/cron/service.ts` (2h)

**阅读范围**：前 80 行

**Cron 服务核心循环**：

```typescript
// src/cron/service.ts（简化）
class CronService {
  private jobs: Map<string, CronJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  async start(config: OpenClawConfig): Promise<void> {
    // 加载所有 Job 配置
    const jobs = config.cron?.jobs ?? [];
    for (const job of jobs) {
      await this.scheduleJob(job);
    }
  }

  private async scheduleJob(job: CronJobConfig): Promise<void> {
    const nextFireAt = getNextFireTime(job.schedule);
    const delay = nextFireAt - Date.now();

    const timer = setTimeout(async () => {
      await this.fireJob(job);
      await this.scheduleJob(job);  // 重新调度下次执行
    }, delay);

    this.timers.set(job.id, timer);
  }

  private async fireJob(job: CronJobConfig): Promise<void> {
    const sessionKey = buildCronSessionKey(job.id, job.agentId);
    // → "agent:main:cron:daily-summary"

    await runIsolatedCronAgent({
      sessionKey,
      message: job.message,
      agentId: job.agentId,
    });

    await this.runLog.record(job.id, { firedAt: Date.now(), status: "success" });
  }
}
```

---

#### 任务 3：理解 Cron 隔离 Agent (1.5h)

**阅读范围**：`src/cron/isolated-agent.ts` 前 60 行

**为什么需要隔离？**：防止 Cron 任务历史污染用户的日常对话历史

```typescript
// src/cron/isolated-agent.ts（简化）
async function runIsolatedCronAgent(plan: CronDeliveryPlan): Promise<void> {
  // Cron 会话与用户会话完全隔离
  const cronSessionKey = buildCronSessionKey(plan.jobId, plan.agentId);
  // 格式: "agent:main:cron:daily-summary"

  // 独立的 Session 存储（单独的 JSONL 文件）
  // ~/.openclaw/sessions/transcripts/agent%3Amain%3Acron%3Adaily-summary.jsonl

  await handleChannelChat(cronSessionKey, plan.message, cronChannel);
}
```

**Cron Session Key 特征**：

```typescript
isCronSessionKey("agent:main:cron:daily")   // → true
isCronSessionKey("agent:main:main")         // → false
```

---

#### Day 30 检验题

1. Cron Job `"schedule": "0 9 * * 1-5"` 表示什么含义？
2. Cron Session Key 和普通用户 Session Key 的区别是什么？
3. 如何查看 Cron Job 的执行历史和结果？

---

## Day 31 — MCP 协议与工具扩展 (5h)

### 学习目标

- 理解 MCP（Model Context Protocol）的作用
- 能通过 MCP 给 AI 添加外部工具（如数据库查询、文件操作）
- 理解 MCP 端点的请求/响应格式

---

### 流程图：MCP 工具调用流程

```mermaid
flowchart TD
    A["AI 模型\n需要调用工具\n{name:'query_db', input:{sql:'SELECT...'}}"]

    A --> B["server-chat.ts\ntoolCallDispatcher()"]

    B --> C{"工具来源?"}
    C -->|"内置工具"| D["src/agents/bash-tools.ts\n直接执行"]
    C -->|"MCP 工具"| E["mcp-http.ts\n/mcp 端点"]

    subgraph mcp["MCP 协议层"]
        E --> F["POST /mcp\n{method:'tools/call',\nparams:{name:'query_db', arguments:{...}}}"]
        F --> G["MCP Server（外部进程）\n如 @modelcontextprotocol/server-sqlite"]
        G --> H["执行工具\n连接数据库 / 调用 API"]
        H -->|"结果"| F
    end

    D --> I["工具结果\n{content: '查询返回 3 行'}"]
    F --> I

    I --> J["拼入下一轮 messages\n{role:'tool', content:'...'}"]
    J --> A
```

---

### 详细任务清单

#### 任务 1：配置 MCP Server (1.5h)

```json5
// ~/.openclaw/openclaw.json
{
  "mcp": {
    "servers": [
      {
        "id": "filesystem",
        "type": "stdio",            // 通过 stdio 通信
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"]
      },
      {
        "id": "sqlite",
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sqlite", "/path/to/db.sqlite"]
      }
    ]
  }
}
```

**MCP Server 类型**：

| 类型 | 描述 | 适用场景 |
|------|------|---------|
| `stdio` | 子进程，通过 stdin/stdout 通信 | 本地工具（文件、数据库）|
| `sse` | HTTP Server-Sent Events | 远程服务 |
| `websocket` | WebSocket 连接 | 远程服务 |

---

#### 任务 2：精读 `src/gateway/mcp-http.ts` (2h)

**阅读范围**：前 80 行

MCP HTTP 端点允许外部客户端通过 OpenClaw Gateway 访问 MCP 工具：

```typescript
// src/gateway/mcp-http.ts（简化）
// 处理 POST /mcp 请求
async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);

  // MCP 协议：JSON-RPC 格式
  switch (body.method) {
    case "tools/list":
      // 返回所有可用工具列表
      const tools = await mcpClient.listTools();
      res.json({ tools });
      break;

    case "tools/call":
      // 执行工具调用
      const result = await mcpClient.callTool(body.params.name, body.params.arguments);
      res.json({ content: result });
      break;

    case "resources/list":
      // 返回可访问的资源列表
      const resources = await mcpClient.listResources();
      res.json({ resources });
      break;
  }
}
```

---

#### 任务 3：手动测试 MCP API (1.5h)

```bash
# 列出所有可用工具
curl -X POST http://localhost:18789/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# 调用工具
curl -X POST http://localhost:18789/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "read_file",
      "arguments": {"path": "/home/user/docs/readme.md"}
    },
    "id": 2
  }'
```

---

#### Day 31 检验题

1. MCP 协议使用什么格式（HTTP？WebSocket？自定义协议）？
2. AI 如何知道有哪些 MCP 工具可以调用？
3. `type: "stdio"` 的 MCP Server 和 `type: "sse"` 有什么区别？

---

## Day 32 — Canvas、Nodes 与其他高级功能 (5h)

### 学习目标

- 了解 Canvas 功能（结构化文档协作）
- 了解 Nodes 功能（移动设备作为计算节点）
- 了解 Voice/TTS 功能

---

### 详细任务清单

#### 任务 1：阅读 `07-advanced-topics.md` (1.5h)

**阅读范围**：全文

重点理解：
- Canvas 的用途：AI 和用户共同编辑的结构化文档（类似 Claude.ai 的 Artifacts 功能）
- Nodes 的用途：将 iOS/Android 设备作为 AI 执行节点
- Voice/TTS：语音消息输入和文字转语音输出

---

#### 任务 2：理解 Canvas 系统 (1.5h)

**阅读范围**：`src/canvas/` 目录下的关键文件

Canvas 允许 AI 创建和修改结构化文档（代码、Markdown、JSON 等）：

```typescript
// Canvas 工作流程
// 1. 用户请求 AI 生成文档
// → AI 回复包含 <canvas> 标签的内容

// 2. Gateway 解析 canvas 内容
// → 存储到 ~/.openclaw/canvas/<id>.md

// 3. 用户可以在 TUI 或 Web UI 中编辑
// → 编辑后的版本作为上下文反馈给 AI

// 4. AI 基于用户编辑继续修改
```

---

#### 任务 3：了解 Voice/TTS 配置 (1h)

```json5
// ~/.openclaw/openclaw.json TTS 配置示例
{
  "voice": {
    "enabled": true,
    "tts": {
      "provider": "elevenlabs",  // 或 "openai"
      "apiKey": "${ELEVENLABS_API_KEY}",
      "voiceId": "default"
    },
    "stt": {
      "provider": "whisper",
      "model": "whisper-1"
    }
  }
}
```

---

#### 任务 4：守护进程模式 (1h)

```bash
# 以守护进程方式启动 Gateway（后台运行）
openclaw daemon start

# 查看状态
openclaw daemon status

# 查看日志
openclaw logs --tail 100

# 停止
openclaw daemon stop
```

**守护进程的 systemd 集成**：

```bash
# 生成 systemd service 文件
openclaw daemon install

# 查看 systemd 状态
systemctl --user status openclaw
```

---

## Day 33 — 安全模型与调试技巧 (5h)

### 学习目标

- 理解 OpenClaw 的安全边界（什么可以做，什么不可以）
- 掌握调试技巧：日志级别、代理捕获、测试工具

---

### 详细任务清单

#### 任务 1：安全模型概览 (1.5h)

**阅读范围**：`src/security/` 目录 + `07-advanced-topics.md` 安全章节

**允许列表（Allowlist）配置**：

```json5
{
  "channels": {
    "discord": {
      "allowFrom": ["user123", "role:moderator"],  // 只允许这些用户/角色
      "denyFrom": ["user456"]                       // 黑名单
    }
  }
}
```

**工具执行安全策略**：

```
可自动执行的工具：
  - read_file       ← 只读，无副作用
  - web_search      ← 网络请求，但只读
  - web_fetch       ← 网络请求，但只读

需要用户批准的工具：
  - bash（执行命令）  ← 有副作用
  - write_file       ← 修改文件系统

永远禁止：
  - 读取 ~/.openclaw/ 以外的私密文件（密钥、私钥等）
```

---

#### 任务 2：掌握日志系统 (1.5h)

```bash
# 查看 Gateway 实时日志
openclaw logs --follow

# 按级别过滤
OPENCLAW_LOG_LEVEL=debug openclaw start 2>&1 | grep "chat\|session"

# 查看最近的 AI 调用
openclaw logs --filter type:chat --tail 20

# 代理捕获模式（记录所有 HTTP 请求）
OPENCLAW_DEBUG_PROXY=1 openclaw start
```

---

#### 任务 3：编写单元测试 (2h)

参考现有测试：`src/routing/session-key.test.ts`

```typescript
// src/routing/session-key.test.ts（参考）
import { describe, expect, it } from "vitest";
import { toAgentStoreSessionKey, parseAgentSessionKey } from "./session-key.js";

describe("toAgentStoreSessionKey", () => {
  it("空 key → 返回默认主会话", () => {
    expect(toAgentStoreSessionKey({ agentId: "main", requestKey: null }))
      .toBe("agent:main:main");
  });

  it("已有 agent: 前缀 → 规范化", () => {
    expect(toAgentStoreSessionKey({ agentId: "main", requestKey: "agent:coder:thread1" }))
      .toBe("agent:coder:thread1");
  });
});
```

```bash
# 运行测试
pnpm test src/routing/session-key.test.ts

# 运行所有测试
pnpm test
```

---

## Day 34 — 性能分析与优化 (5h)

### 学习目标

- 理解 OpenClaw 的性能瓶颈（启动时间、AI 延迟、内存）
- 掌握 Node.js 性能分析工具

---

### 详细任务清单

#### 任务 1：测量启动时间 (1h)

```bash
# 测量 Gateway 启动时间
time node openclaw.mjs start &
sleep 3 && curl http://localhost:18789/health && kill %1

# 分析 V8 编译缓存效果
# 第一次启动（无缓存）
rm -rf ~/.cache/node/v8cache 2>/dev/null
time node openclaw.mjs start &
sleep 3 && kill %1

# 第二次启动（有缓存）
time node openclaw.mjs start &
sleep 3 && kill %1
```

---

#### 任务 2：分析内存使用 (1.5h)

```bash
# 启动 Gateway 并监控内存
node --max-old-space-size=512 openclaw.mjs start &
PID=$!

# 定期采样内存
while kill -0 $PID 2>/dev/null; do
  ps -p $PID -o pid,rss,vsz --no-header
  sleep 10
done
```

**内存注意事项**：
- 长期运行时，JSONL 对话历史全量加载可能占用大量内存
- `resolveContextTokensForModel()` 负责按 token 上限裁剪历史

---

#### 任务 3：理解懒加载的性能意义 (1.5h)

```bash
# 追踪模块加载顺序（--trace-require）
NODE_DEBUG=module node openclaw.mjs --help 2>&1 | head -50
NODE_DEBUG=module node openclaw.mjs start 2>&1 | head -100
```

对比 `--help` 和 `start` 加载的模块数量——懒加载使 `--help` 几乎不加载任何业务模块。

---

#### 任务 4：第五周阶段检验 (1h)

1. **Hooks**：如何给 Hooks 请求设置幂等性 Key，防止重复处理？
2. **Cron**：如果 Gateway 关闭期间错过了一个 Cron 触发时间，重启后会补发吗？
3. **MCP**：`stdio` 类型的 MCP Server 崩溃后，Gateway 如何恢复？
4. **安全**：工具执行批准请求发送给哪个 Channel？
5. **性能**：V8 编译缓存存储在哪个目录？

---

## Day 35 — 综合实践：端到端功能开发 (5h)

### 学习目标

- 综合运用前 5 周所学，独立开发一个完整的 OpenClaw 功能
- 验证自己已达到"可修改源码"的水平

---

### 综合实践任务

#### 任务 1：功能需求

实现一个"每日总结"功能：
1. 每天 18:00，触发 Cron Job
2. Cron Job 加载当天的 Discord 对话历史
3. 让 AI 生成当天对话的摘要
4. 将摘要通过 Hooks 发送到指定的 Discord 频道

---

#### 任务 2：实现步骤

**步骤 1**：配置 Cron Job（参考 Day 30）

```json5
{
  "cron": {
    "jobs": [{
      "id": "daily-summary",
      "schedule": "0 18 * * *",
      "message": "请总结今天的对话要点（不超过 200 字）",
      "agentId": "main"
    }]
  }
}
```

**步骤 2**：在 `src/cron/delivery.ts` 中添加历史注入逻辑

```typescript
// 在 buildDeliveryPlan() 中，注入当天历史
const todayHistory = await loadTodayTranscript(sessionKey);
if (todayHistory.length > 0) {
  plan.systemPrompt = `[今日对话历史]\n${formatHistory(todayHistory)}\n\n请基于以上历史生成摘要。`;
}
```

**步骤 3**：配置 Hooks 输出到 Discord

```json5
{
  "hooks": {
    "enabled": true,
    "token": "cron-hook-token",
    "mappings": [{
      "path": "/hooks/daily-summary",
      "channelId": "discord",
      "accountId": "server123",
      "conversationId": "summary-channel"
    }]
  }
}
```

---

#### 任务 3：最终验收检验

完成以下检验，确认已达到"熟悉并可修改源码"水平：

**理论题**：

1. 画出消息从 Discord 到 AI 回复的完整数据流（至少标注 6 个经过的文件）
2. `agent:coder:acp:main-abc123` 这个 Session Key 代表什么？它是怎么生成的？
3. 如果想给所有 AI 回复添加"由 OpenClaw 生成"的署名，应该修改哪个文件的哪个函数？

**实操题**：

4. 添加一个新的 Agent 配置，让 `agent:helper:main` 使用 `claude-haiku-4-5-20251001` 模型（更快更便宜）
5. 修改 Discord Extension，让机器人在发送每条回复前先发一个 "🤔 思考中..." 状态消息
6. 为 `src/routing/session-key.ts` 的 `toAgentStoreSessionKey()` 函数添加一个单元测试用例

---

## 附录：第四、五周关键文件速查

```
src/routing/session-key.ts           # Session Key 格式与路由（L21 常量, L54 toAgentStoreSessionKey）
src/sessions/session-key-utils.ts    # Session Key 解析工具函数
src/config/sessions.ts               # Session Store 接口（SQLite 封装）
src/gateway/session-utils.ts         # 运行时 Session 操作（load/persist）
src/agents/agent-runtime-config.ts   # Agent 配置解析
src/agents/agent-scope-config.ts     # Agent 作用域（多 Agent 路由）
src/gateway/server-chat.ts           # AI 调用主流程（handleChannelChat）
extensions/anthropic/src/provider.ts # Anthropic OpenAI 兼容客户端
src/memory/root-memory-files.ts      # 记忆文件路径管理
src/plugins/memory-runtime.ts        # 向量记忆检索与存储
src/gateway/hooks.ts                 # Hooks 引擎（L49 resolveHooksConfig）
src/gateway/hooks-mapping.ts         # Hooks URL 路径映射
src/gateway/mcp-http.ts              # MCP HTTP 端点
src/cron/service.ts                  # Cron 服务主循环
src/cron/schedule.ts                 # Cron 表达式解析
src/cron/isolated-agent.ts           # Cron 隔离 Agent 执行器
src/cron/delivery.ts                 # Cron 交付计划构建
src/agents/bash-tools.ts             # Bash 工具（工具调用）
src/agents/acp-spawn.ts              # 子 Agent 生成（ACP 协议）
```
