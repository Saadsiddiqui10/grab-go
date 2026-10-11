import type {
  NotificationPreferences,
  SavedAddress,
  UserProfile,
} from '@grabgo/types';
import type { NotificationChannel, NotificationTopic } from '@prisma/client';
import { prisma } from '../db';
import { HttpError, notFound } from '../lib/http-error';
import { toUserProfile, userWithProfile } from '../mappers';

/**
 * Customer profile, saved locations, favourites and notification preferences.
 */

const TOPICS: NotificationTopic[] = [
  'ORDER_UPDATES',
  'LOYALTY',
  'REFERRALS',
  'PROMOTIONS',
  'PRODUCT_NEWS',
];

export async function updateProfile(
  userId: string,
  input: {
    fullName?: string;
    email?: string;
    phone?: string;
    avatarUrl?: string | null;
    cityId?: string | null;
  },
): Promise<UserProfile> {
  // Email and phone are login identifiers, so a clash has to be reported rather
  // than silently swallowed by the unique index.
  if (input.email) {
    const taken = await prisma.user.findFirst({
      where: { email: input.email, id: { not: userId } },
      select: { id: true },
    });
    if (taken) throw new HttpError('CONFLICT', 'That email is already in use.');
  }

  if (input.phone) {
    const taken = await prisma.user.findFirst({
      where: { phone: input.phone, id: { not: userId } },
      select: { id: true },
    });
    if (taken) throw new HttpError('CONFLICT', 'That phone number is already in use.');
  }

  const user = await prisma.$transaction(async (tx) => {
    if (input.email !== undefined || input.phone !== undefined) {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.email !== undefined
            ? { email: input.email, emailVerifiedAt: null }
            : {}),
          // Changing either identifier resets its verified flag: the new address
          // has not been proven, and referral qualification depends on that.
          ...(input.phone !== undefined
            ? { phone: input.phone, phoneVerifiedAt: null }
            : {}),
        },
      });
    }

    if (
      input.fullName !== undefined ||
      input.avatarUrl !== undefined ||
      input.cityId !== undefined
    ) {
      await tx.userProfile.update({
        where: { userId },
        data: {
          ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
          ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
          ...(input.cityId !== undefined ? { cityId: input.cityId } : {}),
        },
      });
    }

    return tx.user.findUniqueOrThrow({ where: { id: userId }, ...userWithProfile });
  });

  return toUserProfile(user);
}

/* ---------------------------------------------------------------- favourites */

export async function addFavourite(userId: string, businessId: string): Promise<void> {
  const business = await prisma.business.findFirst({
    where: { id: businessId, deletedAt: null },
    select: { id: true },
  });
  if (!business) throw notFound('That cafe');

  await prisma.favourite.upsert({
    where: { userId_businessId: { userId, businessId } },
    create: { userId, businessId },
    update: {},
  });
}

export async function removeFavourite(userId: string, businessId: string): Promise<void> {
  await prisma.favourite.deleteMany({ where: { userId, businessId } });
}

export async function listFavouriteIds(userId: string): Promise<string[]> {
  const rows = await prisma.favourite.findMany({
    where: { userId },
    select: { businessId: true },
  });
  return rows.map((row) => row.businessId);
}

/* ------------------------------------------------------------ saved addresses */

export async function listAddresses(userId: string): Promise<SavedAddress[]> {
  const rows = await prisma.savedAddress.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    addressLine: row.addressLine,
    areaId: row.areaId,
    cityId: row.cityId,
    latitude: row.latitude,
    longitude: row.longitude,
    isDefault: row.isDefault,
  }));
}

export async function saveAddress(
  userId: string,
  input: {
    label: string;
    addressLine: string;
    areaId?: string | null;
    cityId: string;
    coordinates?: { latitude: number; longitude: number } | null;
    isDefault: boolean;
  },
): Promise<SavedAddress> {
  const row = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      // Exactly one default, so demote the incumbent in the same transaction.
      await tx.savedAddress.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.savedAddress.create({
      data: {
        userId,
        label: input.label,
        addressLine: input.addressLine,
        areaId: input.areaId ?? null,
        cityId: input.cityId,
        latitude: input.coordinates?.latitude ?? null,
        longitude: input.coordinates?.longitude ?? null,
        isDefault: input.isDefault,
      },
    });
  });

  return {
    id: row.id,
    label: row.label,
    addressLine: row.addressLine,
    areaId: row.areaId,
    cityId: row.cityId,
    latitude: row.latitude,
    longitude: row.longitude,
    isDefault: row.isDefault,
  };
}

export async function deleteAddress(userId: string, addressId: string): Promise<void> {
  await prisma.savedAddress.deleteMany({ where: { id: addressId, userId } });
}

/* ------------------------------------------------------------- notifications */

export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const rows = await prisma.notificationPreference.findMany({ where: { userId } });

  // Default-on: build the full matrix and let stored rows override it, so a new
  // topic added later is enabled without a backfill.
  const build = (channel: NotificationChannel): Record<NotificationTopic, boolean> => {
    const result = {} as Record<NotificationTopic, boolean>;
    for (const topic of TOPICS) {
      const stored = rows.find((row) => row.topic === topic && row.channel === channel);
      result[topic] = stored?.enabled ?? true;
    }
    return result;
  };

  return { push: build('PUSH'), email: build('EMAIL'), sms: build('SMS') };
}

export async function updateNotificationPreferences(
  userId: string,
  input: {
    push?: Record<string, boolean>;
    email?: Record<string, boolean>;
    sms?: Record<string, boolean>;
  },
): Promise<NotificationPreferences> {
  const updates: Array<{ topic: NotificationTopic; channel: NotificationChannel; enabled: boolean }> = [];

  const collect = (channel: NotificationChannel, values?: Record<string, boolean>): void => {
    if (!values) return;
    for (const [topic, enabled] of Object.entries(values)) {
      if (!TOPICS.includes(topic as NotificationTopic)) continue;
      updates.push({ topic: topic as NotificationTopic, channel, enabled });
    }
  };

  collect('PUSH', input.push);
  collect('EMAIL', input.email);
  collect('SMS', input.sms);

  await prisma.$transaction(
    updates.map((update) =>
      prisma.notificationPreference.upsert({
        where: {
          userId_topic_channel: {
            userId,
            topic: update.topic,
            channel: update.channel,
          },
        },
        create: { userId, ...update },
        update: { enabled: update.enabled },
      }),
    ),
  );

  return getNotificationPreferences(userId);
}

export async function registerDeviceToken(
  userId: string,
  input: { token: string; platform: 'IOS' | 'ANDROID' | 'WEB'; deviceId?: string },
): Promise<void> {
  // A token can move between accounts when a phone is handed over, so reassign
  // rather than reject.
  await prisma.deviceToken.upsert({
    where: { token: input.token },
    create: {
      userId,
      token: input.token,
      platform: input.platform,
      deviceId: input.deviceId ?? null,
    },
    update: { userId, platform: input.platform, lastSeenAt: new Date() },
  });
}

export async function removeDeviceToken(userId: string, token: string): Promise<void> {
  await prisma.deviceToken.deleteMany({ where: { userId, token } });
}

/** Unread in-app notifications, for the bell badge. */
export async function listNotifications(
  userId: string,
  limit = 30,
): Promise<Array<{ id: string; title: string; body: string; readAt: string | null; createdAt: string }>> {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function markNotificationsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
