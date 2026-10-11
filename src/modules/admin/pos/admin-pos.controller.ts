import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AdminPosService } from './admin-pos.service';
import { AdminJwtGuard, PermissionsGuard, CurrentUser } from '../../../shared/auth';

/** 后台·POS 管理接口（/admin/pos）：装机审核/回收，要求登录态（POS 无独立权限码） */
@Controller('admin/pos')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminPosController {
  constructor(private readonly service: AdminPosService) {}

  @Post('review')
  review(
    @Body() body: { posTaskId: string; approve: boolean; rejectReason?: string },
    @CurrentUser() admin: { id: bigint; username: string; role: string },
  ) {
    return this.service.review(BigInt(body.posTaskId), body.approve, body.rejectReason ?? '', admin.id);
  }

  @Post('return')
  returnMachine(@Body() body: { posTaskId: string }, @CurrentUser() admin: { id: bigint; username: string; role: string }) {
    return this.service.returnMachine(BigInt(body.posTaskId), admin.id);
  }
}
