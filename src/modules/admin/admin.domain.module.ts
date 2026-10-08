import { Module } from '@nestjs/common';
import { AdminAuthModule } from './auth/admin-auth.module';
import { AdminUserModule } from './users/admin-user.module';
import { AdminPosModule } from './pos/admin-pos.module';
import { AdminTeamModule } from './teams/admin-team.module';
import { AdminPointsModule } from './points/admin-points.module';
import { AdminMallModule } from './mall/admin-mall.module';
import { AdminTaskModule } from './tasks/admin-task.module';
import { AdminGiftModule } from './gifts/admin-gift.module';
import { AdminPoolModule } from './pool/admin-pool.module';
import { AdminOpsModule } from './ops/admin-ops.module';

/**
 * 管理后台模块聚合（B 端：用户/POS/团队/积分/商城/任务/赠送/分润池/风控对账）
 * 与 C 端（modules/app）独立维护，共用 src/dao 数据访问层。
 * 接口前缀 /admin/*，RBAC + 敏感操作双人复核（FR-12.8）
 */
@Module({
  imports: [
    AdminAuthModule,
    AdminUserModule,
    AdminPosModule,
    AdminTeamModule,
    AdminPointsModule,
    AdminMallModule,
    AdminTaskModule,
    AdminGiftModule,
    AdminPoolModule,
    AdminOpsModule,
  ],
})
export class AdminDomainModule {}
