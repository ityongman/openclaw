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

## 2. 关键文件详解

### 2.1 `openclaw.mjs` — 最外层包装

**职责**：轻量的 Node.js 脚本，尽量少做事，快速把控制权交给 `dist/entry.js`。

关键逻辑：
```javascript
// 1. 检查版本
const MIN_NODE_MAJOR = 22;
ensureSupportedNodeVersion();

// 2. 快速帮助路径（避免加载完整程序）
if (isBareRootHelpInvocation(process.argv)) {
  // 直接输出预计算的帮助文本，不启动 Gateway
}

// 3. 加载真正的入口
await import("./dist/entry.js");
```

**为什么要这层包装？**
- 兼容性：确保 Node.js 版本满足要求才加载 ES 模块
- 性能：`--help` 请求直接返回预计算文本，不需要启动完整程序
- 编译缓存：启用 V8 编译缓存加速后续启动

### 2.2 `src/entry.ts` — TypeScript 入口

**职责**：
- 决定以什么身份运行：CLI 模式 vs 库模式（被 `import` 时）
- 处理 respawn（在某些场景下需要重新启动子进程）
- 处理 Windows 参数规范化

关键模式：
```typescript
// 判断是否作为主模块运行（而不是被 import）
if (!isMainModule({ currentFile: fileURLToPath(import.meta.url) })) {
  // 库模式：导出 API 供其他程序使用
} else {
  // CLI 模式：启动命令行界面
  await runCli(process.argv);
}
```

**对 Java 程序员**：等价于 `public static void main(String[] args)`，但 TypeScript 需要显式判断是否作为主模块运行。

**对 Python 程序员**：等价于 `if __name__ == "__main__":` 这个常见模式——同一个文件既可以被 import 用作库，也可以直接运行。

### 2.3 `src/cli/run-main.ts` — CLI 分发核心

这是 CLI 层最重要的文件，约 400 行，控制着所有命令的分发流程。

**主流程 `runCli()` 函数**：

```typescript
export async function runCli(argv: string[]) {
  // 1. 参数预处理
  const normalizedArgv = normalizeWindowsArgv(argv);

  // 2. 容器模式处理（--container 参数）
  const containerTarget = maybeRunCliInContainer(originalArgv);
  if (containerTarget.handled) return;

  // 3. 加载 .env 文件
  if (shouldLoadCliDotEnv()) {
    loadCliDotEnv({ quiet: true });
  }

  // 4. 快速路径：裸调用 → 启动 Crestodian（TUI 交互界面）
  if (shouldStartCrestodianForBareRoot(normalizedArgv)) {
    await runCrestodian({ onReady: stopProgress });
    return;
  }

  // 5. 尝试快速路由（别名等）
  if (await tryRouteCli(normalizedArgv)) return;

  // 6. 完整 CLI 启动
  const { buildProgram } = await import("./program.js");
  const program = buildProgram();

  // 7. 注册插件命令（懒加载）
  await registerPluginCliCommandsFromValidatedConfig(program, ...);

  // 8. 解析并执行命令
  await program.parseAsync(parseArgv);
}
```

**几个重要的判断函数**：

| 函数 | 判断条件 | 行为 |
|------|---------|------|
| `shouldStartCrestodianForBareRoot` | `openclaw`（无参数） | 启动 TUI 交互界面 |
| `shouldUseRootHelpFastPath` | `openclaw --help` | 输出预计算帮助 |
| `shouldSkipPluginCommandRegistration` | 内置命令优先 | 跳过插件命令注册 |

---

## 3. Commander 命令树

OpenClaw 使用 [Commander.js](https://github.com/tj/commander.js) 管理 CLI 命令，这是 Node.js 生态最流行的 CLI 框架。

**对 Java 程序员**：类似 Picocli / Spring Shell
**对 Python 程序员**：类似 Click / Typer / argparse
> Go 参考：类似 Cobra

### 3.1 主要命令列表

查看 `src/cli/program.ts`，主要顶层命令：

```
openclaw
├── start / gateway     → 启动 Gateway 服务器
├── daemon              → 守护进程管理（start/stop/restart/status）
├── plugins             → 插件管理（install/uninstall/list/update）
├── channels            → 渠道管理
├── config              → 配置管理
├── onboard             → 新用户引导
├── crestodian          → TUI 交互界面
├── models              → AI 模型管理
├── secrets             → 密钥管理
├── logs                → 日志查看
├── nodes               → 节点（移动设备）管理
├── skills              → 技能管理
├── mcp                 → MCP 工具管理
├── update              → 更新 OpenClaw
└── [plugin-commands]   → 插件注入的命令（如 discord、telegram 等）
```

### 3.2 命令注册机制

命令注册分两类：

**内置命令（静态注册）**：
```typescript
// src/cli/program.ts 中直接注册
program
  .command("start")
  .description("Start the OpenClaw gateway")
  .action(async () => {
    const { startGatewayFromCli } = await import("./gateway-cli.js");
    await startGatewayFromCli();
  });
```

**插件命令（动态注册）**：
```typescript
// 从已安装的插件配置中读取命令
await registerPluginCliCommandsFromValidatedConfig(program, undefined, undefined, {
  mode: "lazy",  // 懒加载：只在需要时才加载插件代码
  primary,       // 当前命令的主名称
});
```

---

## 4. 关键设计模式

### 4.1 懒加载（Lazy Import）

整个 CLI 层大量使用动态 `import()` 来加速启动速度：

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

### 4.2 respawn（重新启动自身）

某些场景下（如版本升级后），进程需要重新启动：

```typescript
// src/entry.ts
function ensureCliRespawnReady(): boolean {
  const plan = buildCliRespawnPlan();
  if (!plan) return false;

  // 启动新进程替代自己
  const child = spawn(plan.command, plan.argv, { stdio: "inherit" });
  // 把退出码转发给父进程
  child.once("exit", (code) => process.exit(code ?? 1));
  return true;
}
```

类比 Go 的 `syscall.Exec()`：用新进程替换当前进程。

### 4.3 Crestodian — 交互式 TUI

当用户直接运行 `openclaw`（不带参数），启动 Crestodian，这是一个基于 `@mariozechner/pi-tui` 的终端交互界面：

```typescript
// 裸调用 → TUI 模式
if (shouldStartCrestodianForBareRoot(argv)) {
  const { runCrestodian } = await import("../crestodian/crestodian.js");
  await runCrestodian({ onReady: stopProgress });
}
```

---

## 5. 实际执行流程举例

### 例 1：`openclaw start`

```
openclaw start
    │
    └── runCli(["node", "openclaw.mjs", "start"])
            │
            └── buildProgram() → Commander 解析 "start"
                    │
                    └── action() → import("./gateway-cli.js")
                            │
                            └── startGatewayFromCli()
                                    │
                                    └── loadConfig() → startGatewayServer(config)
```

### 例 2：`openclaw plugins install discord`

```
openclaw plugins install discord
    │
    └── runCli([..., "plugins", "install", "discord"])
            │
            └── Commander 解析 "plugins"
                    │
                    └── import("./plugins-cli.js")
                            │
                            └── 执行 install 子命令
                                    │
                                    └── 下载 discord 插件 → 更新配置
```

---

## 6. 阅读建议

读完本文后，打开这些文件对照阅读：

1. `src/entry.ts`：完整读一遍（约 190 行），重点看 `if (isMain)` 分支
2. `src/cli/run-main.ts`：重点看 `runCli()` 函数（第 184 行起）
3. `src/cli/route.ts`：了解快速路由机制
4. `src/cli/program.ts`：浏览命令注册（不用每个都看懂）

---

## 下一步

完成本文后，去读 [03-config-system.md](./03-config-system.md)。
