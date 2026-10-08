import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * 任务域 DAO：task_template / user_task（FR-7.x 事件驱动判定 + 幂等）
 * 幂等核心：uk_user_task_period 唯一键 + UPDATE WHERE status 条件更新
 * 注：db pull 的复合唯一输入名为 uk_user_task_period
 */
@Injectable()
export class TaskDao {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? this.prisma;
  }

  // ---------- task_template ----------

  findEnabledTemplates(minLevel = 0) {
    return this.prisma.task_template.findMany({ where: { status: 1, min_level: { lte: minLevel } }, orderBy: { sort: 'asc' } });
  }

  findTemplateByCode(code: string) {
    return this.prisma.task_template.findUnique({ where: { code } });
  }

  /** 按事件类型匹配启用中的模板（任务事件推进入口） */
  findEnabledByEvent(eventType: string) {
    return this.prisma.task_template.findMany({ where: { status: 1, event_type: eventType }, orderBy: { sort: 'asc' } });
  }

  /** 任务实例（含模板字段，用于发奖） */
  async findInstance(instanceId: bigint) {
    const inst = await this.prisma.user_task.findUnique({ where: { id: instanceId } });
    if (!inst) return null;
    const tpl = await this.prisma.task_template.findUnique({ where: { id: inst.task_id } });
    return {
      ...inst,
      taskCode: tpl?.code ?? '',
      rewardPoints: tpl?.reward_points ?? 0,
    };
  }

  // ---------- user_task ----------

  /**
   * 事件进度推进（核心幂等点）：
   * 1. upsert 实例（uk_user_task_period 保证同周期唯一）
   * 2. 条件更新 progress += 1 且 status=1（仅进行中可推进）
   * 返回本次推进后的实例；已达阈值则 status→2（待结算）
   */
  async advanceProgress(
    tx: Tx,
    data: { userId: bigint; taskId: bigint; periodKey?: string; dueAt?: Date },
  ) {
    const db = this.db(tx);
    const existing = await db.user_task.findUnique({
      where: { user_id_task_id_period_key: { user_id: data.userId, task_id: data.taskId, period_key: data.periodKey ?? '' } },
    });
    if (!existing) {
      const inst = await db.user_task.create({
        data: { user_id: data.userId, task_id: data.taskId, period_key: data.periodKey ?? '', due_at: data.dueAt, progress: 1 },
      });
      return this.checkCompletion(tx, inst.id);
    }
    if (existing.status !== 1) return existing; // 已完成/已过期不再计入
    await db.user_task.update({ where: { id: existing.id }, data: { progress: { increment: 1 } } });
    return this.checkCompletion(tx, existing.id);
  }

  /** 进度达阈值 → 置待结算（条件更新幂等：status=1） */
  private async checkCompletion(tx: Tx, instanceId: bigint) {
    const db = this.db(tx);
    const inst = await db.user_task.findUniqueOrThrow({ where: { id: instanceId } });
    const template = await db.task_template.findUniqueOrThrow({ where: { id: inst.task_id } });
    if (inst.status === 1 && inst.progress >= template.threshold) {
      const updated = await db.user_task.updateMany({
        where: { id: instanceId, status: 1 },
        data: { status: 2, completed_at: new Date() },
      });
      if (updated.count === 1) {
        return db.user_task.findUniqueOrThrow({ where: { id: instanceId } });
      }
    }
    return inst;
  }

  /** 结算发奖幂等（status 2→3，条件更新影响行数=1 才发奖） */
  async markSettled(tx: Tx, instanceId: bigint) {
    const updated = await this.db(tx).user_task.updateMany({ where: { id: instanceId, status: 2 }, data: { status: 3, settled_at: new Date() } });
    return updated.count === 1;
  }

  /** 新手任务到期扫描（注册+30 天，FR-7.2） */
  findDueNewbieTasks(now: Date, limit = 200) {
    return this.prisma.user_task.findMany({ where: { status: 1, due_at: { lte: now } }, take: limit });
  }

  /** 到期关闭（条件更新幂等） */
  async expireTask(tx: Tx, instanceId: bigint) {
    return this.db(tx).user_task.updateMany({ where: { id: instanceId, status: 1 }, data: { status: 4 } });
  }

  /** 用户任务列表（任务中心页；db pull 无关联字段，模板单独查询装配） */
  async findUserTasks(userId: bigint | number) {
    const instances = await this.prisma.user_task.findMany({
      where: { user_id: userId as bigint },
      orderBy: { created_at: 'desc' },
    });
    const taskIds = [...new Set(instances.map((i) => i.task_id))];
    const templates = await this.prisma.task_template.findMany({ where: { id: { in: taskIds } } });
    const tplMap = new Map(templates.map((t) => [t.id, t]));
    return instances.map((i) => ({ ...i, task_template: tplMap.get(i.task_id) ?? null }));
  }

  // ---------- 运营统计（管理后台） ----------

  /** 任务实例按状态分组统计（运营大盘） */
  statsByStatus(taskId: bigint) {
    return this.prisma.user_task.groupBy({ by: ['status'], where: { task_id: taskId }, _count: { _all: true } });
  }
}
