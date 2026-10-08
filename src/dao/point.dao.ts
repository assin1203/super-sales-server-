import { Injectable } from '@nestjs/common';
import { Prisma, point_flow } from '../generated/prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * 积分域 DAO：point_wallet / point_flow / point_expire_batch
 * 资金路径唯一入口（FR-4.x / FR-9.7）：
 * - 入账/扣减必须走 credit/debit（乐观锁 + 流水 + flow_no 唯一键双保险）
 * - 所有方法支持传入 tx（事务内调用）；原子性由外层 $transaction 保证，方法内不嵌套事务
 */
@Injectable()
export class PointDao {
  constructor(private readonly prisma: PrismaService) {}

  /** 事务客户端：显式传入或回退到全局（非事务场景） */
  private db(tx?: Tx): Tx {
    return tx ?? this.prisma;
  }

  // ---------- point_wallet ----------

  findWallet(userId: bigint | number) {
    return this.prisma.point_wallet.findUnique({ where: { user_id: userId as bigint } });
  }

  /** 注册同步开户（唯一键冲突=已开户） */
  async ensureWallet(tx: Tx, userId: bigint | number) {
    const exists = await this.db(tx).point_wallet.findUnique({ where: { user_id: userId as bigint } });
    if (exists) return exists;
    return this.db(tx).point_wallet.create({ data: { user_id: userId as bigint } });
  }

  /** 入账（余额+delta；delta 为正数） */
  async credit(
    tx: Tx,
    userId: bigint | number,
    delta: number,
    flowNo: string,
    flowType: string,
    opts: { bizId?: bigint; bizNo?: string; ruleVersion?: number; expireAt?: Date; frozen?: boolean; remark?: string } = {},
  ) {
    const db = this.db(tx);
    const wallet = await db.point_wallet.update({
      where: { user_id: userId as bigint },
      data: {
        balance: { increment: delta },
        frozen_balance: { increment: opts.frozen ? delta : 0 },
        total_earned: { increment: Math.max(delta, 0) },
        version: { increment: 1 },
      },
    });
    await db.point_flow.create({
      data: {
        flow_no: flowNo,
        user_id: userId as bigint,
        delta,
        balance_after: wallet.balance,
        flow_type: flowType,
        biz_id: opts.bizId,
        biz_no: opts.bizNo ?? '',
        rule_version: opts.ruleVersion ?? 1,
        expire_at: opts.expireAt,
        frozen: opts.frozen ? 1 : 0,
        remark: opts.remark ?? '',
      },
    });
    return wallet;
  }

  /**
   * 扣减（乐观锁：WHERE version 校验；余额不足/幂等冲突返回 null）
   */
  async debit(
    tx: Tx,
    userId: bigint | number,
    delta: number,
    flowNo: string,
    flowType: string,
    opts: { bizId?: bigint; bizNo?: string; remark?: string } = {},
  ): Promise<point_flow | null> {
    const db = this.db(tx);
    const wallet = await db.point_wallet.findUnique({ where: { user_id: userId as bigint } });
    if (!wallet || wallet.balance < delta) return null;
    try {
      await db.point_wallet.update({
        where: { user_id: userId as bigint, version: wallet.version },
        data: {
          balance: { decrement: delta },
          total_consumed: { increment: delta },
          version: { increment: 1 },
        },
      });
      return await db.point_flow.create({
        data: {
          flow_no: flowNo,
          user_id: userId as bigint,
          delta: -delta,
          balance_after: Number(wallet.balance) - delta,
          flow_type: flowType,
          biz_id: opts.bizId,
          biz_no: opts.bizNo ?? '',
          remark: opts.remark ?? '',
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null; // flow_no 重复（幂等）
      throw e;
    }
  }

  /** 冻结转可用（安装积分达标转可用，FR-9.2）：仅移动状态，留痕走流水 */
  async unfreeze(tx: Tx, userId: bigint | number, amount: number, flowNo: string, remark = ''): Promise<boolean> {
    const db = this.db(tx);
    const updated = await db.point_wallet.updateMany({
      where: { user_id: userId as bigint, frozen_balance: { gte: amount } },
      data: { frozen_balance: { decrement: amount } },
    });
    if (updated.count === 0) return false;
    const wallet = await db.point_wallet.findUniqueOrThrow({ where: { user_id: userId as bigint } });
    await db.point_flow.create({
      data: { flow_no: flowNo, user_id: userId as bigint, delta: 0, balance_after: wallet.balance, flow_type: 'INSTALL_UNFREEZE', remark },
    });
    return true;
  }

  /** 流水查询（用户端/管理端分页） */
  findFlows(userId: bigint | number, pageNum = 1, pageSize = 20, flowType?: string) {
    return this.prisma.point_flow.findMany({
      where: { user_id: userId as bigint, ...(flowType ? { flow_type: flowType } : {}) },
      orderBy: { created_at: 'desc' },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    });
  }

  // ---------- point_expire_batch ----------

  /** 创建有效期批次（发放时调用） */
  createExpireBatch(tx: Tx, userId: bigint | number, batchNo: string, points: number, expireAt: Date) {
    return this.db(tx).point_expire_batch.create({
      data: { user_id: userId as bigint, source_batch_no: batchNo, points, expire_at: expireAt },
    });
  }

  /** 每日过期扫描：找出到期的有效批次 */
  findExpiredBatches(now: Date, limit = 500) {
    return this.prisma.point_expire_batch.findMany({
      where: { status: 1, expire_at: { lte: now } },
      orderBy: { expire_at: 'asc' },
      take: limit,
    });
  }

  /** 批次清零（条件更新幂等：status=1 才清零） */
  async clearBatch(tx: Tx, batchId: bigint, remaining: number) {
    return this.db(tx).point_expire_batch.updateMany({
      where: { id: batchId, status: 1 },
      data: { points: { decrement: remaining }, status: 2, cleared_at: new Date() },
    });
  }
}
