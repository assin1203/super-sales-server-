import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppModule } from './app.module';
import { resolveEnv } from './config/env.config';

async function bootstrap() {
  const env = resolveEnv();
  const app = await NestFactory.create(AppModule, {
    logger: env === 'production' ? ['log', 'warn', 'error'] : ['log', 'warn', 'error', 'debug'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  new Logger('Bootstrap').log(`[env=${env}] API server listening on :${port}`);
}
bootstrap();
