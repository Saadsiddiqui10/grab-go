/**
 * Transport-level API contract: envelopes, pagination and the error taxonomy.
 *
 * Every response the API produces is one of `ApiSuccess` / `ApiError`, so clients
 * have exactly one shape to branch on and error handling can live in one place.
 */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    /** Field-level validation problems, keyed by dot-path. */
    fields?: Record<string, string[]>;
    /** Correlates a client report with the server log line. */
    requestId?: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginationMeta {
  /** Opaque cursor for the next page; null when the list is exhausted. */
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

export interface CursorPageParams {
  cursor?: string | null;
  limit?: number;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

/**
 * Stable machine-readable error codes.
 *
 * Clients switch on these, never on message text. New codes may be added; clients
 * must treat unknown codes as `INTERNAL_ERROR`.
 */
export const ApiErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',

  BUSINESS_CLOSED: 'BUSINESS_CLOSED',
  BUSINESS_NOT_ACCEPTING_ORDERS: 'BUSINESS_NOT_ACCEPTING_ORDERS',
  BUSINESS_AT_CAPACITY: 'BUSINESS_AT_CAPACITY',
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  INVALID_PICKUP_TIME: 'INVALID_PICKUP_TIME',
  EMPTY_CART: 'EMPTY_CART',
  CART_BUSINESS_MISMATCH: 'CART_BUSINESS_MISMATCH',
  MODIFIER_SELECTION_INVALID: 'MODIFIER_SELECTION_INVALID',
  MINIMUM_ORDER_NOT_MET: 'MINIMUM_ORDER_NOT_MET',

  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  ORDER_NOT_CANCELLABLE: 'ORDER_NOT_CANCELLABLE',
  PICKUP_CODE_INVALID: 'PICKUP_CODE_INVALID',
  PICKUP_CODE_LOCKED: 'PICKUP_CODE_LOCKED',
  ORDER_NOT_READY: 'ORDER_NOT_READY',

  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_NOT_VERIFIED: 'PAYMENT_NOT_VERIFIED',
  PAYMENT_ALREADY_SETTLED: 'PAYMENT_ALREADY_SETTLED',
  REFUND_FAILED: 'REFUND_FAILED',

  INSUFFICIENT_POINTS: 'INSUFFICIENT_POINTS',
  REWARD_UNAVAILABLE: 'REWARD_UNAVAILABLE',
  REDEMPTION_INVALID: 'REDEMPTION_INVALID',

  PROMO_INVALID: 'PROMO_INVALID',
  PROMO_EXPIRED: 'PROMO_EXPIRED',
  PROMO_LIMIT_REACHED: 'PROMO_LIMIT_REACHED',
  PROMO_NOT_APPLICABLE: 'PROMO_NOT_APPLICABLE',

  REFERRAL_SELF: 'REFERRAL_SELF',
  REFERRAL_ALREADY_USED: 'REFERRAL_ALREADY_USED',
  REFERRAL_CODE_INVALID: 'REFERRAL_CODE_INVALID',

  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_TOO_MANY_ATTEMPTS: 'OTP_TOO_MANY_ATTEMPTS',

  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** HTTP status paired with each code, so handlers never guess. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  ACCOUNT_SUSPENDED: 403,

  BUSINESS_CLOSED: 409,
  BUSINESS_NOT_ACCEPTING_ORDERS: 409,
  BUSINESS_AT_CAPACITY: 409,
  ITEM_UNAVAILABLE: 409,
  INVALID_PICKUP_TIME: 422,
  EMPTY_CART: 422,
  CART_BUSINESS_MISMATCH: 422,
  MODIFIER_SELECTION_INVALID: 422,
  MINIMUM_ORDER_NOT_MET: 422,

  INVALID_STATE_TRANSITION: 409,
  ORDER_NOT_CANCELLABLE: 409,
  PICKUP_CODE_INVALID: 400,
  PICKUP_CODE_LOCKED: 429,
  ORDER_NOT_READY: 409,

  PAYMENT_FAILED: 402,
  PAYMENT_NOT_VERIFIED: 402,
  PAYMENT_ALREADY_SETTLED: 409,
  REFUND_FAILED: 409,

  INSUFFICIENT_POINTS: 409,
  REWARD_UNAVAILABLE: 409,
  REDEMPTION_INVALID: 409,

  PROMO_INVALID: 422,
  PROMO_EXPIRED: 422,
  PROMO_LIMIT_REACHED: 409,
  PROMO_NOT_APPLICABLE: 422,

  REFERRAL_SELF: 422,
  REFERRAL_ALREADY_USED: 409,
  REFERRAL_CODE_INVALID: 422,

  OTP_INVALID: 400,
  OTP_EXPIRED: 410,
  OTP_TOO_MANY_ATTEMPTS: 429,

  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/**
 * Copy shown to customers. The API sends a message with every error, but clients
 * prefer this table so wording stays consistent and localisable in one place.
 */
export const API_ERROR_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  BUSINESS_CLOSED: 'This cafe is currently closed.',
  BUSINESS_NOT_ACCEPTING_ORDERS: 'This cafe is not taking orders right now.',
  BUSINESS_AT_CAPACITY: 'This cafe is busy right now. Try a later pickup time.',
  ITEM_UNAVAILABLE: 'Sorry, this item is no longer available.',
  INVALID_PICKUP_TIME: 'That pickup time is no longer available. Pick another slot.',
  PAYMENT_FAILED: "Payment couldn't be completed. Try another payment method.",
  INSUFFICIENT_POINTS: 'You need more Grab Points to redeem this reward.',
  PICKUP_CODE_INVALID: 'That pickup code is not valid for this order.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  INTERNAL_ERROR: 'Something went wrong. Check your connection and try again.',
  SERVICE_UNAVAILABLE: 'Something went wrong. Check your connection and try again.',
};
