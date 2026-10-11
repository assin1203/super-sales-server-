/**
 * 多环境配置（dev / test / production）
 *
 * 切换方式：
 *   1. npm scripts（推荐）：npm run start:dev / start:test / start:prod
 *   2. 环境变量：NODE_ENV=test npm run start
 *
 * 文件加载（后者覆盖前者，均由 NestJS ConfigModule 完成）：
 *   .env             —— 公共配置（所有环境共享）
 *   .env.{NODE_ENV}  —— 环境专属配置（.env.test / .env.production，gitignore）
 *
 * 环境值约定：dev | test | production
 */
export type AppEnv = 'dev' | 'test' | 'production';

export function resolveEnv(): AppEnv {
  const raw = (process.env.NODE_ENV || 'dev').toLowerCase();
  if (raw === 'test' || raw === 'testing' || raw === 'staging') return 'test';
  if (raw === 'production' || raw === 'prod') return 'production';
  return 'dev';
}

/**
 * 内部调用方凭证（token exchange）：JSON 对象 clientId -> clientSecret
 * 例：INTERNAL_CLIENTS='{"settlement-job":"<强随机串>"}'
 * 泄漏处置：更换该 client 的 secret 即可，旧 token 15min 自然过期，无需重启 API 侧（新值随重启生效）。
 */
function parseInternalClients(): Record<string, string> {
  const raw = process.env.INTERNAL_CLIENTS;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 一个字符的 typo 若静默返回 {}，所有 internal client 会被静默禁用，直到结算 Job 401 才发现；这里直接拒绝启动
    throw new Error('[bootstrap] INTERNAL_CLIENTS 不是合法 JSON（应为 clientId -> secret 的对象），请检查引号/逗号');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('[bootstrap] INTERNAL_CLIENTS 必须是 JSON 对象（clientId -> secret）');
  }
  const out: Record<string, string> = {};
  for (const [id, secret] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof secret === 'string' && secret.length > 0) out[id] = secret;
  }
  return out;
}

export const appConfig = () => ({
  env: resolveEnv(),
  port: parseInt(process.env.PORT ?? '3000', 10),
  api: {
    prefix: process.env.API_PREFIX ?? 'api',
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  /**
   * JWT 三条线（密钥完全隔离，防 token 串用）：
   * - admin：后台 B 端（aud=admin，JWT_ADMIN_SECRET 签发）
   * - app：C 端（aud=app，JWT_APP_SECRET 签发，access + refresh 双 token）
   * - internal：内部 Job（aud=internal，JWT_INTERNAL_SECRET 签发，client secret 换发）
   */
  jwt: {
    iss: process.env.JWT_ISS ?? 'kqw-server',
    admin: {
      secret: process.env.JWT_ADMIN_SECRET ?? 'dev-admin-secret',
      accessExpires: process.env.JWT_ADMIN_EXPIRES ?? '2h',
    },
    app: {
      secret: process.env.JWT_APP_SECRET ?? 'dev-app-secret',
      accessExpires: process.env.JWT_APP_EXPIRES ?? '2h',
      refreshDays: parseInt(process.env.JWT_APP_REFRESH_DAYS ?? '30', 10),
      /** 已轮换 refresh 的重用检测窗口（秒）：窗口内被重用即作废该用户当前会话 */
      reuseWindowSeconds: parseInt(process.env.JWT_APP_REFRESH_REUSE_WINDOW ?? '600', 10),
    },
    internal: {
      secret: process.env.JWT_INTERNAL_SECRET ?? 'dev-internal-secret',
      accessExpires: process.env.JWT_INTERNAL_EXPIRES ?? '15m',
      clients: parseInternalClients(),
    },
  },
});

/** 弱值/占位符：dev 默认值或 .env.*.example 样例值（公开在 git 仓库，照抄等于密钥泄漏） */
function isWeakSecret(v: string | undefined): boolean {
  return (
    !v ||
    v.startsWith('dev-') ||
    v === 'change-me' ||
    v === 'change-me-in-production' ||
    v === 'REPLACE_WITH_STRONG_RANDOM'
  );
}

/**
 * 生产环境密钥 fail-fast：缺失或仍为 dev 默认值时拒绝启动。
 * 在 main.ts bootstrap 首行调用。
 */
export function assertProductionSecrets(env: AppEnv): void {
  if (env !== 'production') return;
  const checks: Array<[string, string | undefined]> = [
    ['JWT_ADMIN_SECRET', process.env.JWT_ADMIN_SECRET],
    ['JWT_APP_SECRET', process.env.JWT_APP_SECRET],
    ['JWT_INTERNAL_SECRET', process.env.JWT_INTERNAL_SECRET],
  ];
  const bad = checks.filter(([, v]) => isWeakSecret(v));
  if (bad.length > 0) {
    throw new Error(`[bootstrap] 生产环境必须配置强随机 JWT 密钥：${bad.map(([k]) => k).join(', ')}（参考 .env.production.example，openssl rand -hex 32 生成）`);
  }
  // 内部调用方：生产必须配置至少一个 client，且 secret 不能是样例占位符
  const clients = parseInternalClients();
  if (Object.keys(clients).length === 0) {
    throw new Error('[bootstrap] 生产环境必须配置 INTERNAL_CLIENTS（内部 Job token exchange 凭证，参考 .env.production.example）');
  }
  const badClients = Object.entries(clients)
    .filter(([, secret]) => isWeakSecret(secret))
    .map(([id]) => id);
  if (badClients.length > 0) {
    throw new Error(`[bootstrap] INTERNAL_CLIENTS 中的 secret 必须为强随机串（不允许样例占位符）：${badClients.join(', ')}`);
  }
}

/** 环境专属 .env 文件列表（ConfigModule envFilePath，按顺序覆盖） */
export function envFilePaths(): string[] {
  return ['.env', `.env.${resolveEnv()}`];
}
