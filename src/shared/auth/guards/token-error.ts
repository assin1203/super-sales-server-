import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../errors/business.exception';
import { ErrorCode } from '../../errors/error-codes';

/** jsonwebtoken 校验异常 → 业务异常：过期 → 40101；其余（签名/aud/iss/格式）→ 40102 */
export function toTokenException(e: unknown): BusinessException {
  if (e instanceof Error && e.name === 'TokenExpiredError') {
    return new BusinessException(ErrorCode.TOKEN_EXPIRED, HttpStatus.UNAUTHORIZED);
  }
  return new BusinessException(ErrorCode.TOKEN_INVALID, HttpStatus.UNAUTHORIZED);
}
