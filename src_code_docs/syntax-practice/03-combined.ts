// ============================================================
// 综合练习：模拟 OpenClaw 配置加载流程
// 运行方式：npx ts-node src_code_docs/syntax-practice/03-combined.ts
// ============================================================

// 模拟 OpenClaw 的配置类型（简化版）
type OpenClawConfig = {
  port: number;
  host: string;
  secret: string;
  mode: "development" | "production";
  ai: {
    model: string;
    temperature: number;
    maxRetries: number;
  };
};

// 模拟从文件读取的原始配置（部分字段可能缺失）
type RawConfig = Partial<{
  port: number | null;
  host: string | null;
  secret: string | null;
  mode: string | null;
  ai: Partial<{
    model: string | null;
    temperature: number | null;
    maxRetries: number | null;
  }> | null;
}>;

// 默认值（用 satisfies 保留字面量精度）
const DEFAULTS = {
  port: 3000,
  host: "localhost",
  mode: "development",
  ai: {
    model: "gpt-4",
    temperature: 0.7,
    maxRetries: 3,
  },
} as const satisfies Partial<OpenClawConfig>;


// 配置解析函数：综合运用 ?? 和 satisfies
function resolveConfig(
  raw: RawConfig,
  envSecret?: string
): OpenClawConfig {
  return {
    // ?? 链：端口号0是有效值，必须用 ?? 不能用 ||
    port: raw.port ?? DEFAULTS.port,

    host: raw.host ?? DEFAULTS.host,

    // 三级优先级：环境变量 → 配置文件 → 报错
    secret: envSecret ?? raw.secret ?? (() => {
      throw new Error("secret 必须通过环境变量或配置文件提供");
    })(),

    // mode 需要验证合法性
    mode: (raw.mode === "production" ? "production" : DEFAULTS.mode),

    ai: {
      model: raw.ai?.model ?? DEFAULTS.ai.model,
      // temperature=0 是有效值（关闭随机性），必须用 ??
      temperature: raw.ai?.temperature ?? DEFAULTS.ai.temperature,
      // maxRetries=0 表示不重试，必须用 ??
      maxRetries: raw.ai?.maxRetries ?? DEFAULTS.ai.maxRetries,
    },
  };
}


// --- 运行示例 ---
console.log("=== 完整配置（所有字段都提供）===");
const full = resolveConfig(
  {
    port: 8080,
    host: "example.com",
    secret: "file-secret",
    mode: "production",
    ai: { model: "gpt-3.5-turbo", temperature: 0, maxRetries: 0 },
  },
  undefined
);
console.log(full);
// 注意：temperature=0 和 maxRetries=0 被正确保留


console.log("\n=== 最小配置（只提供 secret）===");
const minimal = resolveConfig({ secret: "my-secret" });
console.log(minimal);
// 其余字段全部使用默认值


console.log("\n=== 环境变量优先于配置文件 secret ===");
const withEnv = resolveConfig(
  { secret: "file-secret" },
  "env-secret"  // 环境变量
);
console.log("secret:", withEnv.secret);  // "env-secret"


console.log("\n=== 缺少 secret 会抛出错误 ===");
try {
  resolveConfig({});
} catch (e) {
  console.log("捕获到错误:", (e as Error).message);
}


// --- 动手练习 ---
// TODO: 在 RawConfig 里增加 timeout?: number | null 字段，
//       在 DEFAULTS 里设置默认值 5000，
//       在 resolveConfig 里用 ?? 合并，
//       验证 timeout=0 能被正确保留（不被默认值覆盖）。
