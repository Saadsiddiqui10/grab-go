import { type ApiErrorCode } from '@grabgo/types';

/**
 * A rule violation the caller can act on, as opposed to a bug.
 *
 * Domain code throws these; the HTTP layer maps `code` to a status and body, and
 * the mobile app switches on `code` to pick its copy. Nothing in this package
 * knows about HTTP.
 */
export class DomainError extends Error {
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** Narrow a `Result` failure into a throw at the boundary where that is wanted. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new DomainError(result.code, result.message, result.details);
}

/**
 * Explicit success/failure return for rules that are *expected* to fail routinely
 * (an expired promo code, a busy cafe). Throwing for those makes call sites noisy,
 * so they return a `Result` and the caller decides whether it is fatal.
 */
export type Result<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: ApiErrorCode;
      message: string;
      details?: Record<string, unknown>;
    };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Result<T> {
  return details ? { ok: false, code, message, details } : { ok: false, code, message };
}
