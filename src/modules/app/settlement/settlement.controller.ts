import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { InternalJwtGuard } from '../../../shared/auth';

/**
 * 结算触发接口（内部）：
 * 仅接受 /internal/token 换发的 internal token（T+1 流水导入 Job 调用）；
 * 用户/后台 token 因 aud 不匹配一律 401。
 */
@Controller('settlement')
@UseGuards(InternalJwtGuard)
export class SettlementController {
  constructor(private readonly settlement: SettlementService) {}

  /** 达标事件触发入口（T+1 流水导入 Job 调用） */
  @Post('qualified')
  qualified(@Body() body: { sn: string; userId: number }) {
    return this.settlement.settleQualified(body.sn, body.userId);
  }
}
