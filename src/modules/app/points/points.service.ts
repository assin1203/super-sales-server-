import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PointDao } from '../../../dao/point.dao';
import { RedisService } from '../../../shared/redis/redis.service';

type Tx = Prisma.TransactionClient;

/**
 * 积分账户（FR-4.x）：
 * - 余额缓存 bal:{uid} 写后删，MySQL 为真相；资金扣减强制走主库 + 乐观锁，不走缓存
 * - 所有 DB 操作经 PointDao（DAO 层架构约束）
 */
@Injectable()
export class PointsService {
  constructor(
    private readonly pointDao: PointDao,
    private readonly redis: RedisService,
  ) {}

  async getBalance(userId: bigint | number) {
    return this.redis.cacheGetOrLoad(`bal:${userId}`, 300, async () => {
      const wallet = await this.pointDao.findWallet(userId);
      return wallet ? { balance: Number(wallet.balance), frozen: Number(wallet.frozen_balance) } : null;
    });
  }

  /** 资金入账（仅结算链路调用）；写后删余额缓存 */
  async credit(
    tx: Tx,
    userId: bigint | number,
    delta: number,
    flowNo: string,
    flowType: string,
    opts: { bizId?: bigint; bizNo?: string; ruleVersion?: number; expireAt?: Date; frozen?: boolean; remark?: string } = {},
  ) {
    const wallet = await this.pointDao.credit(tx, userId, delta, flowNo, flowType, opts);
    await this.redis.cacheEvict(`bal:${userId}`); // 写后删
    return wallet;
  }

  /** 资金扣减（余额不足返回 null）；写后删余额缓存 */
  async debit(
    tx: Tx,
    userId: bigint | number,
    delta: number,
    flowNo: string,
    flowType: string,
    opts: { bizId?: bigint; bizNo?: string; remark?: string } = {},
  ) {
    const flow = await this.pointDao.debit(tx, userId, delta, flowNo, flowType, opts);
    await this.redis.cacheEvict(`bal:${userId}`);
    return flow;
  }

  /** 冻结转可用（安装积分达标转可用，FR-9.2） */
  async unfreeze(tx: Tx, userId: bigint | number, amount: number, flowNo: string, remark?: string) {
    const ok = await this.pointDao.unfreeze(tx, userId, amount, flowNo, remark);
    await this.redis.cacheEvict(`bal:${userId}`);
    return ok;
  }

  findFlows(userId: bigint | number, pageNum = 1, pageSize = 20, flowType?: string) {
    return this.pointDao.findFlows(userId, pageNum, pageSize, flowType);
  }
}
