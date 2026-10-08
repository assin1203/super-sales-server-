import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { AdminOpsService } from './admin-ops.service';

/** 后台·风控/对账/死信接口（/admin/ops） */
@Controller('admin/ops')
export class AdminOpsController {
  constructor(private readonly service: AdminOpsService) {}

  @Get('risks')
  risks(@Query('status') status?: string) {
    return this.service.risks(status ? Number(status) : undefined);
  }

  @Post('risks/:id/handle')
  handleRisk(@Body() body: { id: string; status: number; operatorId: string }) {
    return this.service.handleRisk(BigInt(body.id), body.status, BigInt(body.operatorId));
  }

  @Get('diffs')
  diffs(@Query('status') status?: string) {
    return this.service.diffs(status ? Number(status) : undefined);
  }

  @Post('diffs/:id/handle')
  handleDiff(@Body() body: { id: string; status: number; handledBy: string }) {
    return this.service.handleDiff(BigInt(body.id), body.status, BigInt(body.handledBy));
  }

  @Get('dead-letters')
  deadLetters() {
    return this.service.deadLetters();
  }

  @Post('dead-letters/:id/replay')
  replay(@Body() body: { id: string }) {
    return this.service.markReplayed(BigInt(body.id));
  }
}
