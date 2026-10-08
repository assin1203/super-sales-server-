import { Global, Module } from '@nestjs/common';
import { UserDao } from './user.dao';
import { PointDao } from './point.dao';
import { PosDao } from './pos.dao';
import { TeamDao } from './team.dao';
import { MallDao } from './mall.dao';
import { TaskDao } from './task.dao';
import { GiftDao } from './gift.dao';
import { PoolDao } from './pool.dao';
import { AdminDao } from './admin.dao';
import { OpsDao } from './ops.dao';

/**
 * DAO 层（数据访问层）：
 * - 唯一允许直接调用 PrismaService 的层，业务 Service 一律经 DAO 访问数据库；
 * - 每张表一个 DAO（或按域聚合），方法内完成"条件构造 + 幂等键 + 条件更新"；
 * - 跨表原子操作通过 prisma.$transaction 在 Service 层编排，DAO 提供事务内可用的方法（接收 tx 客户端）。
 */
@Global()
@Module({
  providers: [UserDao, PointDao, PosDao, TeamDao, MallDao, TaskDao, GiftDao, PoolDao, AdminDao, OpsDao],
  exports: [UserDao, PointDao, PosDao, TeamDao, MallDao, TaskDao, GiftDao, PoolDao, AdminDao, OpsDao],
})
export class DaoModule {}
