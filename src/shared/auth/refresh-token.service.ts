import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { RedisService } from '../redis/redis.service';
import { BusinessException } from '../errors/business.exception';
import { ErrorCode } from '../errors/error-codes';

/**
 * C 端 refresh token（opaque 随机串，Redis 承载，非 JWT）：
 * - 每用户至多一个生效 refresh（后登录/后刷新覆盖先前的，单会话模型）
 * - 刷新即轮换（旧的标记为已消费，重用检测窗口内保留反查记录）；
 *   已消费的 refresh 被重用 → 判定疑似盗用，作废该用户当前会话，需重新登录
 * 键：
 *   auth:rt:{userId} -> 当前生效 jti，TTL 同 refresh 有效期（默认 30 天）
 *   auth:rtj:{jti}   -> userId（生效中）或 revoked:{userId}（已消费，TTL = 重用检测窗口，默认 600s）
 */
@Injectable()
export class RefreshTokenService {
  private readonly ttlSeconds: number;
  private readonly reuseWindowSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    const days = config.get<number>('jwt.app.refreshDays') ?? 30;
    this.ttlSeconds = days * 86400;
    this.reuseWindowSeconds = config.get<number>('jwt.app.reuseWindowSeconds') ?? 600;
  }

  async issue(userId: string): Promise<string> {
    const jti = crypto.randomBytes(24).toString('hex');
    await this.redis.client.set(`auth:rt:${userId}`, jti, 'EX', this.ttlSeconds);
    await this.redis.client.set(`auth:rtj:${jti}`, userId, 'EX', this.ttlSeconds);
    return jti;
  }

  /** 轮换刷新：校验旧 jti → 签发新 jti；已消费的 jti 被重用 → 作废该用户当前会话 */
  async rotate(refreshToken: string): Promise<{ userId: string; newRefreshToken: string }> {
    const owner = await this.redis.client.get(`auth:rtj:${refreshToken}`);
    if (!owner) throw new BusinessException(ErrorCode.TOKEN_INVALID, HttpStatus.UNAUTHORIZED);

    if (owner.startsWith('revoked:')) {
      // 已轮换作废的 refresh 被重用 → 疑似 token 被盗：作废该用户当前会话
      const userId = owner.slice('revoked:'.length);
      await this.redis.client.del(`auth:rt:${userId}`);
      throw new BusinessException(ErrorCode.TOKEN_INVALID, HttpStatus.UNAUTHORIZED);
    }

    const current = await this.redis.client.get(`auth:rt:${owner}`);
    if (current !== refreshToken) {
      // 防御分支：jti 有效但非当前生效（并发竞争等异常）→ 按重用处理
      await this.redis.client.del(`auth:rt:${owner}`);
      throw new BusinessException(ErrorCode.TOKEN_INVALID, HttpStatus.UNAUTHORIZED);
    }
    // 旧 jti 转入重用检测窗口（短 TTL），窗口内被重用可触发整族作废；然后签发新 jti
    await this.redis.client.set(`auth:rtj:${refreshToken}`, `revoked:${owner}`, 'EX', this.reuseWindowSeconds);
    const newRefreshToken = await this.issue(owner);
    return { userId: owner, newRefreshToken };
  }

  /** 登出：撤销该用户当前生效的 refresh（单会话模型下等同全设备登出） */
  async revoke(refreshToken: string): Promise<void> {
    const userId = await this.redis.client.get(`auth:rtj:${refreshToken}`);
    if (!userId) return;
    await this.redis.client.del(`auth:rtj:${refreshToken}`);
    const current = await this.redis.client.get(`auth:rt:${userId}`);
    if (current === refreshToken) await this.redis.client.del(`auth:rt:${userId}`);
  }
}
