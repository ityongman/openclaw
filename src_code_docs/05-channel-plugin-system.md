# Channel 与插件系统

---

## 1. 核心概念关系

```
Extension（extensions/ 目录）
    │
    ├── 包含 openclaw.plugin.json   ← 插件清单（描述这个插件是什么）
    ├── 包含 index.ts               ← 插件入口（注册到 Plugin SDK）
    └── 包含实现代码（src/）
            │
            ▼
        Plugin SDK（packages/plugin-sdk/）
            │  插件通过 SDK 与 Gateway 通信
            ▼
        Gateway 插件注册表（src/plugins/plugin-registry.ts）
            │  Gateway 统一管理所有插件
            ▼
        Channel Manager（src/gateway/server-channels.ts）
            │  管理 Channel 类插件的生命周期
            ▼
        Channel 会话（src/channels/session.ts）
            │  处理具体的消息收发
            ▼
        AI 回复（src/gateway/server-chat.ts）
```

---

## 2. 插件清单（Plugin Manifest）

每个 Extension 都有一个 `openclaw.plugin.json`，这是插件的「身份证」：

### 2.1 Discord 插件清单示例

```json
// extensions/discord/openclaw.plugin.json
{
  "id": "discord",           // 插件唯一 ID
  "channels": ["discord"],   // 这个插件提供的 Channel 列表

  // 相关的环境变量（用于提示用户设置）
  "channelEnvVars": {
    "discord": ["DISCORD_BOT_TOKEN"]
  },

  // 顶层配置 JSON Schema（追加到全局配置）
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

### 2.2 更复杂的清单（模型提供商）

```json
// extensions/anthropic/openclaw.plugin.json（示意）
{
  "id": "anthropic",
  "providers": ["anthropic"],    // 提供的 AI 模型提供商

  // 模型目录
  "modelCatalog": {
    "models": [
      { "id": "claude-opus-4-7", "label": "Claude Opus 4.7" },
      { "id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6" }
    ]
  },

  // 认证方式
  "auth": {
    "type": "api-key",
    "envVar": "ANTHROPIC_API_KEY"
  }
}
```

### 2.3 清单字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 插件唯一标识 |
| `channels` | string[] | 提供的 Channel 名称列表 |
| `providers` | string[] | 提供的 AI 模型提供商列表 |
| `modelCatalog` | object | 支持的模型列表 |
| `configSchema` | JSON Schema | 插件的配置 Schema |
| `channelEnvVars` | object | 需要的环境变量 |
| `commands` | object | 注入到 CLI 的命令 |
| `minHostVersion` | string | 最低兼容的 OpenClaw 版本 |

---

## 3. 插件入口（index.ts）

每个 Extension 有一个 `index.ts`，使用 Plugin SDK 声明自己：

```typescript
// extensions/discord/index.ts
import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "discord",
  name: "Discord",
  description: "Discord channel plugin",
  importMetaUrl: import.meta.url,

  // 插件核心逻辑（懒加载）
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "discordPlugin",
  },

  // 运行时适配器（懒加载）
  runtime: {
    specifier: "./runtime-setter-api.js",
    exportName: "setDiscordRuntime",
  },

  // 账号检查（懒加载）
  accountInspect: {
    specifier: "./account-inspect-api.js",
    exportName: "inspectDiscordReadOnlyAccount",
  },

  // 注册额外功能（Hook、子 Agent 等）
  registerFull(api) {
    registerDiscordSubagentHooks(api);
  },
});
```

---

## 4. Plugin SDK

`packages/plugin-sdk/` 是插件开发的核心工具库，Extension 通过它与 Gateway 交互。

### 4.1 主要 API 模块

```
openclaw/plugin-sdk/
├── channel-contract       ← Channel 消息收发接口定义
├── channel-core           ← 创建 Channel 插件的核心函数
├── channel-entry-contract ← 定义插件入口（defineBundledChannelEntry）
├── allowlist-config-edit  ← 白名单配置编辑工具
├── directory-runtime      ← 目录（联系人）运行时
├── error-runtime          ← 错误格式化
├── lazy-runtime           ← 懒加载模块工具
├── runtime-env            ← 运行时环境工具（sleep、abort 等）
├── status-helpers         ← Channel 状态工具
├── target-resolver-runtime ← 消息目标解析
└── text-runtime           ← 文本规范化工具
```

### 4.2 创建 Channel 插件的核心 API

```typescript
import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";

// 这是创建 Channel 插件的工厂函数
export const discordPlugin = createChatChannelPlugin({
  // 获取账号 ID 列表
  listAccountIds: () => listDiscordAccountIds(config),

  // 解析账号
  resolveAccount: (accountId) => resolveDiscordAccount(accountId, config),

  // 配置适配器（读取插件自己的配置）
  config: discordConfigAdapter,

  // 状态适配器（获取 Channel 状态）
  status: createComputedAccountStatusAdapter(...),

  // 出站消息适配器（发送回复给用户）
  outbound: discordOutbound,

  // 设置适配器（引导用户配置）
  setup: discordSetupAdapter,

  // 安全审计适配器
  security: discordSecurityAdapter,

  // 消息动作（编辑、删除等）
  messageActions: discordMessageActionsImpl,
});
```

---

## 5. Channel 生命周期详解

### 5.1 Channel 的状态机

```
未配置
    │ 用户配置 discord.token
    ▼
已配置（待启动）
    │ openclaw start
    ▼
启动中
    ├── 加载插件代码
    ├── 验证 Token
    └── 连接到 Discord API
    │
    ▼
运行中
    ├── 监听 Discord 消息
    ├── 处理用户输入 → 发给 Gateway
    └── 接收 Gateway 回复 → 发给 Discord
    │
    ▼（发生错误）
错误/重启中
    └── 指数退避重试（5s → 10s → 20s → ... → 5min）
```

### 5.2 消息处理主循环

文件：`src/channels/draft-stream-loop.ts`

```typescript
// 消息处理的核心循环（伪代码）
async function handleInboundMessage(message: InboundMessage) {
  // 1. 确定会话（每个用户/频道对应一个 session）
  const sessionKey = resolveSessionKey(message);
  const session = await loadOrCreateSession(sessionKey);

  // 2. 防抖（避免用户快速连续发消息触发多次 AI 调用）
  await debounce(session);

  // 3. 构建 AI 请求上下文
  const context = buildContext(session, message);

  // 4. 调用 AI 模型（流式输出）
  const stream = await callAiModel(context);

  // 5. 流式转发回复给 Channel
  for await (const delta of stream) {
    await channel.sendTyping();  // 发送"正在输入"状态
    buffer.push(delta);
    if (shouldFlush(buffer)) {
      await channel.sendPartialReply(buffer.join(""));
    }
  }

  // 6. 发送最终完整回复
  await channel.sendFinalReply(buffer.join(""));

  // 7. 持久化会话记录
  await session.persist();
}
```

---

## 6. 插件注册系统

文件：`src/plugins/plugin-registry.ts`

### 6.1 插件注册表

```typescript
// 插件注册表管理所有已加载的插件
type PluginRegistry = {
  // 按 ID 查找插件
  getPlugin(id: string): PluginEntry | null;

  // 列出所有 Channel 插件
  listChannelPlugins(): ChannelPluginEntry[];

  // 列出所有提供商插件（AI 模型）
  listProviderPlugins(): ProviderPluginEntry[];

  // 按模型 ID 前缀查找提供商
  resolveProviderByModelId(modelId: string): ProviderPluginEntry | null;
};
```

### 6.2 插件加载流程

```typescript
// 简化版插件加载流程
async function loadPlugins(config: OpenClawConfig) {
  // 1. 扫描 extensions/ 目录（内置插件）
  const bundledPlugins = await scanBundledPlugins();

  // 2. 扫描用户安装的插件（~/.openclaw/plugins/）
  const userPlugins = await scanUserPlugins();

  // 3. 根据配置的 plugins.allow 过滤
  const allowedPlugins = filterByAllowList(
    [...bundledPlugins, ...userPlugins],
    config.plugins?.allow
  );

  // 4. 验证插件（安全扫描、版本兼容性）
  for (const plugin of allowedPlugins) {
    await validatePlugin(plugin);
  }

  // 5. 构建注册表
  return buildPluginRegistry(allowedPlugins);
}
```

---

## 7. 内置插件 vs 用户插件

### 7.1 内置插件（Bundled）

- 位置：`extensions/` 目录
- 随 OpenClaw 一起发布
- 无需单独安装
- 通过 `plugins.allow` 启用/禁用

### 7.2 用户插件（User-installed）

- 位置：`~/.openclaw/plugins/<plugin-id>/`
- 通过 `openclaw plugins install <plugin-id>` 安装
- 从 npm registry 下载

### 7.3 配置启用

```json5
// openclaw.json
{
  "plugins": {
    // 只允许这些插件（其他全部禁用）
    "allow": ["discord", "anthropic", "brave"],

    // 对特定插件的配置覆盖
    "entries": {
      "discord": {
        "enabled": true
      }
    }
  }
}
```

---

## 8. 提供商插件（AI 模型）

提供商插件（如 `anthropic`、`google`、`deepseek`）负责与 AI 模型 API 通信。

### 8.1 与 Channel 插件的区别

| 特性 | Channel 插件 | 提供商插件 |
|------|-------------|----------|
| 作用 | 对接聊天平台 | 对接 AI 模型 |
| 方向 | 接收用户消息 | 发送 AI 请求 |
| 配置键 | `discord:` / `telegram:` | `providers.anthropic:` |
| 示例 | discord、telegram、slack | anthropic、google、deepseek |

### 8.2 提供商 API 对齐

所有提供商插件都实现 OpenAI 兼容 API（`/v1/chat/completions`），Gateway 通过统一接口调用：

```typescript
// Gateway 调用 AI 模型（提供商无关）
const response = await provider.createChatCompletion({
  model: "claude-sonnet-4-6",
  messages: context.messages,
  stream: true,
});
```

---

## 9. 关键文件阅读顺序

1. `extensions/discord/openclaw.plugin.json`（5 行，看清单格式）
2. `extensions/discord/index.ts`（25 行，看入口定义）
3. `extensions/discord/src/channel.ts`（前 80 行，看 Channel 插件创建）
4. `src/plugins/manifest.ts`（前 80 行，了解清单解析）
5. `src/plugins/plugin-registry.ts`（前 80 行，了解注册表）
6. `src/channels/draft-stream-loop.ts`（消息处理主循环）

---

## 下一步

完成本文后，去读 [06-session-and-ai.md](./06-session-and-ai.md)。
