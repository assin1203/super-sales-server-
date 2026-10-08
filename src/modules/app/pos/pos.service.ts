import { Injectable } from '@nestjs/common';
import { PosDao } from '../../../dao/pos.dao';

/**
 * POS 装机/达标监控（FR-3.x）：
 * - 25 天内刷够 1000 元 = 达标（流水由收单通道 T+1 导入）
 * - 达标 → 达标入队四元组结算（走 SettlementService，唯一触发点）
 * 数据访问全部经 PosDao（DAO 层架构约束）
 */
@Injectable()
export class PosService {
  constructor(private readonly posDao: PosDao) {}

  /**
   * T+1 流水导入后累计判断达标（FR-3.3）
   * 达标判定成功（条件更新获得判定权）→ 由调用方 publish evt:pos.qualified
   */
  async checkQualified(sn: string, reachAmount = 1000): Promise<boolean> {
    const machine = await this.posDao.findBySn(sn);
    if (!machine || machine.qualified_at || machine.fake_flag === 1 || machine.machine_status !== 1) return false;
    if (Number(machine.cumulative_flow) < reachAmount) return false;
    // 判定权由 PosDao.markQualified 条件更新保证（qualified_at IS NULL → 仅一次事务成功）
    // 实际调用点在结算事务内：posDao.markQualified(tx, machine.id, flow)
    return true;
  }

  /** 名下机器是否存在"未退机 + 近 N 天有真实交易"（再入队运营校验，FR-9.9） */
  hasActiveMachine(userId: bigint | number, windowDays = 30) {
    return this.posDao.hasActiveMachine(userId, windowDays);
  }

  findMachinesByUser(userId: bigint | number) {
    return this.posDao.findByUser(userId);
  }
}
