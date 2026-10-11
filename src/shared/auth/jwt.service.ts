import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService as NestJwtService } from '@nestjs/jwt';

export interface AdminClaims {
  sub: string; // admin_user.id（String：Prisma BigInt 不能直接进 JWT）
  username: string;
  role: string;
  typ: 'admin';
  aud: 'admin';
}

export interface UserClaims {
  sub: string;
  typ: 'user';
  aud: 'app';
}

export interface InternalClaims {
  sub: string; // clientId
  typ: 'internal';
  aud: 'internal';
}

export interface SignedToken {
  token: string;
  expiresAt: number; // unix 秒
}

type Line = 'admin' | 'app' | 'internal';

const AUD: Record<Line, string> = { admin: 'admin', app: 'app', internal: 'internal' };

/**
 * JWT 三线签发/校验（密钥完全隔离，见 env.config jwt.*）：
 * - admin：JWT_ADMIN_SECRET，aud=admin（后台 B 端）
 * - app：JWT_APP_SECRET，aud=app（C 端）
 * - internal：JWT_INTERNAL_SECRET，aud=internal（内部 Job，client secret 换发）
 *
 * verify 统一强制 aud + iss：跨线 token（如 C 端 token 打后台接口）
 * 直接抛 JsonWebTokenError，由 guard 映射为 40102。
 */
@Injectable()
export class JwtService {
  private readonly nest = new NestJwtService();
  private readonly cfg: {
    iss: string;
    admin: { secret: string; expires: string };
    app: { secret: string; expires: string };
    internal: { secret: string; expires: string };
  };

  constructor(config: ConfigService) {
    this.cfg = {
      iss: config.get<string>('jwt.iss') ?? 'kqw-server',
      admin: {
        secret: config.get<string>('jwt.admin.secret') ?? 'dev-admin-secret',
        expires: config.get<string>('jwt.admin.accessExpires') ?? '2h',
      },
      app: {
        secret: config.get<string>('jwt.app.secret') ?? 'dev-app-secret',
        expires: config.get<string>('jwt.app.accessExpires') ?? '2h',
      },
      internal: {
        secret: config.get<string>('jwt.internal.secret') ?? 'dev-internal-secret',
        expires: config.get<string>('jwt.internal.accessExpires') ?? '15m',
      },
    };
  }

  signAdmin(payload: { id: bigint | number; username: string; role: string }): SignedToken {
    return this.sign('admin', { sub: String(payload.id), username: payload.username, role: payload.role, typ: 'admin' });
  }

  signUser(payload: { id: bigint | number }): SignedToken {
    return this.sign('app', { sub: String(payload.id), typ: 'user' });
  }

  signInternal(clientId: string): SignedToken {
    return this.sign('internal', { sub: clientId, typ: 'internal' });
  }

  verifyAdmin(token: string): AdminClaims {
    return this.nest.verify(token, { secret: this.cfg.admin.secret, audience: 'admin', issuer: this.cfg.iss }) as unknown as AdminClaims;
  }

  verifyUser(token: string): UserClaims {
    return this.nest.verify(token, { secret: this.cfg.app.secret, audience: 'app', issuer: this.cfg.iss }) as unknown as UserClaims;
  }

  verifyInternal(token: string): InternalClaims {
    return this.nest.verify(token, {
      secret: this.cfg.internal.secret,
      audience: 'internal',
      issuer: this.cfg.iss,
    }) as unknown as InternalClaims;
  }

  private sign(line: Line, payload: Record<string, unknown>): SignedToken {
    const { secret, expires } = this.cfg[line];
    const token = this.nest.sign({ ...payload, aud: AUD[line] }, { secret, expiresIn: expires, issuer: this.cfg.iss });
    const decoded = this.nest.decode(token) as { exp?: number } | null;
    return { token, expiresAt: decoded?.exp ?? 0 };
  }
}
