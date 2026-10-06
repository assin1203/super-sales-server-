import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';

/**
 * 积分账户（FR-4.x）：
 * - point_wallet 乐观锁并发；point_flow 只增不改、flow_no 幂等
 * - 余额缓存 bal:{uid} 写后删，MySQL 为真相；资金扣减强制走主库 + 乐观锁，不走缓存
 */
@Injectable()
export class PointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getBalance(userId: number) {
    return this.redis.cacheGetOrLoad(`bal:${userId}`, 300, async () => {
      const wallet = await this.prisma.point_wallet.findUnique({
        where: { user_id: userId },
      });
      return wallet ? { balance: wallet.balance, frozen: wallet.frozen_balance } : null;
    });
  }

  /** 资金写路径入口（仅 SettlementService 调用）；tx 为 Prisma 事务客户端 */
  async credit(tx: any, userId: number, delta: number, flowNo: string, flowType: string, bizId: string) {
    const wallet = await tx.point_wallet.update({
      where: { user_id: userId },
      data: {
        balance: { increment: delta },
        total_earned: { increment: Math.max(delta, 0) },
        version: { increment: 1 },
      },
    });
    await tx.point_flow.create({
      data: { flow_no: flowNo, user_id: userId, delta, flow_type: flowType, biz_id: bizId, balance_after: wallet.balance },
    });
    await this.redis.cacheEvict(`bal:${userId}`); // 写后删
    return wallet;
  }
}
