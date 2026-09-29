import type { ZodError } from 'zod';

export type FieldErrors = Record<string, string[]>;

/**
 * Flatten a Zod error into the `fields` map the API error envelope carries.
 *
 * Paths are dot/bracket notation (`lines[0].quantity`) so a React Hook Form or a
 * dashboard form can map a server-side failure straight onto the offending input
 * without any translation layer.
 */
export function formatZodError(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};

  for (const issue of error.issues) {
    const path = issue.path.reduce<string>((accumulator, segment) => {
      if (typeof segment === 'number') return `${accumulator}[${segment}]`;
      return accumulator ? `${accumulator}.${segment}` : String(segment);
    }, '');

    const key = path || '_';
    const existing = fields[key];
    if (existing) {
      existing.push(issue.message);
    } else {
      fields[key] = [issue.message];
    }
  }

  return fields;
}

/** First message, for toasts and other single-line surfaces. */
export function firstErrorMessage(error: ZodError, fallback = 'Please check your details.'): string {
  return error.issues[0]?.message ?? fallback;
}
