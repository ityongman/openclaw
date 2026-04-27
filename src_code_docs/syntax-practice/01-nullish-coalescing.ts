// ============================================================
// 练习：空值合并 ?? vs 逻辑或 ||
// 运行方式：npx ts-node src_code_docs/syntax-practice/01-nullish-coalescing.ts
// ============================================================

// --- 场景 1：端口号（0 是有效值！）---
function getPort(config: { port?: number | null }): number {
  const portWithOr = config.port || 3000;   // 错误：port=0 时会fallback到3000
  const portWithQQ = config.port ?? 3000;   // 正确：只有null/undefined才fallback

  console.log("|| 结果:", portWithOr);
  console.log("?? 结果:", portWithQQ);
  return portWithQQ;
}

console.log("=== port = 8080 ===");
getPort({ port: 8080 });
// || 结果: 8080
// ?? 结果: 8080

console.log("\n=== port = 0（有效值）===");
getPort({ port: 0 });
// || 结果: 3000  ← 错了！
// ?? 结果: 0     ← 正确

console.log("\n=== port = null（未设置）===");
getPort({ port: null });
// || 结果: 3000
// ?? 结果: 3000

console.log("\n=== port = undefined（未设置）===");
getPort({});
// || 结果: 3000
// ?? 结果: 3000


// --- 场景 2：链式 ?? 优先级查找 ---
function resolveSecret(
  envVar: string | undefined,
  configValue: string | undefined
): string | null {
  // 依次尝试：环境变量 → config → null
  return envVar ?? configValue ?? null;
}

console.log("\n=== secret 链式查找 ===");
console.log(resolveSecret("env-secret", "config-secret")); // "env-secret"
console.log(resolveSecret(undefined, "config-secret"));    // "config-secret"
console.log(resolveSecret(undefined, undefined));           // null


// --- 场景 3：可选链 ?. 配合 ?? ---
type Config = {
  server?: {
    host?: string;
    timeout?: number;
  };
};

function buildUrl(config: Config): string {
  const host = config.server?.host ?? "localhost";
  const timeout = config.server?.timeout ?? 5000;
  return `http://${host}?timeout=${timeout}`;
}

console.log("\n=== 可选链 + 空值合并 ===");
console.log(buildUrl({ server: { host: "example.com", timeout: 3000 } }));
// http://example.com?timeout=3000
console.log(buildUrl({ server: {} }));
// http://localhost?timeout=5000
console.log(buildUrl({}));
// http://localhost?timeout=5000


// --- 动手练习 ---
// TODO 1: 写一个函数 getRetryCount，从 config.retries 取值，
//         默认值为 3，但 retries=0 代表"不重试"（应该保留0）。
function getRetryCount(config: {retries?:number | null}): number {
  const retry_cnt = config.retries ?? 3
  console.log("getRetryCount ?? 结果: ", retry_cnt)

  return retry_cnt
}

console.log("=== getRetryCount ===");
getRetryCount({ retries: 5 });
getRetryCount({ retries: 0 });

// TODO 2: 写一个函数 resolveModel，
//         依次从 process.env.OPENCLAW_MODEL → config.model → "gpt-4" 取值。
function resolveModel(process?: {env?: {OPENCLAW_SECRET?: string | null}}, config?:{secret?: string | null}): string {
  const model_type = process?.env?.OPENCLAW_SECRET ?? config?.secret ?? "00000"
  console.log(model_type)
  
  return model_type
}

console.log("=== resolveModel ===");
resolveModel({env: {OPENCLAW_SECRET: "openclaw_012345"}}, {secret: "openclaw_543210"})
resolveModel({}, {secret: "openclaw_543210"})
resolveModel({}, {})
