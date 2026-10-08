import { Controller, Get, Post, Body } from '@nestjs/common';
import { AdminPosService } from './admin-pos.service';

/** 后台·POS 管理接口（/admin/pos） */
@Controller('admin/pos')
export class AdminPosController {
  constructor(private readonly service: AdminPosService) {}

  @Post('review')
  review(
    @Body() body: { posTaskId: string; approve: boolean; rejectReason?: string; adminId: string },
  ) {
    return this.service.review(BigInt(body.posTaskId), body.approve, body.rejectReason ?? '', BigInt(body.adminId));
  }

  @Post('return')
  returnMachine(@Body() body: { posTaskId: string; adminId: string }) {
    return this.service.returnMachine(BigInt(body.posTaskId), BigInt(body.adminId));
  }
}
