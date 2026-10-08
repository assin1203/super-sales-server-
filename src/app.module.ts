import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule } from './shared/redis/redis.module';
import { DaoModule } from './dao/dao.module';
import { AppDomainModule } from './modules/app/app.domain.module';
import { AdminDomainModule } from './modules/admin/admin.domain.module';
import { appConfig, envFilePaths } from './config/env.config';

/**
 * API 主应用装配（API 进程：C 端 + 管理后台 BFF 合一）
 *
 * 分层约定（架构文档）：
 * - Controller/Service 不直接碰 Prisma，一律经 DaoModule（全局模块）
 * - modules/app（C 端）与 modules/admin（后台）独立维护，共用 DAO 层
 * - 环境切换：.env + .env.{NODE_ENV}（envFilePaths），见 config/env.config.ts
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envFilePaths(),
      load: [appConfig],
    }),
    PrismaModule,
    RedisModule,
    DaoModule,
    AppDomainModule,
    AdminDomainModule,
  ],
})
export class AppModule {}
