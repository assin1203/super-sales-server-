import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';

/**
 * 分润池（FR-12.9，架构文档 §7）：
 * - T+1 入池 Job：收单结算单 → 按机器归集 → pool_ledger(IN)
 * - 发放计提 LIABILITY / 核销出池 OUT
 * - 保护状态：<30 天可支撑 → 告警；<14 天 → 降级（缓存 pool:guard 状态位）
 */
@Injectable()
export class PoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 结算前置检查：返回当前保护等级（normal/warn/degraded） */
  async guardLevel(): Promise<'normal' | 'warn' | 'degraded'> {
    const cached = await this.redis.client.get('pool:guard');
    return (cached as any) ?? 'normal';
  }
}
