import { Module } from '@nestjs/common';
import { InternalTokenController } from './internal-token.controller';

/** 内部凭证线：/internal/token（token exchange），供受控内部 Job 换取短时效 internal token */
@Module({
  controllers: [InternalTokenController],
})
export class InternalModule {}
