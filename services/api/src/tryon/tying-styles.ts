/**
 * Backend mirror of apps/mobile/src/lib/tying-styles.ts — the worker
 * processes jobs long after the client has gone, so it needs its own
 * lookup from the stored tyingStyle id to the prompt text that the
 * Python compositor passes to its diffusion model. Keep the two files
 * in sync.
 */
export const TYING_PROMPTS: Record<string, string> = {
  classical:
    'classical hijab wrap, modest fit, the fabric covers the forehead and goes under the chin, both ends fall gently in front of the shoulders, no visible pins',
  loose:
    'loose hijab drape, soft fabric falls freely to the chest and over one shoulder, airy and relaxed, no tight tucks',
  double:
    'double-layered hijab, two overlapping scarves of contrasting shades, the inner layer frames the face and the outer layer wraps around the shoulders',
  wrap:
    'cross-wrap hijab, the fabric is pulled across the neck and tucked at the opposite shoulder, clean neckline, long tail cascading down the back',
  turban:
    'turban-style hijab, fabric wrapped tightly around the head, forehead fully covered, no ends falling, polished and structured silhouette',
  draped:
    'draped shawl hijab, long fabric cascades from the crown over both shoulders and down the chest, soft natural folds, elegant evening look',
  twist:
    'twisted hijab style, the two ends are twisted together behind the neck and brought over the shoulder, textured spiral detail',
  satin:
    'satin hijab, glossy fabric that catches light, smooth drape with crisp folds, luxurious sheen, formal styling',
  layered:
    'multi-layered hijab, several folds stacked over the chest in soft tiers, voluminous silhouette, generous coverage',
};

export function tyingPromptFor(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return TYING_PROMPTS[id];
}
