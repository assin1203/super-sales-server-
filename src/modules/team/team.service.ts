import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RedisService } from '../../shared/redis/redis.service';

/**
 * 团队树/7 人房间（FR-10.x）：
 * - 入队补位：从上到下、从左到右（pos_no 顺序），条件更新防并发占位
 * - 满员 → 房间行锁 + dividend_record UNIQUE(room_id) 双保险 → publish evt:team.full
 * - 分红后：中奖者自动再入队（校验机器持续运营），6 人按权重重组
 * - 级联（推荐人联动/再入队致满员）一律重新入队串行处理，事务内不递归
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 按空位补位：条件更新 WHERE holder_user_id IS NULL，失败换下一空位 */
  async occupyPosition(roomId: number, userId: number): Promise<boolean> {
    const positions = await this.prisma.room_position.findMany({
      where: { room_id: roomId, holder_user_id: null },
      orderBy: { pos_no: 'asc' },
    });
    for (const pos of positions) {
      const updated = await this.prisma.room_position.updateMany({
        where: { id: pos.id, holder_user_id: null },
        data: { holder_user_id: userId, occupied_at: new Date() },
      });
      if (updated.count === 1) return true;
    }
    return false;
  }
}
