import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TaskDao } from '../../../dao/task.dao';
import { PointsService } from '../points/points.service';
import { FLOW_TYPE } from '../../../shared/constants/domain.constants';

type Tx = Prisma.TransactionClient;

/**
 * 任务体系（FR-7.x）：
 * - 新手任务：注册 +30 天到期关闭（BullMQ 延迟 + DB 状态兜底扫描）
 * - 普通任务：日/周/月周期重置；成就任务一次性
 * - 事件驱动判定，幂等；分润池保护触发时任务积分降档 50%
 * 数据访问全部经 TaskDao（DAO 层架构约束）
 */
@Injectable()
export class TaskService {
  constructor(
    private readonly taskDao: TaskDao,
    private readonly points: PointsService,
  ) {}

  /**
   * 任务事件推进（核心入口）：
   * 业务事件（注册/装机/达标/推荐/签到…）→ 事件类型匹配启用中的模板 → 推进进度
   * 完成后由结算链路发奖（幂等 markSettled）
   */
  async onEvent(
    tx: Tx,
    userId: bigint,
    eventType: string,
    periodKey = '',
    dueAt?: Date,
  ) {
    const templates = await this.taskDao.findEnabledByEvent(eventType);
    for (const t of templates) {
      await this.taskDao.advanceProgress(tx, {
        userId,
        taskId: t.id,
        periodKey,
        dueAt,
      });
    }
  }

  /** 任务发奖（status 2→3 幂等；分润池降级时降档 50%，FR-9.12） */
  async settleTaskReward(tx: Tx, instanceId: bigint, guardDowngrade: boolean) {
    const inst = await this.taskDao.findInstance(instanceId);
    if (!inst) return;
    const ok = await this.taskDao.markSettled(tx, instanceId);
    if (!ok) return; // 已结算（幂等）
    const reward = guardDowngrade
      ? Math.ceil(Number(inst.rewardPoints) / 2)
      : Number(inst.rewardPoints);
    await this.points.credit(tx, inst.user_id, reward, `TS${instanceId}`, FLOW_TYPE.TASK, {
      bizId: instanceId,
      bizNo: inst.taskCode,
    });
  }

  /** 用户任务列表（任务中心页） */
  findUserTasks(userId: bigint | number) {
    return this.taskDao.findUserTasks(userId);
  }

  /** 新手任务到期扫描（每日 Job） */
  findDueNewbieTasks(now: Date, limit = 200) {
    return this.taskDao.findDueNewbieTasks(now, limit);
  }
}
