import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * Prisma 统一入口（Prisma 7：driver adapter 必填，连接串由应用侧提供）
 *
 * 注意：WHATWG URL 的 username/password getter 不做 percent-decode，
 * 形如 mysql://user:p%40ss@host 的连接串必须显式 decodeURIComponent，
 * 否则密码会带着 %40 原样下发导致 MySQL 认证挂起（池 acquire 超时）。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const u = new URL(process.env.DATABASE_URL!);
    super({
      adapter: new PrismaMariaDb({
        host: u.hostname,
        port: u.port ? parseInt(u.port, 10) : 3306,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: decodeURIComponent(u.pathname.replace(/^\//, '')),
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
