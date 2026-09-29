import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { notificationCopy, deepLinks } from '@grabgo/config';
import type { NotificationChannel, NotificationTopic } from '@prisma/client';
import type { DbOrTx } from '../db';
import { prisma } from '../db';
import { getEnv } from '../env';

/**
 * Push notifications.
 *
 * Delivery is fire-and-forget: an order must never fail because a push token has
 * gone stale. Every send is also persisted as a `Notification` row, which gives
 * the in-app inbox its content and makes "did the customer get told?" answerable
 * during support.
 *
 * Preferences are checked before sending. A customer who turned off promotions
 * still gets order updates — those are transactional, not marketing.
 */

let expoClient: Expo | null = null;

function getExpo(): Expo {
  const env = getEnv();
  expoClient ??= new Expo(
    env.EXPO_ACCESS_TOKEN ? { accessToken: env.EXPO_ACCESS_TOKEN } : {},
  );
  return expoClient;
}

export interface NotifyInput {
  userId: string;
  topic: NotificationTopic;
  title: string;
  body: string;
  data?: Record<string, string>;
  channel?: NotificationChannel;
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    await deliver(input);
  } catch (error) {
    console.error('[notify] delivery failed', input.topic, error);
  }
}

async function deliver(input: NotifyInput): Promise<void> {
  const env = getEnv();
  const channel = input.channel ?? 'PUSH';

  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      topic: input.topic,
      channel,
      title: input.title,
      body: input.body,
      data: input.data ?? undefined,
    },
    select: { id: true },
  });

  if (channel !== 'PUSH' || !env.PUSH_ENABLED) return;

  const allowed = await isTopicEnabled(prisma, input.userId, input.topic, 'PUSH');
  if (!allowed) return;

  const devices = await prisma.deviceToken.findMany({
    where: { userId: input.userId },
    select: { id: true, token: true },
  });

  const messages: ExpoPushMessage[] = devices
    .filter((device) => Expo.isExpoPushToken(device.token))
    .map((device) => ({
      to: device.token,
      sound: 'default',
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      // Order updates are time-critical: a "ready" push that arrives batched
      // fifteen minutes later has missed its entire purpose.
      priority: input.topic === 'ORDER_UPDATES' ? 'high' : 'normal',
      channelId: input.topic === 'ORDER_UPDATES' ? 'orders' : 'default',
    }));

  if (messages.length === 0) return;

  const expo = getExpo();
  const tickets: ExpoPushTicket[] = [];

  for (const chunk of expo.chunkPushNotifications(messages)) {
    tickets.push(...(await expo.sendPushNotificationsAsync(chunk)));
  }

  await pruneDeadTokens(tickets, devices);

  await prisma.notification.update({
    where: { id: notification.id },
    data: { sentAt: new Date() },
  });
}

/**
 * Expo reports a permanently unregistered device with `DeviceNotRegistered`.
 * Deleting those keeps the token table from filling with dead entries that slow
 * every subsequent send.
 */
async function pruneDeadTokens(
  tickets: ExpoPushTicket[],
  devices: Array<{ id: string; token: string }>,
): Promise<void> {
  const dead: string[] = [];

  tickets.forEach((ticket, index) => {
    if (ticket.status !== 'error') return;
    if (ticket.details?.error !== 'DeviceNotRegistered') return;
    const device = devices[index];
    if (device) dead.push(device.id);
  });

  if (dead.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { id: { in: dead } } });
  }
}

export async function isTopicEnabled(
  db: DbOrTx,
  userId: string,
  topic: NotificationTopic,
  channel: NotificationChannel,
): Promise<boolean> {
  const preference = await db.notificationPreference.findUnique({
    where: { userId_topic_channel: { userId, topic, channel } },
    select: { enabled: true },
  });

  // Absent means default-on: a new user should hear that their coffee is ready.
  return preference?.enabled ?? true;
}

/* ------------------------------------------------------------- order updates */

export interface OrderNotificationContext {
  userId: string;
  orderId: string;
  orderNumber: string;
  businessName: string;
}

/** Map an order status onto the right push, or nothing when it is not worth one. */
export async function notifyOrderStatus(
  status: string,
  context: OrderNotificationContext,
): Promise<void> {
  const data = {
    orderId: context.orderId,
    orderNumber: context.orderNumber,
    url: deepLinks.order(context.orderId),
  };

  const copy = (() => {
    switch (status) {
      case 'ACCEPTED':
        return notificationCopy.ORDER_ACCEPTED;
      case 'PREPARING':
        return notificationCopy.ORDER_PREPARING;
      case 'READY':
        return notificationCopy.ORDER_READY;
      case 'CANCELLED_BY_CAFE':
      case 'CANCELLED_BY_ADMIN':
      case 'EXPIRED':
        return notificationCopy.ORDER_CANCELLED;
      default:
        // PENDING, PICKED_UP and COMPLETED need no push: the customer is either
        // looking at the screen or standing at the counter.
        return null;
    }
  })();

  if (!copy) return;

  await notify({
    userId: context.userId,
    topic: 'ORDER_UPDATES',
    title: copy.title,
    body: copy.body,
    data,
  });
}

export async function notifyPointsProgress(
  userId: string,
  pointsToNextReward: number,
): Promise<void> {
  // Only worth interrupting someone for when the reward is genuinely in reach.
  if (pointsToNextReward <= 0 || pointsToNextReward > 50) return;

  await notify({
    userId,
    topic: 'LOYALTY',
    title: notificationCopy.POINTS_NEAR_REWARD.title,
    body: notificationCopy.POINTS_NEAR_REWARD.body(pointsToNextReward),
    data: { url: deepLinks.rewards() },
  });
}

export async function notifyReferralJoined(referrerId: string): Promise<void> {
  await notify({
    userId: referrerId,
    topic: 'REFERRALS',
    title: notificationCopy.REFERRAL_JOINED.title,
    body: notificationCopy.REFERRAL_JOINED.body,
  });
}

export async function notifyRewardUnlocked(userId: string): Promise<void> {
  await notify({
    userId,
    topic: 'LOYALTY',
    title: notificationCopy.REWARD_READY.title,
    body: notificationCopy.REWARD_READY.body,
    data: { url: deepLinks.rewards() },
  });
}
