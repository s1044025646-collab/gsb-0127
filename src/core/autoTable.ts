import type { NormalizedBox } from "./geometry.js";

export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Detect regular table areas, evaluating spatially clustered boxes. */
export function detectTables(boxes: NormalizedBox[]): BoxRect[] {
  const rects: BoxRect[] = [];
  for (const cluster of clusterByProximity(boxes)) {
    const rect = detectOneTable(cluster);
    if (rect) rects.push(rect);
  }
  return rects;
}

function detectOneTable(boxes: NormalizedBox[]): BoxRect | null {
  const lineH = median(boxes.map((b) => b.nh)) || 6;
  const xTol = lineH * 0.9;
  const yTol = lineH * 0.6;

  const xAnchors = sharedAnchors(boxes.map((b) => b.nx + b.nw / 2), xTol, 2);
  const yAnchors = sharedAnchors(boxes.map((b) => b.ny + b.nh / 2), yTol, 2);
  if (xAnchors.length < 2 || yAnchors.length < 2) return null;

  const near = (v: number, anchors: number[], tol: number) =>
    anchors.findIndex((a) => Math.abs(v - a) <= tol);

  const members = boxes.filter((b) => {
    const cx = near(b.nx + b.nw / 2, xAnchors, xTol);
    const cy = near(b.ny + b.nh / 2, yAnchors, yTol);
    const compact = b.nw <= Math.max(b.nh * 7, lineH * 7);
    return cx >= 0 && cy >= 0 && compact;
  });

  const occupied = new Set<string>();
  for (const b of members) {
    const cx = near(b.nx + b.nw / 2, xAnchors, xTol);
    const cy = near(b.ny + b.nh / 2, yAnchors, yTol);
    occupied.add(`${cy}:${cx}`);
  }

  const usedCols = new Set([...occupied].map((k) => k.split(":")[1]));
  const usedRows = new Set([...occupied].map((k) => k.split(":")[0]));
  const density = occupied.size / (usedCols.size * usedRows.size);
  const hasNumeric = members.some((b) => /\d/.test(b.text));

  if (
    occupied.size < 4 ||
    density < 0.5 ||
    usedCols.size < 2 ||
    usedRows.size < 2 ||
    !hasNumeric
  )
    return null;

  const xs = members.map((b) => [b.nx, b.nx + b.nw]).flat();
  const ys = members.map((b) => [b.ny, b.ny + b.nh]).flat();
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

function sharedAnchors(values: number[], tol: number, minCount: number): number[] {
  const sorted = values.slice().sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    const mean = last ? last.reduce((s, x) => s + x, 0) / last.length : Infinity;
    if (last && Math.abs(v - mean) <= tol) last.push(v);
    else groups.push([v]);
  }
  return groups.filter((g) => g.length >= minCount).map((g) => g.reduce((s, x) => s + x, 0) / g.length);
}

function clusterByProximity(boxes: NormalizedBox[]): NormalizedBox[][] {
  const gap = median(boxes.map((b) => Math.max(b.nw, b.nh))) * 1.5 || 40;
  const parent = boxes.map((_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a]!)));
  const rects = boxes.map((b) => ({
    x0: b.nx - gap,
    y0: b.ny - gap,
    x1: b.nx + b.nw + gap,
    y1: b.ny + b.nh + gap,
  }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      if (a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, NormalizedBox[]>();
  boxes.forEach((b, i) => {
    const arr = groups.get(find(i)) ?? [];
    arr.push(b);
    groups.set(find(i), arr);
  });
  return [...groups.values()];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
