import { Module } from '@nestjs/common';
import { GiftService } from './gift.service';

@Module({
  providers: [GiftService],
  exports: [GiftService],
})
export class GiftModule {}
