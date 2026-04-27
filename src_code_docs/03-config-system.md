# 配置系统

---

## 1. 配置系统概览

OpenClaw 的配置系统是整个项目的骨骼，几乎所有模块都依赖它。

```
配置文件（openclaw.json / JSON5）
    │
    ▼
src/config/io.ts           ← 文件读写、缓存、热加载
    │
    ├── src/config/env-substitution.ts   ← 环境变量替换（${VAR}）
    ├── src/config/includes.ts           ← 配置文件 include（@include）
    ├── src/config/validation.ts         ← Zod/JSON Schema 验证
    ├── src/config/materialize.ts        ← Source → Runtime 转换
    └── src/config/merge-patch.ts        ← 配置合并/更新
            │
            ▼
        OpenClawConfig（运行时配置对象）
            │
            ▼
        所有使用配置的模块（Gateway、Channels、Plugins 等）
```

---

## 2. 配置文件位置

| 环境变量 | 默认路径 | 说明 |
|---------|---------|------|
| `OPENCLAW_CONFIG_PATH` | — | 显式指定配置文件路径 |
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | 状态目录（配置文件在其中） |
| 默认 | `~/.openclaw/openclaw.json` | 主配置文件 |

**兼容性路径**（遗留）：
- `~/.clawdbot/clawdbot.json`（旧版本）

源码位置：`src/config/paths.ts` — 第 60 行的 `resolveStateDir()` 和第 106 行的 `resolveCanonicalConfigPath()`

---

## 3. 配置文件格式

配置使用 **JSON5** 格式（支持注释、尾随逗号），例如：

```json5
{
  // 网关配置
  gateway: {
    port: 18789,
    secret: "${OPENCLAW_SECRET}",  // 支持环境变量替换
  },

  // AI 模型提供商
  providers: {
    anthropic: {
      enabled: true,
      apiKey: "${ANTHROPIC_API_KEY}",
    },
  },

  // 启用的插件/渠道
  plugins: {
    allow: ["discord", "telegram", "anthropic"],
  },

  // Discord 渠道配置（由 discord 插件提供 schema）
  discord: {
    token: "${DISCORD_TOKEN}",
  },
}
```

---

## 4. 配置加载流程

### 4.1 完整加载链

```typescript
// 入口：src/config/io.ts 中的 loadConfig()
async function loadConfig(): Promise<OpenClawConfig> {
  // 1. 确定配置文件路径
  const configPath = resolveConfigPath();  // ~/.openclaw/openclaw.json

  // 2. 读取原始 JSON5 文本
  const rawText = fs.readFileSync(configPath, "utf8");

  // 3. 解析 JSON5
  const rawObject = JSON5.parse(rawText);

  // 4. 处理 @include 指令（合并外部文件）
  const withIncludes = await resolveConfigIncludes(rawObject, configPath);

  // 5. 环境变量替换：${VAR} → 实际值
  const withEnvVars = resolveConfigEnvVars(withIncludes);

  // 6. 应用 .env 文件中的变量
  applyConfigEnvVars(withEnvVars);

  // 7. Zod/JSON Schema 验证
  const validated = validateConfigObject(withEnvVars);

  // 8. 转换为运行时配置（Source → Runtime）
  const runtimeConfig = materializeRuntimeConfig(validated);

  // 9. 缓存到内存（避免重复读取）
  setRuntimeConfigSnapshot(runtimeConfig);

  return runtimeConfig;
}
```

### 4.2 两种配置对象

OpenClaw 区分了「源配置」和「运行时配置」：

```typescript
// 源配置（Source Config）：接近原始 JSON 结构，含环境变量引用
type SourceConfig = {
  gateway?: { port?: number; secret?: string };
  providers?: Record<string, { enabled?: boolean; apiKey?: string }>;
};

// 运行时配置（Runtime Config）：完全展开，所有默认值已填充
type OpenClawConfig = {
  gateway: { port: number; secret: string; ... };  // 有确定的类型
  providers: { anthropic: { enabled: boolean; apiKey: string; ... }; ... };
};
```

转换发生在 `src/config/materialize.ts` 的 `materializeRuntimeConfig()`。

---

## 5. 配置 Schema（类型定义）

配置类型定义分散在多个文件：

```
src/config/
├── types.ts               ← 导出所有类型（入口）
├── types.openclaw.ts      ← OpenClawConfig 主类型
├── types.gateway.ts       ← Gateway 相关配置
├── types.channels.ts      ← Channel 相关配置
├── types.providers.ts     ← 模型提供商配置
├── types.plugins.ts       ← 插件配置
├── types.agents.ts        ← Agent/AI 相关配置
├── types.hooks.ts         ← Hooks 配置
└── schema.ts              ← JSON Schema（用于 UI 展示和验证）
```

**阅读建议**：先看 `types.openclaw.ts`，它是顶层配置对象的类型，从它能看到完整的配置结构。

---

## 6. 热加载（Config Hot Reload）

Gateway 运行时支持配置热加载，无需重启：

```typescript
// 注册配置变更监听器
registerConfigWriteListener((notification) => {
  console.log("Config changed:", notification.changedPaths);
  // 重新加载受影响的模块
  reloadAffectedModules(notification.changedPaths);
});

// 写入配置时会触发所有监听器
await writeConfigFile(newConfig);
```

实现在：
- `src/config/io.ts` — `registerConfigWriteListener()` 和 `writeConfigFile()`
- `src/gateway/server-reload-handlers.ts` — Gateway 层的热加载处理

---

## 7. 关键 API

### 7.1 读取配置

```typescript
import { loadConfig, getRuntimeConfig } from "../config/config.js";

// 首次加载（从文件读取）
const config = await loadConfig();

// 之后获取缓存的运行时配置（同步，快速）
const config = getRuntimeConfig();  // 如果未加载会抛出

// 容错版本（未加载时返回空配置）
const config = readBestEffortConfig();
```

### 7.2 写入配置

```typescript
import { mutateConfigFile } from "../config/config.js";

// 原子性更新配置（带备份和合并）
await mutateConfigFile(async (current) => {
  return {
    ...current,
    gateway: {
      ...current.gateway,
      port: 19000,
    },
  };
});
```

### 7.3 路径解析

```typescript
import { resolveStateDir, resolveConfigPath, DEFAULT_GATEWAY_PORT } from "../config/paths.js";

const stateDir = resolveStateDir();  // ~/.openclaw
const configPath = resolveConfigPath();  // ~/.openclaw/openclaw.json
const port = resolveGatewayPort(config);  // 优先环境变量 > 配置 > 默认值 18789
```

---

## 8. 配置验证

### 8.1 Zod Schema

```typescript
// src/config/zod-schema.ts
import { z } from "zod";

const GatewayConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(18789),
  secret: z.string().min(1),
  bind: z.string().optional(),
}).strict();
```

### 8.2 验证时机

1. **加载时**：`loadConfig()` → `validateConfigObject()`（必须通过验证）
2. **写入时**：`writeConfigFile()` 写入前验证
3. **插件安装时**：安装新插件后重新验证整体配置

### 8.3 错误处理

```typescript
const result = validateConfigObjectRaw(rawConfig);
if (!result.success) {
  // result.error 包含 Zod 验证错误详情
  throw new InvalidConfigError(formatConfigValidationFailure(result.error));
}
```

---

## 9. 环境变量支持

配置文件中可以用 `${VAR_NAME}` 引用环境变量：

```json5
{
  gateway: {
    secret: "${OPENCLAW_SECRET}",  // 必须存在的环境变量
  }
}
```

处理逻辑在 `src/config/env-substitution.ts`：
- 找到所有 `${VAR}` 模式
- 查找 `process.env.VAR`
- 未找到时根据配置决定是否抛出 `MissingEnvVarError`

---

## 10. 关键目录路径速查

```
~/.openclaw/                    ← STATE_DIR（OPENCLAW_STATE_DIR 可覆盖）
    ├── openclaw.json           ← 主配置文件
    ├── logs/                   ← 日志文件
    ├── sessions/               ← 会话数据（SQLite）
    ├── credentials/            ← OAuth 凭证
    ├── plugins/                ← 安装的插件
    ├── memory/                 ← 记忆向量数据库
    └── .backup/                ← 配置备份文件
```

---

## 11. 阅读建议

按顺序阅读以下文件：

1. `src/config/paths.ts`（全文，约 300 行）— 了解所有路径约定
2. `src/config/types.openclaw.ts`（前 100 行）— 看懂配置类型
3. `src/config/io.ts`（第 1-100 行的 import，和 `loadConfig`、`writeConfigFile` 函数）
4. `src/config/env-substitution.ts`（全文）— 了解 `${VAR}` 替换机制

---

## 下一步

完成本文后，去读 [04-gateway-server.md](./04-gateway-server.md)。
