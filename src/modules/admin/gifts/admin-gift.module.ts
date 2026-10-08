import { Module } from '@nestjs/common';
import { AdminGiftService } from './admin-gift.service';
import { AdminGiftController } from './admin-gift.controller';

/** 后台·赠送管理（活动审批双人复核/预算硬控监控/台账） */
@Module({
  controllers: [AdminGiftController],
  providers: [AdminGiftService],
})
export class AdminGiftModule {}
