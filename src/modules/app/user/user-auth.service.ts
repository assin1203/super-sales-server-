import { HttpStatus, Injectable } from '@nestjs/common';
import { UserDao } from '../../../dao/user.dao';
import { JwtService, PasswordService, RefreshTokenService } from '../../../shared/auth';
import { BusinessException } from '../../../shared/errors/business.exception';
import { ErrorCode } from '../../../shared/errors/error-codes';

export interface UserLoginResult {
  accessToken: string;
  expiresAt: number; // unix 秒
  refreshToken: string;
  user: {
    id: bigint;
    phone: string;
    nickname: string;
    level: number;
  };
}

/**
 * C 端登录态（FR-1.1）：
 * - 手机号 + 密码（scrypt 恒定时间校验）；password_hash 为空的账号（验证码/微信注册）走其他通道
 * - 双 token：access（JWT，aud=app，无状态，2h）+ refresh（opaque，Redis 30d，轮换刷新）
 */
@Injectable()
export class UserAuthService {
  constructor(
    private readonly userDao: UserDao,
    private readonly password: PasswordService,
    private readonly jwt: JwtService,
    private readonly refreshService: RefreshTokenService,
  ) {}

  async login(phone: string, password: string): Promise<UserLoginResult> {
    const user = await this.userDao.findByPhone(phone);
    // 统一文案防枚举：不区分"账号不存在 / 已冻结 / 密码错误"
    const badCred = new BusinessException(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, '手机号或密码错误');
    if (!user || user.status !== 1) throw badCred;
    if (!user.password_hash) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, '该账号请使用验证码登录');
    }
    if (!(await this.password.verify(password, user.password_hash))) throw badCred;

    const { token, expiresAt } = this.jwt.signUser({ id: user.id });
    const refreshToken = await this.refreshService.issue(String(user.id));
    await this.userDao.update(user.id, { last_login_at: new Date() });

    return {
      accessToken: token,
      expiresAt,
      refreshToken,
      user: { id: user.id, phone: user.phone, nickname: user.nickname, level: user.level },
    };
  }

  /** 刷新轮换：旧 refresh 换新的 access + 新的 refresh（旧 refresh 立即作废） */
  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: number; refreshToken: string }> {
    const { userId, newRefreshToken } = await this.refreshService.rotate(refreshToken);
    const { token, expiresAt } = this.jwt.signUser({ id: BigInt(userId) });
    return { accessToken: token, expiresAt, refreshToken: newRefreshToken };
  }

  /** 登出：撤销 refresh（access token 无状态，自然到期） */
  async logout(refreshToken: string): Promise<{ ok: true }> {
    await this.refreshService.revoke(refreshToken);
    return { ok: true as const };
  }
}
