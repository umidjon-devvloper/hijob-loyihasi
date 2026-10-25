import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Try-on collection: items the buyer picked across different shops to
 * compare side-by-side in the Primerka tab. Categories that make no sense
 * on a mannequin's face/body (bags, accessories) are rejected at add time.
 */
const KEY = 'n2431.tryonCollection.v1';

export const TRYON_ALLOWED_CATEGORIES = new Set(['scarves', 'dresses', 'shoes']);

export interface TryonItem {
  productId: string;
  variantId: string | null;
  sellerId: string | null;
  categoryId: string;
  addedAt: number;
}

interface State {
  items: TryonItem[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (item: Omit<TryonItem, 'addedAt'>) => Promise<void>;
  remove: (productId: string) => Promise<void>;
  clear: () => Promise<void>;
  has: (productId: string) => boolean;
}

async function persist(items: TryonItem[]) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // best-effort — the collection is a convenience, losing it just means
    // the user re-adds the products.
  }
}

export const useTryonCollection = create<State>((set, get) => ({
  items: [],
  hydrated: false,

  async hydrate() {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TryonItem[];
        if (Array.isArray(parsed)) {
          set({ items: parsed, hydrated: true });
          return;
        }
      }
    } catch {
      // fall through to empty
    }
    set({ items: [], hydrated: true });
  },

  async add(item) {
    if (!TRYON_ALLOWED_CATEGORIES.has(item.categoryId)) return;
    const current = get().items;
    if (current.some((i) => i.productId === item.productId)) return;
    const next = [...current, { ...item, addedAt: Date.now() }];
    set({ items: next });
    await persist(next);
  },

  async remove(productId) {
    const next = get().items.filter((i) => i.productId !== productId);
    set({ items: next });
    await persist(next);
  },

  async clear() {
    set({ items: [] });
    await persist([]);
  },

  has(productId) {
    return get().items.some((i) => i.productId === productId);
  },
}));
