/**
 * Domain types for the OCR layout backend.
 *
 * Coordinate system: origin top-left of the *un-rotated* page, x grows right,
 * y grows down. All boxes are normalized into this system before analysis.
 */

/** Rotation that was applied to the scanned page. Only multiples of 90deg. */
export type Rotation = 0 | 90 | 180 | 270;

/** A raw recognized text box as supplied by the (external) OCR stage. */
export interface TextBox {
  /** Caller supplied stable id within a page; used for source mapping. */
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0..1 recognition confidence. */
  confidence: number;
}

/** A page plus the raw boxes recorded on the (possibly rotated) scan. */
export interface PageInput {
  pageNo: number;
  width: number;
  height: number;
  rotation: Rotation;
  boxes: TextBox[];
}

export type RegionKind = "body" | "table" | "header" | "footer";

export interface Region {
  id: number;
  pageNo: number;
  kind: RegionKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** true when the region was inferred rather than user specified. */
  auto: boolean;
}

export type Severity = "info" | "warning" | "error";

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  pageNo: number;
  /** Related box / cell ids, when known. */
  refs: string[];
}

/** An ordered paragraph reconstructed from body boxes. */
export interface Paragraph {
  index: number;
  text: string;
  boxIds: string[];
  /** Column index, 0 based, for multi-column layouts; -1 for spanning titles. */
  column: number;
}

export interface TableCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  boxIds: string[];
  /** True when the cell area had no recognized text (empty cell). */
  empty: boolean;
  /** True when row/col span could not be proven and needs review. */
  mergeUncertain: boolean;
}

export interface TableResult {
  regionId: number;
  rows: number;
  cols: number;
  cells: TableCell[];
}

export interface PageResult {
  pageNo: number;
  order: Paragraph[];
  tables: TableResult[];
  issues: Issue[];
}

export interface DocumentResult {
  documentId: number;
  version: number;
  pages: PageResult[];
}

export interface Revision {
  id: number;
  documentId: number;
  version: number;
  pageNo: number;
  /** Dot-path style locator, e.g. "order.3.text" or "table.1.cell.0.2.text". */
  target: string;
  oldValue: string;
  newValue: string;
  createdAt: string;
}
