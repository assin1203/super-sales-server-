import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthCacheService } from '../auth-cache.service';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { BusinessException } from '../../errors/business.exception';
import { ErrorCode } from '../../errors/error-codes';

/**
 * RBAC 权限点守卫（须与 AdminJwtGuard 组合挂载，位于其后）：
 * - 路由未标 @RequirePermission → 放行（仅要求 admin 登录态）
 * - SUPER_ADMIN 直通
 * - 否则校验角色权限码（Redis 缓存 TTL 300s，变更 ≤5min 生效；
 *   权限变更写操作后调 AuthCacheService.evictRolePerm 可立即生效）
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authCache: AuthCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const code = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!code) return true;

    const req = context.switchToHttp().getRequest();
    const admin = req.admin as { role: string } | undefined;
    if (!admin) throw new BusinessException(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
    if (admin.role === 'SUPER_ADMIN') return true;

    const permissions = await this.authCache.permissionCodes(admin.role);
    if (!permissions.includes(code)) {
      throw new BusinessException(ErrorCode.PERMISSION_DENIED, HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
