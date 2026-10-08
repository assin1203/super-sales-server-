import { Controller, Get, Query } from '@nestjs/common';
import { AdminMallService } from './admin-mall.service';

/** 后台·商城接口（/admin/mall） */
@Controller('admin/mall')
export class AdminMallController {
  constructor(private readonly service: AdminMallService) {}

  @Get('products')
  products(@Query('pageNum') pageNum = '1', @Query('pageSize') pageSize = '20') {
    return this.service.findProducts(Number(pageNum), Number(pageSize));
  }

  @Get('products/:id')
  detail(@Query('id') id: string) {
    return this.service.findById(BigInt(id));
  }
}
