# 第一周详细学习计划（Day 1-7）

> 目标：建立 TypeScript 基础感知、搞懂项目结构、完全理解 `openclaw start` 的入口链和配置系统
>
> 前提：已安装 Node.js >= 22.12，pnpm，已克隆 openclaw 仓库

---

## Day 1 — TypeScript 语言基础 (4h)

### 学习目标

- 消除 TypeScript 陌生感，能读懂 OpenClaw 代码基本语法
- 理解 `type`、`interface`、泛型、`as const`、可选链（`?.`）等关键语法
- 用两个简单的工具文件作为实操对象

---

### 序列图：TypeScript 类型推导过程

```mermaid
graph TD
    A[".ts 源码文件"] --> B["tsc 编译器"]
    B --> C{类型检查}
    C -->|类型正确| D[".js 输出文件"]
    C -->|类型错误| E["编译报错：类型不匹配"]
    D --> F["Node.js 运行时执行"]

    G["类型注解 (: string)"] -.-> C
    H["接口/类型别名"] -.-> C
    I["泛型 <T>"] -.-> C
```

---

### 详细任务清单

#### 任务 1：阅读 `00-typescript-primer.md` (1h)

**阅读范围**：`src_code_docs/00-typescript-primer.md` 全文

**理解重点**（阅读时逐一回答）：
1. `type` 和 `interface` 的区别是什么？
2. `string | undefined` 和 `string?` 有什么不同？
3. `as const` 会把数组/对象变成什么？
4. 泛型 `<T>` 在函数定义中怎么用？

---

#### 任务 2：阅读 `src/infra/env.ts` (1h)

**阅读范围**：`src/infra/env.ts` 全文（约 50 行）

**代码解读**：找到这个函数，逐行分析：

```typescript
// 文件：src/infra/env.ts
export function isTruthyEnvValue(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}
```

**逐行理解**：
- `value: string | undefined` — 参数类型，允许传入字符串或 `undefined`
- `value === "1"` — 精确等于字符串 "1"，JavaScript `===` 不做类型转换
- `value?.toLowerCase()` — 可选链：如果 `value` 是 `undefined`，整个表达式返回 `undefined` 而不是报错
- `=== "true"` — 所以如果 value 是 undefined，`undefined === "true"` 返回 `false`，总体返回 `false`

**接口调用关系**：

```
isTruthyEnvValue(value: string | undefined) → boolean
  被调用位置（grep 搜索）:
    src/infra/env.ts:isTruthyEnvValue
    → 多处 src/config/*.ts 中判断环境变量开关
```

**Debug 实操**：在终端执行（不需要构建，直接用 Node.js）：

```bash
# 在仓库根目录执行
node --input-type=module << 'EOF'
function isTruthyEnvValue(value) {
  return value === "1" || value?.toLowerCase() === "true";
}
console.log(isTruthyEnvValue("1"));       // true
console.log(isTruthyEnvValue("true"));    // true
console.log(isTruthyEnvValue("TRUE"));    // true
console.log(isTruthyEnvValue("false"));   // false
console.log(isTruthyEnvValue(undefined)); // false
EOF
```

**预期输出**：
```
true
true
true
false
false
```

---

#### 任务 3：阅读 `src/infra/errors.ts` (1h)

**阅读范围**：`src/infra/errors.ts` 全文（约 60 行）

**理解重点**：
- OpenClaw 如何定义自定义错误类
- `class XxxError extends Error` 模式
- 错误的 `name` 属性为什么要设置

**代码结构模式**：

```typescript
// OpenClaw 自定义错误的统一模式
export class SomeError extends Error {
  readonly name = "SomeError";  // 使 instanceof 和 console.log 清晰
  constructor(message: string, public readonly details?: unknown) {
    super(message);
  }
}
```

**知识点**：
- `readonly name = "SomeError"` — 类属性，只读，每个实例都有这个值
- `public readonly details?` — 构造函数参数自动变成实例属性（TypeScript 语法糖）
- `super(message)` — 调用父类 `Error` 的构造函数，设置 `message` 属性

---

#### 任务 4：阅读 `src/version.ts` + `src/utils.ts` (1h)

**阅读范围**：
- `src/version.ts` 全文
- `src/utils.ts` 前 80 行

**理解重点**：
- `as const` 的用法（可能出现在版本号数组中）
- `export const` vs `export function` 的区别
- 工具函数如何导出和使用

---

### 知识检验

完成 Day 1 后，不看代码，能回答以下问题：

1. `value?.toLowerCase()` 中，如果 `value` 是 `undefined`，结果是什么？（答：`undefined`）
2. TypeScript 的 `interface` 和 `type` 最主要的使用区别？
3. 为什么自定义 Error 类要设置 `name` 属性？

---

### 常见疑问

**Q：为什么 import 路径是 `.js` 而不是 `.ts`？**

A：TypeScript ESM 模块规范要求 import 路径使用运行时的文件名（即编译后的 `.js`）。TypeScript 编译器会把 `.ts` 文件编译成 `.js`，所以 import 时就用 `.js`。这是 OpenClaw 全仓库的约定。

**Q：`export default` 和 `export const` 有什么区别？**

A：`export default` 导出一个默认值，import 时可以用任意名字；`export const` 导出有名字的绑定，import 时必须用花括号 `{ functionName }`。

---

## Day 2 — 项目结构与构建系统 (4h)

### 学习目标

- 理解 pnpm workspace monorepo 的目录组织
- 理解 tsdown（基于 Rolldown）的打包流程
- 能成功构建项目并运行 `openclaw --help`

---

### 序列图：pnpm build 构建流程

```mermaid
sequenceDiagram
    participant Dev as 开发者
    participant pnpm as pnpm
    participant tsdown as tsdown
    participant ts as TypeScript 编译器
    participant dist as dist/ 目录

    Dev->>pnpm: pnpm build
    pnpm->>tsdown: 读取 tsdown.config.ts
    tsdown->>ts: 解析所有 .ts 源文件
    ts->>tsdown: AST + 类型信息
    tsdown->>dist: 打包输出 dist/entry.js
    tsdown->>dist: 打包输出 dist/cli/*.js
    tsdown->>dist: 打包输出 dist/gateway/*.js
    dist->>Dev: 构建完成
```

---

### 详细任务清单

#### 任务 1：阅读 `01-project-structure.md` (1h)

**阅读范围**：`src_code_docs/01-project-structure.md` 全文

**重点关注**：

```
openclaw/
├── src/           ← 核心代码（Gateway、CLI、配置、AI层等）
├── extensions/    ← 插件（discord、telegram、anthropic 等）
├── packages/      ← 共享库（plugin-sdk 等）
├── apps/          ← 原生应用（iOS、macOS、Android）
├── skills/        ← 技能插件（canvas 等）
├── openclaw.mjs   ← 最外层 CLI 入口（可执行脚本）
├── package.json   ← 根包配置
└── tsdown.config.ts ← 构建配置
```

**接口调用关系图（目录层级）**：

```
openclaw.mjs（可执行文件）
  └── import("./dist/entry.js")
        └── src/entry.ts（TypeScript 源码）
              └── import("./cli/run-main.js")
                    └── src/cli/run-main.ts
                          └── import("./program.js")
                                └── src/cli/program.ts（Commander 命令树）
```

---

#### 任务 2：阅读 `package.json` 的 scripts 字段 (30m)

**阅读范围**：根目录 `package.json`，重点看 `scripts` 字段

**关键 scripts 及其作用**：

| 命令 | 作用 |
|------|------|
| `pnpm build` | 运行 tsdown，编译所有 TypeScript 到 dist/ |
| `pnpm test` | 运行 vitest 单元测试 |
| `pnpm typecheck` | 只做类型检查，不输出文件 |
| `pnpm lint` | ESLint 代码质量检查 |

---

#### 任务 3：阅读 `tsdown.config.ts` (30m)

**阅读范围**：根目录 `tsdown.config.ts` 全文

**理解重点**：
- `entry` 字段：指定打包入口文件（`src/entry.ts` → `dist/entry.js`）
- `format: "esm"` — 输出 ES Module 格式
- `outDir: "dist"` — 输出目录

---

#### 任务 4：实操构建 (1h)

**步骤**：

```bash
# 步骤 1：安装依赖（约 2-5 分钟）
pnpm install

# 步骤 2：构建（约 30-60 秒）
pnpm build

# 步骤 3：验证构建成功
ls dist/
# 预期：看到 entry.js 和其他文件

# 步骤 4：运行 CLI 帮助
node openclaw.mjs --help
```

**预期输出**（节选）：
```
Usage: openclaw [options] [command]

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  start           Start the OpenClaw gateway
  daemon          Manage the OpenClaw daemon
  plugins         Manage plugins
  ...
```

---

#### 任务 5：阅读目录结构，建立心智模型 (1h)

执行以下命令，观察关键目录的文件数量：

```bash
# 查看 extensions 下有哪些插件
ls extensions/

# 查看 src/ 下的主要子目录
ls src/

# 查看 packages/ 下有什么
ls packages/
```

**Debug 实操**：在 `openclaw.mjs` 第 1 行之后添加一行日志，验证入口被执行：

```javascript
// 在 openclaw.mjs 最顶部（shebang 行之后）添加：
console.error(">>> openclaw.mjs 被执行，Node.js 版本:", process.version);
```

然后运行：
```bash
node openclaw.mjs --help 2>&1 | head -5
```

**预期输出**：
```
>>> openclaw.mjs 被执行，Node.js 版本: v22.x.x
Usage: openclaw [options] [command]
...
```

> 记得测试完后删除这行 console.error

---

### 知识检验

1. `pnpm build` 后，TypeScript 文件被编译到哪个目录？
2. `openclaw.mjs` 是如何加载实际逻辑的？（答：`await import("./dist/entry.js")`）
3. `extensions/` 和 `packages/` 有什么区别？

---

## Day 3 — 入口链深入 (4h)

### 学习目标

- 完全搞懂 `openclaw start` 从执行到 Gateway 启动的**完整调用链**
- 理解 `isMainModule()` 判断机制
- 理解懒加载（dynamic import）在 CLI 启动优化中的作用

---

### 序列图：`openclaw start` 完整调用链

```mermaid
sequenceDiagram
    participant Shell as Shell
    participant mjs as openclaw.mjs
    participant entry as src/entry.ts
    participant runmain as src/cli/run-main.ts
    participant program as src/cli/program.ts
    participant gwcli as src/cli/gateway-cli.ts
    participant gw as src/gateway/server.ts

    Shell->>mjs: node openclaw.mjs start
    mjs->>mjs: 检查 Node.js >= 22.12
    mjs->>mjs: 启用 V8 编译缓存
    mjs->>entry: await import("./dist/entry.js")
    entry->>entry: isMainModule() → true
    entry->>entry: ensureCliRespawnReady() → false（正常不 respawn）
    entry->>runmain: await runCli(process.argv)
    runmain->>runmain: 加载 .env 文件
    runmain->>runmain: shouldStartCrestodianForBareRoot(argv) → false
    runmain->>runmain: tryRouteCli(argv) → false
    runmain->>program: const program = buildProgram()
    program->>program: 注册所有命令（start/daemon/plugins...）
    runmain->>program: program.parseAsync(["start"])
    program->>gwcli: 匹配 "start" 命令，执行 action()
    gwcli->>gwcli: import("./gateway-cli.js")
    gwcli->>gw: startGatewayFromCli()
    gw->>gw: loadConfig() 加载配置
    gw->>gw: startGatewayServer(port, opts)
    gw-->>Shell: Gateway 启动监听端口 18789
```

---

### 详细任务清单

#### 任务 1：阅读 `02-entry-and-cli.md` (30m)

**阅读范围**：`src_code_docs/02-entry-and-cli.md` 全文

---

#### 任务 2：精读 `openclaw.mjs` (1h)

**阅读范围**：根目录 `openclaw.mjs` 全文

**关键代码解读**：

```javascript
// openclaw.mjs 关键逻辑（简化版）

// 1. 检查 Node.js 版本
const MIN_NODE_MAJOR = 22;
const [major] = process.versions.node.split(".").map(Number);
if (major < MIN_NODE_MAJOR) {
  console.error(`需要 Node.js >= ${MIN_NODE_MAJOR}`);
  process.exit(1);
}

// 2. 快速帮助路径（不加载完整程序）
if (isBareRootHelpInvocation(process.argv)) {
  // 直接打印预计算的帮助文本，毫秒级响应
  process.stdout.write(precomputedHelp);
  process.exit(0);
}

// 3. 真正的入口
await import("./dist/entry.js");
```

**接口关系**：
- `isBareRootHelpInvocation(argv: string[]): boolean` — 判断是否是 `openclaw --help`
- `await import("./dist/entry.js")` — 加载编译后的 TypeScript 入口

**Debug 实操**：在 `openclaw.mjs` 加载 `dist/entry.js` 之前添加计时日志：

```javascript
// 在 await import("./dist/entry.js"); 之前添加：
const t0 = Date.now();
console.error(`[TIMING] openclaw.mjs → 开始加载 dist/entry.js, t=${t0}`);
await import("./dist/entry.js");
// 注意：这行不会执行（entry.js 内部会 process.exit）
```

运行：
```bash
node openclaw.mjs --version 2>&1
```

---

#### 任务 3：精读 `src/entry.ts` (1h)

**阅读范围**：`src/entry.ts` 全文（189 行）

**关键函数定位**：

```
src/entry.ts:
  L1-17    imports
  L18-21   ENTRY_WRAPPER_PAIRS 常量（定义 .mjs 和 .js 的对应关系）
  L38-42   isMainModule({ currentFile, wrapperEntryPairs }) → boolean
  L129     runMainOrRootHelp(argv: string[]) — 决策入口
  L134-172 tryHandleRootHelpFastPath() — 快速帮助路径
  L174-189 主逻辑：if (isMainModule) → runCli(argv)
```

**核心判断 `isMainModule()`**：

```typescript
// src/entry.ts L38-42（简化）
function isMainModule({ currentFile }: IsMainModuleParams): boolean {
  // 判断当前文件是否是 Node.js 的主模块（直接运行，非 import）
  // 类比 Python 的 if __name__ == "__main__"
  return currentFile === process.argv[1] ||
         currentFile === fileURLToPath(import.meta.url);
}
```

**Debug 实操**：在 `src/entry.ts` 的 `runCli` 调用之前添加日志（需要 pnpm build 后才生效）：

```typescript
// src/entry.ts，在 await runCli(process.argv); 之前添加：
console.error("[entry.ts] isMain=true, 即将调用 runCli, argv:", process.argv.slice(2));
```

步骤：
```bash
# 1. 修改 src/entry.ts（添加上面的 console.error）
# 2. 重新构建
pnpm build

# 3. 运行并观察
node openclaw.mjs start 2>&1 | head -3
```

**预期输出**：
```
[entry.ts] isMain=true, 即将调用 runCli, argv: ["start"]
```

---

#### 任务 4：精读 `src/cli/run-main.ts` 的 `runCli()` 函数 (1.5h)

**阅读范围**：`src/cli/run-main.ts` 第 83-310 行（`runCli` 函数）

**函数签名**：

```typescript
// src/cli/run-main.ts L83
export async function runCli(argv: string[] = process.argv): Promise<void>
```

**内部执行阶段**（逐步理解）：

| 代码位置 | 阶段 | 作用 |
|---------|------|------|
| L84-95 | 参数预处理 | 处理 `--container` 参数 |
| L111-114 | 加载 .env | 读取 `.env` 文件到 `process.env` |
| L130-137 | 快速帮助路径 | `openclaw --help` 时直接返回 |
| L146-175 | Crestodian 快速路径 | `openclaw`（无参数）时启动 TUI |
| L189-191 | tryRouteCli | 尝试别名路由 |
| L193-306 | 完整 CLI 启动 | 构建 Commander 程序，解析命令 |

**接口调用关系**：

```
runCli(argv: string[]) [run-main.ts:83]
  ├── shouldStartCrestodianForBareRoot(argv) [run-main.ts:146]
  │     └── returns: boolean
  ├── tryRouteCli(argv) [src/cli/route.ts]
  │     └── returns: Promise<boolean>
  ├── buildProgram() [src/cli/program.ts]
  │     └── returns: Command (Commander.js)
  └── program.parseAsync(argv) [Commander.js]
        └── 触发匹配命令的 action()
```

**Debug 实操**：

```typescript
// src/cli/run-main.ts:83 后面加（在函数体第一行）：
console.error("[run-main.ts] runCli 被调用，args:", argv.slice(2));
```

重新构建后：
```bash
pnpm build && node openclaw.mjs plugins list 2>&1 | head -5
```

**预期输出**：
```
[run-main.ts] runCli 被调用，args: ["plugins", "list"]
```

---

#### 任务 5：阅读 `src/cli/route.ts` (30m)

**阅读范围**：`src/cli/route.ts` 全文

**理解重点**：
- `tryRouteCli` 是如何做命令别名/快速路由的
- 返回 `true` 表示已处理，`false` 表示交给 Commander 处理

---

### 知识检验

不看代码，能画出 `openclaw start` 的调用链（5个关键节点）：

```
openclaw.mjs → ? → ? → ? → Gateway 启动
```

答案：
```
openclaw.mjs → src/entry.ts → src/cli/run-main.ts → src/cli/program.ts → src/cli/gateway-cli.ts → src/gateway/server.ts
```

---

## Day 4 — CLI 命令树深入 (5h)

### 学习目标

- 理解所有 CLI 命令的注册机制（静态 vs 动态）
- 理解 Commander.js 的核心 API
- 能给 CLI 添加一个新命令

---

### 序列图：Commander 命令解析流程

```mermaid
sequenceDiagram
    participant argv as process.argv
    participant program as Commander program
    participant action as command action()
    participant lazy as lazy import()
    participant module as 实际模块

    argv->>program: program.parseAsync(argv)
    program->>program: 匹配 argv[2] 为命令名
    program->>action: 执行匹配命令的 action 函数
    action->>lazy: const { fn } = await import("./xxx.js")
    lazy->>module: 动态加载模块（首次执行才加载）
    module-->>action: 返回导出的函数
    action->>module: 调用函数
```

---

### 详细任务清单

#### 任务 1：浏览 `src/cli/program.ts` (1h)

**阅读范围**：`src/cli/program.ts` 全文

**关键模式**：Commander.js 命令注册：

```typescript
// src/cli/program.ts（典型命令注册模式）
program
  .command("start")                          // 命令名
  .alias("gateway")                          // 别名
  .description("Start the OpenClaw gateway") // 帮助文本
  .option("--port <port>", "Port to listen") // 选项（带参数）
  .option("--verbose", "Verbose output")     // 开关选项
  .action(async (options) => {               // 执行回调（async）
    // 懒加载：只有执行 start 命令时才加载这些模块
    const { startGatewayFromCli } = await import("./gateway-cli.js");
    await startGatewayFromCli(options);
  });
```

**Commander.js 核心 API**：

| API | 说明 |
|-----|------|
| `.command(name)` | 定义子命令 |
| `.description(text)` | 设置帮助描述 |
| `.option(flags, desc)` | 定义选项 |
| `.argument(<name>)` | 定义位置参数 |
| `.action(fn)` | 绑定执行函数 |
| `.addCommand(sub)` | 添加嵌套子命令 |

**列出所有顶层命令**：

```bash
node openclaw.mjs --help
```

---

#### 任务 2：精读 `src/cli/gateway-cli.ts` (1h)

**阅读范围**：`src/cli/gateway-cli.ts` 全文

**关键函数**：

```typescript
// src/cli/gateway-cli.ts
export async function startGatewayFromCli(options?: {
  port?: number;
  verbose?: boolean;
}): Promise<void> {
  // 1. 加载配置
  const config = await loadConfig();

  // 2. 解析端口（命令行选项 > 配置文件 > 默认值 18789）
  const port = options?.port ?? resolveGatewayPort(config);

  // 3. 启动 Gateway
  const { startGatewayServer } = await import("../gateway/server.js");
  await startGatewayServer(port, { config });
}
```

**接口调用关系**：

```
startGatewayFromCli(options?)
  ├── loadConfig() [src/config/io.ts]
  │     └── returns: OpenClawConfig
  ├── resolveGatewayPort(config, env?) [src/config/paths.ts:L285]
  │     └── returns: number (默认 18789)
  └── startGatewayServer(port, opts) [src/gateway/server.ts]
        └── returns: Promise<GatewayServer>
```

---

#### 任务 3：浏览 `src/cli/daemon-cli.ts` (1h)

**阅读范围**：`src/cli/daemon-cli.ts` 全文

**理解重点**：
- `openclaw daemon start` 如何在后台启动进程
- Linux/macOS 使用 systemd，Windows 使用什么机制？

---

#### 任务 4：浏览 `src/cli/plugins-cli.ts` (1h)

**阅读范围**：`src/cli/plugins-cli.ts` 全文

**理解重点**：
- `openclaw plugins install discord` 如何下载和安装插件
- 安装后配置文件如何更新

---

#### 任务 5：动手添加一个新命令 (1h)

**练习**：在 `src/cli/program.ts` 中添加 `config echo` 命令，打印当前 Gateway 端口

```typescript
// 在 src/cli/program.ts 中找到合适位置添加：
const configCmd = program
  .command("config")
  .description("Configuration utilities");

configCmd
  .command("echo")
  .description("Print current gateway port")
  .action(async () => {
    const { loadConfig } = await import("../config/io.js");
    const { resolveGatewayPort } = await import("../config/paths.js");
    const config = await loadConfig();
    const port = resolveGatewayPort(config);
    console.log(`Gateway port: ${port}`);
  });
```

**测试**：
```bash
pnpm build && node openclaw.mjs config echo
```

**预期输出**：
```
Gateway port: 18789
```

---

### 知识检验

1. Commander.js 的 `.action()` 回调何时执行？（答：parseAsync 匹配到对应命令时）
2. 为什么命令的实现代码在 `await import()` 里？（答：懒加载，加速 `--help` 响应）
3. `openclaw plugins` 和 `openclaw config` 的 action 函数分别在哪个文件？

---

## Day 5 — 配置系统深入 (6h)

### 学习目标

- 完全理解配置如何从文件加载到内存
- 理解 Zod 验证机制
- 理解环境变量替换 `${VAR}` 的实现

---

### 序列图：配置加载完整流程

```mermaid
sequenceDiagram
    participant code as 调用代码
    participant io as src/config/io.ts
    participant paths as src/config/paths.ts
    participant fs as 文件系统
    participant json5 as JSON5 解析器
    participant env as 环境变量替换
    participant zod as Zod 验证
    participant mat as materialize.ts

    code->>io: loadConfig()
    io->>paths: resolveCanonicalConfigPath()
    paths-->>io: "~/.openclaw/openclaw.json"
    io->>fs: fs.readFileSync(configPath, "utf8")
    fs-->>io: 原始 JSON5 文本
    io->>json5: JSON5.parse(rawText)
    json5-->>io: 原始 JS 对象
    io->>env: resolveConfigEnvVars(obj)
    env->>env: 替换所有 ${VAR} 为 process.env.VAR
    env-->>io: 替换后的对象
    io->>zod: validateConfigObject(obj)
    zod-->>io: 验证通过（或抛出 InvalidConfigError）
    io->>mat: materializeRuntimeConfig(validated)
    mat-->>io: OpenClawConfig（运行时配置）
    io-->>code: OpenClawConfig
```

---

### 详细任务清单

#### 任务 1：阅读 `03-config-system.md` (1h)

**阅读范围**：`src_code_docs/03-config-system.md` 全文

---

#### 任务 2：精读 `src/config/paths.ts` (1h)

**阅读范围**：`src/config/paths.ts` 全文（约 302 行）

**关键函数**：

```typescript
// src/config/paths.ts L60-89
function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir()
): string {
  // 优先级：OPENCLAW_STATE_DIR 环境变量 > ~/.openclaw
  if (env.OPENCLAW_STATE_DIR) {
    return env.OPENCLAW_STATE_DIR;
  }
  return path.join(homedir, ".openclaw");
}
```

```typescript
// src/config/paths.ts L106-115
function resolveCanonicalConfigPath(
  env?: NodeJS.ProcessEnv,
  stateDir?: string
): string {
  // 1. 如果指定了 OPENCLAW_CONFIG_PATH，直接用
  if (env?.OPENCLAW_CONFIG_PATH) return env.OPENCLAW_CONFIG_PATH;

  // 2. 否则：stateDir/openclaw.json
  const dir = stateDir ?? resolveStateDir(env);
  return path.join(dir, "openclaw.json");
}
```

```typescript
// src/config/paths.ts L285-301
function resolveGatewayPort(
  cfg?: { gateway?: { port?: number } },
  env: NodeJS.ProcessEnv = process.env
): number {
  // 优先级：OPENCLAW_GATEWAY_PORT > config.gateway.port > 18789
  if (env.OPENCLAW_GATEWAY_PORT) {
    return parseInt(env.OPENCLAW_GATEWAY_PORT, 10);
  }
  return cfg?.gateway?.port ?? DEFAULT_GATEWAY_PORT; // DEFAULT_GATEWAY_PORT = 18789
}
```

**接口调用关系图**：

```
resolveStateDir(env?, homedir?) → string
  调用方: resolveCanonicalConfigPath, loadConfig, 等
  
resolveCanonicalConfigPath(env?, stateDir?) → string
  调用方: loadConfig [io.ts:1458]
  
resolveGatewayPort(cfg?, env?) → number
  调用方: startGatewayFromCli [gateway-cli.ts]
          resolveGatewayPort [server.impl.ts]
```

**Debug 实操**：

```bash
# 测试路径解析
node --input-type=module << 'EOF'
import { createRequire } from 'module';
import os from 'os';
import path from 'path';

// 模拟 resolveStateDir 逻辑
function resolveStateDir(env = process.env) {
  if (env.OPENCLAW_STATE_DIR) return env.OPENCLAW_STATE_DIR;
  return path.join(os.homedir(), ".openclaw");
}

console.log("默认 stateDir:", resolveStateDir());
console.log("覆盖 stateDir:", resolveStateDir({ OPENCLAW_STATE_DIR: "/tmp/test" }));
EOF
```

**预期输出**：
```
默认 stateDir: C:\Users\username\.openclaw   (Windows)
覆盖 stateDir: /tmp/test
```

---

#### 任务 3：精读 `src/config/io.ts` 的 `loadConfig` 函数 (1h)

**阅读范围**：`src/config/io.ts` 第 1458-1595 行

**注意**：`loadConfig()` 虽然函数名看起来是异步，但内部主要是**同步**的文件读取（`fs.readFileSync`），这是一个重要细节。

**代码结构**：

```typescript
// src/config/io.ts L1458（简化伪代码，帮助理解结构）
function loadConfig(): OpenClawConfig {
  // 1. 确定配置文件路径
  const configPath = resolveCanonicalConfigPath();
  
  // 2. 读取文件（同步）
  const rawText = fs.readFileSync(configPath, "utf8");
  
  // 3. JSON5 解析
  const rawObj = JSON5.parse(rawText);
  
  // 4. @include 指令处理
  const withIncludes = resolveConfigIncludes(rawObj, configPath);
  
  // 5. ${VAR} 环境变量替换
  const withEnvVars = resolveConfigEnvVars(withIncludes);
  
  // 6. Zod 验证
  const validated = validateConfigObject(withEnvVars);  // 失败则抛出
  
  // 7. 转为运行时配置
  const config = materializeRuntimeConfig(validated);
  
  // 8. 缓存到内存
  setRuntimeConfigSnapshot(config);
  
  return config;
}
```

---

#### 任务 4：精读 `src/config/env-substitution.ts` (1h)

**阅读范围**：`src/config/env-substitution.ts` 全文

**关键实现**：

```typescript
// 环境变量替换的核心逻辑（简化）
const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;  // 匹配 ${VAR_NAME}

function substituteEnvVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(ENV_VAR_PATTERN, (_, varName) => {
    const envValue = env[varName];
    if (envValue === undefined) {
      throw new MissingEnvVarError(`环境变量 ${varName} 未设置`);
    }
    return envValue;
  });
}
```

**Debug 实操**：验证环境变量替换：

```bash
# 临时设置环境变量后运行
ANTHROPIC_API_KEY="test-key-123" node openclaw.mjs config echo 2>&1
```

---

#### 任务 5：浏览 `src/config/types.openclaw.ts` (1h)

**阅读范围**：`src/config/types.openclaw.ts` 前 100 行

**重点理解**：`OpenClawConfig` 的顶层结构：

```typescript
// src/config/types.openclaw.ts（示意）
export type OpenClawConfig = {
  gateway: GatewayConfig;           // Gateway 服务器配置
  providers: ProvidersConfig;       // AI 提供商配置
  agents: AgentsConfig;             // AI Agent 配置
  plugins: PluginsConfig;           // 插件配置
  channels?: Record<string, ...>;  // Channel 配置（可选）
  hooks?: HookConfig[];             // HTTP Hooks
  cron?: CronConfig;                // 定时任务
  mcp?: McpConfig;                  // MCP 配置
  tts?: TtsConfig;                  // TTS 配置
};
```

---

#### 任务 6：阅读 `src/config/validation.ts` + 理解 Zod (1h)

**阅读范围**：`src/config/validation.ts` 全文

**Zod 基础**（对不熟悉 Zod 的开发者）：

```typescript
import { z } from "zod";

// 定义 Schema
const UserSchema = z.object({
  name: z.string(),
  age: z.number().min(0).max(150),
  email: z.string().email().optional(),
});

// 验证
const result = UserSchema.safeParse({ name: "Alice", age: 30 });
if (result.success) {
  console.log(result.data);  // 类型安全的 { name: string, age: number }
} else {
  console.log(result.error.issues);  // 验证错误列表
}
```

**在 OpenClaw 中的使用**：

```typescript
// src/config/validation.ts（简化）
function validateConfigObject(obj: unknown): SourceConfig {
  const result = OpenClawSourceConfigSchema.safeParse(obj);
  if (!result.success) {
    throw new InvalidConfigError(
      formatZodError(result.error)
    );
  }
  return result.data;
}
```

---

### 知识检验

1. 配置文件默认路径是什么？（答：`~/.openclaw/openclaw.json`）
2. 如何用环境变量覆盖 Gateway 端口？（答：`OPENCLAW_GATEWAY_PORT=19000 openclaw start`）
3. `loadConfig()` 是同步还是异步的？（答：主要是同步）
4. `${ANTHROPIC_API_KEY}` 在配置文件中何时被替换？（答：`loadConfig()` 内部的 `resolveConfigEnvVars` 步骤）

---

## Day 6 — 巩固与实践（4h）

### 学习目标

- 复习 Day 1-5 所有知识点
- 整理对项目整体架构的理解
- 完成一个小的代码实践任务

---

### 复习框架

用下面的填空题检验自己的理解：

```
用户执行 openclaw start 时：

1. ________（文件名）检查 Node.js 版本
2. 加载 __________________（文件路径）
3. isMainModule() 返回 ______，进入 CLI 模式
4. 调用 ________________（函数名），在 ______（文件）中定义
5. buildProgram() 返回 ______（Commander 对象）
6. 匹配 "start" 命令，懒加载 ________________
7. loadConfig() 从 ________________ 读取配置
8. startGatewayServer(______) 启动服务器
```

**答案**：
1. `openclaw.mjs`
2. `dist/entry.js`（即 `src/entry.ts`）
3. `true`
4. `runCli()`，在 `src/cli/run-main.ts`
5. `Command`
6. `src/cli/gateway-cli.ts`
7. `~/.openclaw/openclaw.json`
8. `18789`（默认端口）

---

### 代码实践：添加 `config echo` 命令

**任务**：给 `openclaw config` 添加一个 `echo` 子命令，完整打印当前配置的 Gateway 部分。

**实现步骤**：

1. 在 `src/cli/program.ts` 找到 `config` 命令注册位置
2. 添加 `echo` 子命令
3. 实现功能：加载配置 → 打印 `config.gateway`

**参考实现**：

```typescript
// src/cli/program.ts 中的 config 命令部分添加：
configCmd
  .command("echo")
  .description("Print current gateway configuration")
  .action(async () => {
    try {
      // 懒加载避免影响其他命令启动速度
      const { loadConfig } = await import("../config/io.js");
      const { resolveGatewayPort } = await import("../config/paths.js");
      const config = await loadConfig();
      console.log("Gateway configuration:");
      console.log("  Port:", resolveGatewayPort(config));
      console.log("  Bind:", config.gateway?.bind ?? "(default)");
    } catch (e) {
      console.error("Failed to load config:", e);
      process.exit(1);
    }
  });
```

**测试**：
```bash
pnpm build && node openclaw.mjs config echo
```

---

## Day 7 — 巩固（4h）

### 学习目标

- 尝试完整跑通一次 `openclaw start`（哪怕启动失败，观察启动过程）
- 阅读更多配置类型定义
- 为第二周做准备

---

### 详细任务清单

#### 任务 1：运行 `openclaw start` 观察启动过程 (1h)

```bash
# 直接运行，观察输出（可能会因为没有配置而报错，这没关系）
node openclaw.mjs start 2>&1 | head -20
```

**分析输出中的关键信息**：
- 哪一行表明进入了 Gateway 启动流程？
- 报错信息是什么？（可能是找不到配置文件，或者配置格式错误）

---

#### 任务 2：创建最小可用配置文件 (1h)

```bash
# 创建配置目录
mkdir -p ~/.openclaw

# 创建最小配置文件
cat > ~/.openclaw/openclaw.json << 'EOF'
{
  "gateway": {
    "port": 18789,
    "secret": "test-secret-change-me"
  },
  "providers": {
    "anthropic": {
      "enabled": false
    }
  },
  "plugins": {
    "allow": []
  }
}
EOF
```

然后再次运行：
```bash
node openclaw.mjs start 2>&1 | head -20
```

观察：是否能启动到监听端口的阶段？

---

#### 任务 3：阅读 `src/config/types.agents.ts` + `src/config/types.providers.ts` (1h)

理解 Agent 和 Provider 配置的完整类型定义。

---

#### 任务 4：回顾并整理笔记 (1h)

写出以下架构图（用文字或画图）：

```
用户请求 → openclaw.mjs → entry.ts → run-main.ts → program.ts
                                                        │
                                        ┌───────────────┼───────────────┐
                                        │               │               │
                                   gateway-cli     plugins-cli     daemon-cli
                                        │
                                   loadConfig()
                                        │
                               startGatewayServer()
```

---

### 第一周总结检验

完成以下所有问题，才算真正完成第一周：

1. **入口链**：`openclaw start` 依次经过哪 6 个文件？
2. **配置路径**：默认配置文件在哪？如何用环境变量覆盖？
3. **懒加载**：为什么 CLI 命令的实现代码放在 `await import()` 里？
4. **类型系统**：`OpenClawConfig` 在哪个文件定义？
5. **isMainModule**：这个检查是为了解决什么问题？
6. **Zod**：配置验证失败时会发生什么？
7. **路径优先级**：Gateway 端口的确定顺序是什么？

---

## 附录：第一周关键文件速查

```
openclaw.mjs                     # CLI 可执行入口（~60行）
src/entry.ts                     # TS 主入口（189行）
  L18-21  ENTRY_WRAPPER_PAIRS
  L38-42  isMainModule()
  L129    runMainOrRootHelp()
  L174-189 主逻辑

src/cli/run-main.ts              # CLI 分发（315行）
  L83     runCli(argv)
  L130    快速帮助路径
  L146    Crestodian 快速路径
  L193    buildProgram 和 parseAsync

src/cli/program.ts               # Commander 命令树
src/cli/gateway-cli.ts           # start 命令入口
src/config/paths.ts              # 路径约定（302行）
  L60     resolveStateDir()
  L106    resolveCanonicalConfigPath()
  L214    DEFAULT_GATEWAY_PORT = 18789
  L285    resolveGatewayPort()

src/config/io.ts                 # 配置读写（2392行）
  L1458   loadConfig()
  L1900   writeConfigFile()

src/config/types.openclaw.ts     # 配置类型定义
src/config/env-substitution.ts   # ${VAR} 替换机制
src/config/validation.ts         # Zod 验证
```
