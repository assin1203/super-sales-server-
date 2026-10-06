import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule } from './shared/redis/redis.module';
import { UserModule } from './modules/user/user.module';
import { MemberModule } from './modules/member/member.module';
import { PosModule } from './modules/pos/pos.module';
import { TeamModule } from './modules/team/team.module';
import { PointsModule } from './modules/points/points.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { MallModule } from './modules/mall/mall.module';
import { TaskModule } from './modules/task/task.module';
import { GiftModule } from './modules/gift/gift.module';
import { PoolModule } from './modules/pool/pool.module';
import { AdminModule } from './modules/admin/admin.module';

/**
 * API 主应用：用户端 + 管理后台 BFF。
 * 模块划分对齐 DOC/demo-技术架构.md §4.1。
 * 注意：积分写入单入口原则 —— 其他模块不得直写 point_wallet，一律走 SettlementModule。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    UserModule,
    MemberModule,
    PosModule,
    TeamModule,
    PointsModule,
    SettlementModule,
    MallModule,
    TaskModule,
    GiftModule,
    PoolModule,
    AdminModule,
  ],
})
export class AppModule {}
