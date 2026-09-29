import type { NormalizedBox } from "./geometry.js";
import type { Issue, Paragraph } from "./types.js";
import { boxesCenterY, detectColumnsHelper, medianLineHeight } from "./internals.js";

export interface BodyAnalysis {
  paragraphs: Paragraph[];
  issues: Issue[];
}

type Mark = (code: string, severity: Issue["severity"], msg: string, refs: string[]) => void;

interface BodyRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Reconstruct reading order for body boxes (header/footer/table already
 * excluded). Supports single and double horizontal CJK/Latin columns and
 * cross-column spanning titles. Never invents text; keeps source box ids.
 */
export function analyzeBody(
  pageNo: number,
  bodyBoxes: NormalizedBox[],
  region: BodyRegion,
  mark: Mark,
): BodyAnalysis {
  void pageNo;
  for (const b of bodyBoxes) {
    if (b.boundaryMissing) {
      mark("BOX_MISSING_BOUNDARY", "warning", `框 ${b.id} 边界缺失，位置不可靠`, [b.id]);
    }
    if (b.confidence < 0.6) {
      mark("LOW_CONFIDENCE", "warning", `框 ${b.id} 置信度过低 (${b.confidence})`, [b.id]);
    }
  }

  for (let i = 0; i < bodyBoxes.length; i++) {
    for (let j = i + 1; j < bodyBoxes.length; j++) {
      const a = bodyBoxes[i]!;
      const b = bodyBoxes[j]!;
      const ox = Math.max(0, Math.min(a.nx + a.nw, b.nx + b.nw) - Math.max(a.nx, b.nx));
      const oy = Math.max(0, Math.min(a.ny + a.nh, b.ny + b.nh) - Math.max(a.ny, b.ny));
      const inter = ox * oy;
      const smaller = Math.min(a.nw * a.nh, b.nw * b.nh);
      if (smaller > 0 && inter / smaller > 0.3) {
        mark("OVERLAPPING_BOXES", "warning", `框 ${a.id} 与 ${b.id} 明显重叠`, [a.id, b.id]);
      }
    }
  }

  const { columns, splitX } = detectColumnsHelper(bodyBoxes, region.w, region.x);

  // A spanning title is wide, centered and located in the top band of the
  // region. Crossing the gutter alone is not enough (body lines are wide too);
  // require the box to sit above the main column content.
  const tops = bodyBoxes.map((b) => b.ny).sort((a, b) => a - b);
  const contentTop = tops[Math.min(2, tops.length - 1)] ?? region.y;
  const isSpanning = (b: NormalizedBox): boolean => {
    const cx = b.nx + b.nw / 2 - region.x;
    const wide = b.nw >= region.w * 0.6;
    const centered = Math.abs(cx - region.w / 2) <= region.w * 0.15;
    const inTitleBand = b.ny <= contentTop + (b.nh || 1) * 1.5;
    if (!(wide && centered)) return false;
    if (columns === 2 && splitX !== null) {
      const crosses = b.nx < splitX - region.w * 0.02 && b.nx + b.nw > splitX + region.w * 0.02;
      return crosses && inTitleBand;
    }
    return inTitleBand;
  };

  const titles = bodyBoxes.filter(isSpanning);
  const rest = bodyBoxes.filter((b) => !isSpanning(b));

  let ordered: Paragraph[];
  if (columns === 2 && splitX !== null) {
    const left = rest.filter((b) => b.nx + b.nw / 2 < splitX);
    const right = rest.filter((b) => b.nx + b.nw / 2 >= splitX);
    ordered = interleaveTwoColumns(titles, left, right);
  } else {
    // Single column. Titles participate as their own lines in vertical order.
    ordered = buildParagraphs(rest, 0);
    // Re-insert spanning titles (rare in 1-col) at correct vertical position by
    // rebuilding over the full set so global vertical order is preserved.
    ordered = buildParagraphs(bodyBoxes, 0);
  }

  ordered.forEach((p, i) => (p.index = i));
  return { paragraphs: ordered, issues: [] };
}

/**
 * Two-column interleave: scan top to bottom. A spanning title is emitted whole
 * when reached; column content is read left fully-then-right only across the
 * title-free bands. Implementation: split each column into segments by title
 * horizontal bands, then emit (left segment, right segment, title) in y order.
 */
function interleaveTwoColumns(
  titles: NormalizedBox[],
  left: NormalizedBox[],
  right: NormalizedBox[],
): Paragraph[] {
  const out: Paragraph[] = [];
  const sortedTitles = titles.slice().sort((a, b) => a.ny - b.ny);

  const segmentParas = (
    boxes: NormalizedBox[],
    col: number,
    fromY: number,
    toY: number,
  ): Paragraph[] =>
    buildParagraphs(
      boxes.filter((b) => b.ny >= fromY && b.ny < toY),
      col,
    );

  let cursor = -Infinity;
  for (const t of sortedTitles) {
    const bandTop = t.ny - t.nh;
    out.push(...segmentParas(left, 0, cursor, bandTop));
    out.push(...segmentParas(right, 1, cursor, bandTop));
    out.push({ index: -1, text: t.text, boxIds: [t.id], column: -1 });
    cursor = t.ny + 2 * t.nh;
  }
  out.push(...segmentParas(left, 0, cursor, Infinity));
  out.push(...segmentParas(right, 1, cursor, Infinity));
  return out;
}

/** Group one column's boxes into lines then paragraphs. */
function buildParagraphs(boxes: NormalizedBox[], column: number): Paragraph[] {
  if (boxes.length === 0) return [];
  const lineH = medianLineHeight(boxes) || 1;
  const sorted = boxes.slice().sort((a, b) => a.ny - b.ny || a.nx - b.nx);

  const lines: NormalizedBox[][] = [];
  for (const b of sorted) {
    const cy = boxesCenterY(b);
    let target: NormalizedBox[] | null = null;
    for (const line of lines) {
      const center = line.reduce((s, l) => s + boxesCenterY(l), 0) / line.length;
      if (Math.abs(cy - center) <= lineH * 0.6) {
        target = line;
        break;
      }
    }
    if (target) target.push(b);
    else lines.push([b]);
  }

  for (const line of lines) line.sort((a, b) => a.nx - b.nx);
  lines.sort(
    (a, b) =>
      a.reduce((s, l) => s + boxesCenterY(l), 0) / a.length -
      b.reduce((s, l) => s + boxesCenterY(l), 0) / b.length,
  );

  const paragraphs: Paragraph[] = [];
  let current: NormalizedBox[][] | null = null;
  let prevLeft = 0;
  let prevBottom = 0;

  for (const line of lines) {
    const left = Math.min(...line.map((l) => l.nx));
    const top = Math.min(...line.map((l) => l.ny));
    const h = Math.max(...line.map((l) => l.nh));
    const gapV = current ? top - prevBottom : Infinity;
    const indent = current ? left - prevLeft : 0;
    const startsNew = !current || gapV > h * 0.9 || indent > lineH * 0.6;
    if (startsNew) {
      if (current) paragraphs.push(toPara(current, column));
      current = [];
    }
    current!.push(line);
    prevLeft = left;
    prevBottom = top + h;
  }
  if (current) paragraphs.push(toPara(current, column));
  return paragraphs;
}

function toPara(lines: NormalizedBox[][], column: number): Paragraph {
  const boxIds: string[] = [];
  const textParts: string[] = [];
  for (const line of lines) {
    boxIds.push(...line.map((l) => l.id));
    textParts.push(line.map((l) => l.text).join(""));
  }
  return { index: -1, text: textParts.join(""), boxIds, column };
}
