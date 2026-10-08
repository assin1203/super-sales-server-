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
  jwt: {
    secret: process.env.JWT_SECRET ?? 'change-me',
    expires: process.env.JWT_EXPIRES ?? '2h',
  },
});

/** 环境专属 .env 文件列表（ConfigModule envFilePath，按顺序覆盖） */
export function envFilePaths(): string[] {
  return ['.env', `.env.${resolveEnv()}`];
}
