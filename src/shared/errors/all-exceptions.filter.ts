import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ErrorCode } from './error-codes';
import { errorMessage } from './error-messages';
import { BusinessException } from './business.exception';

/** 统一 API 错误响应格式（成功响应保持裸数据，仅错误走此结构） */
export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  data: unknown;
  path: string;
  timestamp: string;
}

interface MappedError {
  httpStatus: number;
  code: ErrorCode;
  message: string;
  data: unknown;
}

const codeForStatus: Record<number, ErrorCode> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  429: ErrorCode.RATE_LIMITED,
};

/**
 * 全局异常过滤器（main.ts 注册，兜底所有未捕获异常）
 *
 * 原则：
 * - 客户端永远只拿到统一格式 { code, message, data, path, timestamp }
 * - 5xx 一律回通用文案，细节只进日志，不泄露堆栈/SQL/内部路径
 * - 4xx 按状态码取可配置文案；ValidationPipe 的字段明细放 data.details
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const path = `${request.method} ${request.url}`;

    const mapped = this.mapException(exception);
    const body: ApiErrorBody = {
      code: mapped.code,
      message: mapped.message,
      data: mapped.data,
      path,
      timestamp: new Date().toISOString(),
    };

    if (mapped.httpStatus >= 500) {
      this.logger.error(
        `${path} -> ${mapped.code} ${mapped.message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${path} -> ${mapped.code} ${mapped.message}`);
    }

    response.status(mapped.httpStatus).json(body);
  }

  private mapException(exception: unknown): MappedError {
    // 1. 业务异常：自带 code，文案可配置
    if (exception instanceof BusinessException) {
      const payload = exception.getResponse() as { code: ErrorCode; message: string; data: unknown };
      return { httpStatus: exception.getStatus(), code: payload.code, message: payload.message, data: payload.data };
    }

    // 2. Prisma 已知错误：唯一键冲突 / 记录不存在 → 4xx，其余 5xx 不暴露细节
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return this.conflict(errorMessage(ErrorCode.CONFLICT));
      }
      if (exception.code === 'P2025') {
        return this.notFound(errorMessage(ErrorCode.NOT_FOUND));
      }
      return this.serverError(ErrorCode.DB_ERROR, `prisma ${exception.code}`);
    }

    // 3. NestJS HttpException 族
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();

      // ValidationPipe：{ message: string[] | string, error: 'Bad Request' }
      if (status === HttpStatus.BAD_REQUEST && resp && typeof resp === 'object' && 'message' in resp) {
        const details = Array.isArray((resp as { message: unknown }).message)
          ? ((resp as { message: string[] }).message as string[])
          : [String((resp as { message: unknown }).message)];
        return {
          httpStatus: status,
          code: ErrorCode.VALIDATION_FAILED,
          message: errorMessage(ErrorCode.VALIDATION_FAILED),
          data: { details },
        };
      }

      const code = codeForStatus[status] ?? (status < 500 ? ErrorCode.BAD_REQUEST : ErrorCode.INTERNAL_ERROR);
      // 显式传入字符串 message 的 HttpException 保留原文（视为开发者有意为之），否则用可配置文案
      const explicit = typeof resp === 'string' ? resp : resp && typeof (resp as { message?: unknown }).message === 'string' ? (resp as { message: string }).message : undefined;
      return {
        httpStatus: status,
        code,
        message: status < 500 && explicit ? explicit : errorMessage(code),
        data: null,
      };
    }

    // 4. 兜底：未知异常 → 500 通用文案
    return this.serverError(ErrorCode.INTERNAL_ERROR, exception instanceof Error ? exception.message : String(exception));
  }

  private notFound(message: string): MappedError {
    return { httpStatus: HttpStatus.NOT_FOUND, code: ErrorCode.NOT_FOUND, message, data: null };
  }

  private conflict(message: string): MappedError {
    return { httpStatus: HttpStatus.CONFLICT, code: ErrorCode.CONFLICT, message, data: null };
  }

  private serverError(code: ErrorCode, detail: string): MappedError {
    return { httpStatus: HttpStatus.INTERNAL_SERVER_ERROR, code, message: errorMessage(code), data: null };
  }
}
