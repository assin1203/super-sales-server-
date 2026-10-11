import { ErrorCode } from './error-codes';

/**
 * 用户可见错误文案（唯一出口）
 *
 * - 默认文案在此维护；内部堆栈/SQL 细节一律不得出现在 message 中
 * - 可按环境覆盖：env 变量 ERROR_MESSAGES 传 JSON 对象，如
 *     ERROR_MESSAGES='{"40001":"部分参数有误，请检查后重新提交"}'
 *   只覆盖指定 code，其余回落默认文案；JSON 解析失败时静默忽略（不影响启动）
 */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.BAD_REQUEST]: '请求参数错误',
  [ErrorCode.VALIDATION_FAILED]: '请求参数校验失败，请检查后重试',
  [ErrorCode.UNAUTHORIZED]: '未登录或登录已失效，请重新登录',
  [ErrorCode.TOKEN_EXPIRED]: '登录已过期，请重新登录',
  [ErrorCode.TOKEN_INVALID]: '登录凭证无效，请重新登录',
  [ErrorCode.ACCOUNT_DISABLED]: '账号已被冻结，请联系客服',
  [ErrorCode.FORBIDDEN]: '无权执行此操作',
  [ErrorCode.PERMISSION_DENIED]: '暂无此操作权限，请联系管理员开通',
  [ErrorCode.NOT_FOUND]: '请求的资源不存在',
  [ErrorCode.CONFLICT]: '数据冲突，请勿重复操作',
  [ErrorCode.RATE_LIMITED]: '操作过于频繁，请稍后再试',
  [ErrorCode.INTERNAL_ERROR]: '系统繁忙，请稍后再试',
  [ErrorCode.DB_ERROR]: '系统繁忙，请稍后再试',
};

function loadOverrides(): Partial<Record<ErrorCode, string>> {
  const raw = process.env.ERROR_MESSAGES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<ErrorCode, string>> = {};
    for (const [code, msg] of Object.entries(parsed)) {
      if (typeof msg === 'string' && msg.length > 0) out[Number(code) as ErrorCode] = msg;
    }
    return out;
  } catch {
    return {};
  }
}

const OVERRIDES = loadOverrides();

/** 取错误码对应的用户可见文案（覆盖表 > 默认表 > fallback） */
export function errorMessage(code: ErrorCode, fallback?: string): string {
  return OVERRIDES[code] ?? DEFAULT_MESSAGES[code] ?? fallback ?? '未知错误';
}
