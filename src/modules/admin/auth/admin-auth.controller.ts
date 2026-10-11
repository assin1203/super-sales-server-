import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';

/** 后台登录接口（公开：签发前无 token 可用，其余 admin 路由由 AdminJwtGuard 保护） */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { username: string; password: string }) {
    return this.auth.login(body.username, body.password);
  }
}
