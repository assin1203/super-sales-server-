import { Module } from '@nestjs/common';
import { AdminPoolService } from './admin-pool.service';
import { AdminPoolController } from './admin-pool.controller';

/** 后台·分润池管理（FR-12.9 台账/健康度/参数配置/保护状态） */
@Module({
  controllers: [AdminPoolController],
  providers: [AdminPoolService],
})
export class AdminPoolModule {}
