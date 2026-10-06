import { Controller, Get } from '@nestjs/common';
import { AdminService } from './admin.service';

// TODO: AdminAuthGuard + RBAC 权限点校验（FR-12.8）
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('ping')
  ping() {
    return { ok: true };
  }
}
