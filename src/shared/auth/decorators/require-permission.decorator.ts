import { SetMetadata } from '@nestjs/common';

/** RBAC 权限码元数据 key（PermissionsGuard 读取） */
export const PERMISSION_KEY = 'auth:requirePermission';

/** 路由级权限点要求，如 @RequirePermission('user:freeze')；SUPER_ADMIN 直通 */
export const RequirePermission = (code: string) => SetMetadata(PERMISSION_KEY, code);
