import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';
import { PointsService } from '../points/points.service';
import { TeamService } from '../team/team.service';
import { UserService } from '../user/user.service';
import { FLOW_TYPE, EVT_STREAM } from '../../shared/constants/domain.constants';

/**
 * 核心结算引擎（FR-9.x，系统心脏，架构文档 §5）：
 * - 幂等三层：Redis SETNX → flow_no 唯一键 → 条件更新
 * - 达标入队四元组（积分转可用+达标积分+晋级L1+编队）单事务原子完成
 * - 分润池保护前置检查：分红顺延/任务降档/赠送冻结（FR-9.12）
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly points: PointsService,
    private readonly team: TeamService,
    private readonly user: UserService,
  ) {}

  /** 达标入队结算：四元组原子事务（FR-3.4 / FR-9.3） */
  async settleQualified(sn: string, userId: number): Promise<void> {
    const eventId = `QU:${sn}`;
    if (!(await this.redis.idempotentTryAcquire(eventId))) return;

    try {
      await this.prisma.$transaction(async (tx: any) => {
        // 1. 达标标记（幂等：条件更新）
        const marked = await tx.pos_task.updateMany({
          where: { sn, qualified_at: null },
          data: { qualified_at: new Date() },
        });
        if (marked.count === 0) return;

        // 2. 安装积分冻结转可用 + 达标入队积分 300
        await this.points.credit(tx, userId, 300, `QU${sn}`, FLOW_TYPE.QUALIFIED, sn);
        // TODO: 安装积分 100 frozen → balance 转移

        // 3. 晋级 L1（user_tier_record UNIQUE(user_id,tier_id) 幂等）
        // TODO: tx.user_tier_record.create + member.upgraded 事件

        // 4. 编入 7 人团队（无空位 → 等待队列）
        // TODO: 定位推荐人所在未满房间 → occupyPosition → 满 7 人 publish evt:team.full

        // 5. 1~3 级推荐积分：异步事件
        const ancestors = await this.user.getAncestorChain(userId);
        for (let i = 0; i < ancestors.length; i++) {
          await this.redis.publishEvent(EVT_STREAM.REFERRAL_QUALIFIED, {
            level: String(i + 1),
            userId: String(ancestors[i]),
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
}
