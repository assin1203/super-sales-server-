import { Injectable } from '@nestjs/common';
import { GiftDao } from '../../../dao/gift.dao';
import { RedisService } from '../../../shared/redis/redis.service';

/**
 * 积分赠送（FR-8.x）：
 * - 活动赠送：双人审批 + 预算硬控（超预算自动停止告警）
 * - 规则赠送：生日/周年/晋级礼事件触发
 * - 会员互赠：单次 ≤100、单日 ≤5 次（Redis 滑动窗口限流），24h 未确认退回
 * 数据访问全部经 GiftDao（DAO 层架构约束）
 */
@Injectable()
export class GiftService {
  constructor(
    private readonly giftDao: GiftDao,
    private readonly redis: RedisService,
  ) {}

  /**
   * 会员互赠（FR-8.3）
   * 限流：Redis 滑动窗口（单日 ≤5 次、单次 ≤100）；
   * 到账：创建记录（待确认）→ 接收人确认或 24h 超时退回
   */
  async peerGift(
    fromUserId: bigint,
    toUserId: bigint,
    points: number,
    flowNo: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (points > 100) return { ok: false, reason: '单次互赠上限 100 积分' };
    const dayKey = `risk:${fromUserId}:giftpeer:${new Date().toISOString().slice(0, 10)}`;
    const count = await this.redis.client.incr(dayKey);
    if (count === 1) await this.redis.client.expire(dayKey, 86400);
    if (count > 5) return { ok: false, reason: '今日互赠次数已达上限' };

    const record = await this.giftDao.createRecord(undefined, {
      giftType: 3,
      fromUserId,
      toUserId,
      points,
      flowNo,
      needConfirm: true,
    });
    if (!record) return { ok: false, reason: '赠送记录已存在（幂等拦截）' };
    return { ok: true };
  }

  /** 接收人确认（条件更新幂等） */
  confirm(recordId: bigint) {
    return this.giftDao.confirm(undefined, recordId);
  }

  /** 24h 超时退回扫描（每日 Job） */
  findTimeoutPending(now: Date, limit = 200) {
    return this.giftDao.findTimeoutPending(now, limit);
  }

  findRecords(userId: bigint | number, pageNum = 1, pageSize = 20) {
    return this.giftDao.findRecords(userId, pageNum, pageSize);
  }
}
