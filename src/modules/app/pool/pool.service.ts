import { Injectable } from '@nestjs/common';
import { PoolDao } from '../../../dao/pool.dao';
import { RedisService } from '../../../shared/redis/redis.service';

/**
 * 分润池（FR-12.9，架构文档 §7）：
 * - T+1 入池 Job：收单结算单 → 按机器归集 → pool_ledger(IN)
 * - 发放计提 LIABILITY / 核销出池 OUT
 * - 保护状态：<30 天可支撑 → 告警；<14 天 → 降级（缓存 pool:guard 状态位）
 * 数据访问全部经 PoolDao（DAO 层架构约束）
 */
@Injectable()
export class PoolService {
  constructor(
    private readonly poolDao: PoolDao,
    private readonly redis: RedisService,
  ) {}

  /**
   * 结算前置检查（每次积分发放前调用，FR-9.12）
   * 返回保护等级：normal / warn / degraded
   */
  async guardLevel(): Promise<'normal' | 'warn' | 'degraded'> {
    const cached = (await this.redis.client.get('pool:guard')) as
      | 'normal' | 'warn' | 'degraded' | null;
    if (cached) return cached;
    const cfg = await this.poolDao.findConfig();
    if (!cfg) return 'normal';
    const level = ['normal', 'warn', 'degraded'] as const;
    return level[cfg.guard_status] ?? 'normal';
  }

  /** 池余额（台账最近 balance_after 为准） */
  currentBalance() {
    return this.poolDao.currentBalance();
  }

  /** 可支撑天数（余额 / 日均支出） */
  async supportDays(): Promise<number> {
    const [balance, avg] = await Promise.all([
      this.poolDao.currentBalance(),
      this.poolDao.avgDailySpend(30),
    ]);
    if (avg <= 0) return 999;
    return Math.floor(balance / avg);
  }
}
