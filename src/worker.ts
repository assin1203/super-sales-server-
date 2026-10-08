import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';
import { resolveEnv } from './config/env.config';

/**
 * 结算 Worker 独立入口（架构文档 §5）：
 * 消费 Redis Stream 结算事件 + BullMQ 延迟任务，不对外提供 HTTP。
 * 启动：npm run start:worker（生产）/ npm run start:worker:dev（开发）
 * 环境：cross-env 已设 NODE_ENV，ConfigModule 自动加载 .env.{NODE_ENV}
 */
async function bootstrap() {
  const env = resolveEnv();
  await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
  new Logger('WorkerBootstrap').log(`[env=${env}] Settlement worker started`);
}
bootstrap();
