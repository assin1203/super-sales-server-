import { Module } from '@nestjs/common';
import { AdminOpsService } from './admin-ops.service';
import { AdminOpsController } from './admin-ops.controller';

/** 后台·风控/对账/死信（FR-12.7 风控处置 / FR-12.6 对账差异 / FR-9.11 死信重放） */
@Module({
  controllers: [AdminOpsController],
  providers: [AdminOpsService],
})
export class AdminOpsModule {}
