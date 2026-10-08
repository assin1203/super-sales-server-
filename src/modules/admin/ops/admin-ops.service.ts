import { Injectable } from '@nestjs/common';
import { OpsDao } from '../../../dao/ops.dao';

/**
 * 后台·运维（FR-12.7 风控 / FR-12.6 对账 / FR-9.11 死信）
 * 数据访问全部经共用 DAO 层
 */
@Injectable()
export class AdminOpsService {
  constructor(private readonly opsDao: OpsDao) {}

  // ---------- 风控 ----------

  risks(status?: number, pageNum = 1, pageSize = 30) {
    return this.opsDao.findRisks(status, pageNum, pageSize);
  }

  /** 人工处置（确认处置 / 误报解除，FR-12.7） */
  handleRisk(id: bigint, status: number, operatorId: bigint) {
    return this.opsDao.handleRisk(id, status, operatorId);
  }

  // ---------- 对账 ----------

  diffs(status?: number, pageNum = 1, pageSize = 30) {
    return this.opsDao.findDiffs(status, pageNum, pageSize);
  }

  handleDiff(id: bigint, status: number, handledBy: bigint) {
    return this.opsDao.handleDiff(id, status, handledBy);
  }

  // ---------- 死信 ----------

  deadLetters(limit = 50) {
    return this.opsDao.findDeadLetters(limit);
  }

  markReplayed(id: bigint) {
    return this.opsDao.markReplayed(undefined, id);
  }
}
