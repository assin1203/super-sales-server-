import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * 任务体系（FR-7.x）：
 * - 新手任务：注册 +30 天到期关闭（BullMQ 延迟 + DB 状态兜底扫描）
 * - 普通任务：日/周/月周期重置；成就任务一次性
 * - 事件驱动判定，幂等；分润池保护触发时任务积分降档 50%
 */
@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService) {}
}
