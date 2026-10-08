import { Module } from '@nestjs/common';
import { PointsModule } from '../points/points.module';
import { TaskService } from './task.service';

@Module({
  imports: [PointsModule],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
