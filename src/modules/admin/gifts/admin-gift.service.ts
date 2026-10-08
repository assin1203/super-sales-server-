import { Injectable } from '@nestjs/common';
import { GiftDao } from '../../../dao/gift.dao';
import { AdminDao } from '../../../dao/admin.dao';

/**
 * 后台·赠送管理（FR-8.1/8.4 双人审批 + 预算硬控）
 * 数据访问全部经共用 DAO 层
 */
@Injectable()
export class AdminGiftService {
  constructor(
    private readonly giftDao: GiftDao,
    private readonly adminDao: AdminDao,
  ) {}

  list(status?: number, pageNum = 1, pageSize = 20) {
    return this.giftDao.findActivities(status, pageNum, pageSize);
  }

  /**
   * 活动审批（双人复核，FR-8.4）
   * 第一人审批后 status 1→2；大额活动第二人复核再确认
   */
  async approve(activityId: bigint, isSecond: boolean, operator: { adminId: bigint; ip?: string }) {
    await this.giftDao.approve(undefined, activityId, operator.adminId, isSecond);
    await this.adminDao.logOp({
      adminId: operator.adminId,
      action: isSecond ? 'gift.approve2' : 'gift.approve',
      targetType: 'gift_activity',
      targetId: activityId,
      confirmFlag: true,
      confirmBy: operator.adminId,
      ip: operator.ip,
    });
  }

  /** 超预算自动停止（Job 扫描预算使用率 ≥100% 调用，FR-8.4） */
  stopOverBudget(activityId: bigint) {
    return this.giftDao.stopActivity(undefined, activityId, 'OVER_BUDGET');
  }
}
