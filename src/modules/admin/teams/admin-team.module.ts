import { Module } from '@nestjs/common';
import { AdminTeamService } from './admin-team.service';
import { AdminTeamController } from './admin-team.controller';

/** 后台·7 人团队监控（房间列表/权重/再入队等待队列/手动补位） */
@Module({
  controllers: [AdminTeamController],
  providers: [AdminTeamService],
})
export class AdminTeamModule {}
