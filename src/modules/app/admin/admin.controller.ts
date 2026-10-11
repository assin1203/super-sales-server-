import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { UserJwtGuard } from '../../../shared/auth';

/**
 * APP 端内管理接口（/app-admin，FR-12.8）：
 * 本质仍是 C 端用户（更高角色），走 UserJwtGuard；
 * 路由改名 app-admin，避免与后台 B 端（modules/admin，/admin/*）路径冲突。
 */
@Controller('app-admin')
@UseGuards(UserJwtGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('ping')
  ping() {
    return { ok: true };
  }
}
