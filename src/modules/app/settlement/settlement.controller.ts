import { Controller, Post, Body } from '@nestjs/common';
import { SettlementService } from './settlement.service';

// TODO: 内部签名鉴权（仅收单流水导入 Job / 管理端可调用）
@Controller('settlement')
export class SettlementController {
  constructor(private readonly settlement: SettlementService) {}

  /** 达标事件触发入口（T+1 流水导入 Job 调用） */
  @Post('qualified')
  qualified(@Body() body: { sn: string; userId: number }) {
    return this.settlement.settleQualified(body.sn, body.userId);
  }
}
