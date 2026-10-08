import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';

/**
 * 后台管理（FR-12.x）：
 * - RBAC（admin_permission / admin_role_permission）
 * - 敏感操作（调账/规则变更/分润池参数）双人复核 + admin_op_log 审计
 * - 对账中心：钱包↔流水、房间占用↔日志、分润池台账三口径
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}
}
