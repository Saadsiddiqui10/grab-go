import { getEnv } from '../env';

/**
 * SMS delivery.
 *
 * Abstracted behind one function because the Pakistani SMS market is a moving
 * target — a launch might start on Twilio and move to a local aggregator for
 * cost or deliverability. Only this file changes when that happens.
 *
 * In development the `mock` provider logs the message, which is what makes it
 * possible to sign in on a simulator with no phone and no SMS spend.
 */

export interface SmsProvider {
  send(to: string, message: string): Promise<void>;
}

class MockSmsProvider implements SmsProvider {
  async send(to: string, message: string): Promise<void> {
    console.info(`[sms:mock] to=${to} :: ${message}`);
  }
}

class TwilioSmsProvider implements SmsProvider {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
  ) {}

  async send(to: string, message: string): Promise<void> {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: this.from, Body: message }),
      },
    );

    if (!response.ok) {
      // The message text is never logged: it contains a live OTP.
      throw new Error(`Twilio rejected the message (${response.status})`);
    }
  }
}

let cached: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (cached) return cached;

  const env = getEnv();

  if (env.SMS_PROVIDER === 'twilio') {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
      throw new Error('SMS_PROVIDER=twilio requires the TWILIO_* variables to be set');
    }
    cached = new TwilioSmsProvider(
      env.TWILIO_ACCOUNT_SID,
      env.TWILIO_AUTH_TOKEN,
      env.TWILIO_FROM_NUMBER,
    );
  } else {
    cached = new MockSmsProvider();
  }

  return cached;
}

export function setSmsProvider(provider: SmsProvider | null): void {
  cached = provider;
}

/**
 * Send, but never let a delivery failure break the caller.
 *
 * If the gateway is down, the OTP row still exists; the customer can retry, and
 * the alternative — a 500 on the login screen — is worse.
 */
export async function sendSms(to: string, message: string): Promise<void> {
  try {
    await getSmsProvider().send(to, message);
  } catch (error) {
    console.error('[sms] delivery failed', error);
  }
}
