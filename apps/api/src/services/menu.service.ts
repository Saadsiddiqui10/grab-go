import type { MenuCategory, MenuItem } from '@grabgo/types';
import type { CreateMenuItemInput } from '@grabgo/validation';
import { prisma, type Tx } from '../db';
import { HttpError, notFound } from '../lib/http-error';
import { menuItemWithOptions, toMenuItem } from '../mappers';

/**
 * Merchant menu management.
 *
 * Variants and modifier groups are edited as whole nested structures rather than
 * one row at a time — a cafe owner thinks in terms of "the Iced Latte", not in
 * terms of eleven joined records. The write path replaces the structure inside a
 * transaction so a half-applied edit can never leave an item unorderable.
 */

/* ---------------------------------------------------------------- categories */

export async function createCategory(
  businessId: string,
  input: { name: string; description?: string | null; sortOrder?: number; isActive: boolean },
): Promise<MenuCategory> {
  const last = await prisma.menuCategory.findFirst({
    where: { businessId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const category = await prisma.menuCategory.create({
    data: {
      businessId,
      name: input.name,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? (last?.sortOrder ?? -1) + 1,
      isActive: input.isActive,
    },
  });

  return {
    id: category.id,
    businessId: category.businessId,
    name: category.name,
    description: category.description,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    items: [],
  };
}

export async function updateCategory(
  businessId: string,
  categoryId: string,
  input: { name?: string; description?: string | null; sortOrder?: number; isActive?: boolean },
): Promise<void> {
  const updated = await prisma.menuCategory.updateMany({
    where: { id: categoryId, businessId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  if (updated.count === 0) throw notFound('That category');
}

export async function deleteCategory(
  businessId: string,
  categoryId: string,
): Promise<void> {
  const itemCount = await prisma.menuItem.count({
    where: { categoryId, businessId, deletedAt: null },
  });

  if (itemCount > 0) {
    throw new HttpError(
      'CONFLICT',
      'Move or remove the items in this category before deleting it.',
    );
  }

  await prisma.menuCategory.deleteMany({ where: { id: categoryId, businessId } });
}

/* --------------------------------------------------------------------- items */

export async function createMenuItem(
  businessId: string,
  input: CreateMenuItemInput,
): Promise<MenuItem> {
  await assertCategoryBelongs(businessId, input.categoryId);
  assertVariantsCoherent(input.variants);

  const last = await prisma.menuItem.findFirst({
    where: { businessId, categoryId: input.categoryId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const item = await prisma.menuItem.create({
    data: {
      businessId,
      categoryId: input.categoryId,
      name: input.name,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      basePrice: input.basePrice,
      isAvailable: input.isAvailable,
      isSoldOut: input.isSoldOut,
      isPopular: input.isPopular,
      calories: input.calories ?? null,
      prepTimeMinutes: input.prepTimeMinutes ?? null,
      sortOrder: input.sortOrder ?? (last?.sortOrder ?? -1) + 1,
      tags: input.tags,
      variants: {
        create: input.variants.map((variant, index) => ({
          name: variant.name,
          priceDelta: variant.priceDelta,
          isDefault: variant.isDefault,
          isAvailable: variant.isAvailable,
          sortOrder: variant.sortOrder ?? index,
        })),
      },
      modifiers: {
        create: input.modifiers.map((modifier, index) => ({
          name: modifier.name,
          selectionType: modifier.selectionType,
          isRequired: modifier.isRequired,
          minSelections: modifier.minSelections,
          maxSelections: modifier.maxSelections ?? null,
          sortOrder: modifier.sortOrder ?? index,
          options: {
            create: modifier.options.map((option, optionIndex) => ({
              name: option.name,
              priceDelta: option.priceDelta,
              isDefault: option.isDefault,
              isAvailable: option.isAvailable,
              sortOrder: option.sortOrder ?? optionIndex,
            })),
          },
        })),
      },
    },
    ...menuItemWithOptions,
  });

  return toMenuItem(item);
}

export async function updateMenuItem(
  businessId: string,
  itemId: string,
  input: Partial<CreateMenuItemInput>,
): Promise<MenuItem> {
  const existing = await prisma.menuItem.findFirst({
    where: { id: itemId, businessId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw notFound('That item');

  if (input.categoryId) await assertCategoryBelongs(businessId, input.categoryId);
  if (input.variants) assertVariantsCoherent(input.variants);

  const item = await prisma.$transaction(async (tx) => {
    await tx.menuItem.update({
      where: { id: itemId },
      data: {
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.basePrice !== undefined ? { basePrice: input.basePrice } : {}),
        ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
        ...(input.isSoldOut !== undefined ? { isSoldOut: input.isSoldOut } : {}),
        ...(input.isPopular !== undefined ? { isPopular: input.isPopular } : {}),
        ...(input.calories !== undefined ? { calories: input.calories } : {}),
        ...(input.prepTimeMinutes !== undefined
          ? { prepTimeMinutes: input.prepTimeMinutes }
          : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      },
    });

    if (input.variants) await replaceVariants(tx, itemId, input.variants);
    if (input.modifiers) await replaceModifiers(tx, itemId, input.modifiers);

    return tx.menuItem.findUniqueOrThrow({ where: { id: itemId }, ...menuItemWithOptions });
  });

  return toMenuItem(item);
}

/**
 * Replace an item's variants.
 *
 * Rows carrying an `id` are updated in place so historical order lines keep their
 * foreign key; anything absent from the payload is removed.
 */
async function replaceVariants(
  tx: Tx,
  itemId: string,
  variants: NonNullable<CreateMenuItemInput['variants']>,
): Promise<void> {
  const keepIds = variants
    .map((variant) => variant.id)
    .filter((id): id is string => Boolean(id));

  await tx.menuItemVariant.deleteMany({
    where: { menuItemId: itemId, id: { notIn: keepIds.length > 0 ? keepIds : ['__none__'] } },
  });

  for (const [index, variant] of variants.entries()) {
    const data = {
      name: variant.name,
      priceDelta: variant.priceDelta,
      isDefault: variant.isDefault,
      isAvailable: variant.isAvailable,
      sortOrder: variant.sortOrder ?? index,
    };

    if (variant.id) {
      await tx.menuItemVariant.update({ where: { id: variant.id }, data });
    } else {
      await tx.menuItemVariant.create({ data: { ...data, menuItemId: itemId } });
    }
  }
}

async function replaceModifiers(
  tx: Tx,
  itemId: string,
  modifiers: NonNullable<CreateMenuItemInput['modifiers']>,
): Promise<void> {
  const keepIds = modifiers
    .map((modifier) => modifier.id)
    .filter((id): id is string => Boolean(id));

  await tx.menuItemModifier.deleteMany({
    where: { menuItemId: itemId, id: { notIn: keepIds.length > 0 ? keepIds : ['__none__'] } },
  });

  for (const [index, modifier] of modifiers.entries()) {
    const data = {
      name: modifier.name,
      selectionType: modifier.selectionType,
      isRequired: modifier.isRequired,
      minSelections: modifier.minSelections,
      maxSelections: modifier.maxSelections ?? null,
      sortOrder: modifier.sortOrder ?? index,
    };

    const modifierId = modifier.id
      ? (await tx.menuItemModifier.update({ where: { id: modifier.id }, data })).id
      : (await tx.menuItemModifier.create({ data: { ...data, menuItemId: itemId } })).id;

    const optionKeepIds = modifier.options
      .map((option) => option.id)
      .filter((id): id is string => Boolean(id));

    await tx.menuItemModifierOption.deleteMany({
      where: {
        modifierId,
        id: { notIn: optionKeepIds.length > 0 ? optionKeepIds : ['__none__'] },
      },
    });

    for (const [optionIndex, option] of modifier.options.entries()) {
      const optionData = {
        name: option.name,
        priceDelta: option.priceDelta,
        isDefault: option.isDefault,
        isAvailable: option.isAvailable,
        sortOrder: option.sortOrder ?? optionIndex,
      };

      if (option.id) {
        await tx.menuItemModifierOption.update({ where: { id: option.id }, data: optionData });
      } else {
        await tx.menuItemModifierOption.create({ data: { ...optionData, modifierId } });
      }
    }
  }
}

/**
 * The one-tap control on the merchant board.
 *
 * Kept separate from the full item update because "the oat milk ran out" is a
 * thing a barista does mid-rush, and it must not require loading and resubmitting
 * the whole item.
 */
export async function setItemAvailability(
  businessId: string,
  itemId: string,
  input: { isAvailable?: boolean; isSoldOut?: boolean },
): Promise<void> {
  const updated = await prisma.menuItem.updateMany({
    where: { id: itemId, businessId, deletedAt: null },
    data: {
      ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
      ...(input.isSoldOut !== undefined ? { isSoldOut: input.isSoldOut } : {}),
    },
  });

  if (updated.count === 0) throw notFound('That item');
}

/**
 * Soft delete.
 *
 * Order lines reference menu items for reorder and analytics, so a removed item
 * is hidden rather than dropped.
 */
export async function deleteMenuItem(businessId: string, itemId: string): Promise<void> {
  const updated = await prisma.menuItem.updateMany({
    where: { id: itemId, businessId, deletedAt: null },
    data: { deletedAt: new Date(), isAvailable: false },
  });

  if (updated.count === 0) throw notFound('That item');
}

export async function reorderItems(businessId: string, ids: string[]): Promise<void> {
  const owned = await prisma.menuItem.count({
    where: { id: { in: ids }, businessId, deletedAt: null },
  });

  if (owned !== ids.length) {
    throw new HttpError('VALIDATION_ERROR', 'Some of those items are not on your menu.');
  }

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.menuItem.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );
}

export async function reorderCategories(businessId: string, ids: string[]): Promise<void> {
  const owned = await prisma.menuCategory.count({ where: { id: { in: ids }, businessId } });

  if (owned !== ids.length) {
    throw new HttpError('VALIDATION_ERROR', 'Some of those categories are not yours.');
  }

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.menuCategory.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );
}

/* ------------------------------------------------------------------- helpers */

async function assertCategoryBelongs(businessId: string, categoryId: string): Promise<void> {
  const category = await prisma.menuCategory.findFirst({
    where: { id: categoryId, businessId },
    select: { id: true },
  });
  if (!category) throw notFound('That category');
}

/** An item with sizes needs exactly one default, or ordering it becomes ambiguous. */
function assertVariantsCoherent(
  variants: CreateMenuItemInput['variants'] | undefined,
): void {
  if (!variants || variants.length === 0) return;

  const defaults = variants.filter((variant) => variant.isDefault);

  if (defaults.length > 1) {
    throw new HttpError('VALIDATION_ERROR', 'Only one size can be the default.');
  }

  if (defaults.length === 0) {
    throw new HttpError('VALIDATION_ERROR', 'Mark one size as the default.');
  }
}

/* --------------------------------------------------------------- menu search */

export async function searchMenuItems(
  query: string,
  options: { cityId?: string; limit: number },
): Promise<Array<{ item: MenuItem; businessId: string; businessName: string }>> {
  const rows = await prisma.menuItem.findMany({
    where: {
      deletedAt: null,
      isAvailable: true,
      name: { contains: query, mode: 'insensitive' },
      business: {
        status: 'ACTIVE',
        deletedAt: null,
        ...(options.cityId ? { cityId: options.cityId } : {}),
      },
    },
    include: {
      ...menuItemWithOptions.include,
      business: { select: { id: true, name: true } },
    },
    take: options.limit,
    orderBy: [{ isPopular: 'desc' }, { name: 'asc' }],
  });

  return rows.map((row) => ({
    item: toMenuItem(row),
    businessId: row.business.id,
    businessName: row.business.name,
  }));
}
