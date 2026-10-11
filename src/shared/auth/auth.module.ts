import { Global, Module } from '@nestjs/common';
import { JwtService } from './jwt.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthCacheService } from './auth-cache.service';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { UserJwtGuard } from './guards/user-jwt.guard';
import { InternalJwtGuard } from './guards/internal-jwt.guard';
import { PermissionsGuard } from './guards/permissions.guard';

/**
 * 全局认证模块（@Global：业务模块直接注入 guard/服务，无需 import）：
 * - 三线 JWT 签发/校验（admin / app / internal，密钥隔离）
 * - scrypt 密码服务 / C 端 refresh token（Redis）/ 鉴权状态缓存
 * - Guards + RBAC 装饰器（RequirePermission / CurrentUser）
 * 依赖全局 DaoModule（UserDao/AdminDao）与 RedisModule。
 */
@Global()
@Module({
  providers: [JwtService, PasswordService, RefreshTokenService, AuthCacheService, AdminJwtGuard, UserJwtGuard, InternalJwtGuard, PermissionsGuard],
  exports: [JwtService, PasswordService, RefreshTokenService, AuthCacheService, AdminJwtGuard, UserJwtGuard, InternalJwtGuard, PermissionsGuard],
})
export class AuthModule {}
