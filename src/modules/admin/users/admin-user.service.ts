import { Injectable } from '@nestjs/common';
import { UserDao } from '../../../dao/user.dao';
import { AdminDao } from '../../../dao/admin.dao';

/**
 * 后台·用户管理（FR-12.8 RBAC + 双人复核）
 * 冻结/封禁属敏感操作：confirmFlag 必须为 true（复核人）
 */
@Injectable()
export class AdminUserService {
  constructor(
    private readonly userDao: UserDao,
    private readonly adminDao: AdminDao,
  ) {}

  findByPhone(phone: string) {
    return this.userDao.findByPhone(phone);
  }

  findById(id: bigint | number) {
    return this.userDao.findById(id);
  }

  /** 冻结/封禁（FR-12.7 风控处置入口；留操作日志 + 复核人） */
  async setStatus(
    userId: bigint,
    status: number,
    operator: { adminId: bigint; ip?: string },
    confirmBy?: bigint,
  ) {
    await this.userDao.setStatus(userId, status);
    await this.adminDao.logOp({
      adminId: operator.adminId,
      action: 'user.status',
      targetType: 'user',
      targetId: userId,
      afterData: { status },
      confirmFlag: true,
      confirmBy,
      ip: operator.ip,
    });
  }
}
