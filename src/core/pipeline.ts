import { normalizePage, centerInRegion, type NormalizedBox, type NormalizedPage } from "./geometry.js";
import { analyzeBody } from "./readingOrder.js";
import { analyzeTable, type TableRegion } from "./table.js";
import { detectHeaderFooter } from "./regions.js";
import { detectTables } from "./autoTable.js";
import type {
  DocumentResult,
  Issue,
  PageInput,
  PageResult,
  Region,
  RegionKind,
  TableResult,
} from "./types.js";

export interface ManualRegion {
  pageNo: number;
  kind: RegionKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PipelineOptions {
  documentId: number;
  version: number;
  /** User-specified regions; auto header/footer detection fills the rest. */
  manualRegions?: ManualRegion[];
  /** When true, infer body/table regions automatically per page. */
  autoDetect?: boolean;
}

interface RegionBox extends TableRegion {
  kind: RegionKind;
  auto: boolean;
}

/**
 * Run the full reconstruction for a document version.
 */
export function runPipeline(pages: PageInput[], opts: PipelineOptions): DocumentResult {
  const normalized = pages.map((p) =>
    normalizePage(p.pageNo, p.width, p.height, p.rotation, p.boxes),
  );

  const issues: Issue[] = [];
  const mark = (pageNo: number) =>
    (code: string, severity: Issue["severity"], message: string, refs: string[] = []) =>
      issues.push({ code, severity, message, pageNo, refs });

  // Repeated header/footer detection across pages.
  const hf = detectHeaderFooter(normalized);

  const resultPages: PageResult[] = normalized.map((np) => {
    const pageIssues: Issue[] = [];
    const pageMark = (code: string, sev: Issue["severity"], msg: string, refs: string[]) =>
      pageIssues.push({ code, severity: sev, message: msg, pageNo: np.pageNo, refs });

    const manual = (opts.manualRegions ?? []).filter((r) => r.pageNo === np.pageNo);

    // Build region list: explicit manual regions + auto header/footer bands.
    let regions: RegionBox[] = manual.map((m) => ({
      id: 0,
      kind: m.kind,
      x: m.x,
      y: m.y,
      w: m.w,
      h: m.h,
      auto: false,
    }));

    for (const band of hf.regions) {
      if (band.kind === "header" || band.kind === "footer") {
        if (!regions.some((r) => r.kind === band.kind)) {
          // Use a full-width band spanning top/bottom margin for reliable
          // exclusion; the detected labels merely prove it is repeated.
          const bandH = Math.max(band.h, np.height * 0.08);
          regions.push({
            id: 0,
            kind: band.kind,
            x: 0,
            y: band.kind === "header" ? 0 : np.height - bandH,
            w: np.width,
            h: bandH,
            auto: true,
          });
        }
      }
    }

    // Automatic table detection unless the user supplied table regions.
    const hasManualTable = regions.some((r) => r.kind === "table" && !r.auto);
    if (opts.autoDetect !== false && !hasManualTable) {
      const available = np.boxes.filter(
        (b) => !regions.some((r) => (r.kind === "header" || r.kind === "footer") && centerInRegion(b, r)),
      );
      for (const rect of detectTables(available)) {
        regions.push({ id: 0, kind: "table", ...rect, auto: true });
      }
    }

    // Default: a full-page body region if the user gave no body region.
    const hasBody = regions.some((r) => r.kind === "body");
    const tableRegions = regions.filter((r) => r.kind === "table");

    const excluded = (r: RegionBox) => r.kind === "table" || r.kind === "header" || r.kind === "footer";
    const inExcluded = (b: NormalizedBox) => regions.some((r) => excluded(r) && centerInRegion(b, r));

    let bodyBoxes: NormalizedBox[];
    if (hasBody) {
      const bodyRegion = regions.find((r) => r.kind === "body")!;
      bodyBoxes = np.boxes.filter((b) => centerInRegion(b, bodyRegion) && !inExcluded(b));
    } else {
      bodyBoxes = np.boxes.filter((b) => !inExcluded(b));
    }

    const bodyRegion =
      regions.find((r) => r.kind === "body") ??
      ({ x: 0, y: 0, w: np.width, h: np.height, auto: true } as RegionBox);

    const { paragraphs } = analyzeBody(np.pageNo, bodyBoxes, bodyRegion, pageMark);

    const tables: TableResult[] = tableRegions.map((tr, idx) => {
      const inside = np.boxes.filter((b) => centerInRegion(b, tr));
      return analyzeTable(
        np.pageNo,
        inside,
        { id: tr.id || idx + 1, x: tr.x, y: tr.y, w: tr.w, h: tr.h },
        pageMark,
      );
    });

    // Any box not consumed by body or a table is flagged (missing boundary of
    // belonging), so nothing is silently dropped.
    const consumed = new Set<string>([
      ...paragraphs.flatMap((p) => p.boxIds),
      ...tables.flatMap((t) => t.cells.flatMap((c) => c.boxIds)),
    ]);
    for (const b of np.boxes) {
      if (!consumed.has(b.id)) {
        pageMark("UNASSIGNED_BOX", "warning", `框 ${b.id} 未归入任何区域`, [b.id]);
      }
    }

    return {
      pageNo: np.pageNo,
      order: paragraphs,
      tables,
      issues: pageIssues,
    };
  });

    void issues;
  return { documentId: opts.documentId, version: opts.version, pages: resultPages };
}

export type { NormalizedPage, Region };
