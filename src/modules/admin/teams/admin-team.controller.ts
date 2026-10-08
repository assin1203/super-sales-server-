import { Controller, Get, Param } from '@nestjs/common';
import { AdminTeamService } from './admin-team.service';

/** 后台·团队接口（/admin/teams） */
@Controller('admin/teams')
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
