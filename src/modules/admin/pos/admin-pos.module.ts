import { Module } from '@nestjs/common';
import { AdminPosService } from './admin-pos.service';
import { AdminPosController } from './admin-pos.controller';

/** 后台·POS 装机管理（审核/达标监控/退机） */
@Module({
  controllers: [AdminPosController],
  providers: [AdminPosService],
})
export class AdminPosModule {}
