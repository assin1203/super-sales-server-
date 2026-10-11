import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminUserService } from './admin-user.service';
import { AdminJwtGuard, PermissionsGuard, RequirePermission, CurrentUser } from '../../../shared/auth';

/** 后台·用户管理接口（/admin/users） */
@Controller('admin/users')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminUserController {
  constructor(private readonly service: AdminUserService) {}

  @Get('by-phone')
  @RequirePermission('user:query')
  byPhone(@Query('phone') phone: string) {
    return this.service.findByPhone(phone);
  }

  @Get(':id')
  @RequirePermission('user:query')
  detail(@Query('id') id: string) {
    return this.service.findById(BigInt(id));
  }

  /** 冻结/封禁（敏感操作：前端传 confirmBy 复核人 ID；操作者取自 JWT，不信任请求体） */
  @Post(':id/status')
  @RequirePermission('user:freeze')
  setStatus(
    @Body() body: { id: string; status: number; confirmBy?: string; ip?: string },
    @CurrentUser() admin: { id: bigint; username: string; role: string },
  ) {
    return this.service.setStatus(
      BigInt(body.id),
      body.status,
      { adminId: admin.id, ip: body.ip },
      body.confirmBy ? BigInt(body.confirmBy) : undefined,
    );
  }
}
