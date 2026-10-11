import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGiftService } from './admin-gift.service';
import { AdminJwtGuard, PermissionsGuard, RequirePermission, CurrentUser } from '../../../shared/auth';

/** 后台·赠送接口（/admin/gifts）：列表仅登录态，审批为敏感操作（双人复核） */
@Controller('admin/gifts')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminGiftController {
  constructor(private readonly service: AdminGiftService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.service.list(status ? Number(status) : undefined);
  }

  /** 审批（操作者取自 JWT，不信任请求体） */
  @Post('approve')
  @RequirePermission('gift:approve')
  approve(
    @Body() body: { activityId: string; isSecond: boolean; ip?: string },
    @CurrentUser() admin: { id: bigint; username: string; role: string },
  ) {
    return this.service.approve(BigInt(body.activityId), body.isSecond, { adminId: admin.id, ip: body.ip });
  }
}
