import type { DatabaseSync } from "node:sqlite";
import { Repo, RepoError } from "../db/repo.js";
import type { Clock } from "../db/database.js";
import { runPipeline, type ManualRegion } from "./pipeline.js";
import { toCsv, toJson } from "./exporters.js";
import { diffVersions, type ChangeEntry } from "./diff.js";
import type { DocumentResult, PageInput } from "./types.js";

export class Service {
  private repo: Repo;

  constructor(
    db: DatabaseSync,
    private now: Clock = () => new Date(),
  ) {
    this.repo = new Repo(db, now);
  }

  createDocument(name: string): number {
    return this.repo.createDocument(name);
  }

  listDocuments(limit: number, offset: number) {
    return this.repo.listDocuments(limit, offset);
  }

  latestVersion(documentId: number): number {
    return this.repo.latestVersion(documentId);
  }

  importPages(documentId: number, pages: PageInput[], importKey?: string) {
    return this.repo.importVersionIdempotent(documentId, pages, importKey);
  }

  addRegion(documentId: number, version: number, region: ManualRegion): number {
    return this.repo.addRegion(documentId, version, region.pageNo, region.kind, region);
  }

  listRegions(documentId: number, version: number, pageNo: number) {
    return this.repo.listRegions(documentId, version, pageNo);
  }

  reconstruct(
    documentId: number,
    version: number | "latest",
    opts: { autoDetect?: boolean } = { autoDetect: true },
  ): DocumentResult {
    const v = version === "latest" ? this.repo.latestVersion(documentId) : version;
    if (v === 0) throw new RepoError("VERSION_NOT_FOUND", "文档尚无版本", 404);
    const pages = this.repo.loadVersion(documentId, v);
    const stored = this.repo.listRegionsAll(documentId, v);
    const manualRegions = stored.map((r) => ({
      pageNo: Number(r.pageNo),
      kind: r.kind as ManualRegion["kind"],
      x: Number(r.x),
      y: Number(r.y),
      w: Number(r.w),
      h: Number(r.h),
    }));
    const result = runPipeline(pages, {
      documentId,
      version: v,
      manualRegions,
      autoDetect: opts.autoDetect,
    });
    this.repo.saveResult(documentId, v, JSON.stringify(result));
    return result;
  }

  getStoredResult(documentId: number, version: number): DocumentResult {
    const row = this.repo.getResult(documentId, version);
    if (!row) throw new RepoError("RESULT_NOT_FOUND", "请先重建该版本", 404);
    return JSON.parse(String(row.payload)) as DocumentResult;
  }

  listIssues(documentId: number, version: number) {
    this.repo.loadVersion(documentId, version);
    const result = this.getStoredResult(documentId, version);
    return result.pages.flatMap((p) => p.issues);
  }

  revise(
    documentId: number,
    version: number,
    pageNo: number,
    target: string,
    newValue: string,
  ) {
    const result = this.getStoredResult(documentId, version);
    const page = result.pages.find((p) => p.pageNo === pageNo);
    if (!page) throw new RepoError("PAGE_NOT_FOUND", "页面不存在", 404);
    const oldValue = resolveTarget(page, target);
    if (oldValue === undefined) throw new RepoError("TARGET_NOT_FOUND", `修订目标不存在: ${target}`, 404);
    const revision = this.repo.addRevision({
      documentId,
      version,
      pageNo,
      target,
      oldValue: String(oldValue),
      newValue,
    });
    applyTarget(page, target, newValue);
    this.repo.saveResult(documentId, version, JSON.stringify(result));
    return revision;
  }

  listRevisions(documentId: number, version: number) {
    return this.repo.listRevisions(documentId, version);
  }

  compare(documentId: number, from: number, to: number): ChangeEntry[] {
    const a = this.getStoredResult(documentId, from);
    const b = this.getStoredResult(documentId, to);
    return diffVersions(a, b);
  }

  exportJson(documentId: number, version: number): string {
    const result = this.getStoredResult(documentId, version);
    return toJson(result, { revisions: this.repo.listRevisions(documentId, version) });
  }

  exportCsv(documentId: number, version: number): string {
    const result = this.getStoredResult(documentId, version);
    return toCsv(result, { revisions: this.repo.listRevisions(documentId, version) });
  }

  nowIso(): string {
    return this.now().toISOString();
  }
}

/** Resolve a dotted target like order.3.text or table.0.cell.1.2.text. */
function resolveTarget(page: DocumentResult["pages"][number], target: string): string | undefined {
  const parts = target.split(".");
  if (parts[0] === "order") {
    const idx = Number(parts[1]);
    const para = page.order[idx];
    if (!para || parts[2] !== "text") return undefined;
    return para.text;
  }
  if (parts[0] === "table") {
    const ti = Number(parts[1]);
    const table = page.tables[ti];
    if (!table || parts[2] !== "cell") return undefined;
    const r = Number(parts[3]);
    const c = Number(parts[4]);
    const cell = table.cells.find((cell) => cell.row === r && cell.col === c);
    if (!cell || parts[5] !== "text") return undefined;
    return cell.text;
  }
  return undefined;
}

function applyTarget(page: DocumentResult["pages"][number], target: string, value: string): void {
  const parts = target.split(".");
  if (parts[0] === "order") {
    const para = page.order[Number(parts[1])];
    if (para && parts[2] === "text") para.text = value;
  } else if (parts[0] === "table") {
    const table = page.tables[Number(parts[1])];
    const cell = table?.cells.find(
      (cell) => cell.row === Number(parts[3]) && cell.col === Number(parts[4]),
    );
    if (cell && parts[5] === "text") {
      cell.text = value;
      cell.empty = value.length === 0;
    }
  }
}
