import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminMallService } from './admin-mall.service';
import { AdminJwtGuard, PermissionsGuard, RequirePermission } from '../../../shared/auth';

/** 后台·商城接口（/admin/mall） */
@Controller('admin/mall')
@UseGuards(AdminJwtGuard, PermissionsGuard)
export class AdminMallController {
  constructor(private readonly service: AdminMallService) {}

  @Get('products')
  @RequirePermission('mall:manage')
  products(@Query('pageNum') pageNum = '1', @Query('pageSize') pageSize = '20') {
    return this.service.findProducts(Number(pageNum), Number(pageSize));
  }

  @Get('products/:id')
  @RequirePermission('mall:manage')
  detail(@Query('id') id: string) {
    return this.service.findById(BigInt(id));
  }
}
