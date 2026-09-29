import type { NormalizedBox } from "./geometry.js";

export function centerY(b: { y: number; h: number }): number {
  return b.y + b.h / 2;
}

export function boxesCenterY(b: NormalizedBox): number {
  return b.ny + b.nh / 2;
}

/**
 * Detect 1 vs 2 columns within a body region (region origin at originX).
 * Returns the gutter split x in absolute page coordinates.
 */
export function detectColumnsHelper(
  bodyBoxes: NormalizedBox[],
  regionWidth: number,
  originX: number,
): { columns: 1 | 2; splitX: number | null } {
  if (bodyBoxes.length < 4) return { columns: 1, splitX: null };
  // Build a histogram of box-center occupancy over relative x. Two columns
  // show two dense lobes separated by an empty gutter near the middle.
  const bins = 40;
  const counts = new Array<number>(bins).fill(0);
  for (const b of bodyBoxes) {
    const rel = (b.nx + b.nw / 2 - originX) / regionWidth;
    if (rel < 0 || rel > 1) continue;
    counts[Math.min(bins - 1, Math.floor(rel * bins))]! += 1;
  }
  // Search a zero/near-zero run in the central 30%..70% band.
  let bestStart = -1;
  let bestRun = 0;
  for (let i = Math.floor(bins * 0.3); i < bins * 0.7; i++) {
    if (counts[i] === 0) {
      let j = i;
      while (j < bins * 0.7 && counts[j] === 0) j++;
      const run = j - i;
      if (run > bestRun) {
        bestRun = run;
        bestStart = i;
      }
    }
  }
  // Require a gutter at least ~4% of width and occupancy on both sides.
  if (bestStart >= 0 && bestRun >= 2) {
    const splitRel = (bestStart + bestRun / 2) / bins;
    const leftMass = counts.slice(0, bestStart).reduce((s, v) => s + v, 0);
    const rightMass = counts
      .slice(bestStart + bestRun)
      .reduce((s, v) => s + v, 0);
    if (leftMass > 0 && rightMass > 0) {
      return { columns: 2, splitX: originX + splitRel * regionWidth };
    }
  }
  return { columns: 1, splitX: null };
}

/** Median line height of a set of boxes. */
export function medianLineHeight(boxes: NormalizedBox[]): number {
  if (boxes.length === 0) return 0;
  const hs = boxes.map((b) => b.nh).sort((a, b) => a - b);
  return hs[Math.floor(hs.length / 2)]!;
}
