import { Module } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { SettlementController } from './settlement.controller';
import { PointsModule } from '../points/points.module';
import { TeamModule } from '../team/team.module';
import { MemberModule } from '../member/member.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [PointsModule, TeamModule, MemberModule, UserModule],
  providers: [SettlementService],
  controllers: [SettlementController],
  exports: [SettlementService],
})
export class SettlementModule {}
