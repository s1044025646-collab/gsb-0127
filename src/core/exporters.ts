import type { DocumentResult, Revision } from "./types.js";

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export interface CsvOptions {
  revisions?: Revision[];
}

/** Structured JSON export: the reconstruction result plus optional revisions. */
export function toJson(result: DocumentResult, opts: CsvOptions = {}): string {
  return JSON.stringify(
    {
      documentId: result.documentId,
      version: result.version,
      pages: result.pages.map((p) => ({
        pageNo: p.pageNo,
        readingOrder: p.order.map((para) => ({
          index: para.index,
          column: para.column,
          text: para.text,
          sourceBoxIds: para.boxIds,
        })),
        tables: p.tables.map((t) => ({
          regionId: t.regionId,
          rows: t.rows,
          cols: t.cols,
          cells: t.cells.map((c) => ({
            row: c.row,
            col: c.col,
            rowSpan: c.rowSpan,
            colSpan: c.colSpan,
            text: c.text,
            empty: c.empty,
            mergeUncertain: c.mergeUncertain,
            sourceBoxIds: c.boxIds,
          })),
        })),
        issues: p.issues,
      })),
      revisions: opts.revisions ?? [],
    },
    null,
    2,
  );
}

/**
 * CSV export. Reading order rows and table cell rows are emitted into separate
 * sections so numeric cells never get concatenated into prose.
 */
export function toCsv(result: DocumentResult, opts: CsvOptions = {}): string {
  const lines: string[] = [];
  lines.push(["section", "pageNo", "row", "col", "column", "index", "text", "sourceBoxIds", "flags"].map(csvEscape).join(","));
  for (const page of result.pages) {
    for (const para of page.order) {
      lines.push(
        [
          "reading",
          String(page.pageNo),
          "",
          "",
          String(para.column),
          String(para.index),
          csvEscape(para.text),
          csvEscape(para.boxIds.join(";")),
          "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    for (const table of page.tables) {
      for (const cell of table.cells) {
        const flags = [cell.empty ? "empty" : "", cell.mergeUncertain ? "mergeUncertain" : ""]
          .filter(Boolean)
          .join(";");
        lines.push(
          [
            "table",
            String(page.pageNo),
            String(cell.row),
            String(cell.col),
            "",
            "",
            csvEscape(cell.text),
            csvEscape(cell.boxIds.join(";")),
            flags,
          ]
            .map(csvEscape)
            .join(","),
        );
      }
    }
  }
  if (opts.revisions && opts.revisions.length) {
    lines.push("");
    lines.push(["revisionId", "pageNo", "target", "oldValue", "newValue", "createdAt"].map(csvEscape).join(","));
    for (const rev of opts.revisions) {
      lines.push(
        [rev.id, rev.pageNo, rev.target, rev.oldValue, rev.newValue, rev.createdAt].map((v) =>
          csvEscape(String(v)),
        ).join(","),
      );
    }
  }
  return lines.join("\n");
}
