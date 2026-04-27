# TypeScript 速查手册（面向 Java/Python 程序员）

> 本文只覆盖 OpenClaw 源码中高频出现的 TypeScript 特性，不求系统全面，求快速上手。
> 类比语言以 **Java / Python** 为主，Go 作为补充。

---

## 1. 类型系统基础

### 1.1 基本类型对照表

| TypeScript | Java | Python | Go（参考） | 说明 |
|------------|------|--------|-----------|------|
| `string` | `String` | `str` | `string` | 字符串 |
| `number` | `int` / `double` | `int` / `float` | `int` / `float64` | 统一数字类型 |
| `boolean` | `boolean` | `bool` | `bool` | 布尔 |
| `null` | `null` | `None` | — | 空值 |
| `undefined` | — | — | — | 未定义（JS 特有，Python/Java 没有对应概念） |
| `any` | `Object` | `Any`（typing） | `interface{}` | 跳过类型检查 |
| `unknown` | `Object`（安全版） | `object`（安全版） | `interface{}`（安全版） | 使用前必须做类型断言 |
| `void` | `void` | `None`（返回类型） | — | 函数无返回值 |
| `never` | — | `NoReturn`（typing） | — | 永远不会有值（无限循环/必然抛异常） |

### 1.2 联合类型（Union）

```typescript
// 相当于 Java 的 Optional<T> 或 Python 的 Optional[T]（typing 模块）
type Result = string | null;
type Status = "running" | "stopped" | "error";  // 枚举字符串，类似 Python Enum / Java Enum

// 在 OpenClaw 里大量使用
type ChannelId = string | null;
```

### 1.3 接口与类型别名

```typescript
// interface — 可以被 extend，对象结构
interface GatewayConfig {
  port: number;
  host: string;
  secret?: string;  // ? 表示可选，等价于 Java 的 @Nullable 或 Python 的 Optional[str]
}

// type — 更灵活，可以是联合类型
type SessionKey = string;
type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
```

**对 Java 程序员**：`interface` 不是 Java 里的 interface（没有方法签名），它只描述对象的形状，更像 Java 的 POJO / Record。

**对 Python 程序员**：TypeScript `interface` 类似 Python 的 `TypedDict` 或 `dataclass`，描述字典/对象的结构。

> Go 参考：TypeScript `interface` 类似 Go struct，而非 Go interface。

---

## 2. 函数

### 2.1 函数声明方式

```typescript
// 普通函数（Java 的静态方法 / Python 的 def）
function loadConfig(path: string): Promise<Config> { ... }

// 箭头函数（Lambda）— 等价于 Java Lambda 或 Python lambda（但可以多行）
const loadConfig = async (path: string): Promise<Config> => { ... };

// 可选参数和默认值（等价于 Python def func(port=3000, host=None)）
function createServer(port: number = 3000, host?: string) { ... }
```

### 2.2 async/await（在 OpenClaw 中大量使用）

```typescript
// TypeScript 的 async/await 与 Python asyncio、Java CompletableFuture 概念相同
// Python: async def start_gateway(): config = await load_config()
// Java:   CompletableFuture.supplyAsync(() -> loadConfig()).thenAccept(...)
async function startGateway(): Promise<void> {
  const config = await loadConfig();  // 等待异步操作
  await server.start(config);
}

// 并行执行
// Python: asyncio.gather(load_config(), load_plugins())
// Java:   CompletableFuture.allOf(cfConfig, cfPlugins)
const [config, plugins] = await Promise.all([
  loadConfig(),
  loadPlugins(),
]);
```

### 2.3 返回类型模式

OpenClaw 大量使用这种模式（比 throw/catch 更安全）：

```typescript
// 成功/失败联合类型，在 OpenClaw 随处可见
type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function parse(raw: string): ParseResult<Config> {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

// 使用方：
const result = parse(raw);
if (!result.ok) {
  console.error(result.error);
  return;
}
console.log(result.value);  // 这里 TS 知道 value 一定存在
```

---

## 3. 模块系统（ESM）

OpenClaw 使用 ES Modules（`"type": "module"`），不是 CommonJS。

```typescript
// 导出
export function startServer() { ... }
export type { GatewayConfig };          // 只导出类型（编译后消失）
export default class GatewayServer { }  // 默认导出（OpenClaw 较少用）

// 导入
import { startServer } from "./server.js";  // 注意：.js 扩展名！（即使源文件是 .ts）
import type { GatewayConfig } from "./types.js";  // 只导入类型

// 动态导入（懒加载，OpenClaw 大量使用）
const { runCli } = await import("./cli/run-main.js");
```

**注意**：源码是 `.ts` 文件，但 import 路径写的是 `.js`。这是 TypeScript ESM 的规则。

---

## 4. 泛型

```typescript
// 类似 Java <T> 或 Python TypeVar / Generic[T]
function wrap<T>(value: T): { value: T } {
  return { value };
}

// 带约束（类似 Java <T extends Foo> 或 Python TypeVar('T', bound=Foo)）
function getPort<T extends { port: number }>(config: T): number {
  return config.port;
}

// OpenClaw 里常见的泛型用法
type PluginRuntime<TConfig = unknown> = {
  config: TConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
};
```

---

## 5. 类型断言与类型守卫

```typescript
// 类型断言（相当于 Java 强转 (int) x 或 Python cast()，慎用）
const port = value as number;

// 类型守卫（更安全，OpenClaw 常见）
function isString(value: unknown): value is string {
  return typeof value === "string";
}

// 使用
if (isString(value)) {
  console.log(value.toUpperCase());  // TS 知道这里 value 是 string
}

// in 运算符守卫
if ("error" in result) {
  // result 有 error 属性
}
```

---

## 6. 解构赋值

```typescript
// 对象解构（OpenClaw 到处在用）
const { port, host = "localhost" } = config;

// 数组解构
const [first, ...rest] = items;

// 函数参数解构
function start({ port, host }: { port: number; host: string }) { ... }

// 重命名
const { port: serverPort } = config;
```

---

## 7. 可选链与空值合并

```typescript
// ?. 可选链
// Java: Optional.ofNullable(config).map(c -> c.getGateway()).map(g -> g.getPort()).orElse(null)
// Python: config and config.get("gateway") and config["gateway"].get("port")
const port = config?.gateway?.port;  // 任何一层为 null/undefined 就返回 undefined

// ?? 空值合并（比 || 更精准，只处理 null/undefined）
// Python: port = config.port if config.port is not None else 3000
const port = config?.port ?? 3000;  // config.port 为 null/undefined 时用 3000

// 在 OpenClaw 里随处可见：
const secret = process.env.OPENCLAW_SECRET ?? config.secret ?? null;
```

---

## 8. Zod（运行时类型验证库）

OpenClaw 用 Zod 做配置验证，你会大量看到它：

```typescript
import { z } from "zod";

// 定义 schema
// 类似 Java 的 Bean Validation（@NotNull、@Min）或 Python 的 Pydantic BaseModel
const ConfigSchema = z.object({
  port: z.number().min(1).max(65535),
  host: z.string().default("localhost"),
  secret: z.string().optional(),
});

// 推断 TypeScript 类型（魔法：一次定义，类型自动生成）
type Config = z.infer<typeof ConfigSchema>;

// 验证
const result = ConfigSchema.safeParse(rawData);
if (!result.success) {
  console.error(result.error.format());
} else {
  const config = result.data;  // 类型是 Config
}
```

---

## 9. 装饰器与实验性特性

OpenClaw 没有大量使用装饰器，但你会看到：

```typescript
// satisfies — 检查对象满足类型但保留字面量类型
const config = {
  port: 3000,
} satisfies Partial<GatewayConfig>;
```

---

## 10. 常见错误模式对照

### "Property does not exist" 错误

```typescript
// 错误：TS 不知道 obj 有 port 属性
function getPort(obj: unknown) {
  return obj.port;  // Error!
}

// 正确：先做类型断言或守卫
function getPort(obj: Record<string, unknown>) {
  return obj["port"];
}
```

### async 函数忘记 await

```typescript
// 错误：返回 Promise 而不是值
const config = loadConfig();  // config 是 Promise<Config>，不是 Config

// 正确
const config = await loadConfig();
```

---

## 11. 快速理解 OpenClaw 源码的规律

1. **文件命名 `xxx.ts` vs `xxx.runtime.ts`**：runtime 后缀表示只在运行时加载（动态 import），避免循环依赖和启动时间过长。

2. **文件命名 `xxx.test.ts`**：测试文件，用 Vitest 运行，可以忽略（读逻辑时）。

3. **`export type { ... }`**：只导出类型，运行时不存在，不影响逻辑理解。

4. **`Promise.all([...])`**：并行等待多个异步操作，是 OpenClaw 启动优化的常见手段。

5. **`AbortSignal` / `AbortController`**：优雅停止的信号机制。
   - Java 类比：`Thread.interrupt()` / `Future.cancel()`
   - Python 类比：`asyncio.CancelledError` / `threading.Event`
   - 在 OpenClaw 里用于停止 Channel、中断 AI 流式输出等场景。

6. **`as const`**：冻结对象/数组的类型为字面量，常用于定义常量枚举。

---

## 下一步

完成本文后，去读 [01-project-structure.md](./01-project-structure.md)。
