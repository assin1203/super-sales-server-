import { Injectable } from '@nestjs/common';
import { TeamDao } from '../../../dao/team.dao';

/** 后台·团队监控（FR-10.x 房间/权重/再入队队列） */
@Injectable()
export class AdminTeamService {
  constructor(private readonly teamDao: TeamDao) {}

  /** 房间详情 + 权重排序（权重申诉排查用，FR-9.8） */
  async roomDetail(roomId: bigint) {
    const room = await this.teamDao.findRoomWithPositions(roomId);
    const weightOrder = await this.teamDao.computeWeightOrder(roomId);
    return { room, weightOrder };
  }

  /** 再入队等待队列（FR-10.6 按时间排序） */
  waitQueue(limit = 50) {
    return this.teamDao.findWaitQueue(limit);
  }

}
