import { createHmac } from 'node:crypto';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { getEnv } from '../../env';
import { isPrivateAddress, parseEndpoint } from './endpoint';
import type { PosAdapter, PosDelivery, PosDeliveryResult } from './types';

/**
 * The generic POS adapter: one signed HTTPS POST per event.
 *
 * Headers the receiver gets:
 *   X-GrabGo-Event       order.created, order.accepted, …, or ping
 *   X-GrabGo-Delivery    stable per event; deduplicate on it (delivery is at
 *                        least once, so the same event can arrive twice)
 *   X-GrabGo-Timestamp   unix seconds; reject anything older than 5 minutes
 *   X-GrabGo-Signature   v1=hex(HMAC-SHA256(secret, `${timestamp}.${body}`))
 *
 * Any 2xx is success. 408, 429 and 5xx (and network errors) are retried; any
 * other 4xx means the receiver rejected the payload, which retrying will not
 * fix, so the delivery fails at once and shows up for the café to look at.
 *
 * Redirects are not followed, and the connection re-checks the resolved
 * address, so a hostname that passed validation cannot be re-pointed at a
 * private address afterwards (DNS rebinding).
 */

const TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 300;

export function signPayload(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

function guardedLookup(
  hostname: string,
  options: object,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '');
    const list = addresses as LookupAddress[];
    if (getEnv().NODE_ENV !== 'development' && list.some((entry) => isPrivateAddress(entry.address))) {
      return callback(Object.assign(new Error('Endpoint resolves to a private address'), { code: 'EPRIVATE' }), '');
    }
    const wantsAll = (options as { all?: boolean }).all === true;
    const first = list[0];
    if (wantsAll) return callback(null, list);
    return callback(null, first?.address ?? '', first?.family);
  });
}

function post(url: URL, headers: Record<string, string>, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
        lookup: guardedLookup as never,
        timeout: TIMEOUT_MS,
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          // Only the start matters for an error message; do not buffer a huge body.
          if (text.length < 2000) text += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, text }));
      },
    );
    request.on('timeout', () => request.destroy(new Error(`No response within ${TIMEOUT_MS / 1000}s`)));
    request.on('error', reject);
    request.end(body);
  });
}

const NETWORK_ERRORS: Record<string, string> = {
  ECONNREFUSED: 'Connection refused: nothing is listening at that address',
  ENOTFOUND: 'Host not found: check the endpoint address',
  EAI_AGAIN: 'Could not look up the host (DNS); will retry',
  ECONNRESET: 'The connection was dropped by the endpoint',
  ETIMEDOUT: 'The connection timed out',
  EHOSTUNREACH: 'The endpoint host is unreachable',
  CERT_HAS_EXPIRED: 'The endpoint’s HTTPS certificate has expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The endpoint uses a self-signed certificate',
  ERR_TLS_CERT_ALTNAME_INVALID: 'The endpoint’s certificate does not match its address',
};

/** Node reports some failures (e.g. a refused connection) with an empty message. */
function describeNetworkError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  const known = code ? NETWORK_ERRORS[code] : undefined;
  if (known) return known;
  const message = (error as Error).message;
  if (message) return message;
  return code ? `Could not reach the endpoint (${code})` : 'Could not reach the endpoint';
}

export const webhookAdapter: PosAdapter = {
  provider: 'WEBHOOK',

  async deliver(delivery: PosDelivery): Promise<PosDeliveryResult> {
    let url: URL;
    try {
      url = parseEndpoint(delivery.endpointUrl);
    } catch (error) {
      return { ok: false, retryable: false, error: (error as Error).message };
    }

    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);

    try {
      const response = await post(
        url,
        {
          'content-type': 'application/json',
          'user-agent': 'GrabAndGo-POS/1',
          'x-grabgo-event': delivery.event,
          'x-grabgo-delivery': delivery.deliveryId,
          'x-grabgo-timestamp': String(timestamp),
          'x-grabgo-signature': signPayload(delivery.secret, timestamp, body),
        },
        body,
      );

      if (response.status >= 200 && response.status < 300) {
        return { ok: true, statusCode: response.status };
      }

      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      const detail = response.text.trim().slice(0, 120);
      return {
        ok: false,
        retryable,
        statusCode: response.status,
        error: `Endpoint answered ${response.status}${detail ? `: ${detail}` : ''}`.slice(0, MAX_ERROR_LENGTH),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        ok: false,
        // A private address will not become public by waiting.
        retryable: code !== 'EPRIVATE',
        error: describeNetworkError(error).slice(0, MAX_ERROR_LENGTH),
      };
    }
  },
};
