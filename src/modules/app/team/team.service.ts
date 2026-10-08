import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TeamDao } from '../../../dao/team.dao';
import { OpsDao } from '../../../dao/ops.dao';

type Tx = Prisma.TransactionClient;

/**
 * 团队树/7 人房间（FR-10.x）：
 * - 入队补位：从上到下、从左到右（pos_no 顺序），条件更新防并发占位
 * - 满员 → 房间行锁 + dividend_record uk_room_round 双保险
 * - 级联（推荐人联动/再入队致满员）一律走事件队列串行，事务内不递归
 * 数据访问全部经 TeamDao / OpsDao（DAO 层架构约束）
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly teamDao: TeamDao,
    private readonly opsDao: OpsDao,
  ) {}

  /** 按空位补位：条件更新 WHERE holder_user_id IS NULL，失败换下一空位 */
  async occupyFirstFreePosition(tx: Tx, roomId: bigint, userId: bigint): Promise<number | null> {
    const positions = await this.teamDao.findRoomWithPositions(roomId);
    if (!positions) return null;
    for (const pos of positions.positions) {
      if (pos.holder_user_id !== null) continue;
      const ok = await this.teamDao.occupyPosition(tx, roomId, pos.pos_no, userId);
      if (ok) {
        await this.teamDao.logOp(tx, { roomId, opType: 'OCCUPY', userId, posNo: pos.pos_no });
        return pos.pos_no;
      }
    }
    return null; // 无空位（满员或并发占满）
  }

  /** 满员检查：7 位全部占用 → 置待结算并返回满员成员 */
  async checkFullAndMark(tx: Tx, roomId: bigint): Promise<boolean> {
    const room = await this.teamDao.findRoomWithPositions(roomId);
    if (!room || room.room.status !== 1) return false;
    const filled = room.positions.filter((p) => p.holder_user_id !== null).length;
    if (filled < 7) return false;
    const marked = await this.teamDao.markFull(tx, roomId);
    if (marked.count === 1) {
      await this.teamDao.logOp(tx, { roomId, opType: 'DIVIDEND', bizNo: `FULL:${roomId}` });
    }
    return marked.count === 1;
  }

  /** 房间列表（管理端） */
  findRooms() {
    return this.teamDao.findJoinableRoom();
  }
}
