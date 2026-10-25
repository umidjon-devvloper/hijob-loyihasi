/**
 * Pool of standard faceless mannequin reference images, stratified by
 * category + size.
 *
 * Flow:
 *   seller submits a hijob with N size variants (S/M/L)
 *     → backend creates N style jobs, each with its own targetSize
 *     → each job picks a mannequin whose silhouette matches the size
 *     → the AI composer (GPT via extension, or future API) renders
 *       hijob on the matched mannequin
 *     → three renders are stored and the right one is shown per buyer size
 *
 * MANNEQUIN ORIENTATION RULE — IMPORTANT:
 *   Every mannequin reference MUST show the model facing camera or 3/4
 *   turned to the LEFT (viewer's left, so the model's RIGHT cheek is
 *   visible). This way FaceFusion has a clear, unobstructed face region
 *   to swap the buyer's face onto. If the model is turned to the right
 *   or looking away, the face swap mis-aligns and the buyer's face
 *   comes out distorted or absent.
 *
 *   When regenerating these images with any AI image gen tool, include:
 *     "model facing camera, slight 3/4 turn to the left, face fully
 *      visible, eyes forward, no sunglasses, no veil over the face"
 *
 * Images are Pexels free-licence stand-ins. Replace with in-house shots
 * once the model-release pipeline is in place.
 *
 * DEFAULT_MANNEQUIN_URL env var overrides the fallback used when no match
 * is found (brand-new category or missing size).
 */
import type { CategoryId } from '@prisma/client';

export type SizeKey = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'one-size';

export interface MannequinRef {
  url: string;
  label: string;
}

// For hijabs the "size" is almost always one-size (110x110 / 150x150), so a
// single neutral mannequin is enough. Each category still has 2-3 options
// so retries don't always pick the same reference.
const POOL: Record<CategoryId, Record<SizeKey, MannequinRef[]>> = {
  scarves: {
    'XS': [{ url: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'hijob neutral (petite)' }],
    'S':  [{ url: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'hijob neutral (S)' }],
    'M':  [{ url: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'hijob neutral (M)' }],
    'L':  [{ url: 'https://images.pexels.com/photos/8386648/pexels-photo-8386648.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'hijob neutral (L)' }],
    'XL': [{ url: 'https://images.pexels.com/photos/8386648/pexels-photo-8386648.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'hijob neutral (XL)' }],
    'XXL':[{ url: 'https://images.pexels.com/photos/8386648/pexels-photo-8386648.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'hijob neutral (XXL)' }],
    'one-size': [{ url: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'hijob neutral (one-size)' }],
  },
  dresses: {
    'XS': [{ url: 'https://images.pexels.com/photos/2866077/pexels-photo-2866077.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200&fit=crop', label: "ko'ylak XS (petite)" }],
    'S':  [{ url: 'https://images.pexels.com/photos/2866077/pexels-photo-2866077.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200&fit=crop', label: "ko'ylak S" }],
    'M':  [{ url: 'https://images.pexels.com/photos/2866077/pexels-photo-2866077.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200&fit=crop', label: "ko'ylak M (standart)" }],
    'L':  [{ url: 'https://images.pexels.com/photos/2866077/pexels-photo-2866077.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200&fit=crop', label: "ko'ylak L (curvy)" }],
    'XL': [{ url: 'https://images.pexels.com/photos/2866077/pexels-photo-2866077.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200&fit=crop', label: "ko'ylak XL (plus)" }],
    'XXL':[{ url: 'https://images.pexels.com/photos/2866077/pexels-photo-2866077.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200&fit=crop', label: "ko'ylak XXL (plus)" }],
    'one-size': [{ url: 'https://images.pexels.com/photos/2866077/pexels-photo-2866077.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200&fit=crop', label: "ko'ylak neutral" }],
  },
  shoes: {
    'XS': [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'poyabzal standart' }],
    'S':  [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'poyabzal standart' }],
    'M':  [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'poyabzal standart' }],
    'L':  [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'poyabzal standart' }],
    'XL': [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'poyabzal standart' }],
    'XXL':[{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'poyabzal standart' }],
    'one-size': [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'poyabzal standart' }],
  },
  bags: {
    'XS': [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'sumka standart' }],
    'S':  [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'sumka standart' }],
    'M':  [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'sumka standart' }],
    'L':  [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'sumka standart' }],
    'XL': [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'sumka standart' }],
    'XXL':[{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'sumka standart' }],
    'one-size': [{ url: 'https://images.pexels.com/photos/6764007/pexels-photo-6764007.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'sumka standart' }],
  },
  accessories: {
    'XS': [{ url: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'aksessuar neutral' }],
    'S':  [{ url: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'aksessuar neutral' }],
    'M':  [{ url: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'aksessuar neutral' }],
    'L':  [{ url: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'aksessuar neutral' }],
    'XL': [{ url: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'aksessuar neutral' }],
    'XXL':[{ url: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'aksessuar neutral' }],
    'one-size': [{ url: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop', label: 'aksessuar neutral' }],
  },
};

const FALLBACK_URL =
  process.env.DEFAULT_MANNEQUIN_URL ??
  'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800&h=1000&fit=crop';

function normaliseSize(size: string | null | undefined): SizeKey {
  if (!size) return 'one-size';
  const u = size.toUpperCase().replace(/\s+/g, '');
  const sizes: SizeKey[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  if (sizes.includes(u as SizeKey)) return u as SizeKey;
  if (u.match(/^(ONESIZE|UNIV|1SIZE|OS)$/)) return 'one-size';
  // Numeric sizes (e.g. "110x110") → one-size.
  if (u.match(/^\d+/)) return 'one-size';
  return 'one-size';
}

export function pickMannequinForCategorySize(
  categoryId: CategoryId,
  rawSize: string | null | undefined,
  seed = Date.now(),
): string {
  const sizeKey = normaliseSize(rawSize);
  const bucket = POOL[categoryId]?.[sizeKey] ?? POOL.scarves[sizeKey];
  if (!bucket || bucket.length === 0) return FALLBACK_URL;
  const index = Math.abs(seed) % bucket.length;
  return bucket[index]?.url ?? FALLBACK_URL;
}

// Legacy helper used before size stratification. Routes through the new
// picker with a one-size default so existing call sites keep working.
export function pickMannequinForCategory(categoryId: CategoryId, seed = Date.now()): string {
  return pickMannequinForCategorySize(categoryId, null, seed);
}

export function listMannequins() {
  return POOL;
}
