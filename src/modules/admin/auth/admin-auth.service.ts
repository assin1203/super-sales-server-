import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { AdminDao } from '../../../dao/admin.dao';

export interface AdminSession {
  adminId: bigint;
  username: string;
  role: string;
  permissions: string[];
}

/**
 * 后台认证（FR-12.8）：
 * - 账号密码登录 → 角色 → 权限编码列表（RBAC）
 * - 生产环境对接 SSO/网关后此 Service 退化为 token 校验
 */
@Injectable()
export class AdminAuthService {
  constructor(private readonly adminDao: AdminDao) {}

  async login(username: string, password: string): Promise<AdminSession> {
    const admin = await this.adminDao.findByUsername(username);
    if (!admin || admin.status !== 1) throw new UnauthorizedException('账号或密码错误');
    // TODO: bcrypt 校验 password_hash
    void password;
    const permissions = await this.adminDao.permissionCodesByRole(admin.role);
    return { adminId: admin.id, username: admin.username, role: admin.role, permissions };
  }

  /** 权限点校验（控制器装饰器使用） */
  requirePermission(session: AdminSession, code: string): boolean {
    return session.role === 'SUPER_ADMIN' || session.permissions.includes(code);
  }

  hashForDemo(s: string) {
    return crypto.createHash('sha256').update(s).digest('hex');
  }
}
