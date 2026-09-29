import type {
  NormalizedBox,
  PageInput,
  RegionInput,
  RectLike,
  Issue,
  Line,
  Paragraph,
  Table,
  TableCell,
  ReadingBlock,
  RegionKind,
  ExtractionRuleInput,
} from "./types.js";
import {
  area,
  intersectionArea,
  midY,
  rotateRect,
  unionRect,
} from "./geometry.js";

export const LOW_CONFIDENCE = 0.6;
/** Two boxes on the same line may gap by at most this multiple of line height. */
const LINE_GAP_FACTOR = 0.9;
/** Paragraph line spacing threshold relative to median line height. */
const PARA_GAP_FACTOR = 1.6;
/** Header/footer band thickness as a fraction of page height when auto-detecting. */
const BAND_FRACTION = 0.08;

export type ResolvedRegion = {
  kind: RegionKind;
  pageNo: number;
  rect: RectLike;
};

export type PageData = {
  pageNo: number;
  width: number;
  height: number;
  rotation: number;
  boxes: NormalizedBox[];
  regions: ResolvedRegion[];
};

export type PrepareResult = {
  pages: PageData[];
  issues: Issue[];
};

const SUPPORTED_ROTATIONS = new Set([0, 90, 180, 270]);

/**
 * Normalize pages: rotate coordinates upright, validate boundaries, flag
 * overlaps and low confidence. Does not fabricate missing text.
 */
export function preparePages(
  pages: PageInput[],
  regionInputs: RegionInput[] = [],
  startBoxId = 1,
): PrepareResult {
  const issues: Issue[] = [];
  const out: PageData[] = [];
  let nextBoxId = startBoxId;
  void regionInputs;

  for (const page of pages) {
    const rotation = ((page.rotation ?? 0) % 360 + 360) % 360;
    if (!SUPPORTED_ROTATIONS.has(rotation)) {
      issues.push({
        code: "ROTATION_UNSUPPORTED",
        pageNo: page.pageNo,
        message: `Rotation ${page.rotation} is not supported; only 0/90/180/270. Treating as 0.`,
      });
    }
    const swapped = rotation === 90 || rotation === 270;
    const normW = swapped ? page.height : page.width;
    const normH = swapped ? page.width : page.height;

    const boxes: NormalizedBox[] = [];
    const seenRefs = new Set<string>();
    page.boxes.forEach((b, idx) => {
      const boxId = nextBoxId++;
      const boxRef =
        b.boxRef !== undefined && b.boxRef !== null && String(b.boxRef) !== ""
          ? String(b.boxRef)
          : `p${page.pageNo}#${idx + 1}`;
      if (seenRefs.has(boxRef)) {
        issues.push({
          code: "MISSING_BOUNDARY",
          pageNo: page.pageNo,
          boxIds: [boxId],
          message: `Duplicate box reference ${boxRef}; mapped to synthetic id.`,
        });
      }
      seenRefs.add(boxRef);

      let nrect: RectLike;
      try {
        nrect = SUPPORTED_ROTATIONS.has(rotation)
          ? rotateRect(b.rect, rotation, page.width, page.height)
          : { ...b.rect };
      } catch {
        nrect = { ...b.rect };
      }

      const conf =
        b.confidence === undefined || b.confidence === null
          ? null
          : Number(b.confidence);
      if (conf === null) {
        issues.push({
          code: "LOW_CONFIDENCE",
          pageNo: page.pageNo,
          boxIds: [boxId],
          message: `Box ${boxRef} has no confidence value.`,
        });
      } else if (conf < LOW_CONFIDENCE) {
        issues.push({
          code: "LOW_CONFIDENCE",
          pageNo: page.pageNo,
          boxIds: [boxId],
          message: `Box ${boxRef} confidence ${conf.toFixed(2)} below ${LOW_CONFIDENCE}.`,
        });
      }

      if (
        !Number.isFinite(nrect.x) ||
        !Number.isFinite(nrect.y) ||
        !(nrect.w > 0) ||
        !(nrect.h > 0)
      ) {
        issues.push({
          code: "MISSING_BOUNDARY",
          pageNo: page.pageNo,
          boxIds: [boxId],
          message: `Box ${boxRef} has missing or degenerate boundary.`,
        });
      }
      if (
        nrect.x < -1e-6 ||
        nrect.y < -1e-6 ||
        nrect.x + nrect.w > normW + 1e-6 ||
        nrect.y + nrect.h > normH + 1e-6
      ) {
        issues.push({
          code: "OUT_OF_BOUNDS",
          pageNo: page.pageNo,
          boxIds: [boxId],
          message: `Box ${boxRef} extends outside the page.`,
        });
      }

      boxes.push({
        boxId,
        boxRef,
        text: b.text ?? "",
        rect: nrect,
        confidence: conf === null || Number.isNaN(conf) ? null : conf,
        pageNo: page.pageNo,
      });
    });

    // Overlap detection on the same page.
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const inter = intersectionArea(a.rect, b.rect);
        if (inter > 0 && inter > 0.2 * Math.min(area(a.rect), area(b.rect))) {
          issues.push({
            code: "OVERLAP",
            pageNo: page.pageNo,
            boxIds: [a.boxId, b.boxId],
            message: `Boxes ${a.boxRef} and ${b.boxRef} overlap substantially.`,
          });
        }
      }
    }

    const regions = resolveRegions(page.pageNo, normW, normH, boxes, regionInputs);
    out.push({
      pageNo: page.pageNo,
      width: normW,
      height: normH,
      rotation,
      boxes,
      regions,
    });
  }
  return { pages: out, issues };
}

function resolveRegions(
  pageNo: number,
  w: number,
  h: number,
  boxes: NormalizedBox[],
  inputs: RegionInput[],
): ResolvedRegion[] {
  const resolved: ResolvedRegion[] = [];
  for (const input of inputs) {
    if (input.rect && !input.auto) {
      resolved.push({ kind: input.kind, pageNo, rect: { ...input.rect } });
    } else {
      const auto = autoDetectRegion(input.kind, w, h, boxes);
      if (auto) resolved.push({ kind: input.kind, pageNo, rect: auto });
    }
  }
  return resolved;
}

/**
 * Heuristic auto-detection.
 * - header/footer: dense text bands at the very top/bottom repeated geometry.
 * - table: region whose boxes align on a regular x/y grid (>=2 rows and >=2 cols
 *   with small coordinate variance along each axis).
 * - body: remaining area.
 */
export function autoDetectRegion(
  kind: RegionKind,
  w: number,
  h: number,
  boxes: NormalizedBox[],
): RectLike | null {
  if (boxes.length === 0) return null;
  if (kind === "header") {
    const band = h * BAND_FRACTION;
    const inBand = boxes.filter((b) => midY(b.rect) < band);
    if (inBand.length > 0) return unionRect(inBand.map((b) => b.rect));
    return null;
  }
  if (kind === "footer") {
    const band = h * (1 - BAND_FRACTION);
    const inBand = boxes.filter((b) => midY(b.rect) > band);
    if (inBand.length > 0) return unionRect(inBand.map((b) => b.rect));
    return null;
  }
  if (kind === "table") {
    // Generic normalization cannot identify a grid reliably; table auto-detect
    // is performed by the layout orchestrator after preparation.
    return null;
  }
  // body: whole page by default; header/footer/table are subtracted later.
  return { x: 0, y: 0, w, h };
}
