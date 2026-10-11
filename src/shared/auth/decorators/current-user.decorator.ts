import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 注入当前认证主体（guard 已保证存在）：
 * - 后台接口：{ id, username, role }
 * - C 端接口：{ id }
 * - 内部接口：{ clientId }
 * 用法：me(@CurrentUser() admin: { id: bigint; username: string; role: string })
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.admin ?? req.user ?? req.internal;
});
