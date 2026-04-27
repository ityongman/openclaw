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
# pnpm-workspace.yaml
packages:
  - "packages/*"
  - "apps/*"
  - "ui"
```

类比：
- Java：Maven 多模块项目
- Go：Go workspace（`go.work`）

**重要**：`extensions/` 里的插件不在 workspace 里，它们是在运行时动态加载的独立目录。

---

## 3. 构建系统

### 3.1 工具链

| 工具 | 作用 | 类比 |
|------|------|------|
| **tsdown** | TypeScript 打包（基于 Rolldown） | Maven/Gradle 的 package 阶段 |
| **TypeScript tsc** | 类型检查（不输出代码） | `javac` 的类型检查 |
| **oxlint** | 代码 lint | Checkstyle / golangci-lint |
| **vitest** | 单元/集成测试 | JUnit / Go testing |
| **pnpm** | 包管理器 | Maven / Go modules |

### 3.2 常用构建命令

```bash
# 安装依赖
pnpm install

# 构建（编译 TypeScript → JavaScript 到 dist/）
pnpm build

# 运行测试
pnpm test

# 类型检查（不构建）
pnpm typecheck

# Lint
pnpm lint
```

### 3.3 源码 vs 输出

```
src/entry.ts          →  dist/entry.js       （运行时用这个）
src/cli/run-main.ts   →  dist/cli/run-main.js
src/gateway/server.ts →  dist/gateway/server.js
```

开发时直接运行 TypeScript（通过 `tsx` 或 `jiti`），发布时用 `dist/`。

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
    ".": "./dist/index.js",
    "./plugin-sdk": "./dist/plugin-sdk/index.js"  // 子路径导出
  }
}
```

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
