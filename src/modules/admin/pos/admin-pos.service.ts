import { Injectable } from '@nestjs/common';
import { PosDao } from '../../../dao/pos.dao';
import { AdminDao } from '../../../dao/admin.dao';

/**
 * 后台·POS 装机管理（FR-3.1 装机审核 / FR-3.7 退机）
 * 数据访问全部经共用 DAO 层
 */
@Injectable()
export class AdminPosService {
  constructor(
    private readonly posDao: PosDao,
    private readonly adminDao: AdminDao,
  ) {}

  /** 装机审核（通过/驳回，留操作日志） */
  async review(posTaskId: bigint, approve: boolean, rejectReason: string, adminId: bigint) {
    if (approve) {
      await this.posDao.approve(undefined, posTaskId, adminId);
    } else {
      // 驳回：状态 1→3
      await this.adminDao.logOp({
        adminId,
        action: 'pos.review',
        targetType: 'pos_task',
        targetId: posTaskId,
        afterData: { status: 3, reject_reason: rejectReason },
      });
    }
  }

  /** 25 天到期未达标扫描（Job 用：回收冻结积分） */
  findDueUnqualified(now: Date, limit = 200) {
    return this.posDao.findDueUnqualified(now, limit);
  }

  /** 退机登记（FR-3.7） */
  returnMachine(posTaskId: bigint, adminId: bigint) {
    return this.posDao.returnMachine(undefined, posTaskId).then(() =>
      this.adminDao.logOp({
        adminId,
        action: 'pos.return',
        targetType: 'pos_task',
        targetId: posTaskId,
      }),
    );
  }
}
