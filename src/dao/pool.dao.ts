import { Injectable } from '@nestjs/common';
import { Prisma, profit_pool_config, profit_pool_ledger } from '../generated/prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * 分润池域 DAO：profit_pool_config / profit_pool_ledger / profit_pool_daily
 * （§2.5 / FR-12.9 台账只增、保护状态机）
 * 池余额不在表内存字段，以 ledger 累加计算为准（对账锚点 balance_after）
 */
@Injectable()
export class PoolDao {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? this.prisma;
  }

  // ---------- config ----------

  async findConfig(): Promise<profit_pool_config | null> {
    return this.prisma.profit_pool_config.findFirst({ where: { pool_name: 'MAIN' } });
  }

  /** 参数更新（版本号自增 + 审计由 AdminDao 落 admin_op_log，FR-12.9 双人复核） */
  updateConfig(id: bigint, data: Prisma.profit_pool_configUpdateInput) {
    return this.prisma.profit_pool_config.update({
      where: { id },
      data: { ...data, version: { increment: 1 } },
    });
  }

  /** 保护状态流转（0正常→1告警→2降级；人工恢复 2→0） */
  async setGuardStatus(tx: Tx | undefined, configId: bigint, status: number, operatorId?: bigint) {
    return this.db(tx).profit_pool_config.update({
      where: { id: configId },
      data: {
        guard_status: status,
        guard_since: new Date(),
        ...(operatorId ? { updated_by: operatorId } : {}),
      },
    });
  }

  // ---------- ledger ----------

  /**
   * 台账记账（只增；balance_after 由调用方传入计算后的余额）
   * ledgerType: IN / LIABILITY_ADD / LIABILITY_REVERSE / OUT / GUARD_DEFER / GUARD_RECOVER / ADJUST
   */
  async record(
    tx: Tx,
    data: {
      bizDate: Date;
      type: profit_pool_ledger['ledger_type'];
      amount: number;
      points?: number;
      sourceType: string;
      sourceBizId?: bigint;
      balanceAfter: number;
      remark?: string;
    },
  ) {
    return this.db(tx).profit_pool_ledger.create({
      data: {
        biz_date: data.bizDate,
        ledger_type: data.type,
        amount: data.amount,
        points: data.points ?? 0,
        source_type: data.sourceType,
        source_biz_id: data.sourceBizId,
        balance_after: data.balanceAfter,
        remark: data.remark ?? '',
      },
    });
  }

  /** 当前池余额 = 最近一条台账的 balance_after（空池为 0） */
  async currentBalance(): Promise<number> {
    const last = await this.prisma.profit_pool_ledger.findFirst({ orderBy: { created_at: 'desc' } });
    return last ? Number(last.balance_after) : 0;
  }

  findLedger(bizDate?: Date, pageNum = 1, pageSize = 30) {
    return this.prisma.profit_pool_ledger.findMany({
      where: bizDate ? { biz_date: bizDate } : {},
      orderBy: { created_at: 'desc' },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    });
  }

  /** 日均支出（近 N 天 OUT + LIABILITY_ADD 均值，可支撑天数分母） */
  async avgDailySpend(days = 30): Promise<number> {
    const since = new Date(Date.now() - days * 86400_000);
    const row = await this.prisma.profit_pool_ledger.aggregate({
      where: {
        ledger_type: { in: ['OUT', 'LIABILITY_ADD'] },
        biz_date: { gte: since },
      },
      _sum: { amount: true },
    });
    return Number(row._sum.amount ?? 0) / days;
  }

  // ---------- daily ----------

  /** 每日汇总（uk_date 幂等：已存在则更新） */
  upsertDaily(
    tx: Tx,
    data: {
      bizDate: Date;
      opening: number;
      inAmount: number;
      machineCount: number;
      liabilityAdd: number;
      outAmount: number;
      closing: number;
      pendingLiability: number;
      avgDailySpend: number;
      supportDays: number;
      redeemRate: number;
      guardStatus: number;
    },
  ) {
    return this.db(tx).profit_pool_daily.upsert({
      where: { biz_date: data.bizDate },
      create: {
        biz_date: data.bizDate,
        opening_balance: data.opening,
        in_amount: data.inAmount,
        machine_count: data.machineCount,
        liability_add: data.liabilityAdd,
        out_amount: data.outAmount,
        closing_balance: data.closing,
        pending_liability: data.pendingLiability,
        avg_daily_spend: data.avgDailySpend,
        support_days: data.supportDays,
        redeem_rate_actual: data.redeemRate,
        guard_status: data.guardStatus,
      },
      update: {
        opening_balance: data.opening,
        in_amount: data.inAmount,
        machine_count: data.machineCount,
        liability_add: data.liabilityAdd,
        out_amount: data.outAmount,
        closing_balance: data.closing,
        pending_liability: data.pendingLiability,
        avg_daily_spend: data.avgDailySpend,
        support_days: data.supportDays,
        redeem_rate_actual: data.redeemRate,
        guard_status: data.guardStatus,
      },
    });
  }

  /** 预计负债（未核销积分 × 成本系数 × 核销率，FR-11.3） */
  async pendingLiability(): Promise<number> {
    const [cfg, agg] = await Promise.all([
      this.findConfig(),
      this.prisma.point_flow.aggregate({
        where: { delta: { gt: 0 }, frozen: 0 },
        _sum: { delta: true },
      }),
    ]);
    if (!cfg) return 0;
    const issued = Number(agg._sum.delta ?? 0);
    return issued * Number(cfg.point_cost_factor) * Number(cfg.redeem_rate);
  }
}
