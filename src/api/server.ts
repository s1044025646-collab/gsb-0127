import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { openDatabase, type Clock } from "../db/database.js";
import { Service } from "../core/service.js";
import { RepoError } from "../db/repo.js";
import { parsePagination, validatePageInput, validateRegion } from "../core/validation.js";

export interface AppOptions {
  dbPath: string;
  now?: Clock;
  host?: string;
  port?: number; // 0 => auto-select a free port
}

interface JsonError {
  error: { code: string; message: string; fields?: unknown };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

function sendError(res: ServerResponse, status: number, code: string, message: string, fields?: unknown): void {
  const body: JsonError = { error: { code, message } };
  if (fields) body.error.fields = fields;
  send(res, status, body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new RepoError("INVALID_JSON", "请求体不是合法 JSON", 400);
  }
}

function intParam(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new RepoError("INVALID_PARAM", `${name} 必须是整数`, 400);
  return n;
}

export function createApp(opts: AppOptions): { server: Server; service: Service } {
  const db = openDatabase({ path: opts.dbPath, now: opts.now });
  const service = new Service(db, opts.now);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (method === "GET" && path === "/health") {
        return send(res, 200, { ok: true, time: service.nowIso() });
      }

      // POST /documents
      if (method === "POST" && path === "/documents") {
        const body = (await readJson(req)) as { name?: unknown };
        if (typeof body.name !== "string" || body.name.trim().length === 0)
          return sendError(res, 400, "INVALID_NAME", "name 必须是非空字符串", { field: "name" });
        const id = service.createDocument(body.name.trim());
        return send(res, 201, { id, name: body.name.trim() });
      }

      // GET /documents?limit&offset
      if (method === "GET" && path === "/documents") {
        const { limit, offset, errors } = parsePagination(url.searchParams);
        if (errors.length) return sendError(res, 400, "INVALID_PAGINATION", "分页参数错误", errors);
        return send(res, 200, { items: service.listDocuments(limit, offset), limit, offset });
      }

      const importMatch = path.match(/^\/documents\/(\d+)\/versions?$/);
      if (method === "POST" && importMatch) {
        const docId = intParam(importMatch[1], "documentId");
        const body = (await readJson(req)) as { pages?: unknown; importKey?: unknown };
        const parsed = validatePageInput(body.pages);
        if (!parsed.ok) return sendError(res, 400, "VALIDATION_FAILED", "页面校验失败", parsed.errors);
        const key = typeof body.importKey === "string" ? body.importKey : undefined;
        const r = service.importPages(docId, parsed.value, key);
        return send(res, 201, { version: r.version, reused: r.reused });
      }

      const regionMatch = path.match(/^\/documents\/(\d+)\/versions\/(\d+)\/regions$/);
      if (method === "POST" && regionMatch) {
        const docId = intParam(regionMatch[1], "documentId");
        const version = intParam(regionMatch[2], "version");
        const body = await readJson(req);
        const parsed = validateRegion(body);
        if (!parsed.ok) return sendError(res, 400, "VALIDATION_FAILED", "区域校验失败", parsed.errors);
        const id = service.addRegion(docId, version, parsed.value);
        return send(res, 201, { id });
      }
      if (method === "GET" && regionMatch) {
        const docId = intParam(regionMatch[1], "documentId");
        const version = intParam(regionMatch[2], "version");
        const pageNo = intParam(url.searchParams.get("pageNo") ?? "", "pageNo");
        return send(res, 200, { items: service.listRegions(docId, version, pageNo) });
      }

      // POST /documents/:id/versions/:v/reconstruct  (v may be "latest")
      const recMatch = path.match(/^\/documents\/(\d+)\/versions\/([^/]+)\/reconstruct$/);
      if (method === "POST" && recMatch) {
        const docId = intParam(recMatch[1], "documentId");
        const vTok = recMatch[2]!;
        const version = vTok === "latest" ? "latest" : intParam(vTok, "version");
        const result = service.reconstruct(docId, version);
        return send(res, 200, result);
      }

      // GET issues
      const issueMatch = path.match(/^\/documents\/(\d+)\/versions\/(\d+)\/issues$/);
      if (method === "GET" && issueMatch) {
        const docId = intParam(issueMatch[1], "documentId");
        const version = intParam(issueMatch[2], "version");
        const { limit, offset, errors } = parsePagination(url.searchParams);
        if (errors.length) return sendError(res, 400, "INVALID_PAGINATION", "分页参数错误", errors);
        const all = service.listIssues(docId, version);
        return send(res, 200, { items: all.slice(offset, offset + limit), total: all.length, limit, offset });
      }

      // POST revision
      const revMatch = path.match(/^\/documents\/(\d+)\/versions\/(\d+)\/revisions$/);
      if (method === "POST" && revMatch) {
        const docId = intParam(revMatch[1], "documentId");
        const version = intParam(revMatch[2], "version");
        const body = (await readJson(req)) as { pageNo?: unknown; target?: unknown; newValue?: unknown };
        if (
          typeof body.pageNo !== "number" ||
          typeof body.target !== "string" ||
          typeof body.newValue !== "string"
        )
          return sendError(res, 400, "VALIDATION_FAILED", "需要 pageNo/target/newValue");
        const rev = service.revise(docId, version, body.pageNo, body.target, body.newValue);
        return send(res, 201, rev);
      }
      if (method === "GET" && revMatch) {
        const docId = intParam(revMatch[1], "documentId");
        const version = intParam(revMatch[2], "version");
        return send(res, 200, { items: service.listRevisions(docId, version) });
      }

      // GET compare
      const cmpMatch = path.match(/^\/documents\/(\d+)\/compare$/);
      if (method === "GET" && cmpMatch) {
        const docId = intParam(cmpMatch[1], "documentId");
        const from = intParam(url.searchParams.get("from") ?? "", "from");
        const to = intParam(url.searchParams.get("to") ?? "", "to");
        return send(res, 200, { changes: service.compare(docId, from, to) });
      }

      // GET export
      const expMatch = path.match(/^\/documents\/(\d+)\/versions\/(\d+)\/export\.(json|csv)$/);
      if (method === "GET" && expMatch) {
        const docId = intParam(expMatch[1], "documentId");
        const version = intParam(expMatch[2], "version");
        const fmt = expMatch[3];
        if (fmt === "json") {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          return res.end(service.exportJson(docId, version));
        }
        res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
        return res.end(service.exportCsv(docId, version));
      }

      return sendError(res, 404, "NOT_FOUND", `未找到路由 ${method} ${path}`);
    } catch (err) {
      if (err instanceof RepoError) return sendError(res, err.status, err.code, err.message);
      const message = err instanceof Error ? err.message : "内部错误";
      return sendError(res, 500, "INTERNAL", message);
    }
  });

  return { server, service };
}

/** Start the server bound to loopback only; port 0 auto-selects. */
export function startServer(opts: AppOptions): Promise<{ server: Server; port: number }> {
  const { server } = createApp(opts);
  const host = opts.host ?? "127.0.0.1";
  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, host, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

const isMain = process.argv[1] && process.argv[1].endsWith("server.ts");
if (isMain) {
  const dbPath = process.env.OCR_DB_PATH ?? "data/app.db";
  startServer({ dbPath }).then(({ port }) => {
    console.log(`OCR layout API listening on http://127.0.0.1:${port} (db: ${dbPath})`);
  });
}
