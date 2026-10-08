import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PosDao } from '../../../dao/pos.dao';
import { TeamDao } from '../../../dao/team.dao';
import { UserDao } from '../../../dao/user.dao';
import { PoolDao } from '../../../dao/pool.dao';
import { PointDao } from '../../../dao/point.dao';
import { PointsService } from '../points/points.service';
import { TeamService } from '../team/team.service';
import { RedisService } from '../../../shared/redis/redis.service';
import { FLOW_TYPE, EVT_STREAM, MEMBER_LEVEL } from '../../../shared/constants/domain.constants';

type Tx = Prisma.TransactionClient;

/**
 * 核心结算引擎（FR-9.x，系统心脏，架构文档 §5）：
 * - 幂等三层：Redis SETNX → flow_no 唯一键 → 条件更新
 * - 达标入队四元组（积分转可用+达标积分+晋级L1+编队）单事务原子完成
 * - 分润池保护前置检查：分红顺延/任务降档/赠送冻结（FR-9.12）
 * 数据访问全部经 DAO 层（架构约束）
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly posDao: PosDao,
    private readonly teamDao: TeamDao,
    private readonly userDao: UserDao,
    private readonly poolDao: PoolDao,
    private readonly pointDao: PointDao,
    private readonly points: PointsService,
    private readonly team: TeamService,
  ) {}

  /** 达标入队结算：四元组原子事务（FR-3.4 / FR-9.3） */
  async settleQualified(sn: string, userId: number): Promise<void> {
    const eventId = `QU:${sn}`;
    if (!(await this.redis.idempotentTryAcquire(eventId))) return;

    try {
      const machine = await this.posDao.findBySn(sn);
      const uid = BigInt(userId);
      await this.prisma.$transaction(async (tx: Tx) => {
        // 1. 达标判定权（幂等：条件更新 qualified_at IS NULL）
        const ok = await this.posDao.markQualified(tx, machine!.id, Number(machine!.cumulative_flow));
        if (!ok) return;

        // 2. 安装积分冻结转可用 + 达标入队积分 300
        const posTaskId = machine!.id;
        await this.points.unfreeze(tx, uid, 100, `UF${sn}`);
        await this.points.credit(tx, uid, 300, `QU${sn}`, FLOW_TYPE.QUALIFIED, {
          bizId: posTaskId,
          bizNo: sn,
        });

        // 3. 晋级 L1（user_level_record uk 幂等；L0→L1）
        const user = await this.userDao.findById(uid);
        if (user && user.level === MEMBER_LEVEL.L0) {
          const record = await this.userDao.createLevelRecord({
            user_id: uid,
            from_level: 0,
            to_level: MEMBER_LEVEL.L1,
            trigger_type: 'QUALIFIED',
            trigger_biz_id: sn,
          });
          if (record) {
            await this.userDao.update(uid, { level: MEMBER_LEVEL.L1, level_updated_at: new Date() });
            await this.redis.publishEvent(EVT_STREAM.MEMBER_UPGRADED, { userId: String(userId), toLevel: '1', sn });
          }
        }

        // 4. 授予入队名额（uk_user 幂等）+ 编入 7 人团队
        const slot = await this.teamDao.grantSlot(tx, { userId: uid, posTaskId, posSn: sn });
        if (slot) {
          const userRow = await this.userDao.findById(uid);
          const room = await this.teamDao.findJoinableRoom(userRow?.referrer_id ?? undefined);
          if (room) {
            const posNo = await this.team.occupyFirstFreePosition(tx, room.id, uid);
            if (posNo !== null) {
              await this.teamDao.bindSlotToRoom(tx, uid, room.id, posNo);
              const full = await this.team.checkFullAndMark(tx, room.id);
              if (full) {
                // 满员分红判定异步处理（事件驱动，避免事务内级联）
                await this.redis.publishEvent(EVT_STREAM.TEAM_FULL, { roomId: String(room.id) });
              }
            }
          }
          // 无房间/无空位 → 名额保持待入队态，由补位 Job 处理（FR-10.6）
        }

        // 5. 1~3 级推荐积分：异步事件（FR-3.6）
        const ancestors = await this.userDao.getAncestorChain(uid);
        for (let i = 0; i < ancestors.length; i++) {
          await this.redis.publishEvent(EVT_STREAM.REFERRAL_QUALIFIED, {
            level: String(i + 1),
            userId: String(ancestors[i].id),
            sourceUserId: String(userId),
            sn,
          });
        }
      });
    } catch (err) {
      this.logger.error(`settleQualified failed sn=${sn}`, err as Error);
      throw err; // 消费者重试 → 死信表兜底
    }
  }

  /**
   * 团队满员分红结算（FR-9.5 / FR-10.4，消费 evt:team.full）
   * 房间行锁 + dividend_record uk_room_round 双保险
   */
  async settleDividend(roomId: bigint): Promise<void> {
    const eventId = `DV:${roomId}`;
    if (!(await this.redis.idempotentTryAcquire(eventId))) return;

    await this.prisma.$transaction(async (tx: Tx) => {
      const locked = await this.teamDao.lockRoomForUpdate(tx, roomId);
      if (!locked.length || locked[0].status !== 2) return; // 仅满员待结算状态

      const room = locked[0];
      const weightOrder = await this.teamDao.computeWeightOrder(roomId);
      if (weightOrder.length < 7) return;

      const winner = weightOrder[0];
      const roundNo = room.round_no + 1;

      // 分红记录（幂等：uk_room_round）
      const dividend = await this.teamDao.createDividend(tx, {
        roomId,
        roundNo,
        winnerUserId: winner.userId,
        dividendPoints: 1200,
        winnerWeight: { ...winner } as unknown as import('../../../generated/prisma/client').Prisma.InputJsonValue,
        fullWeightOrder: weightOrder as unknown as import('../../../generated/prisma/client').Prisma.InputJsonValue,
        ruleVersion: 1,
      });
      if (!dividend) return;

      // 分润池保护检查（FR-9.12：降级则顺延挂账）
      const cfg = await this.poolDao.findConfig();
      const deferred = cfg?.guard_status === 2;

      // 中奖人积分入账（顺延则不即时入账，只挂账）
      if (!deferred) {
        await this.points.credit(tx, winner.userId, 1200, `DV${dividend.id}`, FLOW_TYPE.DIVIDEND, {
          bizId: dividend.id,
        });
      } else {
        // 分润池保护：分红顺延挂账（池恢复后补发，FR-9.12）
        await this.poolDao.record(tx, {
          bizDate: new Date(),
          type: 'GUARD_DEFER',
          amount: 1200 * Number(cfg!.point_cost_factor),
          points: 1200,
          sourceType: 'FLOW',
          sourceBizId: dividend.id,
          balanceAfter: await this.poolDao.currentBalance(),
          remark: `分红顺延 room=${roomId} round=${roundNo}`,
        });
      }

      // 中奖者离队 + 自动再入队（FR-9.9：校验机器持续运营）
      await this.teamDao.vacatePosition(tx, roomId, winner.userId);
      await this.teamDao.leaveSlot(tx, winner.userId);
      const winnerUser = await this.userDao.findById(winner.userId);
      const machine = await this.posDao.findByUser(winner.userId).then((list) => list[0]);
      const active = await this.posDao.hasActiveMachine(winner.userId);
      await this.teamDao.createReentry(tx, {
        userId: winner.userId,
        dividendId: dividend.id,
        fromRoomId: roomId,
        targetReferrerId: winnerUser?.referrer_id ?? undefined,
        roundNo: 1,
        machineCheck: active,
        machineSn: machine?.sn ?? 'UNKNOWN',
      });

      // 推荐人分红联动积分：异步事件（200/80/30 × 等级系数，FR-3.9）
      const ancestors = await this.userDao.getAncestorChain(winner.userId);
      for (let i = 0; i < ancestors.length; i++) {
        await this.redis.publishEvent(EVT_STREAM.TEAM_FULL, {
          dividendUserId: String(winner.userId),
          dividendRefLevel: String(i + 1),
          refUserId: String(ancestors[i].id),
          dividendId: String(dividend.id),
        });
      }

      // 重组：归档原房间 + 新建房间（6 人按权重落位，FR-9.10）
      const newRoom = await this.teamDao.createRoom(tx, weightOrder[1].userId);
      // 重组落位：按 1+2+4 布局将 6 人按权重顺序写入（实现按 Q12 定稿口径调整）
      for (let i = 1; i < weightOrder.length; i++) {
        const posNo = i + 1; // 1 号位=权重第 2，后续按序（占位顺序=权重序）
        await this.teamDao.occupyPosition(tx, newRoom.id, posNo, weightOrder[i].userId);
      }
      await this.teamDao.archiveRoom(tx, roomId, winner.userId);
      await this.teamDao.createRebuild(tx, {
        dividendId: dividend.id,
        oldRoomId: roomId,
        roundNo,
        newRoomId: newRoom.id,
        weightOrder: weightOrder.slice(1) as unknown as import('../../../generated/prisma/client').Prisma.InputJsonValue,
      });
      await this.teamDao.logOp(tx, { roomId, opType: 'REBUILD', roundNo, bizNo: `REBUILD:${dividend.id}` });

      // 新房间若满员 → 级联走事件（事务内不递归）
      const newFull = await this.team.checkFullAndMark(tx, newRoom.id);
      if (newFull) {
        await this.redis.publishEvent(EVT_STREAM.TEAM_FULL, { roomId: String(newRoom.id) });
      }
    });
  }
}
