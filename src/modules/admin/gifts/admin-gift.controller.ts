import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { AdminGiftService } from './admin-gift.service';

/** 后台·赠送接口（/admin/gifts） */
@Controller('admin/gifts')
export class AdminGiftController {
  constructor(private readonly service: AdminGiftService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.service.list(status ? Number(status) : undefined);
  }

  @Post('approve')
  approve(
    @Body() body: { activityId: string; isSecond: boolean; adminId: string; ip?: string },
  ) {
    return this.service.approve(
      BigInt(body.activityId),
      body.isSecond,
      { adminId: BigInt(body.adminId), ip: body.ip },
    );
  }
}
