import { Module } from '@nestjs/common';
import { AdminMallService } from './admin-mall.service';
import { AdminMallController } from './admin-mall.controller';

/** 后台·商城管理（商品上下架/超成本审批/库存） */
@Module({
  controllers: [AdminMallController],
  providers: [AdminMallService],
})
export class AdminMallModule {}
