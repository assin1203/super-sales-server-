import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

/**
 * 结算 Worker 独立入口（架构文档 §5）：
 * 消费 Redis Stream 结算事件 + BullMQ 延迟任务，不对外提供 HTTP。
 * 启动：npm run start:worker
 */
async function bootstrap() {
  await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
  new Logger('WorkerBootstrap').log('Settlement worker started');
}
bootstrap();
