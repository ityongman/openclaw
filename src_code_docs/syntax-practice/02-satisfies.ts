// ============================================================
// 练习：satisfies vs 类型注解 :
// 运行方式：npx ts-node src_code_docs/syntax-practice/02-satisfies.ts
// ============================================================

// 假设这是 OpenClaw 里的配置类型
type GatewayConfig = {
  port: number;
  host: string;
  mode: "development" | "production" | "test";
  timeout?: number;
};


// --- 场景 1：类型注解 : 会丢失字面量精度 ---
const configA: Partial<GatewayConfig> = {
  port: 3000,
  mode: "production",
};

// mode 类型变成了 "development" | "production" | "test"，精度丢失
// 下面的 if 无法做到类型收窄提示
if (configA.mode === "production") {
  // IDE 不会提示"这个分支一定成立"——因为类型太宽了
  console.log("configA model is production")
} else {
  console.log("configA unknow model type")
}


// --- 场景 2：satisfies 保留字面量类型 ---
const configB = {
  port: 3000,
  mode: "production",
} satisfies Partial<GatewayConfig>;

// configB.mode 类型是 "production"（字面量），不是联合类型
// TypeScript 知道这个值一定是 "production"
const mode = configB.mode;  // 类型："production"
console.log("mode 类型保留为字面量:", mode);


// --- 场景 3：satisfies 能捕获拼写错误 ---
// 取消下面注释，会看到编译错误：
// const configC = {
//   prot: 3000,   // ← 报错：GatewayConfig 里没有 prot
// } satisfies Partial<GatewayConfig>;


// --- 场景 4：satisfies 在 OpenClaw 风格的插件注册表中 ---
type ChannelPlugin = {
  name: string;
  version: string;
  enabled: boolean;
};

const plugins = {
  slack: { name: "Slack", version: "1.0.0", enabled: true },
  discord: { name: "Discord", version: "2.1.0", enabled: false },
} satisfies Record<string, ChannelPlugin>;

// 保留了具体 key 的类型，可以精确访问
console.log("slack 插件:", plugins.slack.name);   // "Slack"
// plugins.unknown  ← 报错：key 不存在

// 如果用 : Record<string, ChannelPlugin>，则 plugins.slack 类型是 ChannelPlugin
// 用 satisfies，plugins.slack 类型是 { name: string; version: string; enabled: boolean }
// 两者等价，但前者索引签名更宽松


// --- 场景 5：结合 as const + satisfies（最严格） ---
const DEFAULTS = {
  port: 3000,
  host: "localhost",
  mode: "development",
} as const satisfies Partial<GatewayConfig>;

// DEFAULTS.port 类型是 3000（数字字面量），不是 number
// DEFAULTS.mode 类型是 "development"，不是联合类型
// 同时满足 GatewayConfig 结构校验
console.log("默认端口:", DEFAULTS.port);  // 3000


// --- 动手练习 ---
// TODO 1: 定义一个 ModelConfig 类型，包含 name(string)、temperature(number)、
//         maxTokens(number)。用 satisfies 创建一个 gpt4Config 对象，
//         然后验证 gpt4Config.name 的类型是字面量还是 string。
type ModelConfig = {
  name: string,
  temperature: number,
  maxTokens: number,
}

const gpt4Config = {
  name: "gpt-5.6",
  temperature: 0.9,
  maxTokens: 5000,
} satisfies Partial<ModelConfig>;

// const gpt4Config = {
//   name: "gpt-5.6",
//   temperature: 0.9,
//   maxTokens: 5000,
// } as const satisfies Partial<ModelConfig>;
console.log("默认配置model名字： ", gpt4Config.name)

// TODO 2: 把场景 4 改用 : Record<string, ChannelPlugin> 注解，
//         观察 plugins.slack 的类型有何变化。
const plugins02: Record<string, ChannelPlugin> = {
  slack: { name: "Slack", version: "1.0.0", enabled: true },
  discord: { name: "Discord", version: "2.1.0", enabled: false },
} 
console.log("slack 插件:", plugins02.slack2.name);  // 编译不报错, 但是运行时存在问题
// console.log("slack 插件:", plugins.slack2.name);  // 编译时直接报错
