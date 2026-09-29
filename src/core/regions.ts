import type { NormalizedBox } from "./geometry.js";
import type { Issue, Region, RegionKind } from "./types.js";

export interface DetectedRegion {
  kind: RegionKind;
  x: number;
  y: number;
  w: number;
  h: number;
  auto: boolean;
}

/**
 * Detect repeated header/footer bands and split the body area into columns.
 * Header/footer = boxes appearing at nearly identical x in the top/bottom
 * band across pages. We need at least two pages to call something "repeated".
 */
export function detectHeaderFooter(
  pages: { pageNo: number; width: number; height: number; boxes: NormalizedBox[] }[],
): { regions: DetectedRegion[] } {
  const regions: DetectedRegion[] = [];
  if (pages.length < 2) return { regions };

  const bandFrac = 0.08;

  const inTop = (p: (typeof pages)[number], b: NormalizedBox) =>
    b.ny + b.nh / 2 <= p.height * bandFrac;
  const inBottom = (p: (typeof pages)[number], b: NormalizedBox) =>
    b.ny + b.nh / 2 >= p.height * (1 - bandFrac);

  for (const [kind, pick] of [
    ["header", inTop],
    ["footer", inBottom],
  ] as const) {
    // A running header/footer is the same trimmed text appearing in the band
    // on at least two pages (page-number-only labels are allowed to differ).
    const perPage = pages.map((p) =>
      p.boxes
        .filter((b) => pick(p, b))
        .map((b) => ({ text: b.text.trim(), key: b.text.replace(/[0-9０-９]+/g, "#").trim(), b })),
    );
    const counts = new Map<string, { pages: number; boxes: NormalizedBox[] }>();
    perPage.forEach((items) => {
      const seen = new Set<string>();
      for (const it of items) {
        if (!it.key || seen.has(it.key)) continue;
        seen.add(it.key);
        const e = counts.get(it.key) ?? { pages: 0, boxes: [] };
        e.pages += 1;
        e.boxes.push(it.b);
        counts.set(it.key, e);
      }
    });
    const matched = [...counts.values()].filter((s) => s.pages >= 2).flatMap((s) => s.boxes);
    if (matched.length === 0) continue;
    const minY = Math.min(...matched.map((b) => b.ny));
    const maxY = Math.max(...matched.map((b) => b.ny + b.nh));
    regions.push({
      kind,
      x: 0,
      y: kind === "header" ? 0 : pages[0]!.height - (pages[0]!.height - minY),
      w: pages[0]!.width,
      h: Math.max(1, maxY - minY),
      auto: true,
    });
  }
  return { regions };
}

/**
 * Decide column layout of a body region by looking at the horizontal gaps in
 * the projection of box centers. Returns 1 or 2 (only single/double supported).
 */
export function detectColumns(
  bodyBoxes: NormalizedBox[],
  regionWidth: number,
): { columns: number; splitX: number | null } {
  if (bodyBoxes.length < 4) return { columns: 1, splitX: null };
  const cxs = bodyBoxes.map((b) => b.nx + b.nw / 2).sort((a, b) => a - b);
  // Find the largest normalized gap between sorted centers.
  let bestGap = 0;
  let bestAt = -1;
  for (let i = 1; i < cxs.length; i++) {
    const gap = cxs[i]! - cxs[i - 1]!;
    if (gap > bestGap) {
      bestGap = gap;
      bestAt = i;
    }
  }
  if (bestAt < 0) return { columns: 1, splitX: null };
  const splitX = (cxs[bestAt - 1]! + cxs[bestAt]!) / 2;
  // Require the gap to be a reasonable gutter and the split near the middle.
  const gutterOk = bestGap >= regionWidth * 0.06;
  const middleOk = splitX > regionWidth * 0.3 && splitX < regionWidth * 0.7;
  if (gutterOk && middleOk) return { columns: 2, splitX };
  return { columns: 1, splitX: null };
}

export function makeIssue(
  code: string,
  severity: Issue["severity"],
  message: string,
  pageNo: number,
  refs: string[] = [],
): Issue {
  return { code, severity, message, pageNo, refs };
}

export type { Region };
