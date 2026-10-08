import { Injectable } from '@nestjs/common';
import { UserDao } from '../../../dao/user.dao';

/**
 * 三级会员（FR-2.x）：L0~L3，只升不降。
 * 晋级条件（达标/直推达标数/积分累计）满足即自动晋级，系数上浮。
 * 数据访问全部经 UserDao（DAO 层架构约束）
 */
@Injectable()
export class MemberService {
  constructor(private readonly userDao: UserDao) {}

  /** 晋级条件检查：直推达标人数（条件①②） */
  countQualifiedDirect(userId: bigint | number) {
    return this.userDao.countQualifiedDirect(userId);
  }

  /** 晋级条件检查：累计获得积分（条件③，走钱包累计字段） */
  totalEarned(userId: bigint | number) {
    return this.userDao.totalEarned(userId);
  }

  /** 晋级留痕 + 等级更新（幂等：uk_user_to_trigger） */
  upgrade(userId: bigint | number, toLevel: number, triggerType: string, triggerBizId: string) {
    return this.userDao.createLevelRecord({
      user_id: userId,
      from_level: toLevel - 1,
      to_level: toLevel,
      trigger_type: triggerType,
      trigger_biz_id: triggerBizId,
    });
  }
}
