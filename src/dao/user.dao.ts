import { Injectable } from '@nestjs/common';
import { Prisma, user, user_level_record } from '../generated/prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

/**
 * 用户域 DAO：user / user_level_record
 * 注：prisma db pull 按表名生成 model（snake_case），delegate/类型名均为 snake_case
 */
@Injectable()
export class UserDao {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: bigint | number) {
    return this.prisma.user.findUnique({ where: { id: id as bigint } });
  }

  findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  findByInviteCode(code: string) {
    return this.prisma.user.findUnique({ where: { invite_code: code } });
  }

  /** 创建用户（注册：referrer_id 终身绑定，创建后不允许 UPDATE 该字段的代码路径） */
  create(data: Prisma.userCreateInput) {
    return this.prisma.user.create({ data });
  }

  update(id: bigint | number, data: Prisma.userUpdateInput) {
    return this.prisma.user.update({ where: { id: id as bigint }, data });
  }

  /** 冻结/封禁（风控处置，FR-12.7） */
  setStatus(id: bigint | number, status: number) {
    return this.prisma.user.update({ where: { id: id as bigint }, data: { status } });
  }

  /** 向上取祖先链（1~3 级计奖链，FR-6.1）；返回 [1级, 2级, 3级] */
  async getAncestorChain(userId: bigint | number, maxDepth = 3): Promise<Pick<user, 'id' | 'level'>[]> {
    const chain: Pick<user, 'id' | 'level'>[] = [];
    let currentId: bigint = userId as bigint;
    for (let depth = 0; depth < maxDepth; depth++) {
      const user = await this.prisma.user.findUnique({
        where: { id: currentId },
        select: { id: true, level: true, referrer_id: true },
      });
      if (!user?.referrer_id) break;
      const ancestor = await this.prisma.user.findUnique({
        where: { id: user.referrer_id },
        select: { id: true, level: true },
      });
      if (!ancestor) break;
      chain.push(ancestor);
      currentId = ancestor.id;
    }
    return chain;
  }

  // ---------- user_level_record ----------

  /** 晋级留痕（幂等：uk_user_to_trigger 唯一键冲突 = 已晋级） */
  async createLevelRecord(data: Prisma.user_level_recordCreateInput): Promise<user_level_record | null> {
    try {
      return await this.prisma.user_level_record.create({ data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }

  findLevelRecords(userId: bigint | number) {
    return this.prisma.user_level_record.findMany({
      where: { user_id: userId as bigint },
      orderBy: { created_at: 'desc' },
    });
  }

  /** 晋级条件统计：直推达标人数（level>=1 且 referrer=该用户） */
  countQualifiedDirect(userId: bigint | number) {
    return this.prisma.user.count({ where: { referrer_id: userId as bigint, level: { gte: 1 } } });
  }

  /** 累计获得积分（晋级条件②，走钱包累计字段而非扫流水） */
  totalEarned(userId: bigint | number) {
    return this.prisma.point_wallet.findUnique({ where: { user_id: userId as bigint } }).then((w) => Number(w?.total_earned ?? 0));
  }
}
