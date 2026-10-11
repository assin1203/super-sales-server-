import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '../jwt.service';
import { AuthCacheService } from '../auth-cache.service';
import { BusinessException } from '../../errors/business.exception';
import { ErrorCode } from '../../errors/error-codes';
import { extractBearer } from './bearer';
import { toTokenException } from './token-error';

/**
 * B 端后台守卫：验签（JWT_ADMIN_SECRET）+ aud + iss + 账号状态。
 * 通过后挂 request.admin = { id, username, role }；
 * RBAC 权限点校验由 PermissionsGuard 负责（可组合挂载）。
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly authCache: AuthCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = extractBearer(req);
    if (!token) throw new BusinessException(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);

    let claims;
    try {
      claims = this.jwt.verifyAdmin(token);
    } catch (e) {
      throw toTokenException(e);
    }

    const id = BigInt(claims.sub);
    if (!(await this.authCache.isAdminActive(id))) {
      throw new BusinessException(ErrorCode.ACCOUNT_DISABLED, HttpStatus.UNAUTHORIZED);
    }
    req.admin = { id, username: claims.username, role: claims.role };
    return true;
  }
}
