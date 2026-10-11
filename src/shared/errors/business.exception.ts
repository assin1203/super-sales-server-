import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';
import { errorMessage } from './error-messages';

/**
 * 业务异常：Service 层抛出已知的业务态（如积分不足、风控拦截、密码错误）。
 * 全局过滤器 AllExceptionsFilter 将其翻译成统一响应格式；
 * 用户可见文案默认取可配置的 error-messages 表，也可显式传入。
 */
export class BusinessException extends HttpException {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, status: HttpStatus, message?: string, data?: unknown) {
    super(
      {
        code,
        message: message ?? errorMessage(code),
        data: data ?? null,
      },
      status,
    );
    this.code = code;
  }
}
