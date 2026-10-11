import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminOpsService } from './admin-ops.service';
import { AdminJwtGuard, PermissionsGuard, RequirePermission, CurrentUser } from '../../../shared/auth';

/**
 * 后台·风控/对账/死信接口（/admin/ops）
 * 查询仅登录态；处置动作（风控处置/对账处理/死信重放）要求 risk:manage（敏感权限）
 */
@Controller('admin/ops')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminOpsController {
  constructor(private readonly service: AdminOpsService) {}

  @Get('risks')
  risks(@Query('status') status?: string) {
    return this.service.risks(status ? Number(status) : undefined);
  }

  @Post('risks/:id/handle')
  @RequirePermission('risk:manage')
  handleRisk(
    @Body() body: { id: string; status: number },
    @CurrentUser() admin: { id: bigint; username: string; role: string },
  ) {
    return this.service.handleRisk(BigInt(body.id), body.status, admin.id);
  }

  @Get('diffs')
  diffs(@Query('status') status?: string) {
    return this.service.diffs(status ? Number(status) : undefined);
  }

  @Post('diffs/:id/handle')
  @RequirePermission('risk:manage')
  handleDiff(
    @Body() body: { id: string; status: number },
    @CurrentUser() admin: { id: bigint; username: string; role: string },
  ) {
    return this.service.handleDiff(BigInt(body.id), body.status, admin.id);
  }

  @Get('dead-letters')
  deadLetters() {
    return this.service.deadLetters();
  }

  @Post('dead-letters/:id/replay')
  @RequirePermission('risk:manage')
  replay(@Body() body: { id: string }) {
    return this.service.markReplayed(BigInt(body.id));
  }
}
