import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

/**
 * 后台域 DAO：admin_user / admin_role_permission / admin_permission /
 *             sys_config / admin_op_log（FR-12.x RBAC + 审计）
 * 注：db pull 无关联字段，角色权限装配分步查询
 */
@Injectable()
export class AdminDao {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- admin_user ----------

  findByUsername(username: string) {
    return this.prisma.admin_user.findUnique({ where: { username } });
  }

  findById(id: bigint | number) {
    return this.prisma.admin_user.findUnique({ where: { id: id as bigint } });
  }

  // ---------- permission ----------

  /** 角色权限编码列表（登录时装配；分步查询替代 include） */
  async permissionCodesByRole(role: string): Promise<string[]> {
    const rows = await this.prisma.admin_role_permission.findMany({ where: { role } });
    const ids = rows.map((r) => r.permission_id);
    if (ids.length === 0) return [];
    const perms = await this.prisma.admin_permission.findMany({ where: { id: { in: ids } } });
    return perms.map((p) => p.code);
  }

  // ---------- sys_config ----------

  async getConfig(key: string): Promise<string | null> {
    const row = await this.prisma.sys_config.findUnique({ where: { config_key: key } });
    return row?.config_value ?? null;
  }

  async setConfig(key: string, value: string, updatedBy?: bigint) {
    return this.prisma.sys_config.upsert({
      where: { config_key: key },
      create: { config_key: key, config_value: value, updated_by: updatedBy },
      update: { config_value: value, updated_by: updatedBy },
    });
  }

  // ---------- admin_op_log（只增；敏感操作双人复核） ----------

  logOp(data: {
    adminId: bigint;
    action: string;
    targetType?: string;
    targetId?: bigint;
    beforeData?: Prisma.InputJsonValue;
    afterData?: Prisma.InputJsonValue;
    confirmFlag?: boolean;
    confirmBy?: bigint;
    ip?: string;
  }) {
    return this.prisma.admin_op_log.create({
      data: {
        admin_id: data.adminId,
        action: data.action,
        target_type: data.targetType ?? '',
        target_id: data.targetId,
        before_data: data.beforeData,
        after_data: data.afterData,
        confirm_flag: data.confirmFlag ? 1 : 0,
        confirm_by: data.confirmBy,
        ip: data.ip ?? '',
      },
    });
  }

  findOpLogs(adminId?: bigint, pageNum = 1, pageSize = 30) {
    return this.prisma.admin_op_log.findMany({
      where: adminId ? { admin_id: adminId } : {},
      orderBy: { created_at: 'desc' },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    });
  }
}
