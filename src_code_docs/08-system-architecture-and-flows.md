# 系统架构图与完整业务执行流程

> 本文用 Mermaid 图表覆盖 4 类视图：
> 1. 系统整体架构
> 2. Gateway 启动时序
> 3. 消息端到端执行流程（请求 → 响应）
> 4. 插件加载生命周期

---

## 1. 系统整体架构图

```mermaid
graph TB
    subgraph Users["用户侧 · 聊天平台"]
        U1["Discord 用户"]
        U2["Telegram 用户"]
        U3["Web UI / iOS / macOS App"]
    end

    subgraph Extensions["Extension 层 · extensions/"]
        E1["extensions/discord/<br/>discord.js 事件监听"]
        E2["extensions/telegram/<br/>bot API 长轮询"]
        EP["extensions/anthropic/<br/>extensions/google/<br/>AI 提供商适配器"]
    end

    subgraph Gateway["Gateway 核心 · src/gateway/"]
        GW["HTTP + WebSocket 服务器<br/>server-http.ts<br/>端口 :18789"]
        CM["Channel Manager<br/>server-channels.ts<br/>管理 Extension 生命周期"]
        SC["AI 调用层<br/>server-chat.ts<br/>流式请求/响应"]
        WS["WebSocket 运行时<br/>server-ws-runtime.ts<br/>App / Web 连接"]
        MCP["MCP 端点<br/>mcp-http.ts<br/>/mcp"]
        HOOKS["Hooks 引擎<br/>hooks.ts<br/>/hook/*"]
    end

    subgraph Core["核心层 · src/"]
        CFG["配置系统<br/>config/io.ts<br/>~/.openclaw/openclaw.json"]
        PLG["插件注册表<br/>plugins/plugin-registry.ts<br/>管理所有插件元数据"]
        SSN["Session 存储<br/>config/sessions.ts<br/>对话历史 + 元数据"]
        AGT["Agent 系统<br/>agents/model-selection.ts<br/>多 Agent / 模型解析"]
    end

    subgraph Storage["存储层"]
        DB["SQLite<br/>~/.openclaw/sessions/sessions.db"]
        TS["对话记录 JSONL<br/>~/.openclaw/sessions/transcripts/"]
        MEM["向量记忆库<br/>sqlite-vec<br/>长期记忆检索"]
    end

    U1 -->|"消息事件"| E1
    U2 -->|"消息事件"| E2
    U3 -->|"WebSocket"| WS

    E1 -->|"WebSocket<br/>/channel/discord"| CM
    E2 -->|"WebSocket<br/>/channel/telegram"| CM

    GW --> CM
    GW --> WS
    GW --> MCP
    GW --> HOOKS

    CM --> SC
    SC -->|"OpenAI compat API<br/>POST /v1/chat/completions"| EP
    SC --> AGT
    AGT --> SSN
    SC --> SSN

    SSN --> DB
    SSN --> TS
    AGT --> MEM

    GW --> CFG
    GW --> PLG
    PLG -.->|"动态加载"| E1
    PLG -.->|"动态加载"| E2
    PLG -.->|"动态加载"| EP

    EP -->|"流式 token"| SC
    SC -->|"流式 delta"| CM
    CM -->|"回复指令"| E1
    CM -->|"回复指令"| E2
    E1 -->|"Discord API"| U1
    E2 -->|"Telegram API"| U2
    WS -->|"事件推送"| U3
```

---

## 2. Gateway 启动时序图

> 对应代码：`openclaw.mjs` → `src/entry.ts` → `src/cli/run-main.ts` → `src/cli/gateway-cli.ts` → `src/gateway/server.impl.ts`

```mermaid
sequenceDiagram
    autonumber
    participant bin  as openclaw.mjs
    participant ent  as src/entry.ts
    participant rm   as cli/run-main.ts
    participant gcli as cli/gateway-cli.ts
    participant impl as gateway/server.impl.ts
    participant cfg  as config/io.ts
    participant plg  as plugins/plugin-registry.ts
    participant http as Node.js http.Server
    participant ws   as WebSocketServer
    participant cm   as gateway/server-channels.ts
    participant ear  as gateway/server-startup-early.ts

    bin->>bin: ensureSupportedNodeVersion() · L39<br/>Node.js >= 22.12 检查
    bin->>bin: module.enableCompileCache() · L43<br/>V8 编译缓存加速
    bin->>ent: import("./dist/entry.js") · L192

    ent->>ent: process.title = "openclaw" · L46
    ent->>ent: normalizeEnv() · L49<br/>标准化环境变量
    ent->>ent: normalizeWindowsArgv() · L100<br/>Windows 路径修正
    ent->>rm: runCli(argv) · L129

    rm->>rm: parseCliContainerArgs() · L186<br/>解析 --container 参数
    rm->>rm: parseCliProfileArgs() · L190<br/>解析 --profile 参数
    rm->>rm: loadCliDotEnv() · L213<br/>加载 .env 文件
    rm->>gcli: buildProgram() + parseAsync() · L324<br/>Commander 解析 "start"

    gcli->>impl: startGatewayServer(port, config)

    Note over impl: Phase 1 · Bootstrap
    impl->>impl: new AbortController()<br/>优雅关闭信号

    Note over impl: Phase 2 · 配置加载
    impl->>cfg: loadConfig()
    cfg->>cfg: 读取 ~/.openclaw/openclaw.json
    cfg->>cfg: 环境变量替换 ${VAR}
    cfg->>cfg: Zod Schema 验证
    cfg-->>impl: OpenClawConfig

    Note over impl: Phase 3 · 插件引导
    impl->>plg: prepareGatewayPluginBootstrap()
    plg->>plg: 扫描 extensions/ 目录
    plg->>plg: 过滤 plugins.allow 白名单
    plg-->>impl: PluginRegistry

    Note over impl: Phase 4 · HTTP/WS 服务器
    impl->>http: http.createServer(handleRequest)
    impl->>ws: new WebSocketServer({ noServer: true })
    impl->>http: server.listen(port · 默认 18789)
    http-->>impl: "listening" 事件

    Note over impl: Phase 5 · 早期运行时
    impl->>ear: startGatewayEarlyRuntime()
    ear->>ear: startGatewayDiscovery()<br/>mDNS/Bonjour 发现
    ear->>ear: startGatewayMaintenanceTimers()<br/>心跳/清理定时器

    Note over impl: Phase 6 · Channel 启动
    impl->>cm: createChannelManager()
    cm->>cm: startChannel("discord")
    cm->>cm: startChannel("telegram")
    cm-->>impl: channels ready

    Note over impl: Phase 7 · 就绪
    impl-->>gcli: GatewayServer 实例
    gcli->>gcli: 打印启动日志<br/>"Gateway listening on :18789"
```

---

## 3. 完整消息端到端执行流程图

> 从用户发送一条消息，到收到 AI 流式回复，标注每一步对应的源码位置。

```mermaid
flowchart TD
    A(["用户在 Discord 发消息\n「你好，介绍一下自己」"])

    A -->|"discord.js messageCreate 事件"| B

    subgraph ext["extensions/discord/src/"]
        B["runtime.ts\n接收 discord.js 事件"]
        B --> C{"过滤规则\nchannel-plugin-api.ts"}
        C -->|"bot 消息 / 无权限 / 黑名单"| Z1(["丢弃"])
        C -->|"通过"| D["构建 InboundMessage\n包含 sender/channel/text"]
    end

    D -->|"WebSocket 帧\n/channel/discord"| E

    subgraph gw_cm["src/gateway/server-channels.ts"]
        E["Channel Manager 接收帧\ncreateChannelManager()"]
        E --> F["路由到对应 Channel 运行时\ngetChannelRuntime(channelId)"]
    end

    F --> G

    subgraph loop["src/channels/draft-stream-loop.ts"]
        G["resolveSessionKey()\nchannelId/accountId/conversationId"]
        G --> H["防抖等待 50ms\n合并连续消息"]
        H --> I["checkAllowlist()\n检查 allow-from 配置"]
        I -->|"被拦截"| Z2(["拒绝，发送提示"])
        I -->|"通过"| J["loadSessionEntry()\n加载历史对话 JSONL"]
    end

    J --> K

    subgraph chat["src/gateway/server-chat.ts"]
        K["buildMessageContext()\n拼接系统提示 + 历史 + 新消息"]
        K --> L["resolveModelRef()\nagents/model-selection.ts\n解析模型 ID → 提供商"]
        L --> M["调用 Provider 插件\nextensions/anthropic/\nPOST /v1/chat/completions"]
    end

    subgraph provider["extensions/anthropic/（OpenAI compat）"]
        M --> N["HTTP 流式请求\nAccept: text/event-stream"]
        N -->|"SSE chunk"| O["解析 delta.content\nfor await chunk of stream"]
    end

    O -->|"每个 token"| P

    subgraph stream_out["流式输出链路"]
        P["server-chat.ts\n累积 buffer"]
        P --> Q["channel.sendDelta(delta)\n推送给 Extension"]
        Q -->|"WebSocket 帧"| R["discord Extension\n调用 Discord API\nmessage.edit()"]
        R --> S(["用户看到逐字更新的回复"])
    end

    O -->|"stream 结束"| T

    subgraph persist["持久化"]
        T["persistSessionEvent()\ngateway/session-utils.ts"]
        T --> U["追加 JSONL\n~/.openclaw/sessions/transcripts/<key>.jsonl\n{role:'user', content:'...'}\n{role:'assistant', content:'...'}"]
        T --> V["更新 SQLite\n~/.openclaw/sessions/sessions.db\ntotalTokens / updatedAt"]
    end
```

---

## 4. 插件加载生命周期图

```mermaid
flowchart TD
    A(["openclaw start"]) --> B

    subgraph scan["plugins/bundled-plugin-scan.ts"]
        B["扫描 extensions/ 目录"]
        B --> C["读取每个子目录的\nopenclaw.plugin.json"]
        C --> D["plugins/manifest.ts\nparsePluginManifest()"]
    end

    subgraph filter["配置过滤 · src/config/config.ts"]
        D --> E{"config.plugins.allow\n白名单过滤"}
        E -->|"不在白名单"| Z1(["跳过此插件"])
        E -->|"在白名单 / 无白名单限制"| F
    end

    subgraph validate["plugins/install-security-scan.ts"]
        F["安全扫描\n检查 package.json 依赖黑名单"]
        F --> G["版本兼容性检查\nminHostVersion 对比"]
        G -->|"不兼容"| Z2(["警告 + 跳过"])
        G -->|"兼容"| H
    end

    subgraph registry["plugins/plugin-registry.ts"]
        H["buildPluginRegistry()\n构建注册表"]
        H --> I["registerChannelPlugin()\n按 id 注册 Channel 类插件"]
        H --> J["registerProviderPlugin()\n按 modelPrefixes 注册 Provider"]
        H --> K["registerCommandAliases()\n注册 CLI 命令别名"]
    end

    subgraph activate["插件激活"]
        I --> L["Channel Manager 启动\nserver-channels.ts\nstartChannel(id)"]
        L --> M["动态 import 插件入口\nextensions/discord/index.ts"]
        M --> N["defineBundledChannelEntry()\n注册 plugin / runtime / accountInspect"]
        N --> O(["Channel 就绪\n开始接收消息"])

        J --> P["Model Catalog 更新\nserver-model-catalog.ts\n添加可用模型列表"]
        P --> Q(["Provider 可用\nAI 请求可发出"])
    end
```

---

## 5. Session Key 生成与会话路由图

```mermaid
flowchart LR
    A["收到消息\nchannelId=discord\naccountId=server123\nconversationId=user456"]

    A --> B["routing/session-key.ts\nbuildSessionKey()"]

    B --> C["discord/server123/user456\n↑ SessionKey 字符串"]

    C --> D{"会话是否存在?\nconfig/sessions.ts\nloadSessionStore()"}

    D -->|"存在"| E["加载历史记录\n~/.openclaw/sessions/transcripts/\ndiscord%2Fserver123%2Fuser456.jsonl"]

    D -->|"不存在"| F["创建新 Session\nupsertSession()\n写入 SQLite sessions.db"]

    E --> G["解析 JSONL\n恢复消息数组\n[{role:'user',...},{role:'assistant',...}]"]
    F --> G

    G --> H["agents/context.ts\n裁剪至模型上下文窗口\nresolveContextTokensForModel()"]

    H --> I["拼接最终 messages 数组\n发送给 AI 模型"]
```

---

## 图例说明

| 符号 | 含义 |
|------|------|
| `实线箭头 →` | 同步调用或数据流向 |
| `虚线箭头 -.->` | 动态加载 / 懒加载关系 |
| `autonumber` | 时序图步骤编号（按调用顺序） |
| `Note over X` | 该阶段的说明注释 |
| `subgraph` | 同一模块/文件内的代码块 |
| `(["..."])` | 终态节点（用户可见的结果） |

---

## 与其他文档的对应关系

| 本文图表 | 对应知识文档 | 对应详细计划 |
|---------|------------|------------|
| 系统架构图 | [01-project-structure.md](./01-project-structure.md) | — |
| Gateway 启动时序 | [04-gateway-server.md](./04-gateway-server.md) | [11-week2-days8-14-详细计划.md](./11-week2-days8-14-详细计划.md) Day 8 |
| 消息端到端流程 | [05-channel-plugin-system.md](./05-channel-plugin-system.md) + [06-session-and-ai.md](./06-session-and-ai.md) | [12-week3-days15-21-详细计划.md](./12-week3-days15-21-详细计划.md) Day 17 |
| 插件加载生命周期 | [05-channel-plugin-system.md](./05-channel-plugin-system.md) | [12-week3-days15-21-详细计划.md](./12-week3-days15-21-详细计划.md) Day 15 |
| Session Key 路由 | [06-session-and-ai.md](./06-session-and-ai.md) | [13-week4-week5-详细计划.md](./13-week4-week5-详细计划.md) Day 22 |
