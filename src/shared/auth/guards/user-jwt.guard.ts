import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '../jwt.service';
import { AuthCacheService } from '../auth-cache.service';
import { BusinessException } from '../../errors/business.exception';
import { ErrorCode } from '../../errors/error-codes';
import { extractBearer } from './bearer';
import { toTokenException } from './token-error';

/**
 * C 端守卫：验签（JWT_APP_SECRET）+ aud + iss + 账号状态。
 * 通过后挂 request.user = { id }。
 */
@Injectable()
export class UserJwtGuard implements CanActivate {
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
      claims = this.jwt.verifyUser(token);
    } catch (e) {
      throw toTokenException(e);
    }

    const id = BigInt(claims.sub);
    if (!(await this.authCache.isUserActive(id))) {
      throw new BusinessException(ErrorCode.ACCOUNT_DISABLED, HttpStatus.UNAUTHORIZED);
    }
    req.user = { id };
    return true;
  }
}
