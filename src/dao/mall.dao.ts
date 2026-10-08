import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * 商城域 DAO：product / mall_order / merchant（FR-5.x 纯积分核销）
 * 防超卖：条件更新 WHERE stock >= ?
 * 防超兑：积分扣减走 PointDao.debit（乐观锁）
 */
@Injectable()
export class MallDao {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? this.prisma;
  }

  // ---------- product ----------

  /** 商品列表（按等级池过滤：min_level <= 用户等级，FR-5.2） */
  findProducts(userLevel: number, pageNum = 1, pageSize = 20) {
    return Promise.all([
      this.prisma.product.findMany({
        where: { status: 1, min_level: { lte: userLevel } },
        orderBy: { sort: 'asc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where: { status: 1, min_level: { lte: userLevel } } }),
    ]);
  }

  findById(id: bigint | number) {
    return this.prisma.product.findUnique({ where: { id: id as bigint } });
  }

  /** 上架成本校验（FR-5.1：cost ≤ price × 成本系数，超限需审批标记） */
  static checkCostLimit(pricePoints: number, costAmount: number, costFactor: number): boolean {
    return costAmount <= pricePoints * costFactor;
  }

  /** 扣库存（防超卖条件更新；影响行数=0 即库存不足） */
  async decStock(tx: Tx, productId: bigint, quantity: number): Promise<boolean> {
    const updated = await this.db(tx).product.updateMany({
      where: { id: productId, stock: { gte: quantity } },
      data: { stock: { decrement: quantity } },
    });
    return updated.count === 1;
  }

  /** 回补库存（取消/退货） */
  async incStock(tx: Tx, productId: bigint, quantity: number) {
    return this.db(tx).product.update({ where: { id: productId }, data: { stock: { increment: quantity } } });
  }

  // ---------- mall_order ----------

  createOrder(tx: Tx, data: Prisma.mall_orderCreateInput) {
    return this.db(tx).mall_order.create({ data });
  }

  findByOrderNo(orderNo: string) {
    return this.prisma.mall_order.findUnique({ where: { order_no: orderNo } });
  }

  findByUser(userId: bigint | number, pageNum = 1, pageSize = 20) {
    return this.prisma.mall_order.findMany({
      where: { user_id: userId as bigint },
      orderBy: { created_at: 'desc' },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    });
  }

  /** 订单状态流转（条件更新幂等：仅 fromStatus 可流转） */
  async transitionStatus(tx: Tx, orderId: bigint, fromStatus: number, data: Prisma.mall_orderUpdateInput) {
    return this.db(tx).mall_order.updateMany({ where: { id: orderId, status: fromStatus }, data });
  }

  /** 履约成本回传扫描（status=已完成 且 未回传，FR-5.9） */
  findUnreportedOrders(limit = 200) {
    return this.prisma.mall_order.findMany({ where: { status: 4, pool_reported: 0 }, take: limit });
  }

  /** 回传标记（幂等） */
  async markPoolReported(tx: Tx, orderId: bigint) {
    const updated = await this.db(tx).mall_order.updateMany({ where: { id: orderId, pool_reported: 0 }, data: { pool_reported: 1 } });
    return updated.count === 1;
  }

  /** 用户当日兑换积分上限校验（FR-5.7，走流水聚合） */
  async todayConsume(userId: bigint | number): Promise<number> {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const row = await this.prisma.point_flow.aggregate({
      where: { user_id: userId as bigint, flow_type: 'MALL_CONSUME', created_at: { gte: since } },
      _sum: { delta: true },
    });
    return Math.abs(Number(row._sum.delta ?? 0));
  }

  // ---------- merchant ----------

  findSystemMerchant() {
    return this.prisma.merchant.findFirst({ where: { status: 1 } });
  }
}
