# 项目结构与构建系统

---

## 1. 整体目录结构

```
openclaw/
├── openclaw.mjs          # CLI 可执行入口（发布到 npm 的 bin 文件）
├── package.json          # 项目元数据、依赖、脚本
├── pnpm-workspace.yaml   # monorepo 工作区配置
├── tsconfig.json         # TypeScript 编译配置（根）
├── tsdown.config.ts      # 打包配置（类似 webpack）
├── vitest.config.ts      # 测试框架配置
│
├── src/                  # 核心源码（主要阅读区域）
│   ├── entry.ts          # TypeScript 主入口
│   ├── index.ts          # 库模式导出入口
│   ├── cli/              # CLI 命令层
│   ├── gateway/          # Gateway 服务器
│   ├── channels/         # Channel 抽象层
│   ├── plugins/          # 插件系统
│   ├── config/           # 配置系统
│   ├── sessions/         # 会话 ID/Key 管理
│   ├── agents/           # AI Agent 逻辑
│   ├── memory/           # 记忆系统 SDK
│   ├── mcp/              # Model Context Protocol
│   ├── acp/              # Agent Client Protocol
│   ├── infra/            # 基础设施（env、日志、错误处理）
│   ├── tts/              # 文字转语音
│   ├── realtime-voice/   # 实时语音
│   ├── canvas-host/      # Canvas 渲染
│   ├── cron/             # 定时任务
│   ├── daemon/           # 守护进程管理
│   ├── hooks/            # 事件钩子
│   └── ...
│
├── extensions/           # 平台/服务适配器（每个是独立插件）
│   ├── discord/          # Discord 适配器
│   ├── telegram/         # Telegram 适配器
│   ├── anthropic/        # Anthropic Claude 模型
│   ├── google/           # Google Gemini 模型
│   ├── browser/          # 浏览器自动化
│   └── ...（60+ 个）
│
├── skills/               # AI 技能脚本（Python/JS，用户可调用）
│   ├── github/           # GitHub 操作技能
│   ├── canvas/           # Canvas 操作技能
│   └── ...
│
├── apps/                 # 原生客户端应用
│   ├── android/          # Android app
│   ├── ios/              # iOS app
│   ├── macos/            # macOS app
│   └── macos-mlx-tts/    # macOS 本地 TTS
│
├── packages/             # 内部共享库（发布到 npm）
│   ├── plugin-sdk/       # 插件开发 SDK
│   ├── memory-host-sdk/  # 记忆宿主 SDK
│   └── plugin-package-contract/  # 插件规范
│
├── ui/                   # Web 控制台前端（Lit + Vite）
├── docs/                 # 文档源文件
├── test/                 # 集成测试
├── test-fixtures/        # 测试用固定数据
└── qa/                   # QA 工具
```

---

## 2. Monorepo 结构

这是一个 **pnpm workspace monorepo**，多个包共享同一个 `node_modules`：

```yaml
# pnpm-workspace.yaml（实际内容）
packages:
  - .
  - ui
  - packages/*
  - extensions/*
```

类比：
- Java：Maven 多模块项目
- Go：Go workspace（`go.work`）

**澄清两个常见误解**：

- ✅ **`extensions/*` 在 workspace 里**——每个 extension 都是独立的 npm 包（有自己的 `package.json`），但通过 workspace 共享依赖与脚本。它们的"动态加载"指的是 Gateway 运行时按 manifest 注册，而不是脱离 workspace。
- ❌ **`apps/*`（android/ios/macos）不在 workspace 里**——这些是原生客户端项目（Gradle / Xcode），构建工具完全独立。

**包管理器版本**：仓库锁定在 `pnpm@10.33.0`（`package.json` 的 `packageManager` 字段），新装机器执行 `corepack enable` 后会自动用对的版本。

---

## 3. 构建系统

### 3.1 工具链

| 工具 | 作用 | 类比 |
|------|------|------|
| **tsdown**（基于 Rolldown） | TypeScript 打包 | Maven/Gradle 的 package 阶段 |
| **tsgo**（`@typescript/native-preview`） | 类型检查（仓库统一入口） | `javac` 的类型检查 |
| **oxlint** | 代码 lint | Checkstyle / golangci-lint |
| **oxfmt** | 代码格式化（**不是 Prettier**） | gofmt |
| **vitest** | 单元/集成测试 | JUnit / Go testing |
| **pnpm**（`10.33.0`） | 包管理器 + 任务运行器 | Maven / Go modules |

⚠️ AGENTS.md 明确禁止：`tsc --noEmit`、`typecheck` 脚本、`check:types` 脚本、Prettier。一律走下面 3.2 的命令。

### 3.2 常用构建命令

```bash
# === 基础 ===
pnpm install                # 安装依赖
pnpm dev                    # dev 模式
pnpm openclaw <subcommand>  # 在仓库内跑 CLI（不需要全局安装）
pnpm build                  # tsdown 构建到 dist/

# === 测试 ===
pnpm test                   # 全部测试
pnpm test:changed           # 仅变更涉及的测试（推送前默认）
pnpm test:serial            # 串行（资源敏感场景）
pnpm test:coverage          # 覆盖率

# === 类型检查（走 tsgo，不要用 tsc） ===
pnpm tsgo:core              # 核心 src/ 类型检查
pnpm tsgo:extensions        # 插件类型检查
pnpm tsgo:all               # 全量
pnpm check:test-types       # 测试代码类型

# === Lint / Format ===
pnpm lint                   # oxlint
pnpm format:check           # oxfmt 校验
pnpm format                 # oxfmt 修复

# === 门控 ===
pnpm check:changed          # 智能变更门控（lint + 类型 + 测试）—— 推送前必跑
pnpm check                  # 全量门控（落 main 前；最严格）
pnpm check:import-cycles    # 检查导入循环
```

> 推送前默认 `pnpm check:changed`；落 main 前 `pnpm check` + `pnpm test`。

### 3.3 源码 vs 输出

```
src/entry.ts                →  dist/entry.js          （运行时入口）
src/cli/run-main.ts         →  dist/cli/run-main.js
src/gateway/server.impl.ts  →  dist/gateway/server.impl.js
```

开发时通过 `pnpm dev` / `pnpm openclaw` 直接执行（用 jiti/tsx 现编译现跑）；发布时用 `dist/`。

---

## 4. 文件命名规范

理解命名规范能快速判断文件的作用：

| 后缀/模式 | 含义 | 是否需要重点阅读 |
|-----------|------|----------------|
| `xxx.ts` | 主逻辑文件 | ✅ 是 |
| `xxx.test.ts` | 测试文件（Vitest） | 用于理解行为，非必读 |
| `xxx.runtime.ts` | 运行时懒加载模块 | ✅ 是（运行时核心） |
| `xxx.types.ts` | 纯类型定义文件 | 需要时查阅 |
| `xxx.e2e.test.ts` | 端到端测试 | 可选 |
| `xxx.integration.test.ts` | 集成测试 | 可选 |
| `xxx.live.test.ts` | 需要真实环境的测试 | 可选 |
| `xxx.coverage.test.ts` | 覆盖率专用测试 | 忽略 |
| `AGENTS.md` / `CLAUDE.md` | AI 代理指令文件 | 忽略 |

---

## 5. 重要配置文件

### 5.1 TypeScript 配置（tsconfig.json）

```json
{
  "compilerOptions": {
    "target": "ES2022",       // 编译目标
    "module": "NodeNext",     // ESM 模块系统
    "strict": true,           // 严格类型检查
    "noUncheckedIndexedAccess": true  // 数组访问返回 T | undefined
  }
}
```

**重要**：`strict: true` 意味着所有变量都必须有类型，`null` 和 `undefined` 要显式处理。

### 5.2 package.json 关键字段

```json
{
  "type": "module",           // 所有 .js 文件都是 ESM
  "bin": {
    "openclaw": "openclaw.mjs"  // npm install -g 后的命令名
  },
  "exports": {
    // 主入口（库模式）
    ".": "./dist/index.js",

    // plugin-sdk 根入口
    "./plugin-sdk": {
      "types": "./dist/plugin-sdk/index.d.ts",   // TypeScript 类型声明
      "default": "./dist/plugin-sdk/index.js"    // 实际 JS 文件
    },

    // plugin-sdk 子路径（共约 300 条，每条格式相同）
    "./plugin-sdk/channel-core": {
      "types": "./dist/plugin-sdk/channel-core.d.ts",
      "default": "./dist/plugin-sdk/channel-core.js"
    },
    "./plugin-sdk/runtime": { ... },
    "./plugin-sdk/memory-core": { ... },
    // ... 更多子路径

    // 其他顶级入口
    "./extension-api": {
      "types": "./dist/extension-api.d.ts",
      "default": "./dist/extension-api.js"
    },
    "./cli-entry": {
      "types": "./dist/cli-entry.d.ts",
      "default": "./dist/cli-entry.js"
    }
  }
}
```

**为什么 exports 有这么多条目（311 条）？**

plugin-sdk 是插件开发的核心库，按功能粒度拆分成数百个子模块（`channel-core`、`memory-core`、`approval-runtime` 等），每个子模块独立导出，插件按需引入，避免打包进不需要的代码。

每条 export 有两个字段：
- `types`：TypeScript 类型声明文件（`.d.ts`），IDE 补全用
- `default`：实际运行的 JavaScript 文件（`.js`）

**对 Java 程序员**：类似 Maven 的多模块 jar，每个 `./plugin-sdk/xxx` 相当于一个独立的子模块 artifact。  
**对 Python 程序员**：类似 `from openclaw.plugin_sdk import channel_core` 按需导入子包。

---

## 6. 依赖分类理解

### 核心运行时依赖

```
openai          ← AI 模型 API（OpenAI 兼容接口）
@modelcontextprotocol/sdk  ← MCP 协议 SDK
zod             ← 配置/数据验证
commander       ← CLI 参数解析（类似 cobra/picocli）
ws              ← WebSocket 客户端/服务端
croner          ← 定时任务（cron 表达式）
sqlite-vec      ← SQLite + 向量扩展（记忆系统）
tslog           ← 结构化日志
yaml            ← YAML 解析（配置文件格式）
json5           ← JSON5 解析（更宽松的 JSON）
chokidar        ← 文件监听（配置热加载）
dotenv          ← .env 文件加载
semver          ← 语义化版本比较
```

### 开发/构建依赖

```
typescript      ← 类型检查
vitest          ← 测试框架
tsdown          ← 打包
oxlint          ← lint
lit             ← Web Components（UI 层）
```

---

## 7. 关键路径：代码如何被执行

### 开发模式（直接运行 TypeScript）

```
node openclaw.mjs
  └── import("./dist/entry.js")
       └── 如果没有 dist/，报错提示先 build
```

### 生产模式

```
npm install -g openclaw
openclaw start
  └── /usr/local/bin/openclaw → openclaw.mjs
       └── dist/entry.js
            └── dist/cli/run-main.js
                 └── dist/cli/program.js（Commander 命令树）
                      └── 命令处理器 → Gateway / CLI 子命令
```

---

## 8. 源码阅读起点建议

按这个顺序打开文件，效率最高：

```
第 1 步：src/entry.ts                   （10 分钟，看懂启动链）
第 2 步：src/cli/run-main.ts            （20 分钟，理解 CLI 分发）
第 3 步：src/config/config.ts           （30 分钟，理解配置加载）
第 4 步：src/gateway/server-startup.ts  （40 分钟，理解 Gateway 启动）
第 5 步：extensions/discord/            （30 分钟，看一个简单的 Extension）
```

---

## 下一步

完成本文后，去读 [02-entry-and-cli.md](./02-entry-and-cli.md)。
