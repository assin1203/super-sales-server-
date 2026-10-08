import { Injectable } from '@nestjs/common';
import { UserDao } from '../../../dao/user.dao';

/**
 * 用户/推荐关系（FR-1.x / FR-6.1）：
 * - 注册时绑定 referrer_id，终身不变
 * - 推荐关系链 ≤3 级计奖，4 级截断
 * 数据访问全部经 UserDao（DAO 层架构约束）
 */
@Injectable()
export class UserService {
  constructor(private readonly userDao: UserDao) {}

  /** 向上取 1~3 级祖先链（用于推荐结算回溯） */
  getAncestorChain(userId: bigint | number, maxDepth = 3) {
    return this.userDao.getAncestorChain(userId, maxDepth);
  }
}
