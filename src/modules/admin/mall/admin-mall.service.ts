import { Injectable } from '@nestjs/common';
import { MallDao } from '../../../dao/mall.dao';

/**
 * 后台·商城管理（FR-5.1 上架成本校验 / FR-5.8 库存预警）
 * 数据访问全部经共用 DAO 层
 */
@Injectable()
export class AdminMallService {
  constructor(private readonly mallDao: MallDao) {}

  findProducts(pageNum = 1, pageSize = 20) {
    return this.mallDao.findProducts(3, pageNum, pageSize);
  }

  findById(id: bigint | number) {
    return this.mallDao.findById(id);
  }

  /** 上架成本校验（cost ≤ price × 0.3，超限标记需审批，FR-5.1） */
  checkCostLimit(pricePoints: number, costAmount: number, costFactor = 0.3): boolean {
    return MallDao.checkCostLimit(pricePoints, costAmount, costFactor);
  }
}
