import type { DatabaseSync } from "node:sqlite";
import { iso, type Clock } from "./database.js";
import type { PageInput, RegionKind, Revision } from "../core/types.js";

export interface Row {
  [key: string]: unknown;
}

export class Repo {
  constructor(
    private db: DatabaseSync,
    private now: Clock = () => new Date(),
  ) {}

  createDocument(name: string): number {
    const info = this.db
      .prepare("INSERT INTO documents(name, created_at) VALUES (?,?)")
      .run(name, iso(this.now));
    return Number(info.lastInsertRowid);
  }

  getDocument(id: number): Row | undefined {
    return this.db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Row | undefined;
  }

  listDocuments(limit: number, offset: number): Row[] {
    return this.db
      .prepare("SELECT * FROM documents ORDER BY id LIMIT ? OFFSET ?")
      .all(limit, offset) as Row[];
  }

  latestVersion(documentId: number): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM pages WHERE document_id = ?")
      .get(documentId) as Row;
    return Number(row.v ?? 0);
  }

  /**
   * Import pages into a new version inside a transaction. Idempotent: reusing
   * the same importKey and identical payload returns the existing version.
   */
  importVersion(documentId: number, pages: PageInput[], importKey?: string): number {
    if (!this.getDocument(documentId)) throw new RepoError("DOC_NOT_FOUND", "文档不存在", 404);
    if (pages.length === 0) throw new RepoError("EMPTY_IMPORT", "导入不包含任何页面", 400);
    const pageNos = pages.map((p) => p.pageNo);
    if (new Set(pageNos).size !== pageNos.length) {
      throw new RepoError("DUP_PAGE_NO", "同一版本中页码不可重复", 400);
    }
    for (const page of pages) {
      const boxIds = page.boxes.map((b) => b.id);
      if (new Set(boxIds).size !== boxIds.length) {
        throw new RepoError("DUP_BOX_ID", `第 ${page.pageNo} 页存在重复框 id`, 400);
      }
    }

    const tx = this.db;
    try {
      tx.exec("BEGIN");
      const version = this.latestVersion(documentId) + 1;
      for (const page of pages) {
        this.insertPage(documentId, version, page, importKey);
      }
      tx.exec("COMMIT");
      return version;
    } catch (err) {
      tx.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Idempotency-aware import: if importKey already produced a version with the
   * same number of pages/boxes, return it instead of creating a new version.
   */
  importVersionIdempotent(
    documentId: number,
    pages: PageInput[],
    importKey?: string,
  ): { version: number; reused: boolean } {
    if (importKey) {
      const existing = this.findImportVersion(documentId, importKey, pages);
      if (existing !== null) return { version: existing, reused: true };
    }
    return { version: this.importVersion(documentId, pages, importKey), reused: false };
  }

  private findImportVersion(documentId: number, importKey: string, pages: PageInput[]): number | null {
    const rows = this.db
      .prepare(
        `SELECT version, COUNT(*) AS n FROM pages
         WHERE document_id = ? AND import_key = ? GROUP BY version`,
      )
      .all(documentId, importKey) as Row[];
    for (const row of rows) {
      const boxCount = (
        this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM boxes b JOIN pages p ON b.page_id = p.id
             WHERE p.document_id = ? AND p.version = ?`,
          )
          .get(documentId, Number(row.version)) as Row
      ).n;
      const expectedBoxes = pages.reduce((s, p) => s + p.boxes.length, 0);
      if (Number(row.n) === pages.length && Number(boxCount) === expectedBoxes) {
        return Number(row.version);
      }
    }
    return null;
  }

  private insertPage(documentId: number, version: number, page: PageInput, importKey?: string): void {
    const info = this.db
      .prepare(
        `INSERT INTO pages(document_id, version, page_no, width, height, rotation, import_key, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        documentId,
        version,
        page.pageNo,
        page.width,
        page.height,
        page.rotation,
        importKey ?? null,
        iso(this.now),
      );
    const pageId = Number(info.lastInsertRowid);
    const stmt = this.db.prepare(
      `INSERT INTO boxes(page_id, box_ref, text, x, y, w, h, confidence, seq)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    page.boxes.forEach((b, i) => {
      stmt.run(pageId, b.id, b.text, b.x, b.y, b.w, b.h, b.confidence, i);
    });
  }

  loadVersion(documentId: number, version: number): PageInput[] {
    const pages = this.db
      .prepare(
        "SELECT * FROM pages WHERE document_id = ? AND version = ? ORDER BY page_no",
      )
      .all(documentId, version) as Row[];
    if (pages.length === 0) throw new RepoError("VERSION_NOT_FOUND", "版本不存在", 404);
    return pages.map((p) => {
      const boxes = this.db
        .prepare("SELECT * FROM boxes WHERE page_id = ? ORDER BY seq")
        .all(Number(p.id)) as Row[];
      return {
        pageNo: Number(p.page_no),
        width: Number(p.width),
        height: Number(p.height),
        rotation: Number(p.rotation) as PageInput["rotation"],
        boxes: boxes.map((b) => ({
          id: String(b.box_ref),
          text: String(b.text),
          x: Number(b.x),
          y: Number(b.y),
          w: Number(b.w),
          h: Number(b.h),
          confidence: Number(b.confidence),
        })),
      };
    });
  }

  saveResult(documentId: number, version: number, payload: string): void {
    this.db
      .prepare(
        `INSERT INTO results(document_id, version, payload, created_at)
         VALUES (?,?,?,?)
         ON CONFLICT(document_id, version) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
      )
      .run(documentId, version, payload, iso(this.now));
  }

  getResult(documentId: number, version: number): Row | undefined {
    return this.db
      .prepare("SELECT * FROM results WHERE document_id = ? AND version = ?")
      .get(documentId, version) as Row | undefined;
  }

  addRegion(
    documentId: number,
    version: number,
    pageNo: number,
    kind: RegionKind,
    r: { x: number; y: number; w: number; h: number; auto?: boolean },
  ): number {
    const page = this.pageRow(documentId, version, pageNo);
    const info = this.db
      .prepare(
        "INSERT INTO regions(page_id, kind, x, y, w, h, auto) VALUES (?,?,?,?,?,?,?)",
      )
      .run(Number(page.id), kind, r.x, r.y, r.w, r.h, r.auto ? 1 : 0);
    return Number(info.lastInsertRowid);
  }

  listRegions(documentId: number, version: number, pageNo: number): Row[] {
    const page = this.pageRow(documentId, version, pageNo);
    return this.db
      .prepare("SELECT * FROM regions WHERE page_id = ? ORDER BY id")
      .all(Number(page.id)) as Row[];
  }

  listRegionsAll(documentId: number, version: number): Array<Row & { pageNo: number }> {
    const rows = this.db
      .prepare(
        `SELECT r.*, p.page_no AS page_no FROM regions r
         JOIN pages p ON r.page_id = p.id
         WHERE p.document_id = ? AND p.version = ? ORDER BY r.id`,
      )
      .all(documentId, version) as Row[];
    return rows.map((r) => ({ ...r, pageNo: Number(r.page_no) }));
  }

  clearRegions(documentId: number, version: number): void {
    this.db
      .prepare(
        `DELETE FROM regions WHERE page_id IN
         (SELECT id FROM pages WHERE document_id=? AND version=?)`,
      )
      .run(documentId, version);
  }

  private pageRow(documentId: number, version: number, pageNo: number): Row {
    const page = this.db
      .prepare(
        "SELECT * FROM pages WHERE document_id=? AND version=? AND page_no=?",
      )
      .get(documentId, version, pageNo) as Row | undefined;
    if (!page) throw new RepoError("PAGE_NOT_FOUND", "页面不存在", 404);
    return page;
  }

  addRevision(rev: Omit<Revision, "id" | "createdAt">): Revision {
    const info = this.db
      .prepare(
        `INSERT INTO revisions(document_id, version, page_no, target, old_value, new_value, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        rev.documentId,
        rev.version,
        rev.pageNo,
        rev.target,
        rev.oldValue,
        rev.newValue,
        iso(this.now),
      );
    return { ...rev, id: Number(info.lastInsertRowid), createdAt: iso(this.now) };
  }

  listRevisions(documentId: number, version: number): Revision[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM revisions WHERE document_id=? AND version=? ORDER BY id",
      )
      .all(documentId, version) as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      documentId: Number(r.document_id),
      version: Number(r.version),
      pageNo: Number(r.page_no),
      target: String(r.target),
      oldValue: String(r.old_value),
      newValue: String(r.new_value),
      createdAt: String(r.created_at),
    }));
  }
}

export class RepoError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "RepoError";
  }
}
