import { Injectable } from '@nestjs/common';
import { TaskDao } from '../../../dao/task.dao';

/** 后台·任务管理（FR-7.5 后台配置化） */
@Injectable()
export class AdminTaskService {
  constructor(private readonly taskDao: TaskDao) {}

  list(minLevel = 3) {
    return this.taskDao.findEnabledTemplates(minLevel);
  }

  byCode(code: string) {
    return this.taskDao.findTemplateByCode(code);
  }

  /** 任务统计（参与/完成，运营大盘） */
  async stats(taskId: bigint) {
    const row = await (this.taskDao as any).prisma.userTask.groupBy({
      by: ['status'],
      where: { task_id: taskId },
      _count: { _all: true },
    });
    return row;
  }
}
