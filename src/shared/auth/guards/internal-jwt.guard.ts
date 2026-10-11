import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '../jwt.service';
import { BusinessException } from '../../errors/business.exception';
import { ErrorCode } from '../../errors/error-codes';
import { extractBearer } from './bearer';
import { toTokenException } from './token-error';

/**
 * 内部调用守卫：仅接受 /internal/token 换发的 internal token（JWT_INTERNAL_SECRET，aud=internal，TTL 15min）。
 * 通过后挂 request.internal = { clientId }。
 * 与用户/后台 token 完全隔离：aud 不匹配直接 40102。
 */
@Injectable()
export class InternalJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = extractBearer(req);
    if (!token) throw new BusinessException(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);

    let claims;
    try {
      claims = this.jwt.verifyInternal(token);
    } catch (e) {
      throw toTokenException(e);
    }
    req.internal = { clientId: claims.sub };
    return true;
  }
}
