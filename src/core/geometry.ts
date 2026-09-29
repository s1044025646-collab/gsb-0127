import type { RectLike, NormalizedBox } from "./types.js";

export function rect(x: number, y: number, w: number, h: number): RectLike {
  return { x, y, w, h };
}

export function intersects(a: RectLike, b: RectLike): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** Intersection area; 0 when rectangles merely touch. */
export function intersectionArea(a: RectLike, b: RectLike): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function area(a: RectLike): number {
  return a.w * a.h;
}

export function unionRect(rects: RectLike[]): RectLike {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function midY(r: RectLike): number {
  return r.y + r.h / 2;
}

export function midX(r: RectLike): number {
  return r.x + r.w / 2;
}

export function contains(outer: RectLike, inner: RectLike): boolean {
  return (
    inner.x >= outer.x - 1e-9 &&
    inner.y >= outer.y - 1e-9 &&
    inner.x + inner.w <= outer.x + outer.w + 1e-9 &&
    inner.y + inner.h <= outer.y + outer.h + 1e-9
  );
}

export function boxesInRegion(
  boxes: NormalizedBox[],
  region: RectLike,
): NormalizedBox[] {
  // A box belongs to a region when its center is inside it; avoids double
  // counting boxes that merely overlap a border.
  return boxes.filter((b) => {
    const cx = midX(b.rect);
    const cy = midY(b.rect);
    return (
      cx >= region.x &&
      cx <= region.x + region.w &&
      cy >= region.y &&
      cy <= region.y + region.h
    );
  });
}

/**
 * Normalize a box rect for a page scanned with a clockwise `rotation`.
 * Rotation semantics: the scanned image must be rotated counter-clockwise by
 * `rotation` to make text upright; therefore we map coordinates accordingly.
 * Supported: 0, 90, 180, 270.
 */
export function rotateRect(
  r: RectLike,
  rotation: number,
  pageW: number,
  pageH: number,
): RectLike {
  switch (((rotation % 360) + 360) % 360) {
    case 0:
      return { ...r };
    case 90:
      // Image was clockwise-rotated: upright page width = image height.
      return { x: r.y, y: pageW - (r.x + r.w), w: r.h, h: r.w };
    case 180:
      return {
        x: pageW - (r.x + r.w),
        y: pageH - (r.y + r.h),
        w: r.w,
        h: r.h,
      };
    case 270:
      return { x: pageH - (r.y + r.h), y: r.x, w: r.h, h: r.w };
    default:
      throw new Error(`UNSUPPORTED_ROTATION:${rotation}`);
  }
}

/**
 * Inverse of rotateRect for a single point, enabling coordinate round-trip
 * from normalized coordinates back to the original scanned image.
 */
export function inverseRotatePoint(
  p: { x: number; y: number },
  rotation: number,
  pageW: number,
  pageH: number,
): { x: number; y: number } {
  switch (((rotation % 360) + 360) % 360) {
    case 0:
      return { ...p };
    case 90:
      return { x: pageW - p.y, y: p.x };
    case 180:
      return { x: pageW - p.x, y: pageH - p.y };
    case 270:
      return { x: p.y, y: pageH - p.x };
    default:
      throw new Error(`UNSUPPORTED_ROTATION:${rotation}`);
  }
}
