import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * 三级会员（FR-2.x）：L0~L3，只升不降。
 * 晋级条件（达标/直推达标数/积分累计）满足即自动晋级，系数上浮。
 */
@Injectable()
export class MemberService {
  constructor(private readonly prisma: PrismaService) {}

  /** 奖励系数：L1 ×1.0 / L2 ×1.5 / L3 ×2.0（默认值，规则表可配） */
  levelFactor(level: number): number {
    return [1, 1, 1.5, 2][level] ?? 1;
  }
}
