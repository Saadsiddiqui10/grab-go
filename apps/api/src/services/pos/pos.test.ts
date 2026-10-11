import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isPrivateAddress, parseEndpoint, UnsafeEndpointError } from './endpoint';
import { decryptPosSecret, encryptPosSecret, generatePosSecret } from './secrets';
import { signPayload, webhookAdapter } from './webhook-adapter';
import { eventForStatus, MAX_ATTEMPTS, nextAttemptDelaySeconds } from './pos.service';

describe('POS signing', () => {
  it('signs timestamp.body with HMAC-SHA256, as documented for receivers', () => {
    const body = JSON.stringify({ event: 'order.created' });
    const expected = createHmac('sha256', 'secret').update(`1760000000.${body}`).digest('hex');
    expect(signPayload('secret', 1760000000, body)).toBe(`v1=${expected}`);
  });

  it('changes the signature when the body is tampered with', () => {
    expect(signPayload('s', 1, '{"total":100}')).not.toBe(signPayload('s', 1, '{"total":1}'));
  });
});

describe('POS secrets at rest', () => {
  it('round-trips, with a fresh ciphertext each time', () => {
    const secret = generatePosSecret();
    const first = encryptPosSecret(secret, 'biz_a');
    expect(first).not.toContain(secret);
    expect(encryptPosSecret(secret, 'biz_a')).not.toBe(first);
    expect(decryptPosSecret(first, 'biz_a')).toBe(secret);
  });

  it('refuses a ciphertext copied onto another cafe', () => {
    const stored = encryptPosSecret(generatePosSecret(), 'biz_a');
    expect(() => decryptPosSecret(stored, 'biz_b')).toThrow();
  });

  it('refuses a tampered ciphertext', () => {
    const [v, iv, tag, data = ''] = encryptPosSecret('ggpos_x', 'biz_a').split('.');
    const flipped = `${data.startsWith('A') ? 'B' : 'A'}${data.slice(1)}`;
    expect(() => decryptPosSecret([v, iv, tag, flipped].join('.'), 'biz_a')).toThrow();
  });
});

describe('POS endpoint safety', () => {
  it('flags private, loopback, link-local and metadata addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const address of ['8.8.8.8', '104.16.1.1', '2606:4700::6810:1', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('requires https on the standard port, without credentials', () => {
    expect(parseEndpoint('https://pos.example.com/grabgo').hostname).toBe('pos.example.com');
    for (const raw of [
      'http://pos.example.com',
      'https://pos.example.com:8443/x',
      'https://user:pass@pos.example.com',
      'ftp://pos.example.com',
      'not a url',
    ]) {
      expect(() => parseEndpoint(raw), raw).toThrow(UnsafeEndpointError);
    }
  });

  it('will not deliver to a local address', async () => {
    const result = await webhookAdapter.deliver({
      deliveryId: 'job_1',
      event: 'ping',
      payload: {},
      endpointUrl: 'http://127.0.0.1:4000/hook',
      secret: 's',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(false);
  });
});

describe('POS retries', () => {
  it('backs off, then gives up', () => {
    expect(nextAttemptDelaySeconds(1)).toBe(30);
    expect(nextAttemptDelaySeconds(2)).toBe(120);
    expect(nextAttemptDelaySeconds(MAX_ATTEMPTS - 1)).toBe(21600);
    expect(nextAttemptDelaySeconds(MAX_ATTEMPTS)).toBeNull();
  });

  it('names events after the order status', () => {
    expect(eventForStatus('PENDING')).toBe('order.created');
    expect(eventForStatus('PICKED_UP')).toBe('order.picked_up');
  });
});
