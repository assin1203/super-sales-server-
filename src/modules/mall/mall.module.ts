import { Module } from '@nestjs/common';
import { MallService } from './mall.service';
import { MallController } from './mall.controller';

@Module({
  providers: [MallService],
  controllers: [MallController],
})
export class MallModule {}
