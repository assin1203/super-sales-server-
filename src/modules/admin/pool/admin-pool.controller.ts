import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { AdminPoolService } from './admin-pool.service';

/** 后台·分润池接口（/admin/pool） */
@Controller('admin/pool')
export class AdminPoolController {
  constructor(private readonly service: AdminPoolService) {}

  @Get('config')
  config() {
    return this.service.config();
  }

  @Get('ledger')
  ledger(@Query('pageNum') pageNum = '1', @Query('pageSize') pageSize = '30') {
    return this.service.ledger(undefined, Number(pageNum), Number(pageSize));
  }

  @Get('health')
  health() {
    return this.service.health();
  }

  @Post('config')
  updateConfig(
    @Body()
    body: {
      configId: string;
      data: Record<string, unknown>;
      adminId: string;
      confirmBy: string;
      ip?: string;
    },
  ) {
    return this.service.updateConfig(
      BigInt(body.configId),
      body.data,
      { adminId: BigInt(body.adminId), ip: body.ip },
      BigInt(body.confirmBy),
    );
  }

  @Post('guard/release')
  releaseGuard(
    @Body() body: { configId: string; adminId: string; confirmBy: string; ip?: string },
  ) {
    return this.service.releaseGuard(
      BigInt(body.configId),
      { adminId: BigInt(body.adminId), ip: body.ip },
      BigInt(body.confirmBy),
    );
  }
}
