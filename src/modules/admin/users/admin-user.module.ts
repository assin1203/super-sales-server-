import { Module } from '@nestjs/common';
import { AdminUserService } from './admin-user.service';
import { AdminUserController } from './admin-user.controller';

/** 后台·用户管理（查询/冻结/封禁，敏感操作双人复核） */
@Module({
  controllers: [AdminUserController],
  providers: [AdminUserService],
})
export class AdminUserModule {}
