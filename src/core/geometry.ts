import type { Rotation, TextBox } from "./types.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NormalizedBox extends TextBox {
  /** Geometry after rotation is undone, in un-rotated page coordinates. */
  nx: number;
  ny: number;
  nw: number;
  nh: number;
  /** Whether the original boundary looked invalid / missing. */
  boundaryMissing: boolean;
}

export interface NormalizedPage {
  pageNo: number;
 width: number;
  height: number;
  rotation: Rotation;
  boxes: NormalizedBox[];
}

const EPS = 1e-6;

export function intersects(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w <= b.x + EPS ||
    b.x + b.w <= a.x + EPS ||
    a.y + a.h <= b.y + EPS ||
    b.y + b.h <= a.y + EPS
  );
}

export function overlapArea(a: Rect, b: Rect): number {
  const ow = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oh = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ow * oh;
}

export function area(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

export function centerX(b: Rect): number {
  return b.x + b.w / 2;
}

export function centerY(b: Rect): number {
  return b.y + b.h / 2;
}

/**
 * Undo the scan rotation. Input coordinates live in the rotated image of size
 * (scanW x scanH); output coordinates live in the logical upright page whose
 * size is given by width/height on PageInput. We derive logical size from the
 * rotation: 90/270 swap width/height relative to the scan.
 */
export function normalizePage(
  pageNo: number,
  scanW: number,
  scanH: number,
  rotation: Rotation,
  boxes: TextBox[],
): NormalizedPage {
  // Logical (upright) page dimensions.
  const swap = rotation === 90 || rotation === 270;
  const pageW = swap ? scanH : scanW;
  const pageH = swap ? scanW : scanH;

  const out: NormalizedBox[] = boxes.map((b) => {
    let nx = b.x;
    let ny = b.y;
    let nw = b.w;
    let nh = b.h;
    if (rotation === 90) {
      nx = b.y;
      ny = scanW - (b.x + b.w);
      nw = b.h;
      nh = b.w;
    } else if (rotation === 180) {
      nx = scanW - (b.x + b.w);
      ny = scanH - (b.y + b.h);
    } else if (rotation === 270) {
      nx = scanH - (b.y + b.h);
      ny = b.x;
      nw = b.h;
      nh = b.w;
    }
    const boundaryMissing =
      !Number.isFinite(b.x) ||
      !Number.isFinite(b.y) ||
      !Number.isFinite(b.w) ||
      !Number.isFinite(b.h) ||
      b.w <= 0 ||
      b.h <= 0;
    return { ...b, nx, ny, nw, nh, boundaryMissing };
  });

  return { pageNo, width: pageW, height: pageH, rotation, boxes: out };
}

/** True if a box lies inside (with margin) a region. */
export function boxInRegion(b: NormalizedBox, r: Rect, margin = 0): boolean {
  return (
    b.nx >= r.x - margin &&
    b.ny >= r.y - margin &&
    b.nx + b.nw <= r.x + r.w + margin &&
    b.ny + b.nh <= r.y + r.h + margin
  );
}

export function centerInRegion(b: NormalizedBox, r: Rect): boolean {
  const cx = centerX({ x: b.nx, y: b.ny, w: b.nw, h: b.nh });
  const cy = centerY({ x: b.nx, y: b.ny, w: b.nw, h: b.nh });
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}
