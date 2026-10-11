import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserAuthService } from './user-auth.service';
import { UserController } from './user.controller';

@Module({
  providers: [UserService, UserAuthService],
  controllers: [UserController],
  exports: [UserService, UserAuthService],
})
export class UserModule {}
