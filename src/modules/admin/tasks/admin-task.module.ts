import { Module } from '@nestjs/common';
import { AdminTaskService } from './admin-task.service';
import { AdminTaskController } from './admin-task.controller';

/** 后台·任务管理（FR-7.5 任务配置化增删改） */
@Module({
  controllers: [AdminTaskController],
  providers: [AdminTaskService],
})
export class AdminTaskModule {}
