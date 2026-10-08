import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * POS 域 DAO：pos_task（FR-3.x 装机/达标监控）+ acq_settle 结算批次
 * 达标判定幂等：条件更新 WHERE qualified_at IS NULL，影响行数=1 才算本次判定
 */
@Injectable()
export class PosDao {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? this.prisma;
  }

  // ---------- pos_task ----------

  create(data: Prisma.pos_taskCreateInput) {
    return this.prisma.pos_task.create({ data });
  }

  findBySn(sn: string) {
    return this.prisma.pos_task.findUnique({ where: { sn } });
  }

  findByUser(userId: bigint | number) {
    return this.prisma.pos_task.findMany({ where: { user_id: userId as bigint }, orderBy: { created_at: 'desc' } });
  }

  /** 装机审核通过（条件更新幂等：仅待审核状态可过审） */
  async approve(tx: Tx | undefined, id: bigint, reviewerId: bigint) {
    return this.db(tx).pos_task.updateMany({
      where: { id, status: 1 },
      data: { status: 2, reviewer_id: reviewerId, reviewed_at: new Date() },
    });
  }

  /** 安装积分记账幂等标记（reward_issued_at NULL 才记） */
  async markRewardIssued(tx: Tx, id: bigint) {
    const updated = await this.db(tx).pos_task.updateMany({
      where: { id, reward_issued_at: null },
      data: { reward_issued_at: new Date() },
    });
    return updated.count === 1;
  }

  /**
   * 达标判定（FR-3.3，核心幂等点）：
   * 25 天窗口内累计流水 >= 1000 时由结算引擎调用；
   * 条件更新 qualified_at IS NULL → 影响行数=1 表示本次事务获得判定权
   */
  async markQualified(tx: Tx, id: bigint, cumulativeFlow: number): Promise<boolean> {
    const updated = await this.db(tx).pos_task.updateMany({
      where: { id, qualified_at: null, fake_flag: 0, machine_status: 1 },
      data: { qualified_at: new Date(), cumulative_flow: cumulativeFlow },
    });
    return updated.count === 1;
  }

  /** T+1 流水导入：按机器累加（仅运营中机器、排除机构风控标记虚假流水） */
  async importDailyFlow(tx: Tx, posTaskId: bigint, flow: number, isFake: boolean) {
    if (isFake) {
      return this.db(tx).pos_task.update({ where: { id: posTaskId }, data: { fake_flag: 1 } });
    }
    return this.db(tx).pos_task.update({
      where: { id: posTaskId },
      data: {
        cumulative_flow: { increment: flow },
        month_flow: { increment: flow },
        last_trade_at: new Date(),
      },
    });
  }

  /** 25 天到期扫描（未达标处理 FR-3.6） */
  findDueUnqualified(now: Date, limit = 200) {
    return this.prisma.pos_task.findMany({
      where: { status: 2, qualified_at: null, due_at: { lte: now }, unqualified_recycled: 0 },
      take: limit,
    });
  }

  /** 未达标冻结积分回收幂等标记 */
  async markRecycled(tx: Tx, id: bigint) {
    const updated = await this.db(tx).pos_task.updateMany({ where: { id, unqualified_recycled: 0 }, data: { unqualified_recycled: 1 } });
    return updated.count === 1;
  }

  /** 退机（FR-3.7；入队名额不自动释放） */
  async returnMachine(tx: Tx | undefined, id: bigint) {
    return this.db(tx).pos_task.updateMany({
      where: { id, machine_status: 1 },
      data: { machine_status: 2, returned_at: new Date() },
    });
  }

  /** 再入队运营校验：名下是否存在"未退机 + 近 N 天有真实交易"的机器（FR-9.9） */
  async hasActiveMachine(userId: bigint | number, windowDays = 30): Promise<boolean> {
    const since = new Date(Date.now() - windowDays * 86400_000);
    const count = await this.prisma.pos_task.count({
      where: { user_id: userId as bigint, machine_status: 1, last_trade_at: { gte: since } },
    });
    return count > 0;
  }

  // ---------- acq_settle（B 端对公结算单） ----------

  /** 导入 T+1 结算批次（批次号幂等） */
  async importSettleBatch(
    tx: Tx,
    batch: { batchNo: string; settleDate: Date; totalFlow: number; totalFee: number; netRevenue: number; depositAmount: number },
    items: { posTaskId: bigint; flow: number; fee: number; isFake: boolean }[],
  ) {
    const db = this.db(tx);
    const exists = await db.acq_settle_batch.findUnique({ where: { batch_no: batch.batchNo } });
    if (exists) return exists;
    const batchRow = await db.acq_settle_batch.create({
      data: {
        batch_no: batch.batchNo,
        settle_date: batch.settleDate,
        total_flow: batch.totalFlow,
        total_fee: batch.totalFee,
        net_revenue: batch.netRevenue,
        deposit_amount: batch.depositAmount,
        machine_count: items.length,
        status: 1,
      },
    });
    await db.acq_settle_item.createMany({
      data: items.map((i) => ({
        batch_id: batchRow.id,
        pos_task_id: i.posTaskId,
        flow_amount: i.flow,
        fee_amount: i.fee,
        fake_flag: i.isFake ? 1 : 0,
      })),
    });
    return batchRow;
  }

  /** 未对账批次（FR-12.6） */
  findUnreconciledBatches() {
    return this.prisma.acq_settle_batch.findMany({ where: { reconciled: 0 }, orderBy: { settle_date: 'asc' } });
  }

  markBatchReconciled(batchId: bigint, ok: boolean) {
    return this.prisma.acq_settle_batch.update({ where: { id: batchId }, data: { reconciled: ok ? 1 : 2, status: 2 } });
  }
}
