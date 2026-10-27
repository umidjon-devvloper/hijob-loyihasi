/**
 * 9 canonical hijab tying styles — the seller picks ONE when they
 * submit "Navbatga jo'natish" (dress-mannequin), and the buyer picks
 * one on the Primerka tab to see the mannequin wearing that specific
 * drape. The prompt text here is what the Python compositor passes to
 * its diffusion model so new styles can be added without touching the
 * backend code.
 */
export type TyingStyleId =
  | 'classical'
  | 'loose'
  | 'double'
  | 'wrap'
  | 'turban'
  | 'draped'
  | 'twist'
  | 'satin'
  | 'layered';

export interface TyingStyleDef {
  id: TyingStyleId;
  label: { uz: string; ru: string; en: string; ar: string };
  prompt: string;
}

export const TYING_STYLES: TyingStyleDef[] = [
  {
    id: 'classical',
    label: { uz: 'Klassik', ru: 'Классический', en: 'Classical', ar: 'كلاسيكي' },
    prompt:
      'elegant modest hijab styling: fabric wraps smoothly over the head, covers the forehead and goes under the chin, one long tail cascades asymmetrically over the LEFT shoulder down to below the chest in soft natural folds, the other side wraps close to the neckline, no visible pins or seams, matte studio lighting; mannequin orientation: body and face turned slightly to the viewer\'s RIGHT at a three-quarter angle so the camera sees the right cheek clearly, this orientation is MANDATORY for every size variant so the whole catalogue reads as one consistent shoot',
  },
  {
    id: 'loose',
    label: { uz: 'Erkin', ru: 'Свободный', en: 'Loose', ar: 'فضفاض' },
    prompt:
      'loose hijab drape, soft fabric falls freely to the chest and over one shoulder, airy and relaxed, no tight tucks',
  },
  {
    id: 'double',
    label: { uz: 'Qo\'sh', ru: 'Двойной', en: 'Double', ar: 'مزدوج' },
    prompt:
      'double-layered hijab, two overlapping scarves of contrasting shades, the inner layer frames the face and the outer layer wraps around the shoulders',
  },
  {
    id: 'wrap',
    label: { uz: "O'rama", ru: 'Обёртка', en: 'Wrap', ar: 'لفة' },
    prompt:
      'cross-wrap hijab, the fabric is pulled across the neck and tucked at the opposite shoulder, clean neckline, long tail cascading down the back',
  },
  {
    id: 'turban',
    label: { uz: 'Turban', ru: 'Тюрбан', en: 'Turban', ar: 'عمامة' },
    prompt:
      'turban-style hijab, fabric wrapped tightly around the head, forehead fully covered, no ends falling, polished and structured silhouette',
  },
  {
    id: 'draped',
    label: { uz: 'Osilma', ru: 'Драпированный', en: 'Draped', ar: 'منسدل' },
    prompt:
      'draped shawl hijab, long fabric cascades from the crown over both shoulders and down the chest, soft natural folds, elegant evening look',
  },
  {
    id: 'twist',
    label: { uz: 'Burama', ru: 'Скрученный', en: 'Twist', ar: 'ملفوف' },
    prompt:
      'twisted hijab style, the two ends are twisted together behind the neck and brought over the shoulder, textured spiral detail',
  },
  {
    id: 'satin',
    label: { uz: 'Atlas', ru: 'Атласный', en: 'Satin', ar: 'ساتان' },
    prompt:
      'satin hijab, glossy fabric that catches light, smooth drape with crisp folds, luxurious sheen, formal styling',
  },
  {
    id: 'layered',
    label: { uz: 'Qavatli', ru: 'Многослойный', en: 'Layered', ar: 'متعدد الطبقات' },
    prompt:
      'multi-layered hijab, several folds stacked over the chest in soft tiers, voluminous silhouette, generous coverage',
  },
];

export function tyingStyleById(id: unknown): TyingStyleDef | null {
  if (!id || typeof id !== 'string') return null;
  return TYING_STYLES.find((s) => s.id === id) ?? null;
}
