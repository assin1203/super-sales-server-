import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminPoolService } from './admin-pool.service';
import { AdminJwtGuard, PermissionsGuard, RequirePermission, CurrentUser } from '../../../shared/auth';

/** 后台·分润池接口（/admin/pool）：查询 pool:query；参数配置/保护恢复为敏感操作（双人复核） */
@Controller('admin/pool')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminPoolController {
  constructor(private readonly service: AdminPoolService) {}

  @Get('config')
  @RequirePermission('pool:query')
  config() {
    return this.service.config();
  }

  @Get('ledger')
  @RequirePermission('pool:query')
  ledger(@Query('pageNum') pageNum = '1', @Query('pageSize') pageSize = '30') {
    return this.service.ledger(undefined, Number(pageNum), Number(pageSize));
  }

  @Get('health')
  @RequirePermission('pool:query')
  health() {
    return this.service.health();
  }

  /** 参数配置（操作者取自 JWT，不信任请求体） */
  @Post('config')
  @RequirePermission('pool:config')
  updateConfig(
    @Body() body: { configId: string; data: Record<string, unknown>; confirmBy: string; ip?: string },
    @CurrentUser() admin: { id: bigint; username: string; role: string },
  ) {
    return this.service.updateConfig(BigInt(body.configId), body.data, { adminId: admin.id, ip: body.ip }, BigInt(body.confirmBy));
  }

  /** 保护状态人工恢复 */
  @Post('guard/release')
  @RequirePermission('pool:guard_release')
  releaseGuard(
    @Body() body: { configId: string; confirmBy: string; ip?: string },
    @CurrentUser() admin: { id: bigint; username: string; role: string },
  ) {
    return this.service.releaseGuard(BigInt(body.configId), { adminId: admin.id, ip: body.ip }, BigInt(body.confirmBy));
  }
}
