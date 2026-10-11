import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminPointsService } from './admin-points.service';
import { AdminJwtGuard, PermissionsGuard, RequirePermission, CurrentUser } from '../../../shared/auth';

/** 后台·积分接口（/admin/points） */
@Controller('admin/points')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminPointsController {
  constructor(private readonly service: AdminPointsService) {}

  @Get('wallet')
  @RequirePermission('points:query')
  wallet(@Query('userId') userId: string) {
    return this.service.findWallet(BigInt(userId));
  }

  @Get('flows')
  @RequirePermission('points:query')
  flows(
    @Query('userId') userId: string,
    @Query('pageNum') pageNum = '1',
    @Query('pageSize') pageSize = '30',
    @Query('flowType') flowType?: string,
  ) {
    return this.service.findFlows(BigInt(userId), Number(pageNum), Number(pageSize), flowType);
  }

  /** 积分调账（敏感操作：confirmBy 必填；操作者取自 JWT，不信任请求体） */
  @Post('adjust')
  @RequirePermission('points:adjust')
  adjust(
    @Body() body: { userId: string; delta: number; reason: string; confirmBy: string; ip?: string },
    @CurrentUser() admin: { id: bigint; username: string; role: string },
  ) {
    return this.service.adjust(
      BigInt(body.userId),
      body.delta,
      body.reason,
      { adminId: admin.id, ip: body.ip },
      BigInt(body.confirmBy),
    );
  }
}
