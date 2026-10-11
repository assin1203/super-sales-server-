import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { UserDao } from '../../dao/user.dao';
import { AdminDao } from '../../dao/admin.dao';

/**
 * 鉴权状态缓存（Redis 短 TTL，MySQL 为真相）：
 * - 账号状态：guard 每请求校验，TTL 60s —— 冻结/禁用 ≤60s 生效
 * - 角色权限码：TTL 300s —— 权限变更 ≤5min 生效
 * - 关键写操作（冻结、角色/权限变更）后调用 evict* 立即失效
 */
@Injectable()
export class AuthCacheService {
  private static readonly USER_TTL = 60;
  private static readonly PERM_TTL = 300;

  constructor(
    private readonly redis: RedisService,
    private readonly userDao: UserDao,
    private readonly adminDao: AdminDao,
  ) {}

  async isUserActive(userId: bigint): Promise<boolean> {
    const active = await this.redis.cacheGetOrLoad<boolean>(`auth:u:${userId}`, AuthCacheService.USER_TTL, async () => {
      const u = await this.userDao.findById(userId);
      return u ? u.status === 1 : false;
    });
    return active === true;
  }

  async isAdminActive(adminId: bigint): Promise<boolean> {
    const active = await this.redis.cacheGetOrLoad<boolean>(`auth:a:${adminId}`, AuthCacheService.USER_TTL, async () => {
      const a = await this.adminDao.findById(adminId);
      return a ? a.status === 1 : false;
    });
    return active === true;
  }

  async permissionCodes(role: string): Promise<string[]> {
    const codes = await this.redis.cacheGetOrLoad<string[]>(`auth:perm:${role}`, AuthCacheService.PERM_TTL, () =>
      this.adminDao.permissionCodesByRole(role),
    );
    return codes ?? [];
  }

  evictUser(id: bigint | number): Promise<void> {
    return this.redis.cacheEvict(`auth:u:${id}`);
  }

  evictAdmin(id: bigint | number): Promise<void> {
    return this.redis.cacheEvict(`auth:a:${id}`);
  }

  evictRolePerm(role: string): Promise<void> {
    return this.redis.cacheEvict(`auth:perm:${role}`);
  }
}
