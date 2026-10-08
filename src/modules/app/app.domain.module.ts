import { Module } from '@nestjs/common';
import { UserModule } from './user/user.module';
import { MemberModule } from './member/member.module';
import { PosModule } from './pos/pos.module';
import { TeamModule } from './team/team.module';
import { PointsModule } from './points/points.module';
import { SettlementModule } from './settlement/settlement.module';
import { MallModule } from './mall/mall.module';
import { TaskModule } from './task/task.module';
import { GiftModule } from './gift/gift.module';
import { PoolModule } from './pool/pool.module';

/**
 * C 端 App 业务模块聚合（用户端：展业/积分/团队/商城/任务/赠送）
 * 与管理后台（modules/admin）独立维护，共用 src/dao 数据访问层。
 */
@Module({
  imports: [
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
  ],
})
export class AppDomainModule {}
