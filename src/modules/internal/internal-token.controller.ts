import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { JwtService } from '../../shared/auth';
import { BusinessException } from '../../shared/errors/business.exception';
import { ErrorCode } from '../../shared/errors/error-codes';

/**
 * 内部凭证换发端点（token exchange）：
 * - 调用方（如 T+1 收单流水导入 Job）提交 clientId + clientSecret（env INTERNAL_CLIENTS 配置）
 * - 换取 internal token（aud=internal，JWT_INTERNAL_SECRET，TTL 15min），
 *   该 token 仅能通过 InternalJwtGuard 受保护的路由（如 /settlement/*）
 * - 安全设计：
 *   - secret 恒定时间比较；泄漏处置 = 更换该 client 的 secret（旧 token 15min 自然过期）
 *   - 此端点不走用户/后台 token，aud 隔离保证两边 token 都进不来
 *   - 生产环境建议 ingress/网关层再叠加内网来源限制
 */
@Controller('internal')
export class InternalTokenController {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  @Post('token')
  @HttpCode(200)
  issue(@Body() body: { clientId: string; clientSecret: string }) {
    const bad = new BusinessException(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
    const clients = this.config.get<Record<string, string>>('jwt.internal.clients') ?? {};
    const expected = body.clientId ? clients[body.clientId] : undefined;
    if (!expected || !body.clientSecret) throw bad;
    const a = Buffer.from(expected);
    const b = Buffer.from(body.clientSecret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw bad;

    const { token, expiresAt } = this.jwt.signInternal(body.clientId);
    return { accessToken: token, expiresAt };
  }
}
