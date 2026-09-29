import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import {
  ConfigKey,
  DEFAULT_LOYALTY_CONFIG,
  DEFAULT_PLATFORM_CONFIG,
  DEFAULT_REFERRAL_CONFIG,
} from '@grabgo/types';
import { generateReferralCode } from '@grabgo/core';

/**
 * Development seed data.
 *
 * Karachi, ten areas and six cafes with full menus, so the whole loop —
 * discover, order, pay, prepare, collect, earn points — can be exercised the
 * minute the database is up.
 *
 * Every cafe here is fictional. Names, addresses and coordinates are invented
 * demo data, not real partner businesses.
 *
 * Idempotent: safe to run repeatedly against an existing database.
 */

const prisma = new PrismaClient();
const randomBytes = (size: number): Uint8Array => new Uint8Array(nodeRandomBytes(size));

/** Rupees to paisa, so the seed reads like a menu board. */
const rs = (rupees: number): number => rupees * 100;

const DEMO_PASSWORD = 'grabandgo2026';

async function main(): Promise<void> {
  console.info('Seeding Grab & Go…');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  /* ------------------------------------------------------------ settings */

  await Promise.all([
    upsertSetting(ConfigKey.LOYALTY, DEFAULT_LOYALTY_CONFIG),
    upsertSetting(ConfigKey.REFERRAL, DEFAULT_REFERRAL_CONFIG),
    upsertSetting(ConfigKey.PLATFORM, DEFAULT_PLATFORM_CONFIG),
  ]);

  /* ----------------------------------------------------------- geography */

  const karachi = await prisma.city.upsert({
    where: { slug: 'karachi' },
    create: {
      name: 'Karachi',
      slug: 'karachi',
      countryCode: 'PK',
      timezone: 'Asia/Karachi',
      latitude: 24.8607,
      longitude: 67.0011,
      isActive: true,
    },
    update: {},
  });

  // Lahore is seeded inactive purely to prove the schema is multi-city from day
  // one — no code change is needed to launch it, only flipping `isActive`.
  await prisma.city.upsert({
    where: { slug: 'lahore' },
    create: {
      name: 'Lahore',
      slug: 'lahore',
      countryCode: 'PK',
      timezone: 'Asia/Karachi',
      latitude: 31.5204,
      longitude: 74.3587,
      isActive: false,
    },
    update: {},
  });

  const areaSeeds = [
    { name: 'Clifton', slug: 'clifton', latitude: 24.8138, longitude: 67.0301 },
    { name: 'DHA Phase 5', slug: 'dha-phase-5', latitude: 24.7961, longitude: 67.0636 },
    { name: 'DHA Phase 6', slug: 'dha-phase-6', latitude: 24.7883, longitude: 67.0745 },
    { name: 'Zamzama', slug: 'zamzama', latitude: 24.8213, longitude: 67.0331 },
    { name: 'Gulshan-e-Iqbal', slug: 'gulshan-e-iqbal', latitude: 24.9204, longitude: 67.0971 },
    { name: 'PECHS', slug: 'pechs', latitude: 24.8681, longitude: 67.0648 },
    { name: 'Bahadurabad', slug: 'bahadurabad', latitude: 24.8798, longitude: 67.0653 },
    { name: 'Saddar', slug: 'saddar', latitude: 24.8607, longitude: 67.0104 },
    { name: 'North Nazimabad', slug: 'north-nazimabad', latitude: 24.9333, longitude: 67.0383 },
    { name: 'Bahria Town', slug: 'bahria-town', latitude: 25.0169, longitude: 67.3106 },
  ];

  const areas = new Map<string, string>();
  for (const area of areaSeeds) {
    const row = await prisma.area.upsert({
      where: { cityId_slug: { cityId: karachi.id, slug: area.slug } },
      create: { ...area, cityId: karachi.id },
      update: {},
    });
    areas.set(area.slug, row.id);
  }

  /* --------------------------------------------------------------- users */

  await upsertUser({
    email: 'admin@grabgo.pk',
    fullName: 'Platform Admin',
    role: 'SUPER_ADMIN',
    passwordHash,
  });

  const customer = await upsertUser({
    email: 'saad@example.com',
    phone: '+923001234567',
    fullName: 'Saad Ahmed',
    role: 'CUSTOMER',
    passwordHash,
    phoneVerified: true,
  });

  await upsertUser({
    email: 'hina@example.com',
    phone: '+923217654321',
    fullName: 'Hina Raza',
    role: 'CUSTOMER',
    passwordHash,
    phoneVerified: true,
  });

  /* ------------------------------------------------------------- rewards */

  const rewards = await seedRewards();

  // Point the referral programme at real rewards, matching the product brief:
  // three friends who order earns the referrer a free coffee.
  await upsertSetting(ConfigKey.REFERRAL, {
    ...DEFAULT_REFERRAL_CONFIG,
    referrerRewardId: rewards.freeCoffee,
    refereeRewardId: rewards.discount150,
  });

  /* ---------------------------------------------------------- promotions */

  await prisma.promotion.upsert({
    where: { code: 'WELCOME50' },
    create: {
      code: 'WELCOME50',
      description: 'Rs. 50 off your first Grab & Go order',
      type: 'FIXED_DISCOUNT',
      scope: 'PLATFORM',
      value: rs(50),
      minimumOrderTotal: rs(300),
      firstOrderOnly: true,
      fundedBy: 'PLATFORM',
      isActive: true,
    },
    update: {},
  });

  await prisma.promotion.upsert({
    where: { code: 'MORNINGRUSH' },
    create: {
      code: 'MORNINGRUSH',
      description: '15% off, up to Rs. 200',
      type: 'PERCENTAGE_DISCOUNT',
      scope: 'PLATFORM',
      value: 15,
      maxDiscountAmount: rs(200),
      minimumOrderTotal: rs(500),
      perUserLimit: 4,
      fundedBy: 'PLATFORM',
      isActive: true,
    },
    update: {},
  });

  /* ---------------------------------------------------------------- cafes */

  const cafes: CafeSeed[] = [
    {
      slug: 'espresso-lab-clifton',
      name: 'Espresso Lab',
      areaSlug: 'clifton',
      addressLine: 'Shop 4, Block 5, Clifton, Karachi',
      description:
        'A small-batch espresso bar in Clifton. Single-origin beans, roasted weekly, pulled fast.',
      tags: ['coffee', 'espresso', 'breakfast'],
      priceTier: 3,
      prepTimeMinutes: 10,
      ownerEmail: 'owner@espressolab.example',
      ownerName: 'Bilal Kazmi',
      latitude: 24.8145,
      longitude: 67.0312,
      rating: 4.8,
      ratingCount: 214,
      maxConcurrentOrders: 10,
    },
    {
      slug: 'karak-and-co-dha',
      name: 'Karak & Co',
      areaSlug: 'dha-phase-5',
      addressLine: '26th Street, DHA Phase 5, Karachi',
      description: 'Doodh patti, karak chai and parathas, made the way Karachi actually drinks it.',
      tags: ['tea', 'breakfast', 'karak'],
      priceTier: 1,
      prepTimeMinutes: 7,
      ownerEmail: 'owner@karakco.example',
      ownerName: 'Fatima Sheikh',
      latitude: 24.7972,
      longitude: 67.0641,
      rating: 4.6,
      ratingCount: 389,
      maxConcurrentOrders: 15,
    },
    {
      slug: 'the-roastery-zamzama',
      name: 'The Roastery',
      areaSlug: 'zamzama',
      addressLine: 'Lane 3, Zamzama Boulevard, Karachi',
      description: 'Filter coffee, cold brew on tap, and a pastry case worth the detour.',
      tags: ['coffee', 'bakery', 'desserts'],
      priceTier: 4,
      prepTimeMinutes: 12,
      ownerEmail: 'owner@roastery.example',
      ownerName: 'Zoya Malik',
      latitude: 24.8219,
      longitude: 67.0338,
      rating: 4.7,
      ratingCount: 156,
      maxConcurrentOrders: 8,
    },
    {
      slug: 'daily-grind-pechs',
      name: 'Daily Grind',
      areaSlug: 'pechs',
      addressLine: 'Block 6, PECHS, Karachi',
      description: 'Fast, honest coffee for the commute. In and out in under five minutes.',
      tags: ['coffee', 'breakfast', 'healthy'],
      priceTier: 2,
      prepTimeMinutes: 6,
      ownerEmail: 'owner@dailygrind.example',
      ownerName: 'Omar Farooq',
      latitude: 24.8688,
      longitude: 67.0655,
      rating: 4.4,
      ratingCount: 92,
      maxConcurrentOrders: 20,
    },
    {
      slug: 'saltwater-coffee-dha6',
      name: 'Saltwater Coffee',
      areaSlug: 'dha-phase-6',
      addressLine: 'Khayaban-e-Bukhari, DHA Phase 6, Karachi',
      description: 'Sea-breeze corner cafe. Iced drinks, big windows, faster than the queue outside.',
      tags: ['coffee', 'desserts'],
      priceTier: 3,
      prepTimeMinutes: 11,
      ownerEmail: 'owner@saltwater.example',
      ownerName: 'Ayesha Noor',
      latitude: 24.7891,
      longitude: 67.0751,
      rating: 4.5,
      ratingCount: 121,
      maxConcurrentOrders: 12,
    },
    {
      slug: 'chai-wala-express-gulshan',
      name: 'Chai Wala Express',
      areaSlug: 'gulshan-e-iqbal',
      addressLine: 'Main University Road, Gulshan-e-Iqbal, Karachi',
      description: 'Open early, closes late. Chai, samosas and a queue this app exists to skip.',
      tags: ['tea', 'breakfast'],
      priceTier: 1,
      prepTimeMinutes: 5,
      ownerEmail: 'owner@chaiwala.example',
      ownerName: 'Imran Qureshi',
      latitude: 24.9211,
      longitude: 67.0978,
      rating: 4.3,
      ratingCount: 502,
      maxConcurrentOrders: 25,
      // Open past midnight, which exercises the overnight-hours logic.
      opensAt: 6 * 60,
      closesAt: 1 * 60,
    },
  ];

  for (const cafe of cafes) {
    await seedCafe(cafe, areas, karachi.id, passwordHash);
  }

  console.info('\nSeed complete.\n');
  console.info('  Admin        admin@grabgo.pk');
  console.info('  Customer     saad@example.com  (phone +923001234567)');
  console.info('  Customer     hina@example.com');
  console.info('  Cafe owners  owner@espressolab.example, owner@karakco.example, …');
  console.info(`  Password     ${DEMO_PASSWORD}`);
  console.info('  Promo codes  WELCOME50, MORNINGRUSH');
  console.info(`\n  Referral code for Saad: ${(await prisma.user.findUniqueOrThrow({ where: { id: customer.id }, select: { referralCode: true } })).referralCode}`);
}

/* ------------------------------------------------------------------ helpers */

async function upsertSetting(key: string, value: object): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value: value as Prisma.InputJsonValue },
    update: { value: value as Prisma.InputJsonValue },
  });
}

interface UpsertUserInput {
  email: string;
  phone?: string;
  fullName: string;
  role: 'CUSTOMER' | 'MERCHANT' | 'ADMIN' | 'SUPER_ADMIN';
  passwordHash: string;
  phoneVerified?: boolean;
}

async function upsertUser(input: UpsertUserInput): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) return existing;

  return prisma.user.create({
    data: {
      email: input.email,
      phone: input.phone ?? null,
      phoneVerifiedAt: input.phoneVerified ? new Date() : null,
      emailVerifiedAt: new Date(),
      passwordHash: input.passwordHash,
      role: input.role,
      referralCode: generateReferralCode(input.fullName, randomBytes),
      profile: { create: { fullName: input.fullName } },
      pointsAccount: { create: {} },
    },
    select: { id: true },
  });
}

async function seedRewards(): Promise<{
  discount150: string;
  freeCoffee: string;
  premium: string;
}> {
  const discount150 = await upsertReward({
    name: 'Rs. 150 off',
    description: 'Rs. 150 off any order.',
    pointsRequired: 100,
    type: 'FIXED_DISCOUNT',
    discountAmount: rs(150),
  });

  const freeCoffee = await upsertReward({
    name: 'Free coffee',
    description: 'One free coffee, on us.',
    pointsRequired: 200,
    type: 'PERCENTAGE_DISCOUNT',
    discountPercentage: 100,
    // Capped so "free coffee" stays a coffee rather than a whole basket.
    maxDiscountAmount: rs(700),
  });

  const premium = await upsertReward({
    name: 'Free premium coffee',
    description: 'Any speciality drink on the menu, free.',
    pointsRequired: 300,
    type: 'PERCENTAGE_DISCOUNT',
    discountPercentage: 100,
    maxDiscountAmount: rs(1200),
  });

  return { discount150, freeCoffee, premium };
}

async function upsertReward(input: {
  name: string;
  description: string;
  pointsRequired: number;
  type: 'FIXED_DISCOUNT' | 'PERCENTAGE_DISCOUNT' | 'FREE_ITEM';
  discountAmount?: number;
  discountPercentage?: number;
  maxDiscountAmount?: number;
}): Promise<string> {
  const existing = await prisma.reward.findFirst({
    where: { name: input.name },
    select: { id: true },
  });
  if (existing) return existing.id;

  const reward = await prisma.reward.create({
    data: {
      name: input.name,
      description: input.description,
      pointsRequired: input.pointsRequired,
      type: input.type,
      discountAmount: input.discountAmount ?? null,
      discountPercentage: input.discountPercentage ?? null,
      maxDiscountAmount: input.maxDiscountAmount ?? null,
      isActive: true,
      sortOrder: input.pointsRequired,
    },
    select: { id: true },
  });

  return reward.id;
}

interface CafeSeed {
  slug: string;
  name: string;
  areaSlug: string;
  addressLine: string;
  description: string;
  tags: string[];
  priceTier: number;
  prepTimeMinutes: number;
  ownerEmail: string;
  ownerName: string;
  latitude: number;
  longitude: number;
  rating: number;
  ratingCount: number;
  maxConcurrentOrders: number;
  opensAt?: number;
  closesAt?: number;
}

async function seedCafe(
  cafe: CafeSeed,
  areas: Map<string, string>,
  cityId: string,
  passwordHash: string,
): Promise<void> {
  const existing = await prisma.business.findUnique({
    where: { slug: cafe.slug },
    select: { id: true },
  });
  if (existing) return;

  const business = await prisma.business.create({
    data: {
      slug: cafe.slug,
      name: cafe.name,
      type: 'CAFE',
      status: 'ACTIVE',
      description: cafe.description,
      addressLine: cafe.addressLine,
      areaId: areas.get(cafe.areaSlug) ?? null,
      cityId,
      latitude: cafe.latitude,
      longitude: cafe.longitude,
      timezone: 'Asia/Karachi',
      prepTimeMinutes: cafe.prepTimeMinutes,
      minLeadTimeMinutes: Math.max(5, cafe.prepTimeMinutes - 2),
      maxConcurrentOrders: cafe.maxConcurrentOrders,
      tags: cafe.tags,
      priceTier: cafe.priceTier,
      ratingAverage: cafe.rating,
      ratingCount: cafe.ratingCount,
      approvedAt: new Date(),
      acceptingOrders: true,
      loyaltyEnabled: true,
      hours: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          opensAt: cafe.opensAt ?? 8 * 60,
          closesAt: cafe.closesAt ?? 23 * 60,
          isClosed: false,
        })),
      },
    },
    select: { id: true },
  });

  const owner = await upsertUser({
    email: cafe.ownerEmail,
    fullName: cafe.ownerName,
    role: 'MERCHANT',
    passwordHash,
  });

  await prisma.cafeStaff.create({
    data: { businessId: business.id, userId: owner.id, staffRole: 'OWNER', acceptedAt: new Date() },
  });

  await seedMenu(business.id, cafe);
}

async function seedMenu(businessId: string, cafe: CafeSeed): Promise<void> {
  const isTeaHouse = cafe.tags.includes('tea');

  const milkModifier = {
    name: 'Milk',
    selectionType: 'SINGLE' as const,
    isRequired: true,
    minSelections: 1,
    maxSelections: 1,
    options: [
      { name: 'Regular', priceDelta: 0, isDefault: true },
      { name: 'Almond', priceDelta: rs(150), isDefault: false },
      { name: 'Oat', priceDelta: rs(150), isDefault: false },
      { name: 'Skimmed', priceDelta: 0, isDefault: false },
    ],
  };

  const extrasModifier = {
    name: 'Extras',
    selectionType: 'MULTIPLE' as const,
    isRequired: false,
    minSelections: 0,
    maxSelections: 3,
    options: [
      { name: 'Extra shot', priceDelta: rs(150), isDefault: false },
      { name: 'Vanilla', priceDelta: rs(100), isDefault: false },
      { name: 'Caramel', priceDelta: rs(100), isDefault: false },
      { name: 'Cinnamon', priceDelta: 0, isDefault: false },
    ],
  };

  const sizeVariants = [
    { name: 'Regular', priceDelta: 0, isDefault: true },
    { name: 'Large', priceDelta: rs(100), isDefault: false },
  ];

  const categories: CategorySeed[] = isTeaHouse
    ? [
        {
          name: 'Chai',
          items: [
            {
              name: 'Karak Chai',
              price: rs(180),
              popular: true,
              variants: sizeVariants,
              description: 'Strong, sweet, boiled the long way.',
            },
            { name: 'Doodh Patti', price: rs(220), popular: true, variants: sizeVariants },
            { name: 'Kashmiri Chai', price: rs(320), variants: sizeVariants },
            { name: 'Green Tea', price: rs(150) },
          ],
        },
        {
          name: 'Coffee',
          items: [
            { name: 'Nescafe', price: rs(200), variants: sizeVariants },
            { name: 'Cold Coffee', price: rs(450), popular: true, variants: sizeVariants, modifiers: [milkModifier] },
          ],
        },
        {
          name: 'Breakfast',
          items: [
            { name: 'Aloo Paratha', price: rs(250), popular: true },
            { name: 'Anda Paratha', price: rs(300) },
            { name: 'Samosa (2 pcs)', price: rs(120) },
            { name: 'Club Sandwich', price: rs(480) },
          ],
        },
      ]
    : [
        {
          name: 'Coffee',
          items: [
            {
              name: 'Iced Latte',
              price: rs(650),
              popular: true,
              description: 'Double shot over ice, milk of your choice.',
              variants: sizeVariants,
              modifiers: [milkModifier, extrasModifier],
            },
            {
              name: 'Cappuccino',
              price: rs(550),
              popular: true,
              variants: sizeVariants,
              modifiers: [milkModifier, extrasModifier],
            },
            {
              name: 'Flat White',
              price: rs(600),
              variants: sizeVariants,
              modifiers: [milkModifier, extrasModifier],
            },
            { name: 'Espresso', price: rs(350), modifiers: [extrasModifier] },
            {
              name: 'Mocha',
              price: rs(700),
              soldOut: true,
              variants: sizeVariants,
              modifiers: [milkModifier],
            },
            {
              name: 'Cold Brew',
              price: rs(680),
              popular: true,
              variants: sizeVariants,
            },
          ],
        },
        {
          name: 'Not Coffee',
          items: [
            { name: 'Matcha Latte', price: rs(750), variants: sizeVariants, modifiers: [milkModifier] },
            { name: 'Hot Chocolate', price: rs(580), variants: sizeVariants, modifiers: [milkModifier] },
            { name: 'Fresh Orange Juice', price: rs(450) },
          ],
        },
        {
          name: 'Breakfast',
          items: [
            { name: 'Avocado Toast', price: rs(950), popular: true, prepTimeMinutes: 12 },
            { name: 'Shakshuka', price: rs(1150), prepTimeMinutes: 15 },
            { name: 'Granola Bowl', price: rs(750) },
            { name: 'Croissant', price: rs(380) },
          ],
        },
        {
          name: 'Desserts',
          items: [
            { name: 'Basque Cheesecake', price: rs(720), popular: true },
            { name: 'Chocolate Brownie', price: rs(520) },
            { name: 'Banoffee Pie', price: rs(680) },
          ],
        },
      ];

  for (const [categoryIndex, category] of categories.entries()) {
    const created = await prisma.menuCategory.create({
      data: {
        businessId,
        name: category.name,
        sortOrder: categoryIndex,
        isActive: true,
      },
      select: { id: true },
    });

    for (const [itemIndex, item] of category.items.entries()) {
      await prisma.menuItem.create({
        data: {
          businessId,
          categoryId: created.id,
          name: item.name,
          description: item.description ?? null,
          basePrice: item.price,
          isAvailable: true,
          isSoldOut: item.soldOut ?? false,
          isPopular: item.popular ?? false,
          prepTimeMinutes: item.prepTimeMinutes ?? null,
          sortOrder: itemIndex,
          tags: [],
          variants: item.variants
            ? {
                create: item.variants.map((variant, index) => ({
                  name: variant.name,
                  priceDelta: variant.priceDelta,
                  isDefault: variant.isDefault,
                  sortOrder: index,
                })),
              }
            : undefined,
          modifiers: item.modifiers
            ? {
                create: item.modifiers.map((modifier, index) => ({
                  name: modifier.name,
                  selectionType: modifier.selectionType,
                  isRequired: modifier.isRequired,
                  minSelections: modifier.minSelections,
                  maxSelections: modifier.maxSelections,
                  sortOrder: index,
                  options: {
                    create: modifier.options.map((option, optionIndex) => ({
                      name: option.name,
                      priceDelta: option.priceDelta,
                      isDefault: option.isDefault,
                      sortOrder: optionIndex,
                    })),
                  },
                })),
              }
            : undefined,
        },
      });
    }
  }
}

interface ModifierSeed {
  name: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  options: Array<{ name: string; priceDelta: number; isDefault: boolean }>;
}

interface ItemSeed {
  name: string;
  price: number;
  description?: string;
  popular?: boolean;
  soldOut?: boolean;
  prepTimeMinutes?: number;
  variants?: Array<{ name: string; priceDelta: number; isDefault: boolean }>;
  modifiers?: ModifierSeed[];
}

interface CategorySeed {
  name: string;
  items: ItemSeed[];
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
