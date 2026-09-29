import type { TypeOf, ZodTypeAny } from 'zod';
import { formatZodError } from '@grabgo/validation';
import { HttpError } from './http-error';

/**
 * Parse untrusted input against a schema, or fail with a field-level 422.
 *
 * Every route body, query string and param goes through here. The client gets a
 * `fields` map keyed by dot-path, which the mobile forms and dashboards bind
 * directly onto their inputs.
 */
export function parse<Schema extends ZodTypeAny>(
  schema: Schema,
  input: unknown,
  what = 'request',
): TypeOf<Schema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new HttpError('VALIDATION_ERROR', `Please check the ${what} and try again.`, {
      fields: formatZodError(result.error),
    });
  }

  return result.data;
}

/** Cursor pagination over an opaque, base64url-encoded cursor. */
export function encodeCursor(value: { id: string; sortValue?: string | number }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor(
  cursor: string | null | undefined,
): { id: string; sortValue?: string | number } | null {
  if (!cursor) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { id?: unknown }).id === 'string'
    ) {
      return parsed as { id: string; sortValue?: string | number };
    }
  } catch {
    // A malformed cursor is a client bug, not a server error: start from the top
    // rather than failing a browse request the user can see no way to fix.
  }

  return null;
}

/**
 * Take one more row than asked for to learn whether another page exists, without
 * a second COUNT query.
 */
export function paginate<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null,
  };
}
