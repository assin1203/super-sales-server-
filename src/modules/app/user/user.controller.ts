import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { UserAuthService } from './user-auth.service';
import { UserJwtGuard, CurrentUser } from '../../../shared/auth';

/**
 * C 端用户接口（/user，FR-1.1 登录态）
 * login/refresh/logout 为公开端点（签发前/续期/登出场景无可用 access token），其余要求 UserJwtGuard
 */
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly auth: UserAuthService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { phone: string; password: string }) {
    return this.auth.login(body.phone, body.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() body: { refreshToken: string }) {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(UserJwtGuard)
  me(@CurrentUser() user: { id: bigint }) {
    return this.userService.getAncestorChain(user.id);
  }
}
