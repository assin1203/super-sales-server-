/**
 * 领域常量：积分来源与事件流命名（对齐架构文档 §5.1 / 数据库设计 point_flow.flow_type）。
 */
export const FLOW_TYPE = {
  INSTALL: 'INSTALL', // 安装积分（冻结）
  QUALIFIED: 'QUALIFIED', // 达标入队积分
  REFERRAL_L1: 'REFERRAL_L1',
  REFERRAL_L2: 'REFERRAL_L2',
  REFERRAL_L3: 'REFERRAL_L3',
  DIVIDEND: 'DIVIDEND', // 团队分红
  DIVIDEND_REFERRAL: 'DIVIDEND_REFERRAL', // 分红联动
  TASK: 'TASK',
  GIFT: 'GIFT',
  MALL_CONSUME: 'MALL_CONSUME', // 商城核销
  EXPIRE: 'EXPIRE',
  ADJUST: 'ADJUST', // 后台调账
} as const;

export type FlowType = (typeof FLOW_TYPE)[keyof typeof FLOW_TYPE];

export const EVT_STREAM = {
  POS_INSTALLED: 'evt:pos.installed',
  POS_QUALIFIED: 'evt:pos.qualified',
  TEAM_FULL: 'evt:team.full',
  TASK_DONE: 'evt:task.done',
  MEMBER_UPGRADED: 'evt:member.upgraded',
  REFERRAL_QUALIFIED: 'evt:referral.qualified',
} as const;

export const MEMBER_LEVEL = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
} as const;

export type MemberLevel = (typeof MEMBER_LEVEL)[keyof typeof MEMBER_LEVEL];
