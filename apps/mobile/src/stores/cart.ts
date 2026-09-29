import { create } from 'zustand';
import type { CartLineInput, MenuItem } from '@grabgo/types';
import { StorageKey, appStorage } from '../lib/storage';

/**
 * The cart.
 *
 * Deliberately local and price-free. It holds *what* the customer wants — item
 * ids, a variant, chosen options, a quantity — and the server decides what that
 * costs. The totals shown on the cart screen come from `/cart/quote`, never from
 * arithmetic done here.
 *
 * A cart belongs to one cafe, because an order is collected from one counter.
 */

export interface CartLine extends CartLineInput {
  /** Stable local id: two lines can be the same item with different options. */
  key: string;
  name: string;
  imageUrl: string | null;
  variantName: string | null;
  optionNames: string[];
}

interface CartState {
  businessId: string | null;
  businessName: string | null;
  lines: CartLine[];
  promoCode: string | null;
  redemptionId: string | null;

  hydrate: () => Promise<void>;
  addLine: (
    businessId: string,
    businessName: string,
    item: MenuItem,
    selection: { variantId?: string | null; modifierOptionIds: string[]; quantity: number; notes?: string | null },
  ) => { replacedCart: boolean };
  setQuantity: (key: string, quantity: number) => void;
  removeLine: (key: string) => void;
  setPromoCode: (code: string | null) => void;
  setRedemptionId: (redemptionId: string | null) => void;
  clear: () => void;
  itemCount: () => number;
  toInput: () => CartLineInput[];
}

/**
 * A line's identity is its item plus its exact configuration, so adding the same
 * latte with oat milk twice increments one row rather than creating two.
 */
function lineKey(
  menuItemId: string,
  variantId: string | null | undefined,
  optionIds: string[],
  notes: string | null | undefined,
): string {
  return [menuItemId, variantId ?? '', [...optionIds].sort().join('+'), notes ?? ''].join('|');
}

function persist(state: Pick<CartState, 'businessId' | 'businessName' | 'lines' | 'promoCode' | 'redemptionId'>): void {
  void appStorage.setJson(StorageKey.cart, {
    businessId: state.businessId,
    businessName: state.businessName,
    lines: state.lines,
    promoCode: state.promoCode,
    redemptionId: state.redemptionId,
  });
}

export const useCartStore = create<CartState>((set, get) => ({
  businessId: null,
  businessName: null,
  lines: [],
  promoCode: null,
  redemptionId: null,

  async hydrate() {
    const stored = await appStorage.getJson<{
      businessId: string | null;
      businessName: string | null;
      lines: CartLine[];
      promoCode: string | null;
      redemptionId: string | null;
    }>(StorageKey.cart);

    if (stored?.lines?.length) {
      set({
        businessId: stored.businessId,
        businessName: stored.businessName,
        lines: stored.lines,
        promoCode: stored.promoCode ?? null,
        redemptionId: stored.redemptionId ?? null,
      });
    }
  },

  addLine(businessId, businessName, item, selection) {
    const state = get();
    // Switching cafes replaces the basket. The caller confirms with the customer
    // first; this returns whether that happened so the UI can say so.
    const replacedCart = state.businessId !== null && state.businessId !== businessId;

    const variant =
      item.variants.find((candidate) => candidate.id === selection.variantId) ??
      item.variants.find((candidate) => candidate.isDefault) ??
      null;

    const optionNames = item.modifiers
      .flatMap((modifier) => modifier.options)
      .filter((option) => selection.modifierOptionIds.includes(option.id))
      .map((option) => option.name);

    const key = lineKey(
      item.id,
      variant?.id ?? null,
      selection.modifierOptionIds,
      selection.notes ?? null,
    );

    const existingLines = replacedCart ? [] : state.lines;
    const existing = existingLines.find((line) => line.key === key);

    const lines = existing
      ? existingLines.map((line) =>
          line.key === key
            ? { ...line, quantity: Math.min(30, line.quantity + selection.quantity) }
            : line,
        )
      : [
          ...existingLines,
          {
            key,
            menuItemId: item.id,
            variantId: variant?.id ?? null,
            modifierOptionIds: selection.modifierOptionIds,
            quantity: selection.quantity,
            notes: selection.notes ?? null,
            name: item.name,
            imageUrl: item.imageUrl,
            variantName: variant?.name ?? null,
            optionNames,
          },
        ];

    const next = {
      businessId,
      businessName,
      lines,
      // A promo or reward chosen for another cafe cannot carry over.
      promoCode: replacedCart ? null : state.promoCode,
      redemptionId: replacedCart ? null : state.redemptionId,
    };

    set(next);
    persist(next);

    return { replacedCart };
  },

  setQuantity(key, quantity) {
    if (quantity <= 0) {
      get().removeLine(key);
      return;
    }

    const lines = get().lines.map((line) =>
      line.key === key ? { ...line, quantity: Math.min(30, quantity) } : line,
    );

    const next = { ...get(), lines };
    set({ lines });
    persist(next);
  },

  removeLine(key) {
    const lines = get().lines.filter((line) => line.key !== key);

    if (lines.length === 0) {
      get().clear();
      return;
    }

    set({ lines });
    persist({ ...get(), lines });
  },

  setPromoCode(code) {
    set({ promoCode: code });
    persist({ ...get(), promoCode: code });
  },

  setRedemptionId(redemptionId) {
    set({ redemptionId });
    persist({ ...get(), redemptionId });
  },

  clear() {
    const empty = {
      businessId: null,
      businessName: null,
      lines: [],
      promoCode: null,
      redemptionId: null,
    };
    set(empty);
    void appStorage.remove(StorageKey.cart);
  },

  itemCount() {
    return get().lines.reduce((total, line) => total + line.quantity, 0);
  },

  toInput() {
    return get().lines.map((line) => ({
      menuItemId: line.menuItemId,
      variantId: line.variantId ?? null,
      modifierOptionIds: line.modifierOptionIds ?? [],
      quantity: line.quantity,
      notes: line.notes ?? null,
    }));
  },
}));

export const useCartCount = (): number =>
  useCartStore((state) => state.lines.reduce((total, line) => total + line.quantity, 0));
