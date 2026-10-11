import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AdminDao } from '../../../dao/admin.dao';
import { PasswordService, JwtService } from '../../../shared/auth';
import { BusinessException } from '../../../shared/errors/business.exception';
import { ErrorCode } from '../../../shared/errors/error-codes';

export interface AdminLoginResult {
  accessToken: string;
  expiresAt: number; // unix 秒
  admin: {
    id: bigint;
    username: string;
    role: string;
    permissions: string[]; // 权限编码（供前端渲染菜单；请求级校验走 PermissionsGuard）
  };
}

/**
 * 后台认证（FR-12.8）：
 * - 账号密码登录（scrypt 恒定时间校验）→ 签发 admin 线 JWT（aud=admin，JWT_ADMIN_SECRET）
 * - 权限码不嵌入 token：请求路径上由 PermissionsGuard 按 role 查 Redis 缓存校验，
 *   权限变更 ≤5min 生效（写操作后 evictRolePerm 可立即生效）
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly adminDao: AdminDao,
    private readonly password: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  async login(username: string, password: string): Promise<AdminLoginResult> {
    const admin = await this.adminDao.findByUsername(username);
    // 统一文案：不区分"账号不存在 / 已禁用 / 密码错误"（防枚举）
    const badCred = new BusinessException(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, '账号或密码错误');
    if (!admin || admin.status !== 1) throw badCred;
    if (!admin.password_hash || !(await this.password.verify(password, admin.password_hash))) throw badCred;

    const permissions = await this.adminDao.permissionCodesByRole(admin.role);
    const { token, expiresAt } = this.jwt.signAdmin({ id: admin.id, username: admin.username, role: admin.role });
    // last_login 为尽力而为：瞬时 UPDATE 失败（锁超时/死锁）不应把已验证的登录变成 500
    try {
      await this.adminDao.touchLastLogin(admin.id);
    } catch (err) {
      this.logger.warn(`last_login_at 更新失败（admin_id=${admin.id}）：${err instanceof Error ? err.message : String(err)}`);
    }

    return { accessToken: token, expiresAt, admin: { id: admin.id, username: admin.username, role: admin.role, permissions } };
  }
}
