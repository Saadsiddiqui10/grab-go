import {
  API_ERROR_STATUS,
  ApiErrorCode,
  type ApiError,
  type ApiSuccess,
  type PaginationMeta,
} from '@grabgo/types';
import { DomainError, isDomainError, type Result } from '@grabgo/core';
import type { FieldErrors } from '@grabgo/validation';

/**
 * The HTTP boundary.
 *
 * Domain code throws `DomainError` or returns `Result`; this module is the only
 * place that knows those map onto status codes and JSON envelopes. Handlers never
 * build an error body by hand, so every failure the client sees has the same shape.
 */

export class HttpError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly fields: FieldErrors | undefined;
  readonly details: Record<string, unknown> | undefined;
  /** True for expected failures (bad input, closed cafe) — logged at debug, not error. */
  readonly expected: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: {
      fields?: FieldErrors;
      details?: Record<string, unknown>;
      statusCode?: number;
      expected?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.statusCode = options.statusCode ?? API_ERROR_STATUS[code] ?? 500;
    this.fields = options.fields;
    this.details = options.details;
    this.expected = options.expected ?? this.statusCode < 500;
    Object.setPrototypeOf(this, HttpError.prototype);
  }

  static fromDomain(error: DomainError): HttpError {
    return new HttpError(error.code, error.message, { details: error.details });
  }

  toBody(requestId?: string): ApiError {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
        ...(this.details ? { details: this.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
  }
}

/* --------------------------------------------------------------- shorthands */

export const badRequest = (message: string, fields?: FieldErrors): HttpError =>
  new HttpError(ApiErrorCode.VALIDATION_ERROR, message, fields ? { fields } : {});

export const unauthenticated = (message = 'Please sign in to continue.'): HttpError =>
  new HttpError(ApiErrorCode.UNAUTHENTICATED, message);

export const forbidden = (message = 'You do not have access to this.'): HttpError =>
  new HttpError(ApiErrorCode.FORBIDDEN, message);

export const notFound = (what = 'That'): HttpError =>
  new HttpError(ApiErrorCode.NOT_FOUND, `${what} could not be found.`);

export const conflict = (message: string, details?: Record<string, unknown>): HttpError =>
  new HttpError(ApiErrorCode.CONFLICT, message, details ? { details } : {});

export const internal = (message = 'Something went wrong. Please try again.'): HttpError =>
  new HttpError(ApiErrorCode.INTERNAL_ERROR, message, { expected: false });

/** Normalise anything thrown into an `HttpError`. */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (isDomainError(error)) return HttpError.fromDomain(error);

  if (error instanceof Error) {
    // Prisma surfaces a unique-constraint violation as P2002; it almost always
    // means the client raced itself rather than that the server broke.
    const code = (error as { code?: string }).code;
    if (code === 'P2002') {
      return conflict('That already exists.');
    }
    if (code === 'P2025') {
      return notFound('That record');
    }
  }

  return internal();
}

/**
 * Unwrap a domain `Result`, throwing the HTTP equivalent on failure.
 * Lets a handler read as a straight line while keeping the domain throw-free.
 */
export function expect<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new HttpError(result.code, result.message, {
    ...(result.details ? { details: result.details } : {}),
  });
}

/* ------------------------------------------------------------- success bodies */

export function success<T>(data: T, meta?: PaginationMeta): ApiSuccess<T> {
  return meta ? { ok: true, data, meta } : { ok: true, data };
}
