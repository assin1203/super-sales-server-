import { Module } from '@nestjs/common';
import { AdminPointsService } from './admin-points.service';
import { AdminPointsController } from './admin-points.controller';

/** 后台·积分管理（流水查询/调账，调账敏感操作双人复核） */
@Module({
  controllers: [AdminPointsController],
  providers: [AdminPointsService],
})
export class AdminPointsModule {}
