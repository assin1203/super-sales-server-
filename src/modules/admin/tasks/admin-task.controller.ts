import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminTaskService } from './admin-task.service';
import { AdminJwtGuard, PermissionsGuard, RequirePermission } from '../../../shared/auth';

/** 后台·任务接口（/admin/tasks） */
@Controller('admin/tasks')
@UseGuards(AdminJwtGuard, PermissionsGuard)
@RequirePermission('task:manage')
export class AdminTaskController {
  constructor(private readonly service: AdminTaskService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('by-code')
  byCode(@Query('code') code: string) {
    return this.service.byCode(code);
  }

  @Get('stats')
  stats(@Query('taskId') taskId: string) {
    return this.service.stats(BigInt(taskId));
  }
}
