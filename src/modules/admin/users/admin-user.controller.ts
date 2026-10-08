import { Controller, Get, Query, Post, Body } from '@nestjs/common';
import { AdminUserService } from './admin-user.service';

/** 后台·用户管理接口（/admin/users） */
@Controller('admin/users')
export class AdminUserController {
  constructor(private readonly service: AdminUserService) {}

  @Get('by-phone')
  byPhone(@Query('phone') phone: string) {
    return this.service.findByPhone(phone);
  }

  @Get(':id')
  detail(@Query('id') id: string) {
    return this.service.findById(BigInt(id));
  }

  /** 冻结/封禁（敏感操作：前端传 confirmBy 复核人 ID） */
  @Post(':id/status')
  setStatus(
    @Body()
    body: {
      id: string;
      status: number;
      adminId: string;
      confirmBy?: string;
      ip?: string;
    },
  ) {
    return this.service.setStatus(
      BigInt(body.id),
      body.status,
      { adminId: BigInt(body.adminId), ip: body.ip },
      body.confirmBy ? BigInt(body.confirmBy) : undefined,
    );
  }
}
