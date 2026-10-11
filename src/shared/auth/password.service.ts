import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * 密码哈希：Node 标准库 crypto.scrypt（零第三方依赖）
 * 存储格式：scrypt$<saltHex(32)>$<hashHex(64)> = 104 字符（适配 VARCHAR(128) 列）
 * 参数 N=16384 r=8 p=1（OWASP 推荐），32 字节派生密钥，恒定时间比较。
 */
@Injectable()
export class PasswordService {
  private readonly N = 16384;
  private readonly r = 8;
  private readonly p = 1;
  private readonly keyLen = 32;

  async hash(password: string): Promise<string> {
    const salt = crypto.randomBytes(16);
    const derived = await this.derive(password, salt);
    return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    if (expected.length !== this.keyLen || salt.length === 0) return false;
    const actual = await this.derive(password, salt);
    return crypto.timingSafeEqual(actual, expected);
  }

  private derive(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, this.keyLen, { N: this.N, r: this.r, p: this.p }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
  }
}
