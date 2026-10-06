import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * 积分商城（FR-5.x，纯积分定价）：
 * - 兑换：积分冻结 → 扣减 + 库存扣减同事务；超卖保护 WHERE stock >= ?
 * - 上架校验：履约成本 ≤ 积分价 × 0.3（成本系数）
 * - 核销成本回传分润池（pool 模块）
 */
@Injectable()
export class MallService {
  constructor(private readonly prisma: PrismaService) {}

  async exchange(userId: number, productId: number): Promise<void> {
    // TODO: 事务：冻结积分 → 扣库存(条件更新) → 建 mall_order(快照价) → 流水
    void userId;
    void productId;
  }
}
