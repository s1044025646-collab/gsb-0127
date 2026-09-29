import type { NormalizedBox } from "./geometry.js";
import type { TableCell, TableResult } from "./types.js";

type Mark = (code: string, severity: "info" | "warning" | "error", msg: string, refs: string[]) => void;

export interface TableRegion {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Reconstruct a regular ruled rectangular table.
 *
 * Grid lines are derived from box edges (left/right/top/bottom). Boxes map to
 * the row/column band containing their center. Spans are detected when a box
 * geometrically covers the center of an adjacent band whose own cell is empty.
 * Empty cells are preserved as such; adjacent numeric cells are never joined.
 */
export function analyzeTable(
  pageNo: number,
  boxes: NormalizedBox[],
  region: TableRegion,
  mark: Mark,
): TableResult {
  void pageNo;
  if (boxes.length === 0) return { regionId: region.id, rows: 0, cols: 0, cells: [] };

  // Cells share borders; inner boxes are inset a few px, so use a tolerance
  // close to half the typical cell pitch to merge coincident edges.
  const minDim = median(boxes.map((b) => Math.min(b.nw, b.nh)));
  const tol = Math.max(4, minDim * 0.45);
  // Anchor outer grid lines to the extreme occupied edges so a loose region
  // rectangle does not create phantom empty outer rows/columns.
  const xLow = Math.min(...boxes.map((b) => b.nx));
  const xHigh = Math.max(...boxes.map((b) => b.nx + b.nw));
  const yLow = Math.min(...boxes.map((b) => b.ny));
  const yHigh = Math.max(...boxes.map((b) => b.ny + b.nh));
  const xLines = gridLines(
    boxes.flatMap((b) => [b.nx, b.nx + b.nw]),
    xLow,
    xHigh,
    tol,
  );
  const yLines = gridLines(
    boxes.flatMap((b) => [b.ny, b.ny + b.nh]),
    yLow,
    yHigh,
    tol,
  );
  const cols = xLines.length - 1;
  const rows = yLines.length - 1;

  const band = (lines: number[], v: number) => {
    for (let i = 0; i < lines.length - 1; i++) {
      if (v >= lines[i]! && v <= lines[i + 1]!) return i;
    }
    return Math.max(0, lines.length - 2);
  };

  const occupied = new Map<string, NormalizedBox[]>();
  for (const b of boxes) {
    const r = band(yLines, b.ny + b.nh / 2);
    const c = band(xLines, b.nx + b.nw / 2);
    const key = `${r}:${c}`;
    const arr = occupied.get(key) ?? [];
    arr.push(b);
    occupied.set(key, arr);
  }

  const cells: TableCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hit = occupied.get(`${r}:${c}`);
      if (!hit) {
        cells.push(mkCell(r, c, "", [], true));
      } else {
        const parts = hit.slice().sort((a, b) => a.nx - b.nx);
        cells.push(mkCell(r, c, parts.map((p) => p.text).join(" "), parts.map((p) => p.id), false));
      }
    }
  }

  inferSpans(cells, rows, cols, boxes, xLines, yLines, mark);
  return { regionId: region.id, rows, cols, cells };
}

function mkCell(
  row: number,
  col: number,
  text: string,
  boxIds: string[],
  empty: boolean,
): TableCell {
  return { row, col, rowSpan: 1, colSpan: 1, text, boxIds, empty, mergeUncertain: false };
}

function inferSpans(
  cells: TableCell[],
  rows: number,
  cols: number,
  boxes: NormalizedBox[],
  xLines: number[],
  yLines: number[],
  mark: Mark,
): void {
  const at = (r: number, c: number) =>
    cells.find((cell) => cell.row === r && cell.col === c);

  for (const cell of cells) {
    if (cell.empty) continue;
    const box = boxes
      .filter((b) => cell.boxIds.includes(b.id))
      .sort((a, b) => b.nw * b.nh - a.nw * a.nh)[0]!;

    // Horizontal: extend across following empty cells whose center the box covers.
    let colSpan = 1;
    for (let c = cell.col + 1; c < cols; c++) {
      const neighbor = at(cell.row, c);
      if (!neighbor || !neighbor.empty) break;
      const center = (xLines[c]! + xLines[c + 1]!) / 2;
      if (box.nx - 1 <= center && center <= box.nx + box.nw + 1) {
        colSpan += 1;
      } else {
        mark(
          "TABLE_MERGE_UNCERTAIN",
          "warning",
          `单元格 (${cell.row},${cell.col}) 与空单元格 (${cell.row},${c}) 的合并关系无法确定`,
          cell.boxIds,
        );
        neighbor.mergeUncertain = true;
        break;
      }
    }

    // Vertical: extend down across empty cells whose center the box covers.
    let rowSpan = 1;
    for (let r = cell.row + 1; r < rows; r++) {
      const neighbor = at(r, cell.col);
      if (!neighbor || !neighbor.empty) break;
      const center = (yLines[r]! + yLines[r + 1]!) / 2;
      if (box.ny - 1 <= center && center <= box.ny + box.nh + 1) {
        rowSpan += 1;
      } else {
        mark(
          "TABLE_MERGE_UNCERTAIN",
          "warning",
          `单元格 (${cell.row},${cell.col}) 与空单元格 (${r},${cell.col}) 的合并关系无法确定`,
          cell.boxIds,
        );
        neighbor.mergeUncertain = true;
        break;
      }
    }

    cell.colSpan = colSpan;
    cell.rowSpan = rowSpan;
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function gridLines(edges: number[], low: number, high: number, tol: number): number[] {
  const clusters: { sum: number; n: number; members: number[] }[] = [];
  for (const v of edges.slice().sort((a, b) => a - b)) {
    const last = clusters[clusters.length - 1];
    const mean = last ? last.sum / last.n : Infinity;
    if (!last || Math.abs(v - mean) > tol) clusters.push({ sum: v, n: 1, members: [v] });
    else {
      last.sum += v;
      last.n += 1;
      last.members.push(v);
    }
  }
  const lines = clusters.map((c) => c.sum / c.n);
  const inner = lines.filter((v) => v > low + tol && v < high - tol);
  return [low, ...inner, high].sort((a, b) => a - b);
}
