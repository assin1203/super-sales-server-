import { Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';

/** 后台登录（RBAC 三角色：SUPER_ADMIN / OPERATOR / AGENT，FR-12.8） */
@Module({
  controllers: [AdminAuthController],
  providers: [AdminAuthService],
  exports: [AdminAuthService],
})
export class AdminAuthModule {}
