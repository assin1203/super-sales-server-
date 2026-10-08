import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * Prisma 统一入口（Prisma 7：driver adapter 必填，连接串由应用侧提供）
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const u = new URL(process.env.DATABASE_URL!);
    super({
      adapter: new PrismaMariaDb({
        host: u.hostname,
        port: u.port ? parseInt(u.port, 10) : 3306,
        user: u.username,
        password: u.password,
        database: u.pathname.replace(/^\//, ''),
        connectionLimit: 10,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
