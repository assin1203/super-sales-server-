import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule } from './shared/redis/redis.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { PoolModule } from './modules/pool/pool.module';
import { PointsModule } from './modules/points/points.module';
import { TeamModule } from './modules/team/team.module';
import { TaskModule } from './modules/task/task.module';

/**
 * Worker 进程装配：结算消费者 + 延迟任务调度 + 日终对账。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    PointsModule,
    TeamModule,
    SettlementModule,
    TaskModule,
    PoolModule,
  ],
})
export class WorkerModule {}
