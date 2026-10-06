import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * POS 装机/达标监控（FR-3.x）：
 * - 25 天内刷够 1000 元 = 达标（流水由收单通道 T+1 导入）
 * - 达标 → 达标入队四元组结算（走 SettlementService，唯一触发点）
 */
@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}

  /** T+1 流水导入后累计判断达标；达标判定成功后 publish evt:pos.qualified */
  async checkQualified(sn: string): Promise<boolean> {
    // TODO: 累计流水 >= 1000 且在装机 25 天窗口内 → 达标
    void sn;
    return false;
  }
}
