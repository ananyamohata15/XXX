/**
 * Name similarity, method "ns1" (SESSION_NOTES 2.3; Checkpoint 1 ruling 3:
 * every persisted score carries its method id — bump the id if this file's
 * behavior changes, never silently).
 *
 * Pure functions only. Score = max(token-set Jaccard, trigram Dice) over
 * normalized names: the token measure forgives word order ("Cafe Pamenar" /
 * "Pamenar Cafe"), the trigram measure forgives small spelling drift; taking
 * the max means either kind of agreement counts.
 */

export const SIMILARITY_METHOD = "ns1";

export const T_HIGH = 0.75;
export const T_LOW = 0.45;
export const MARGIN = 0.15;

/** Lowercase, strip diacritics/punctuation, collapse whitespace. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSetJaccard(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  return intersection / (ta.size + tb.size - intersection);
}

function trigrams(s: string): Map<string, number> {
  const padded = `  ${s} `;
  const grams = new Map<string, number>();
  for (let i = 0; i <= padded.length - 3; i++) {
    const g = padded.slice(i, i + 3);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

function trigramDice(a: string, b: string): number {
  const ga = trigrams(a);
  const gb = trigrams(b);
  let sizeA = 0;
  let sizeB = 0;
  let overlap = 0;
  for (const n of ga.values()) sizeA += n;
  for (const n of gb.values()) sizeB += n;
  if (sizeA === 0 || sizeB === 0) return 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (sizeA + sizeB);
}

/** Similarity in [0, 1] between two raw (unnormalized) names. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na.length === 0 || nb.length === 0) return 0;
  return Math.max(tokenSetJaccard(na, nb), trigramDice(na, nb));
}
