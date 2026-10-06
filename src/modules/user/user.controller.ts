import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';

// TODO: JwtAuthGuard（FR-1.1 登录态）
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  me(@Req() req: any) {
    return this.userService.getAncestorChain(req.user.id);
  }
}
