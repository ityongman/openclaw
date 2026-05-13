# 入口链与 CLI 命令注册

---

## 1. 完整启动链

```
用户执行 openclaw <command>
    │
    ▼
openclaw.mjs                      （Node.js 可执行脚本）
    ├── 检查 Node.js 版本 >= 22.12
    ├── 开启 V8 编译缓存
    ├── --help 快速路径（不加载完整程序）
    └── import("dist/entry.js")
            │
            ▼
        src/entry.ts              （TypeScript 主入口）
            ├── 设置进程标题 "openclaw"
            ├── 安装警告过滤器
            ├── 标准化环境变量
            ├── 处理 --container / --profile 参数
            ├── 裸调用（无参数）→ 启动 Crestodian TUI
            └── runCli(argv)
                    │
                    ▼
                src/cli/run-main.ts      （CLI 分发核心）
                    ├── 加载 .env 文件
                    ├── 初始化代理捕获
                    ├── 快速路径：--help → 输出预计算帮助文本
                    ├── 快速路径：裸调用 → runCrestodian()
                    ├── tryRouteCli()  → 处理别名/快捷路由
                    └── buildProgram() → Commander 命令树解析
                            │
                            ▼
                        src/cli/program.ts   （Commander 程序构建）
                            ├── 注册内置命令（gateway, daemon, plugins...）
                            ├── 注册插件命令（懒加载）
                            └── program.parseAsync(argv)
                                    │
                                    ▼
                                对应命令的 action 处理器
```

---

## 2. 源码级详解

### 2.1 `openclaw.mjs` — 最外层包装

**职责**：轻量的 Node.js 脚本，尽量少做事，快速把控制权交给 `dist/entry.js`。

#### 版本检查（第 9-40 行）

```javascript
// 常量定义
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 12;

// 解析版本字符串 "22.18.0" → { major: 22, minor: 18 }
const parseNodeVersion = (rawVersion) => {
  const [majorRaw = "0", minorRaw = "0"] = rawVersion.split(".");
  return { major: Number(majorRaw), minor: Number(minorRaw) };
};

// 判断逻辑：major > 22，或者 major == 22 且 minor >= 12
// 这样写是为了支持未来的 Node.js 23、24 等版本
const isSupportedNodeVersion = (version) =>
  version.major > MIN_NODE_MAJOR ||
  (version.major === MIN_NODE_MAJOR && version.minor >= MIN_NODE_MINOR);
```

`process.versions.node` 是 Node.js 内置全局对象，始终可用，不需要 import。
版本不满足时用 `process.stderr.write()` 而非 `console.error()`，原因：此时还没安装日志过滤器，`stderr.write` 更底层、更可靠。

#### V8 编译缓存（第 42-49 行）

```javascript
if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {
    // Ignore errors — 某些环境不支持，静默降级
  }
}
```

`module.enableCompileCache()` 是 Node.js 22.1+ 新增 API，把 JS 文件的 V8 字节码缓存到磁盘，避免每次启动都重新 JIT 编译，冷启动加速约 30%~50%。`try/catch` 是因为这个 API 在某些受限环境中会抛异常。

#### 精确的模块未找到错误检测（第 51-70 行）

```javascript
const isDirectModuleNotFoundError = (err, specifier) => {
  if (!isModuleNotFoundError(err)) return false;

  // 检查错误的 url 字段是否就是我们要 import 的文件本身
  const expectedUrl = new URL(specifier, import.meta.url);
  if ("url" in err && err.url === expectedUrl.href) return true;

  // 备用：检查错误消息是否包含文件路径
  const expectedPath = fileURLToPath(expectedUrl);
  return message.includes(`Cannot find module '${expectedPath}'`) || ...;
};
```

这个函数区分了两类错误：
- **直接未找到**：`dist/entry.js` 本身不存在 → 说明未构建，给出友好提示
- **传递性未找到**：`dist/entry.js` 存在，但它的某个依赖不存在 → 是真正的 bug，应该向上抛出

如果不做这个区分，未构建时的错误信息会是看不懂的内部错误，而不是"请先运行 pnpm build"。

#### 帮助快速路径（第 129-185 行）

```javascript
const isBareRootHelpInvocation = (argv) =>
  argv.length === 3 && (argv[2] === "--help" || argv[2] === "-h");
// argv = ["node", "openclaw.mjs", "--help"] 时长度正好是 3

const tryOutputBareRootHelp = async () => {
  if (!isBareRootHelpInvocation(process.argv)) return false;

  // 第一优先：读取构建时预计算的帮助文本（最快，零 import）
  const precomputed = loadPrecomputedHelpText("rootHelpText");
  if (precomputed) {
    process.stdout.write(precomputed);
    return true;
  }

  // 第二优先：加载 dist/cli/program/root-help.js（比加载完整程序快得多）
  for (const specifier of ["./dist/cli/program/root-help.js", "./dist/cli/program/root-help.mjs"]) {
    try {
      const mod = await import(specifier);
      if (typeof mod.outputRootHelp === "function") {
        mod.outputRootHelp();
        return true;
      }
    } catch (err) { ... }
  }
  return false;
};
```

三层降级策略：预计算 JSON → 轻量帮助模块 → 完整程序。
`loadPrecomputedHelpText` 读取的是构建时生成的 `dist/cli-startup-metadata.json`，帮助文本已经序列化为字符串，输出时完全不需要 import 任何模块。

#### 主流程（第 187-200 行）

```javascript
// 两个帮助快速路径优先判断
if (!isHelpFastPathDisabled() && (await tryOutputBareRootHelp())) {
  // OK — 输出帮助，结束
} else if (!isHelpFastPathDisabled() && tryOutputBrowserHelp()) {
  // OK — 输出 browser 子命令帮助，结束
} else {
  await installProcessWarningFilter();       // 过滤 Node.js 噪音警告
  if (await tryImport("./dist/entry.js")) {  // 优先加载 .js
    // OK
  } else if (await tryImport("./dist/entry.mjs")) {  // 兼容旧构建产物
    // OK
  } else {
    // 两个都没找到 → 构建产物缺失
    throw new Error(await buildMissingEntryErrorMessage());
  }
}
```

`installProcessWarningFilter` 只在真正需要加载程序时才安装，避免影响帮助路径的输出。

---

### 2.2 `src/entry.ts` — TypeScript 入口

#### isMainModule 守卫（第 38-44 行）

```typescript
if (
  !isMainModule({
    currentFile: fileURLToPath(import.meta.url),
    wrapperEntryPairs: [...ENTRY_WRAPPER_PAIRS],
  })
) {
  // 被作为依赖 import 时 — 跳过所有副作用
} else {
  // 作为主模块运行时 — 执行 CLI 启动逻辑
}
```

**为什么需要这个守卫？** 打包器（tsdown）可能把 `dist/entry.js` 作为公共依赖打包进 `dist/index.js`，当 `dist/index.js` 被 import 时，`dist/entry.js` 会被再次执行。没有这个守卫，会启动两个 Gateway，第二个因端口冲突而崩溃。

`ENTRY_WRAPPER_PAIRS` 定义了什么文件算"我的包装器"：
```typescript
const ENTRY_WRAPPER_PAIRS = [
  { wrapperBasename: "openclaw.mjs", entryBasename: "entry.js" },
  { wrapperBasename: "openclaw.js",  entryBasename: "entry.js" },
] as const;
```

#### 主模块初始化序列（第 46-65 行）

```typescript
process.title = "openclaw";
// 进程名变成 "openclaw"，在 ps aux / 任务管理器中显示该名字，方便识别

ensureOpenClawExecMarkerOnProcess();
// 向 process.env 写入 OPENCLAW_EXEC=1
// 子进程通过检查这个环境变量判断自己是否由 openclaw 启动

installProcessWarningFilter();
// TypeScript 侧的警告过滤器，比 .mjs 中的更完整
// 过滤如 "ExperimentalWarning: VM Modules is an experimental feature" 等噪音

normalizeEnv();
// 标准化环境变量，例如把 Z_AI_API_KEY 统一为 ZAI_API_KEY

enableCompileCache();
// 再次尝试启用 V8 缓存（.mjs 中已尝试过，这里是双保险）
// 因为 entry.ts 在 .mjs import 之后执行，path 可能不同

if (shouldForceReadOnlyAuthStore(process.argv)) {
  process.env.OPENCLAW_AUTH_STORE_READONLY = "1";
  // secrets audit 命令需要只读模式，防止审计过程中意外修改凭据
}

if (process.argv.includes("--no-color")) {
  process.env.NO_COLOR = "1";
  process.env.FORCE_COLOR = "0";
  // 把 CLI 参数转化为环境变量，后续所有子模块通过环境变量判断颜色
}
```

#### respawn 机制（第 67-98 行）

```typescript
function ensureCliRespawnReady(): boolean {
  const plan = buildCliRespawnPlan();
  if (!plan) return false;
  // plan 不为 null 说明需要用新版本的进程替换当前进程

  const child = spawn(plan.command, plan.argv, {
    stdio: "inherit",  // 子进程直接继承父进程的 stdin/stdout/stderr
    env: plan.env,
  });

  attachChildProcessBridge(child);
  // 建立信号桥：父进程收到 SIGINT/SIGTERM 时转发给子进程

  child.once("exit", (code, signal) => {
    if (signal) {
      process.exitCode = 1;  // 被信号杀死，设置错误退出码
      return;
    }
    process.exit(code ?? 1);  // 子进程退出时，父进程也退出，退出码透传
  });

  return true;  // 返回 true 告知调用方：父进程不该继续执行 CLI
}
```

`buildCliRespawnPlan` 检测到 `.mjs` 包装器已更新（版本升级场景）时返回 respawn 计划。这个设计类似 Unix 的 `exec()` 系统调用——用新进程完全替换自身。

#### 参数解析与条件分支（第 100-131 行）

```typescript
process.argv = normalizeWindowsArgv(process.argv);
// Windows 上路径包含反斜杠，normalize 成正斜杠，避免后续处理出错

if (!ensureCliRespawnReady()) {
  // 只有不需要 respawn 时才继续执行

  const parsedContainer = parseCliContainerArgs(process.argv);
  if (!parsedContainer.ok) {
    console.error(`[openclaw] ${parsedContainer.error}`);
    process.exit(2);  // 退出码 2 表示参数错误（区别于运行时错误的 1）
  }

  const parsed = parseCliProfileArgs(parsedContainer.argv);
  // profile 决定使用哪套配置（如 dev/prod），从 --profile 或 --dev 读取

  if (containerTargetName && parsed.profile) {
    console.error("[openclaw] --container cannot be combined with --profile/--dev");
    process.exit(2);
    // 两个参数语义冲突：容器模式已经隔离了环境，再指定 profile 没有意义
  }

  if (parsed.profile) {
    applyCliProfileEnv({ profile: parsed.profile });
    process.argv = parsed.argv;  // 从 argv 中移除 --profile 参数，避免 Commander 报错
  }

  if (!tryHandleRootVersionFastPath(process.argv)) {
    // tryHandleRootVersionFastPath 处理 `openclaw --version`，输出后返回 true
    // 不是 --version 时，进入主执行函数
    await runMainOrRootHelp(process.argv);
  }
}
```

#### runMainOrRootHelp（第 174-188 行）

```typescript
async function runMainOrRootHelp(argv: string[]): Promise<void> {
  if (await tryHandleRootHelpFastPath(argv)) {
    return;  // --help 快速路径在 entry.ts 层面再次检查
  }
  try {
    // 懒加载：到此才真正加载 CLI 核心模块
    // 在此之前，内存中只有版本检查、警告过滤、env 初始化这些轻量代码
    const { runCli } = await import("./cli/run-main.js");
    await runCli(argv);
  } catch (error) {
    console.error("[openclaw] Failed to start CLI:", ...);
    process.exitCode = 1;
  }
}
```

---

### 2.3 `src/cli/run-main.ts` — CLI 分发核心

#### runCli 前置处理（第 83-127 行）

```typescript
export async function runCli(argv: string[] = process.argv) {
  const originalArgv = normalizeWindowsArgv(argv);
  // entry.ts 已经 normalize 过一次，这里再做一次
  // 原因：runCli 是公开 export 的函数，可能被其他调用方直接调用

  const parsedContainer = parseCliContainerArgs(originalArgv);
  // 解析 --container <name>，用于在 Docker 容器内运行 openclaw 命令

  const parsedProfile = parseCliProfileArgs(parsedContainer.argv);
  // 解析 --profile <name> / --dev，决定用哪套状态目录和配置

  const containerTarget = maybeRunCliInContainer(originalArgv);
  if (containerTarget.handled) {
    // 如果检测到 --container 且容器存在：通过 docker exec 把命令转发进容器执行
    // 然后直接返回，不在宿主机执行任何命令
    if (containerTarget.exitCode !== 0) process.exitCode = containerTarget.exitCode;
    return;
  }

  if (shouldLoadCliDotEnv()) {
    const { loadCliDotEnv } = await import("./dotenv.js");
    loadCliDotEnv({ quiet: true });
    // 懒加载 dotenv 模块：先检查文件是否存在，存在才 import
    // 查找顺序：CWD/.env → ~/.openclaw/.env
  }
  normalizeEnv();
  // .env 加载后再次 normalize，因为 .env 里可能有需要规范化的环境变量

  initializeDebugProxyCapture("cli");
  process.once("exit", () => { finalizeDebugProxyCapture(); });
  // 代理捕获用于调试：记录进程期间所有的 HTTP/HTTPS 请求
  // process.once("exit") 注册退出时的清理钩子，无论正常退出还是异常退出都执行

  ensureGlobalUndiciEnvProxyDispatcher();
  // 让 Node.js 内置 fetch（基于 undici）能识别 HTTP_PROXY/HTTPS_PROXY 环境变量
  // 默认情况下 undici 不读取这些环境变量，需要手动设置 dispatcher

  assertSupportedRuntime();
  // 比 .mjs 中的版本检查更严格，检查完整的运行时环境需求
```

#### 快速路径判断（第 129-191 行）

```typescript
  if (shouldUseRootHelpFastPath(normalizedArgv)) {
    const { outputPrecomputedRootHelpText } = await import("./root-help-metadata.js");
    if (!outputPrecomputedRootHelpText()) {
      // 预计算文本不存在（开发环境可能没有构建 metadata）时降级到动态生成
      const { outputRootHelp } = await import("./program/root-help.js");
      await outputRootHelp();
    }
    return;
  }

  if (shouldStartCrestodianForBareRoot(normalizedArgv)) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      // 裸调用时如果不是 TTY（如被管道或脚本调用），TUI 无法渲染
      // 给出明确错误提示，而不是显示乱码
      console.error('Crestodian needs an interactive TTY...');
      process.exitCode = 1;
      return;
    }
    const { runCrestodian } = await import("../crestodian/crestodian.js");
    const progress = createCliProgress({ label: "Starting Crestodian…", ... });
    // 启动进度指示器，避免 TUI 加载时用户看到空白屏幕
    try {
      await runCrestodian({ onReady: stopProgress });
      // onReady 回调：Crestodian 渲染好首屏后停止进度指示器
    } finally {
      stopProgress();  // 无论正常还是异常退出，都停止进度指示器
    }
    return;
  }

  if (await tryRouteCli(normalizedArgv)) {
    return;
    // 别名路由：如 `openclaw discord` 被路由到 channels 相关命令
    // 命中别名直接处理，不需要加载完整的 Commander 程序
  }
```

#### 完整 CLI 启动（第 193-309 行）

```typescript
  // 显示 "Loading OpenClaw CLI…" 进度指示器
  // 加载完整 Commander 程序可能需要数百毫秒，进度指示器避免用户以为程序卡死
  const startupProgress = createCliProgress({
    label: "Loading OpenClaw CLI…",
    indeterminate: true,
    delayMs: 0,       // 立即显示，不设延迟
    fallback: "none", // 非 TTY 环境不显示
  });

  enableConsoleCapture();
  // 把 console.log/error 的输出捕获到结构化日志系统
  // 对外行为不变（仍然打印到 stdout/stderr），但同时写入日志文件

  // 并行加载 4 个模块，比串行加载快很多
  const [
    { buildProgram },
    { runFatalErrorHooks },
    { installUnhandledRejectionHandler, isUncaughtExceptionHandled },
    { restoreTerminalState },
  ] = await Promise.all([
    import("./program.js"),                     // Commander 程序构建
    import("../infra/fatal-error-hooks.js"),    // 致命错误钩子
    import("../infra/unhandled-rejections.js"), // Promise 未捕获异常处理
    import("../terminal/restore.js"),           // 终端状态恢复
  ]);

  const program = buildProgram();
  // 构建 Commander 命令树，注册所有内置命令

  installUnhandledRejectionHandler();
  process.on("uncaughtException", (error) => {
    if (isUncaughtExceptionHandled(error)) return;
    console.error("[openclaw] Uncaught exception:", formatUncaughtError(error));
    for (const message of runFatalErrorHooks({ reason: "uncaught_exception", error })) {
      console.error("[openclaw]", message);
    }
    restoreTerminalState("uncaught exception", { resumeStdinIfPaused: false });
    // 崩溃前先恢复终端状态：如果程序在 raw mode 下崩溃，终端会变成不可用
    process.exit(1);
  });

  // 优化：如果命令行指向已知内置命令，跳过插件命令注册
  // 例如 `openclaw start` 不需要加载所有已安装插件的命令定义
  const shouldSkipPluginRegistration = shouldSkipPluginCommandRegistration({
    argv: parseArgv, primary, hasBuiltinPrimary,
  });
  if (!shouldSkipPluginRegistration) {
    const { registerPluginCliCommandsFromValidatedConfig } = await import("../plugins/cli.js");
    await registerPluginCliCommandsFromValidatedConfig(program, undefined, undefined, {
      mode: "lazy",  // 懒加载：只注册命令元数据，执行时才加载命令实现代码
      primary,
    });
  }

  stopStartupProgress();  // 进度指示器在 parseAsync 前停止，避免与命令输出交错

  try {
    await program.parseAsync(parseArgv);
    // Commander 解析 argv，找到匹配的命令，执行对应的 action 函数
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    process.exitCode = error.exitCode;
    // Commander 的 --help 和 --version 通过抛出 CommanderError 实现正常退出
    // 捕获后设置 exitCode 而不是 throw，避免打印不必要的错误信息
  }
```

---

## 3. Commander 命令树

OpenClaw 使用 [Commander.js](https://github.com/tj/commander.js) 管理 CLI 命令，这是 Node.js 生态最流行的 CLI 框架。

**对 Java 程序员**：类似 Picocli / Spring Shell
**对 Python 程序员**：类似 Click / Typer / argparse

> ⚠️ **本节是重写版**。早期文档说命令在 `src/cli/program.ts` 里直接 `.command("start")...` 注册——已不再属实。仓库重构成"**descriptor 目录 + 懒加载注册器**"两阶段模式，下面是当前真实结构。

### 3.1 文件分工

| 文件 | 角色 | 内容 |
|---|---|---|
| [src/cli/program.ts](../src/cli/program.ts) | re-export barrel | 只 2 行，对外导出 `buildProgram` 和 `forceFreePort` |
| [src/cli/program/build-program.ts](../src/cli/program/build-program.ts) | `buildProgram()` 工厂 | new Command + 装 hooks + 调 `registerProgramCommands` |
| [src/cli/program/command-registry.ts](../src/cli/program/command-registry.ts) | 注册编排 | 分两阶段：先 core，后 subcli |
| [src/cli/program/core-command-descriptors.ts](../src/cli/program/core-command-descriptors.ts) | **核心命令清单**（声明式 catalog） | 19 个 core 命令的 `{name, description, hasSubcommands}` |
| [src/cli/program/subcli-descriptors.ts](../src/cli/program/subcli-descriptors.ts) | **子 CLI 命令清单** | 35 个 subcli 命令（gateway / daemon / plugins / channels...） |
| [src/cli/program/command-registry-core.ts](../src/cli/program/command-registry-core.ts) | core entrySpecs[] | 每个命令名 → 懒加载哪个模块 + 调哪个导出函数 |
| [src/cli/program/register.subclis-core.ts](../src/cli/program/register.subclis-core.ts) | subcli entrySpecs[] | 同上，但针对 subcli |
| `src/cli/program/register.<topic>.ts`（多个文件） | 实际 `.command(...)` 调用 | 比如 `register.maintenance.ts` 一次注册 doctor/dashboard/reset/uninstall |

### 3.2 完整命令清单（按 catalog 实际抓取）

> 所有命令名以 [core-command-descriptors.ts](../src/cli/program/core-command-descriptors.ts) 与 [subcli-descriptors.ts](../src/cli/program/subcli-descriptors.ts) 为权威。下表是写文档时（2026-05-07）的快照，源文件可能新增。

**核心命令**（19）—— 配置 / 安装 / 维护 / 状态 类

```
crestodian   ring-zero 设置与修复 TUI
setup        初始化本地配置和 agent 工作区
onboard      交互式引导（gateway + workspace + skills）
configure    交互式配置（凭据、channel、gateway、agent 默认值）
config       非交互式 config 操作（get/set/unset/file/validate） [子命令]
backup       本地状态备份归档                                  [子命令]
migrate      从其他 agent 系统导入状态                          [子命令]
doctor       Gateway / channel 健康检查 + 快速修复
dashboard    用当前 token 打开 Control UI
reset        重置本地 config/state（保留 CLI 安装）
uninstall    卸载 gateway 服务 + 本地数据（保留 CLI）
message      发送、读取、管理消息                              [子命令]
mcp          管理 MCP 配置和 channel bridge                    [子命令]
agent        通过 Gateway 跑一轮 agent
agents       管理隔离 agent（workspace、auth、routing）         [子命令]
status       展示 channel 健康度和最近 session 接收方
health       从运行中的 gateway 拉健康状态
sessions     列出已存对话 session                              [子命令]
tasks        查看持久化后台任务状态                            [子命令]
```

**子 CLI 命令**（35）—— 服务 / 协议 / 工具 类

```
acp          Agent Control Protocol 工具                    [子命令]
gateway      运行/检查/查询 WebSocket Gateway              [子命令]  ← `gateway start` 在这里
daemon       gateway 服务（gateway 的 legacy 别名）        [子命令]
logs         通过 RPC tail gateway 日志
system       系统事件、心跳、presence                       [子命令]
models       发现/扫描/配置模型                             [子命令]
infer        provider-backed 推理命令                       [子命令]
capability   provider-backed 推理命令（infer 的别名）       [子命令]
approvals    管理 exec approvals（gateway 或 node host）    [子命令]
exec-policy  显示/同步 exec policy                          [子命令]
nodes        管理 gateway 拥有的 node 配对                  [子命令]
devices      设备配对 + token 管理                          [子命令]
node         运行/管理无头 node host 服务                   [子命令]
sandbox      管理 agent 隔离 sandbox 容器                   [子命令]
tui          连接到 Gateway 的终端 UI
terminal     本地终端 UI（tui --local 别名）
chat         本地终端 UI（tui --local 别名）
cron         通过 Gateway 调度器管理 cron job               [子命令]
dns          Tailscale + CoreDNS 的 DNS 辅助                [子命令]
docs         搜索 OpenClaw 文档
qa           QA 场景与私有 QA 调试 UI（默认隐藏）           [子命令]
proxy        OpenClaw debug proxy                           [子命令]
hooks        管理内部 agent hooks                           [子命令]
webhooks     webhook 助手与集成                             [子命令]
qr           生成移动端配对 QR/setup code
clawbot      legacy clawbot 命令别名                        [子命令]
pairing      安全 DM 配对                                   [子命令]
plugins      管理 OpenClaw 插件                             [子命令]
channels     管理已连接的聊天 channel                       [子命令]
directory    联系人/群组 ID 查询                            [子命令]
security     安全工具 + 本地配置审计                        [子命令]
secrets      Secrets 运行时重载控制                         [子命令]
skills       列出/查看可用 skills                           [子命令]
update       更新 OpenClaw + 检查 channel 状态              [子命令]
completion   生成 shell 补全脚本
```

> 注意：**没有顶层 `start` 命令**。Gateway 启动是 `openclaw gateway start`（`gateway` 是 subcli，`start` 是它的子命令）。如果你想找"开机就跑 Gateway"，去看 [src/cli/gateway-cli.ts](../src/cli/gateway-cli.ts)。

### 3.3 命令注册机制（descriptor + 懒加载）

#### 第一层：`buildProgram()` 只搭骨架

```typescript
// src/cli/program/build-program.ts（完整内容，约 30 行）
export function buildProgram() {
  const program = new Command();
  program.enablePositionalOptions();
  program.exitOverride((err) => {
    process.exitCode = typeof err.exitCode === "number" ? err.exitCode : 1;
    throw err;
  });
  const ctx = createProgramContext();
  const argv = process.argv;

  setProgramContext(program, ctx);
  configureProgramHelp(program, ctx);
  registerPreActionHooks(program, ctx.programVersion);

  registerProgramCommands(program, ctx, argv);   // ← 命令注册全在这里
  return program;
}
```

它**不直接调 `.command(...)`**——把命令注册委托给 `registerProgramCommands`。

#### 第二层：核心 + 子 CLI 两阶段

```typescript
// src/cli/program/command-registry.ts
export function registerProgramCommands(program, ctx, argv) {
  registerCoreCliCommands(program, ctx, argv);    // 19 个 core
  registerSubCliCommands(program, argv);          // 35 个 subcli
}
```

#### 第三层：descriptor + lazy spec

每个命令在 `entrySpecs[]` 里被绑定到一个**懒加载模块**和它的**导出函数**：

```typescript
// 节选自 src/cli/program/command-registry-core.ts
const coreEntrySpecs = [
  ...withProgramOnlySpecs(defineImportedProgramCommandGroupSpecs([
    { commandNames: ["crestodian"],
      loadModule: () => import("./register.crestodian.js"),
      exportName: "registerCrestodianCommand" },
    { commandNames: ["onboard"],
      loadModule: () => import("./register.onboard.js"),
      exportName: "registerOnboardCommand" },
    { commandNames: ["doctor", "dashboard", "reset", "uninstall"],   // ← 一组共享 register
      loadModule: () => import("./register.maintenance.js"),
      exportName: "registerMaintenanceCommands" },
    // ...
  ])),
  // ...
];
```

`loadModule` 是个返回 `import()` 的函数——只有 commander 真的要解析到这些命令时才会执行。

#### 第四层：实际的 `.command(...)` 调用

在 `register.<topic>.ts` 文件里。例：

```typescript
// 节选自 src/cli/program/register.maintenance.ts
export function registerMaintenanceCommands(program: Command) {
  program
    .command("doctor")
    .description("Health checks + quick fixes for the gateway and channels")
    .option("--repair", "Apply recommended repairs without prompting", false)
    .option("--force", "Apply aggressive repairs ...", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await doctorCommand(defaultRuntime, { repair: Boolean(opts.repair), ... });
      });
    });

  program.command("dashboard").description("...").action(...);
  program.command("reset").description("...").action(...);
  program.command("uninstall").description("...").action(...);
}
```

注意：**真正的业务逻辑不在 `register.maintenance.ts`，而在 [src/commands/doctor.ts](../src/commands/doctor.ts) 等**——`register.<topic>.ts` 只负责把 commander 选项解析后转发给 `doctorCommand(...)`。

#### 第五层：插件命令注入（`registerPluginCliCommandsFromValidatedConfig`）

回看 `run-main.ts` 的：

```typescript
const { registerPluginCliCommandsFromValidatedConfig } = await import("../plugins/cli.js");
await registerPluginCliCommandsFromValidatedConfig(program, undefined, undefined, {
  mode: "lazy",
  primary,
});
```

这一步在 `buildProgram()` **返回之后**执行，把已安装插件（如 `extensions/discord` 的 `openclaw discord ...` 子命令）也注入到 commander 程序。`mode: "lazy"` 表示只注册命令元数据（名字、描述、选项），命令实现要等执行时再 import。

### 3.4 怎么找一个命令的代码

按这个顺序定位：

1. **先去 catalog 确认它存不存在 + 在哪一类**
   - 在 [core-command-descriptors.ts](../src/cli/program/core-command-descriptors.ts)？→ 是 core
   - 在 [subcli-descriptors.ts](../src/cli/program/subcli-descriptors.ts)？→ 是 subcli
   - 都没有？→ 大概率是插件命令，去 `extensions/<id>/` 找
2. **去对应的 entrySpecs 找它的 `loadModule`**
   - core：[command-registry-core.ts](../src/cli/program/command-registry-core.ts)
   - subcli：[register.subclis-core.ts](../src/cli/program/register.subclis-core.ts)
3. **打开 `register.<topic>.ts`**——找到 `program.command("<name>")...` 这一段
4. **在 `.action(...)` 里看它转发给哪个业务函数**——通常在 `src/commands/<name>.ts` 或 `src/<area>/`
5. （如果是 `gateway start` 这种 subcommand）—— 找到 `gateway` 的 register 文件，里面会构造一个嵌套的 Command 子树

---

## 4. 关键设计模式

### 4.1 懒加载（Lazy Import）

整个 CLI 层大量使用动态 `import()` 加速启动速度：

```typescript
// ❌ 传统方式：顶部静态导入，启动就加载所有模块
import { startGatewayServer } from "../gateway/server.js";

// ✅ OpenClaw 方式：按需加载，只有执行该命令时才加载
program.command("start").action(async () => {
  const { startGatewayServer } = await import("../gateway/server.js");
  await startGatewayServer(config);
});
```

**为什么？** `openclaw --help` 不需要加载 Gateway 的所有依赖，懒加载让帮助命令毫秒级响应。

### 4.2 多层降级的帮助快速路径

```
--help 请求
    │
    ├── 1. 读取 dist/cli-startup-metadata.json（零 import，最快）
    │         ↓ 不存在
    ├── 2. import dist/cli/program/root-help.js（轻量模块）
    │         ↓ 不存在
    └── 3. 完整程序 → buildProgram() → Commander 生成帮助
```

每层降级保证了即使某些构建产物缺失，帮助命令仍然能输出有用信息。

### 4.3 环境变量的多次规范化

注意到 `normalizeEnv()` 被调用了多次：

| 位置 | 时机 |
|------|------|
| `entry.ts:49` | import entry.js 后立刻规范化 |
| `run-main.ts:115` | 加载 .env 后再次规范化 |

这是刻意设计：第一次规范化基于系统环境变量，第二次规范化把 `.env` 文件里的新变量也纳入处理。

### 4.4 respawn（重新启动自身）

```typescript
// 检测到需要 respawn（如版本升级后 .mjs 包装器更新）
const child = spawn(plan.command, plan.argv, {
  stdio: "inherit",  // 子进程直接接管 stdin/stdout/stderr，对用户透明
  env: plan.env,
});
attachChildProcessBridge(child);  // 信号转发：Ctrl+C 能正确传递给子进程
child.once("exit", (code) => process.exit(code ?? 1));
// 子进程退出码完整透传，脚本调用者能感知到真实退出状态
```

### 4.5 TTY 检测保护 TUI

```typescript
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Crestodian needs an interactive TTY...');
  process.exitCode = 1;
  return;
}
```

被管道调用（如 `openclaw | grep something`）时 isTTY 为 false，TUI 无法正确渲染，必须在启动前拦截，给出有意义的错误信息。

---

## 5. 逐行启动链路（以 `openclaw start` 为例）

#### 第一层：`openclaw.mjs`

| 行号 | 代码 | 说明 |
|------|------|------|
| 9-11 | `MIN_NODE_MAJOR/MINOR` 定义 | 最低版本常量 |
| 21-23 | `isSupportedNodeVersion` | 支持未来 major > 22 的版本 |
| 40 | `ensureSupportedNodeVersion()` | 第一个执行点，版本不满足直接退出 |
| 43-49 | `module.enableCompileCache()` | V8 字节码缓存，加速约 30~50% |
| 129-130 | `isBareRootHelpInvocation` | 判断 `argv.length === 3 && argv[2] === "--help"` |
| 149-173 | `tryOutputBareRootHelp()` | 三层降级输出帮助文本 |
| 187-189 | `if (await tryOutputBareRootHelp())` | `openclaw start` 不命中，继续 |
| 192 | `installProcessWarningFilter()` | 过滤 ExperimentalWarning 等噪音 |
| 193 | `await tryImport("./dist/entry.js")` | 控制权转移至 `src/entry.ts` |

#### 第二层：`src/entry.ts`

| 行号 | 代码 | 说明 |
|------|------|------|
| 38-43 | `isMainModule({...})` | 防止作为依赖被 import 时重复启动 |
| 46 | `process.title = "openclaw"` | 进程名，ps/任务管理器中可见 |
| 47 | `ensureOpenClawExecMarkerOnProcess()` | 写入 `OPENCLAW_EXEC=1` |
| 48 | `installProcessWarningFilter()` | 更完整的警告过滤（TypeScript 侧） |
| 49 | `normalizeEnv()` | 第一次环境变量规范化 |
| 50-56 | `enableCompileCache()` | 双保险 V8 缓存 |
| 58-60 | `shouldForceReadOnlyAuthStore` | secrets audit 需要只读认证存储 |
| 67-98 | `ensureCliRespawnReady()` | 版本升级后 respawn 新进程 |
| 100 | `normalizeWindowsArgv(process.argv)` | Windows 路径反斜杠处理 |
| 102-131 | container + profile 解析 | 互斥检查，参数错误时 `exit(2)` |
| 128 | `tryHandleRootVersionFastPath` | 处理 `openclaw --version` |
| 129 | `await runMainOrRootHelp(process.argv)` | 进入第三层 |
| 179 | `await import("./cli/run-main.js")` | 此时才加载 CLI 核心模块 |

#### 第三层：`src/cli/run-main.ts` 的 `runCli()`

| 行号 | 代码 | 说明 |
|------|------|------|
| 84 | `normalizeWindowsArgv(argv)` | 公开函数需再次规范化（防御性编程） |
| 102-108 | `maybeRunCliInContainer` | 容器模式：转发给 docker exec 执行 |
| 111-114 | `loadCliDotEnv` | 懒加载 dotenv，加载 .env 文件 |
| 115 | `normalizeEnv()` | 第二次规范化，处理 .env 中的新变量 |
| 116-119 | `initializeDebugProxyCapture` | 初始化 HTTP 请求调试记录 |
| 120 | `ensureGlobalUndiciEnvProxyDispatcher()` | 让内置 fetch 识别代理环境变量 |
| 127 | `assertSupportedRuntime()` | 严格运行时断言 |
| 130-137 | `shouldUseRootHelpFastPath` | `openclaw start` 不命中，继续 |
| 146-175 | `shouldStartCrestodianForBareRoot` | 有参数，不命中 |
| 189-191 | `tryRouteCli` | `start` 不是别名，不命中 |
| 212-222 | `Promise.all([...])` | 并行加载 4 个基础设施模块 |
| 223 | `buildProgram()` | 构建 Commander 命令树 |
| 227 | `installUnhandledRejectionHandler()` | 全局 Promise 异常捕获 |
| 229-239 | `uncaughtException` handler | 崩溃前恢复终端状态 |
| 262-292 | 插件命令注册 | `start` 是内置命令，跳过插件注册 |
| 297 | `program.parseAsync(parseArgv)` | Commander 解析 "start"，触发 action |

---

## 6. 阅读建议

读完本文后，打开这些文件对照阅读：

1. [openclaw.mjs](../openclaw.mjs)：完整读一遍（200 行），关注错误处理的精细程度
2. [src/entry.ts](../src/entry.ts)：重点看 `isMainModule` 守卫和 `ensureCliRespawnReady`
3. [src/cli/run-main.ts](../src/cli/run-main.ts)：重点看 `runCli()` 函数中各快速路径的判断顺序
4. [src/cli/run-main-policy.ts](../src/cli/run-main-policy.ts)：了解各 `should*` 函数的判断逻辑

---

## 下一步

完成本文后，去读 [03-config-system.md](./03-config-system.md)。
