import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppModule } from './app.module';
import { resolveEnv, assertProductionSecrets } from './config/env.config';
import { AllExceptionsFilter } from './shared/errors/all-exceptions.filter';

// Prisma 的 BigInt 字段（id / 金额 / 积分余额等）默认无法被 JSON.stringify 序列化，
// Express res.json() 会抛 "Do not know how to serialize a BigInt"。
// 全局让 BigInt 序列化为字符串：保留完整精度（大数转 number 会丢精度），客户端按字符串解析。
(BigInt.prototype as { toJSON?: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

async function bootstrap() {
  const env = resolveEnv();
  assertProductionSecrets(env);
  const app = await NestFactory.create(AppModule, {
    logger: env === 'production' ? ['log', 'warn', 'error'] : ['log', 'warn', 'error', 'debug'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors();

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  new Logger('Bootstrap').log(`[env=${env}] API server listening on :${port}`);
}
bootstrap();
