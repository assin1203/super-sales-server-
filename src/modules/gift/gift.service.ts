import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';

/**
 * 积分赠送（FR-8.x）：
 * - 活动赠送：双人审批 + 预算硬控（超预算自动停止告警）
 * - 规则赠送：生日/周年/晋级礼事件触发
 * - 会员互赠：单次 ≤100、单日 ≤5 次（Redis 滑动窗口限流），24h 未确认退回
 */
@Injectable()
export class GiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}
}
