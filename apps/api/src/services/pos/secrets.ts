import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { getEnv } from '../../env';
import { HttpError } from '../../lib/http-error';

/**
 * POS signing secrets, encrypted at rest.
 *
 * Unlike tokens and passwords these cannot be hashed: the server needs the
 * plaintext to sign every delivery. AES-256-GCM, with a fresh IV per secret and
 * the café id bound in as associated data, so a ciphertext copied onto another
 * café's row fails to decrypt instead of signing for the wrong café.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */

function key(): Buffer {
  const env = getEnv();
  if (env.POS_SECRET_KEY) {
    return Buffer.from(hkdfSync('sha256', env.POS_SECRET_KEY, 'grabgo', 'pos-secret-v1', 32));
  }
  if (env.NODE_ENV === 'production') {
    throw new HttpError(
      'SERVICE_UNAVAILABLE',
      'POS connections are not configured on this server yet.',
    );
  }
  // Development and tests only: derived, so it changes if AUTH_SECRET does.
  return Buffer.from(hkdfSync('sha256', env.AUTH_SECRET, 'grabgo', 'pos-secret-dev-v1', 32));
}

export function generatePosSecret(): string {
  return `ggpos_${randomBytes(32).toString('base64url')}`;
}

export function encryptPosSecret(secret: string, businessId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(businessId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, ciphertext].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

export function decryptPosSecret(stored: string, businessId: string): string {
  const [version, iv, tag, ciphertext] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognised POS secret format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(businessId, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
