import { Controller, Get, Post, Body } from '@nestjs/common';
import { MallService } from './mall.service';

@Controller('mall')
export class MallController {
  constructor(private readonly mall: MallService) {}

  @Get('products')
  listProducts() {
    return []; // TODO: 按会员等级过滤商品池（FR-5.2）
  }

  @Post('exchange')
  exchange(@Body() body: { userId: number; productId: number }) {
    return this.mall.exchange(body.userId, body.productId);
  }
}
