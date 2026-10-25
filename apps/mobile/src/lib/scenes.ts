/**
 * Three podium backdrop scenes a seller can pick per product. The scene
 * sits BEHIND the face-swapped mannequin inside the Primerka tab and on
 * the product detail hero so the listing reads as a studio shot instead
 * of a floating cutout. More scenes can be added here without touching
 * any backend code — the choice is stored in Product.attributes.sceneId.
 */
import type { ImageSourcePropType } from 'react-native';

export type SceneId = 'blue' | 'olive' | 'beige';

export interface SceneDef {
  id: SceneId;
  label: { uz: string; ru: string; en: string; ar: string };
  source: ImageSourcePropType;
}

export const SCENES: SceneDef[] = [
  {
    id: 'blue',
    label: { uz: 'Zumrad ko\'k', ru: 'Голубой', en: 'Blue', ar: 'أزرق' },
    source: require('../../assets/scene-blue.webp'),
  },
  {
    id: 'olive',
    label: { uz: 'Zaytun', ru: 'Оливковый', en: 'Olive', ar: 'زيتوني' },
    source: require('../../assets/scene-olive.webp'),
  },
  {
    id: 'beige',
    label: { uz: 'Krem', ru: 'Бежевый', en: 'Beige', ar: 'بيج' },
    source: require('../../assets/scene-beige.webp'),
  },
];

export function sceneById(id: unknown): SceneDef | null {
  if (!id) return null;
  return SCENES.find((s) => s.id === id) ?? null;
}
