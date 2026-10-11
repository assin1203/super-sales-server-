/**
 * 统一业务错误码
 *
 * 编号规则：前 3 位 = 对应 HTTP 状态码，后 2 位 = 类内序号，
 * 客户端可用 Math.floor(code / 100) 还原 HTTP 状态做粗粒度判断。
 */
export const ErrorCode = {
  BAD_REQUEST: 40000, // 请求错误（通用）
  VALIDATION_FAILED: 40001, // 参数校验失败（字段明细见 data.details）
  UNAUTHORIZED: 40100, // 未携带凭证
  TOKEN_EXPIRED: 40101, // 凭证过期
  TOKEN_INVALID: 40102, // 凭证无效（签名错误 / audience 不匹配 / 格式错误）
  ACCOUNT_DISABLED: 40103, // 账号已冻结/封禁
  FORBIDDEN: 40300, // 无权限（通用）
  PERMISSION_DENIED: 40301, // RBAC 权限点不足
  NOT_FOUND: 40400, // 资源不存在
  CONFLICT: 40900, // 数据冲突（唯一键等）
  RATE_LIMITED: 42900, // 触发限流/防刷
  INTERNAL_ERROR: 50000, // 服务端未知错误（不暴露细节）
  DB_ERROR: 50001, // 数据库异常（不暴露细节）
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
