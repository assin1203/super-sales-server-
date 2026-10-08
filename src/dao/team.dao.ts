import { Injectable } from '@nestjs/common';
import { Prisma, room, room_position, dividend_record, team_reentry, team_slot } from '../generated/prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * 团队域 DAO：room / room_position / contribution_record / dividend_record /
 *             team_reentry / team_slot / room_rebuild / room_op_log（FR-10.x / FR-9.8~9.10）
 *
 * 并发控制约定（架构文档 §5）：
 * - 占位：条件更新 WHERE holder_user_id IS NULL，失败换下一空位（不依赖 Redis 锁）
 * - 分红：房间行锁（SELECT ... FOR UPDATE）+ dividend_record.uk_room_round 双保险
 * - 级联结算走事件队列串行，事务内不递归
 *
 * 注：db pull 未生成表间关联，include 不可用，跨表查询分步执行
 */
@Injectable()
export class TeamDao {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? this.prisma;
  }

  // ---------- room ----------

  /** 创建房间 + 固定 7 位置（1+2+4 布局：row1=1人 row2=2人 row3=4人） */
  async createRoom(tx: Tx, captainUserId?: bigint): Promise<room> {
    const db = this.db(tx);
    const roomRow = await db.room.create({
      data: { ...(captainUserId ? { captain_user_id: captainUserId } : {}) },
    });
    const layout: [number, number, number][] = [
      [1, 1, 1], [2, 2, 1], [3, 2, 2],
      [4, 3, 1], [5, 3, 2], [6, 3, 3], [7, 3, 4],
    ];
    await db.room_position.createMany({
      data: layout.map(([posNo, rowNo, colNo]) => ({
        room_id: roomRow.id, pos_no: posNo, row_no: rowNo, col_no: colNo,
      })),
    });
    return roomRow;
  }

  /** 房间行锁（分红结算入口，调用方在 $transaction 内使用） */
  lockRoomForUpdate(tx: Tx, roomId: bigint): Promise<room[]> {
    return this.db(tx).$queryRaw`SELECT * FROM room WHERE id = ${roomId} FOR UPDATE`;
  }

  /** 未满员房间（入队目标选择：推荐人所在 → 公共队列，FR-10.2） */
  async findJoinableRoom(holderUserId?: bigint): Promise<room | null> {
    const roomRow = holderUserId
      ? await this.prisma.room.findFirst({ where: { status: 1, captain_user_id: holderUserId } })
      : await this.prisma.room.findFirst({ where: { status: 1 } });
    if (!roomRow) return null;
    const positions = await this.prisma.room_position.findMany({
      where: { room_id: roomRow.id },
      orderBy: { pos_no: 'asc' },
    });
    const filled = positions.filter((p) => p.holder_user_id !== null).length;
    return filled >= 7 ? null : roomRow;
  }

  /** 房间 + 7 位置（分步查询：db pull 无关联字段） */
  async findRoomWithPositions(roomId: bigint): Promise<{ room: room; positions: room_position[] } | null> {
    const roomRow = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!roomRow) return null;
    const positions = await this.prisma.room_position.findMany({
      where: { room_id: roomId },
      orderBy: { pos_no: 'asc' },
    });
    return { room: roomRow, positions };
  }

  /**
   * 占位（FR-10.2 补位：从上到下从左到右）
   * 条件更新幂等：holder_user_id IS NULL，影响行数=0 → 换下一空位
   */
  async occupyPosition(tx: Tx, roomId: bigint, posNo: number, userId: bigint): Promise<boolean> {
    const updated = await this.db(tx).room_position.updateMany({
      where: { room_id: roomId, pos_no: posNo, holder_user_id: null },
      data: { holder_user_id: userId, occupied_at: new Date() },
    });
    return updated.count === 1;
  }

  /** 释放位置（中奖离队/重组） */
  async vacatePosition(tx: Tx, roomId: bigint, userId: bigint) {
    return this.db(tx).room_position.updateMany({
      where: { room_id: roomId, holder_user_id: userId },
      data: { holder_user_id: null, vacated_at: new Date() },
    });
  }

  /** 满员后房间置为待结算（条件更新幂等：status=1） */
  async markFull(tx: Tx, roomId: bigint) {
    return this.db(tx).room.updateMany({ where: { id: roomId, status: 1 }, data: { status: 2 } });
  }

  /** 归档房间（重组后 status=3，round_no+1） */
  async archiveRoom(tx: Tx, roomId: bigint, captainUserId: bigint) {
    return this.db(tx).room.update({
      where: { id: roomId },
      data: { status: 3, round_no: { increment: 1 }, last_dividend_at: new Date(), captain_user_id: captainUserId },
    });
  }

  // ---------- room_position 权重 ----------

  /** 权重计算（FR-9.8：贡献值主 + 位置辅；同分按入位先后） */
  async computeWeightOrder(roomId: bigint): Promise<{ userId: bigint; contribPoints: number; posNo: number; occupiedAt: Date; rank: number }[]> {
    const positions = await this.prisma.room_position.findMany({
      where: { room_id: roomId, holder_user_id: { not: null } },
      orderBy: { pos_no: 'asc' },
    });
    return positions
      .map((p) => ({
        userId: p.holder_user_id!,
        contribPoints: p.contrib_points,
        posNo: p.pos_no,
        occupiedAt: p.occupied_at!,
        rank: 0,
      }))
      .sort((a, b) =>
        b.contribPoints - a.contribPoints ||
        a.posNo - b.posNo ||
        a.occupiedAt.getTime() - b.occupiedAt.getTime(),
      )
      .map((p, i) => ({ ...p, rank: i + 1 }));
  }

  // ---------- contribution_record ----------

  /** 记贡献值（上限 2：房内该用户已有 2 个则第 3 个标记顺延 is_overflow=1，Q11 口径） */
  async addContribution(tx: Tx, data: { userId: bigint; roomId: bigint; posNo: number; sourceType: string; sourceBizId?: bigint }) {
    const db = this.db(tx);
    const current = await db.contribution_record.count({ where: { user_id: data.userId, room_id: data.roomId } });
    return db.contribution_record.create({
      data: {
        user_id: data.userId,
        room_id: data.roomId,
        pos_no: data.posNo,
        source_type: data.sourceType,
        source_biz_id: data.sourceBizId,
        is_overflow: current >= 2 ? 1 : 0,
      },
    });
  }

  // ---------- dividend_record（幂等：uk_room_round） ----------

  /** 创建分红记录（唯一键冲突 = 该轮次已结算，返回 null） */
  async createDividend(
    tx: Tx,
    data: { roomId: bigint; roundNo: number; winnerUserId: bigint; dividendPoints: number; winnerWeight: Prisma.InputJsonValue; fullWeightOrder: Prisma.InputJsonValue; ruleVersion: number },
  ): Promise<dividend_record | null> {
    const db = this.db(tx);
    try {
      return await db.dividend_record.create({
        data: {
          room_id: data.roomId,
          round_no: data.roundNo,
          winner_user_id: data.winnerUserId,
          dividend_points: data.dividendPoints,
          winner_weight: data.winnerWeight,
          full_weight_order: data.fullWeightOrder,
          rule_version: data.ruleVersion,
          settled_at: new Date(),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }

  // ---------- team_reentry（再入队，幂等：uk_dividend） ----------

  async createReentry(
    tx: Tx,
    data: { userId: bigint; dividendId: bigint; fromRoomId: bigint; targetReferrerId?: bigint; roundNo: number; machineCheck: boolean; machineSn: string },
  ): Promise<team_reentry | null> {
    const db = this.db(tx);
    try {
      return await db.team_reentry.create({
        data: {
          user_id: data.userId,
          dividend_id: data.dividendId,
          from_room_id: data.fromRoomId,
          target_referrer_id: data.targetReferrerId,
          round_no: data.roundNo,
          machine_check: data.machineCheck ? 1 : 0,
          machine_sn: data.machineSn,
          status: data.machineCheck ? 1 : 3,
          enqueued_at: new Date(),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }

  /** 等待队列（按再入队时间排序自动补位，FR-10.6） */
  findWaitQueue(limit = 50) {
    return this.prisma.team_reentry.findMany({ where: { status: 1 }, orderBy: { enqueued_at: 'asc' }, take: limit });
  }

  /** 执行再入队（条件更新幂等：status=1 才生效） */
  async completeReentry(tx: Tx, reentryId: bigint, roomId: bigint, posNo: number) {
    return this.db(tx).team_reentry.updateMany({
      where: { id: reentryId, status: 1 },
      data: { status: 2, to_room_id: roomId, to_pos_no: posNo, rejoined_at: new Date() },
    });
  }

  // ---------- team_slot（入队名额，1 人 1 名额） ----------

  /** 授予名额（幂等：uk_user 唯一键冲突 = 已有名额） */
  async grantSlot(
    tx: Tx,
    data: { userId: bigint; posTaskId: bigint; posSn: string },
  ): Promise<team_slot | null> {
    const db = this.db(tx);
    try {
      return await db.team_slot.create({
        data: { user_id: data.userId, pos_task_id: data.posTaskId, pos_sn: data.posSn, granted_at: new Date() },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }

  /** 名额绑定房间位置（入队成功后回填） */
  async bindSlotToRoom(tx: Tx, userId: bigint, roomId: bigint, posNo: number) {
    return this.db(tx).team_slot.updateMany({
      where: { user_id: userId, status: 1 },
      data: { status: 2, room_id: roomId, pos_no: posNo, joined_at: new Date() },
    });
  }

  /** 中奖离队：名额置离队态（再入队中） */
  async leaveSlot(tx: Tx, userId: bigint) {
    return this.db(tx).team_slot.updateMany({ where: { user_id: userId, status: 2 }, data: { status: 3, left_at: new Date() } });
  }

  // ---------- room_rebuild（幂等：uk_dividend） ----------

  async createRebuild(
    tx: Tx,
    data: { dividendId: bigint; oldRoomId: bigint; roundNo: number; newRoomId: bigint; weightOrder: Prisma.InputJsonValue },
  ) {
    return this.db(tx).room_rebuild.create({
      data: {
        dividend_id: data.dividendId,
        old_room_id: data.oldRoomId,
        round_no: data.roundNo,
        new_room_id: data.newRoomId,
        weight_order: data.weightOrder,
        rebuilt_at: new Date(),
      },
    });
  }

  // ---------- room_op_log（只增） ----------

  logOp(tx: Tx, data: { roomId: bigint; opType: string; userId?: bigint; posNo?: number; roundNo?: number; fromState?: Prisma.InputJsonValue; toState?: Prisma.InputJsonValue; bizNo?: string }) {
    return this.db(tx).room_op_log.create({
      data: {
        room_id: data.roomId,
        op_type: data.opType,
        user_id: data.userId,
        pos_no: data.posNo,
        round_no: data.roundNo ?? 0,
        from_state: data.fromState,
        to_state: data.toState,
        biz_no: data.bizNo ?? '',
      },
    });
  }
}
