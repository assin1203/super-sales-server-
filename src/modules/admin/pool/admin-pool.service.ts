import { Injectable } from '@nestjs/common';
import { PoolDao } from '../../../dao/pool.dao';
import { AdminDao } from '../../../dao/admin.dao';

/**
 * 后台·分润池管理（FR-11.3 健康度 / FR-12.9 参数配置 + 保护状态）
 * 参数变更属敏感操作：版本号自增 + 双人复核审计
 */
@Injectable()
export class AdminPoolService {
  constructor(
    private readonly poolDao: PoolDao,
    private readonly adminDao: AdminDao,
  ) {}

  config() {
    return this.poolDao.findConfig();
  }

  async ledger(bizDate?: Date, pageNum = 1, pageSize = 30) {
    return this.poolDao.findLedger(bizDate, pageNum, pageSize);
  }

  /** 健康度报表（FR-11.3：余额/可支撑天数/预计负债/核销率） */
  async health() {
    const [cfg, balance, avg, pending] = await Promise.all([
      this.poolDao.findConfig(),
      this.poolDao.currentBalance(),
      this.poolDao.avgDailySpend(30),
      this.poolDao.pendingLiability(),
    ]);
    const supportDays = avg > 0 ? Math.floor(balance / avg) : 999;
    return {
      config: cfg,
      balance,
      avgDailySpend: Number(avg.toFixed(2)),
      supportDays,
      pendingLiability: Number(pending.toFixed(2)),
      guard: ['正常', '告警', '降级中'][cfg?.guard_status ?? 0],
    };
  }

  /** 参数配置更新（敏感操作：version 自增 + 复核审计） */
  async updateConfig(
    configId: bigint,
    data: Record<string, unknown>,
    operator: { adminId: bigint; ip?: string },
    confirmBy: bigint,
  ) {
    const before = await this.poolDao.findConfig();
    await this.poolDao.updateConfig(configId, data as never);
    const after = await this.poolDao.findConfig();
    await this.adminDao.logOp({
      adminId: operator.adminId,
      action: 'pool.config',
      targetType: 'profit_pool_config',
      targetId: configId,
      beforeData: before as unknown as import('../../../generated/prisma/client').Prisma.InputJsonValue,
      afterData: after as unknown as import('../../../generated/prisma/client').Prisma.InputJsonValue,
      confirmFlag: true,
      confirmBy,
      ip: operator.ip,
    });
  }

  /** 保护状态人工恢复（降级 → 正常，FR-12.9 需双人复核） */
  async releaseGuard(configId: bigint, operator: { adminId: bigint; ip?: string }, confirmBy: bigint) {
    await this.poolDao.setGuardStatus(undefined, configId, 0, operator.adminId);
    await this.adminDao.logOp({
      adminId: operator.adminId,
      action: 'pool.guard_release',
      targetType: 'profit_pool_config',
      targetId: configId,
      afterData: { guard_status: 0 },
      confirmFlag: true,
      confirmBy,
      ip: operator.ip,
    });
  }
}
