import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule } from './shared/redis/redis.module';
import { DaoModule } from './dao/dao.module';
import { PointsModule } from './modules/app/points/points.module';
import { TeamModule } from './modules/app/team/team.module';
import { SettlementModule } from './modules/app/settlement/settlement.module';
import { TaskModule } from './modules/app/task/task.module';
import { PoolModule } from './modules/app/pool/pool.module';
import { appConfig, envFilePaths } from './config/env.config';

/**
 * 结算 Worker 进程装配（独立于 API 进程，架构文档 §5）：
 * 结算消费者 + 延迟任务调度 + 日终对账 Job
 * 复用 app 域的 Points/Team/Settlement/Task/Pool 服务与共用 DAO 层
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
    PointsModule,
    TeamModule,
    SettlementModule,
    TaskModule,
    PoolModule,
  ],
})
export class WorkerModule {}
