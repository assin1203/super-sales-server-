import { Controller, Post, Body } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';

/** 后台登录接口 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  login(@Body() body: { username: string; password: string }) {
    return this.auth.login(body.username, body.password);
  }
}
