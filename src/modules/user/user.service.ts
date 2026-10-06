import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';

/**
 * 用户/推荐关系（FR-1.x / FR-6.1）：
 * - 注册时绑定 referrer_id，终身不变
 * - 推荐关系链 ≤3 级计奖，4 级截断
 */
@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 向上取 1~3 级祖先链（用于推荐结算回溯） */
  async getAncestorChain(userId: number, maxDepth = 3): Promise<number[]> {
    const chain: number[] = [];
    let currentId: number = userId;
    for (let depth = 0; depth < maxDepth; depth++) {
      const user = await this.prisma.user.findUnique({
        where: { id: currentId },
        select: { referrer_id: true },
      });
      if (!user?.referrer_id) break;
      chain.push(user.referrer_id);
      currentId = user.referrer_id;
    }
    return chain; // [1级上级, 2级上级, 3级上级]
  }
}
