import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

import { PrismaService } from '../shared/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * 运维域 DAO：risk_record / dead_letter / reconcile_diff（FR-12.7 / FR-9.11 / FR-12.6）
 */
@Injectable()
export class OpsDao {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? this.prisma;
  }

  // ---------- risk_record ----------

  createRisk(data: {
    userId: bigint;
    riskType: string;
    evidence?: Prisma.InputJsonValue;
    action: number;
    actionDetail?: string;
  }) {
    return this.prisma.risk_record.create({
      data: {
        user_id: data.userId,
        risk_type: data.riskType,
        evidence: data.evidence,
        action: data.action,
        action_detail: data.actionDetail ?? '',
      },
    });
  }

  findRisks(status?: number, pageNum = 1, pageSize = 30) {
    return this.prisma.risk_record.findMany({
      where: status !== undefined ? { status } : {},
      orderBy: { created_at: 'desc' },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    });
  }

  /** 人工处置（1待审核→2已确认 / 3误报解除） */
  handleRisk(id: bigint, status: number, operatorId: bigint) {
    return this.prisma.risk_record.update({
      where: { id },
      data: { status, operator_id: operatorId, handled_at: new Date() },
    });
  }

  // ---------- dead_letter ----------

  /** 死信落库（结算事件重试耗尽） */
  pushDeadLetter(eventType: string, payload: Prisma.InputJsonValue, idemKey: string, retryCount: number, lastError: string) {
    return this.prisma.dead_letter.create({
      data: { event_type: eventType, payload, idem_key: idemKey, retry_count: retryCount, last_error: lastError.slice(0, 512) },
    });
  }

  /** 待处理死信（人工/自动重放） */
  findDeadLetters(limit = 50) {
    return this.prisma.dead_letter.findMany({ where: { status: 1 }, orderBy: { created_at: 'asc' }, take: limit });
  }

  /** 重放成功标记（幂等：status=1） */
  markReplayed(tx: Tx | undefined, id: bigint) {
    return this.db(tx).dead_letter.updateMany({ where: { id, status: 1 }, data: { status: 2, replayed_at: new Date() } });
  }

  // ---------- reconcile_diff ----------

  createDiff(bizDate: Date, diffType: string, refId: bigint | null, expected: string, actual: string) {
    return this.prisma.reconcile_diff.create({
      data: { biz_date: bizDate, diff_type: diffType, ref_id: refId, expected, actual },
    });
  }

  findDiffs(status?: number, pageNum = 1, pageSize = 30) {
    return this.prisma.reconcile_diff.findMany({
      where: status !== undefined ? { status } : {},
      orderBy: { created_at: 'desc' },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    });
  }

  handleDiff(id: bigint, status: number, handledBy: bigint) {
    return this.prisma.reconcile_diff.update({ where: { id }, data: { status, handled_by: handledBy, handled_at: new Date() } });
  }
}
