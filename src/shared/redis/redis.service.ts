import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis 统一入口（架构文档 §6.2 用途矩阵）：
 * - 缓存（余额/配置）：写后删，MySQL 为真相
 * - 幂等去重 / 分布式锁 / 防刷计数
 * - Redis Stream 事件总线 / BullMQ 延迟队列连接
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private readonly subscriber: Redis;

  constructor(config: ConfigService) {
    const url = config.get<string>('redis.url') ?? 'redis://localhost:6379';
    this.client = new Redis(url);
    this.subscriber = new Redis(url);
  }

  /** 旁路缓存读：miss 时回源 loader 并回填 */
  async cacheGetOrLoad<T>(key: string, ttlSeconds: number, loader: () => Promise<T | null>): Promise<T | null> {
    const cached = await this.client.get(key);
    if (cached) return JSON.parse(cached) as T;
    const value = await loader();
    if (value !== null && value !== undefined) {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    }
    return value;
  }

  /** 写后删：资金写事务提交后调用，下次读回源 MySQL */
  async cacheEvict(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** 幂等去重：SET NX，第一道防线；MySQL 唯一键兜底 */
  async idempotentTryAcquire(key: string, ttlSeconds = 7 * 86400): Promise<boolean> {
    const ok = await this.client.set(`idem:${key}`, '1', 'EX', ttlSeconds, 'NX');
    return ok === 'OK';
  }

  /** 分布式锁：仅用于减少冲突重试，正确性由 DB 条件更新/唯一键保证 */
  async lock(key: string, ttlMs = 10000): Promise<boolean> {
    const ok = await this.client.set(`lock:${key}`, '1', 'PX', ttlMs, 'NX');
    return ok === 'OK';
  }

  async unlock(key: string): Promise<void> {
    await this.client.del(`lock:${key}`);
  }

  /** 事件发布（Redis Stream），MAXLEN 防止无限增长 */
  async publishEvent(stream: string, fields: Record<string, string>): Promise<string | null> {
    return this.client.xadd(stream, 'MAXLEN', '~', '1000000', '*', ...Object.entries(fields).flat());
  }

  async onModuleDestroy() {
    await this.client.quit();
    await this.subscriber.quit();
  }
}
