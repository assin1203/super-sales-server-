import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { MallService } from './mall.service';
import { UserJwtGuard, CurrentUser } from '../../../shared/auth';

/** C 端商城接口（/mall）：列表公开可浏览；兑换要求登录态（userId 取自 JWT，不信任请求体） */
@Controller('mall')
export class MallController {
  constructor(private readonly mall: MallService) {}

  @Get('products')
  listProducts() {
    return []; // TODO: 按会员等级过滤商品池（FR-5.2）
  }

  @Post('exchange')
  @UseGuards(UserJwtGuard)
  exchange(@Body() body: { productId: number }, @CurrentUser() user: { id: bigint }) {
    return this.mall.exchange(user.id, body.productId);
  }
}
