import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { getEnv } from '../../env';

/**
 * Guarding the URL a café asks us to call.
 *
 * A POS endpoint is a URL a merchant typed, fetched by our server: left
 * unchecked it is a way to make the API call its own database, a cloud
 * metadata service or anything else on the private network (SSRF). So outside
 * development the endpoint must be HTTPS on the default port, and every address
 * its hostname resolves to must be public. The check runs again before each
 * delivery, because DNS can change after the URL was saved.
 *
 * Development allows http and private addresses so a local receiver works.
 */

export class UnsafeEndpointError extends Error {}

function allowPrivate(): boolean {
  return getEnv().NODE_ENV === 'development';
}

/** Syntax and scheme only; cheap enough to run on every save. */
export function parseEndpoint(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeEndpointError('Enter a full URL, starting with https://');
  }

  if (url.username || url.password) {
    throw new UnsafeEndpointError('Put credentials in your receiver, not in the URL.');
  }

  if (url.protocol !== 'https:' && !(allowPrivate() && url.protocol === 'http:')) {
    throw new UnsafeEndpointError('The endpoint must use https://');
  }

  if (!allowPrivate() && url.port !== '' && url.port !== '443') {
    throw new UnsafeEndpointError('The endpoint must use the standard HTTPS port.');
  }

  return url;
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }

  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    // IPv4-mapped: judge the embedded IPv4 address.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return (
      lower.startsWith('fc') ||
      lower.startsWith('fd') || // unique local
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') || // link-local
      lower.startsWith('ff') // multicast
    );
  }

  return true;
}

/** Full check, including DNS. Throws `UnsafeEndpointError`. */
export async function assertSafeEndpoint(raw: string): Promise<URL> {
  const url = parseEndpoint(raw);
  if (allowPrivate()) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true, verbatim: true })
        .then((results) => results.map((result) => result.address))
        .catch(() => {
          throw new UnsafeEndpointError(`Could not find ${host}. Check the address.`);
        });

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UnsafeEndpointError('The endpoint must be reachable on the public internet.');
  }

  return url;
}
