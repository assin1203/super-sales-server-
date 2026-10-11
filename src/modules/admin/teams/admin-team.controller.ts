import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AdminTeamService } from './admin-team.service';
import { AdminJwtGuard, PermissionsGuard } from '../../../shared/auth';

/** 后台·团队接口（/admin/teams）：查询类，要求登录态 */
@Controller('admin/teams')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminTeamController {
  constructor(private readonly service: AdminTeamService) {}

  @Get('wait-queue')
  waitQueue() {
    return this.service.waitQueue();
  }

  @Get(':roomId')
  detail(@Param('roomId') roomId: string) {
    return this.service.roomDetail(BigInt(roomId));
  }
}
