/**
 * Domain types. All coordinates are numbers in the page's own coordinate system
 * before normalization (rotation applied at import). Rectangles use top-left
 * origin with positive width/height.
 */

export type RectLike = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** A single OCR word/line text box as submitted by the caller. */
export type TextBoxInput = {
  /** Caller-supplied stable id within a document version. Used for idempotency. */
  boxRef?: string | number;
  text: string;
  rect: RectLike;
  /** 0..1 confidence. Missing => treated as unknown and flagged. */
  confidence?: number | null;
};

export type PageInput = {
  pageNo: number;
  /** Page size in the same units as the rectangles. */
  width: number;
  height: number;
  /** Clockwise rotation of the scanned page in degrees; only 0/90/180/270 supported. */
  rotation?: number;
  boxes: TextBoxInput[];
};

export type RegionKind = "body" | "table" | "header" | "footer";

export type RegionInput = {
  kind: RegionKind;
  rect?: RectLike;
  /**
   * When true the engine detects the region from geometry instead of using
   * the provided rect.
   */
  auto?: boolean;
};

export type ImportDocumentInput = {
  title?: string;
  clientToken?: string;
  pages: PageInput[];
  regions?: RegionInput[];
  /** Extraction rule hints, e.g. table column separators. */
  rules?: ExtractionRuleInput[];
};

export type ExtractionRuleInput = {
  name: string;
  kind: "table" | "reading-order";
  /** Column separator x coordinates (normalized). Optional. */
  columnGutters?: number[];
  /** Force a region rect for a specific page. */
  pageNo?: number;
};

export type NormalizedBox = {
  boxId: number;
  boxRef: string;
  text: string;
  rect: RectLike;
  confidence: number | null;
  pageNo: number;
};

export type IssueCode =
  | "OVERLAP"
  | "LOW_CONFIDENCE"
  | "MISSING_BOUNDARY"
  | "AMBIGUOUS_MERGE"
  | "ROTATION_UNSUPPORTED"
  | "EMPTY_CELL"
  | "OUT_OF_BOUNDS";

export type Issue = {
  code: IssueCode;
  message: string;
  pageNo: number;
  boxIds?: number[];
  cellId?: string;
};

export type Line = {
  lineId: string;
  text: string;
  boxIds: number[];
  rect: RectLike;
};

export type Paragraph = {
  paragraphId: string;
  text: string;
  lines: Line[];
  boxIds: number[];
  rect: RectLike;
  column: number;
};

export type TableCell = {
  cellId: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  boxIds: number[];
  rect: RectLike;
  /** True when the reconstructed cell has no source text. */
  empty: boolean;
};

export type Table = {
  regionIndex: number;
  pageNo: number;
  rect: RectLike;
  rows: number;
  cols: number;
  cells: TableCell[];
};

export type ReadingBlock =
  | { type: "paragraph"; pageNo: number; order: number; paragraph: Paragraph }
  | { type: "table"; pageNo: number; order: number; table: Table };

export type ReconstructionResult = {
  docId: number;
  version: number;
  pageCount: number;
  blocks: ReadingBlock[];
  issues: Issue[];
  /** Every consumed box id appears exactly once across blocks. */
  consumedBoxIds: number[];
};

export type RevisionInput = {
  /** Which artifact to revise. */
  target:
    | { kind: "paragraph"; paragraphId: string }
    | { kind: "cell"; cellId: string };
  /** Replacement text. null means "marked uncertain, no fabricated text". */
  text?: string | null;
  note?: string;
};
