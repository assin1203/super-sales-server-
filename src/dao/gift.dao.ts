import { Injectable } from '@nestjs/common';
import { Prisma, gift_record } from '../generated/prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * 赠送域 DAO：gift_activity / gift_record（FR-8.x）
 * 预算硬控：issued_points 原子累加，超预算拒绝（FR-8.4）
 * 互赠限额：调用方用 Redis 滑动窗口，DAO 负责落库与确认/退回
 */
@Injectable()
export class GiftDao {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? this.prisma;
  }

  // ---------- gift_activity ----------

  createActivity(data: Prisma.gift_activityCreateInput) {
    return this.prisma.gift_activity.create({ data });
  }

  findActivities(status?: number, pageNum = 1, pageSize = 20) {
    return this.prisma.gift_activity.findMany({
      where: status !== undefined ? { status } : {},
      orderBy: { created_at: 'desc' },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    });
  }

  findById(id: bigint | number) {
    return this.prisma.gift_activity.findUnique({ where: { id: id as bigint } });
  }

  /** 审批（双人：approver1 通过后 approver2 大额再批） */
  async approve(tx: Tx | undefined, id: bigint, approverId: bigint, isSecondApproval: boolean) {
    const db = this.db(tx);
    if (isSecondApproval) {
      return db.gift_activity.updateMany({ where: { id, status: 2 }, data: { approver2_id: approverId } });
    }
    return db.gift_activity.updateMany({ where: { id, status: 1 }, data: { approver_id: approverId, status: 2 } });
  }

  /**
   * 预算硬控发放记账（原子：issued_points + points_per_user ≤ 预算）
   * 影响行数=0 → 预算不足，调用方停止活动并告警（FR-8.4）
   */
  async chargeBudget(tx: Tx, activityId: bigint, pointsPerUser: number): Promise<boolean> {
    const db = this.db(tx);
    const act = await db.gift_activity.findUnique({ where: { id: activityId } });
    if (!act) return false;
    const remaining = Number(act.budget_points) - Number(act.issued_points);
    if (remaining < pointsPerUser) return false;
    const updated = await db.gift_activity.updateMany({
      where: { id: activityId, status: 2, issued_points: { lte: Number(act.budget_points) - pointsPerUser } },
      data: { issued_points: { increment: pointsPerUser }, issued_count: { increment: 1 } },
    });
    return updated.count === 1;
  }

  stopActivity(tx: Tx | undefined, id: bigint, reason: 'OVER_BUDGET' | 'MANUAL') {
    return this.db(tx).gift_activity.updateMany({
      where: { id, status: 2 },
      data: { status: reason === 'OVER_BUDGET' ? 4 : 5 },
    });
  }

  /** 分润池保护：冻结执行中活动（FR-9.12） */
  freezeActivitiesByGuard() {
    return this.prisma.gift_activity.updateMany({ where: { status: 2 }, data: { status: 6 } });
  }

  // ---------- gift_record ----------

  /** 创建赠送记录（互赠带 24h 确认截止时间；活动/规则赠送直接待到账） */
  async createRecord(
    tx: Tx | undefined,
    data: {
      giftType: number;
      activityId?: bigint;
      fromUserId?: bigint;
      toUserId: bigint;
      points: number;
      flowNo: string;
      needConfirm: boolean;
    },
  ): Promise<gift_record | null> {
    const db = this.db(tx);
    try {
      return await db.gift_record.create({
        data: {
          gift_type: data.giftType,
          activity_id: data.activityId,
          from_user_id: data.fromUserId,
          to_user_id: data.toUserId,
          points: data.points,
          flow_no: data.flowNo,
          confirm_deadline: data.needConfirm ? new Date(Date.now() + 86400_000) : null,
          status: data.needConfirm ? 1 : 2,
          confirmed_at: data.needConfirm ? null : new Date(),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }

  /** 接收确认（条件更新幂等：status=1 待确认） */
  async confirm(tx: Tx | undefined, recordId: bigint) {
    const updated = await this.db(tx).gift_record.updateMany({
      where: { id: recordId, status: 1 },
      data: { status: 2, confirmed_at: new Date() },
    });
    return updated.count === 1;
  }

  /** 24h 超时退回扫描（FR-8.3） */
  findTimeoutPending(now: Date, limit = 200) {
    return this.prisma.gift_record.findMany({ where: { status: 1, confirm_deadline: { lte: now } }, take: limit });
  }

  /** 退回（条件更新幂等） */
  async refund(tx: Tx | undefined, recordId: bigint) {
    return this.db(tx).gift_record.updateMany({ where: { id: recordId, status: 1 }, data: { status: 3 } });
  }

  /** 风控拦截标记 */
  async block(tx: Tx | undefined, recordId: bigint, reason: string) {
    return this.db(tx).gift_record.updateMany({
      where: { id: recordId, status: 1 },
      data: { status: 4, risk_block_reason: reason },
    });
  }

  findRecords(userId: bigint | number, pageNum = 1, pageSize = 20) {
    return this.prisma.gift_record.findMany({
      where: { OR: [{ to_user_id: userId as bigint }, { from_user_id: userId as bigint }] },
      orderBy: { created_at: 'desc' },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    });
  }
}
