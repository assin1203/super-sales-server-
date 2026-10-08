import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { AdminPointsService } from './admin-points.service';

/** 后台·积分接口（/admin/points） */
@Controller('admin/points')
export class AdminPointsController {
  constructor(private readonly service: AdminPointsService) {}

  @Get('wallet')
  wallet(@Query('userId') userId: string) {
    return this.service.findWallet(BigInt(userId));
  }

  @Get('flows')
  flows(
    @Query('userId') userId: string,
    @Query('pageNum') pageNum = '1',
    @Query('pageSize') pageSize = '30',
    @Query('flowType') flowType?: string,
  ) {
    return this.service.findFlows(BigInt(userId), Number(pageNum), Number(pageSize), flowType);
  }

  /** 积分调账（敏感操作：confirmBy 必填） */
  @Post('adjust')
  adjust(
    @Body()
    body: {
      userId: string;
      delta: number;
      reason: string;
      adminId: string;
      confirmBy: string;
      ip?: string;
    },
  ) {
    return this.service.adjust(
      BigInt(body.userId),
      body.delta,
      body.reason,
      { adminId: BigInt(body.adminId), ip: body.ip },
      BigInt(body.confirmBy),
    );
  }
}
