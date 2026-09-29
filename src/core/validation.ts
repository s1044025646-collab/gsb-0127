import type { PageInput, RegionKind, Rotation, TextBox } from "./types.js";

export interface FieldError {
  code: string;
  message: string;
  field?: string;
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

export function validatePageInput(raw: unknown): { ok: true; value: PageInput[] } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  if (!Array.isArray(raw)) {
    return { ok: false, errors: [{ code: "INVALID_BODY", message: "请求体必须是页面数组", field: "pages" }] };
  }
  const pages: PageInput[] = [];
  const seenPageNos = new Set<number>();

  raw.forEach((p, pi) => {
    const base = `pages[${pi}]`;
    if (typeof p !== "object" || p === null) {
      errors.push({ code: "INVALID_PAGE", message: "页面必须是对象", field: base });
      return;
    }
    const page = p as Record<string, unknown>;
    const pageNo = page.pageNo;
    if (typeof pageNo !== "number" || !Number.isInteger(pageNo) || pageNo < 1) {
      errors.push({ code: "INVALID_PAGE_NO", message: "pageNo 必须是 >=1 的整数", field: `${base}.pageNo` });
    } else if (seenPageNos.has(pageNo)) {
      errors.push({ code: "DUP_PAGE_NO", message: `页码 ${pageNo} 重复`, field: `${base}.pageNo` });
    } else {
      seenPageNos.add(pageNo);
    }
    if (typeof page.width !== "number" || page.width <= 0)
      errors.push({ code: "INVALID_DIM", message: "width 必须为正数", field: `${base}.width` });
    if (typeof page.height !== "number" || page.height <= 0)
      errors.push({ code: "INVALID_DIM", message: "height 必须为正数", field: `${base}.height` });
    const rotation = (page.rotation ?? 0) as Rotation;
    if (!ROTATIONS.includes(rotation))
      errors.push({ code: "INVALID_ROTATION", message: "rotation 只能是 0/90/180/270", field: `${base}.rotation` });

    if (!Array.isArray(page.boxes)) {
      errors.push({ code: "INVALID_BOXES", message: "boxes 必须是数组", field: `${base}.boxes` });
      return;
    }
    const boxes: TextBox[] = [];
    const seenIds = new Set<string>();
    page.boxes.forEach((b, bi) => {
      const bb = `${base}.boxes[${bi}]`;
      if (typeof b !== "object" || b === null) {
        errors.push({ code: "INVALID_BOX", message: "框必须是对象", field: bb });
        return;
      }
      const box = b as Record<string, unknown>;
      if (typeof box.id !== "string" || box.id.length === 0)
        errors.push({ code: "INVALID_BOX_ID", message: "框 id 必须是非空字符串", field: `${bb}.id` });
      else if (seenIds.has(box.id))
        errors.push({ code: "DUP_BOX_ID", message: `框 id ${box.id} 在同一页重复`, field: `${bb}.id` });
      else seenIds.add(box.id);
      if (typeof box.text !== "string")
        errors.push({ code: "INVALID_TEXT", message: "text 必须是字符串（可为空）", field: `${bb}.text` });
      for (const k of ["x", "y", "w", "h"] as const) {
        const v = box[k];
        if (typeof v !== "number" || !Number.isFinite(v))
          errors.push({ code: "INVALID_COORD", message: `${k} 必须是有限数值`, field: `${bb}.${k}` });
      }
      if (typeof box.w === "number" && box.w <= 0)
        errors.push({ code: "INVALID_SIZE", message: "w 必须为正（边界缺失请走待确认）", field: `${bb}.w` });
      if (typeof box.h === "number" && box.h <= 0)
        errors.push({ code: "INVALID_SIZE", message: "h 必须为正（边界缺失请走待确认）", field: `${bb}.h` });
      const conf = box.confidence;
      if (typeof conf !== "number" || conf < 0 || conf > 1)
        errors.push({ code: "INVALID_CONF", message: "confidence 必须在 0..1", field: `${bb}.confidence` });
      boxes.push({
        id: String(box.id),
        text: String(box.text ?? ""),
        x: Number(box.x),
        y: Number(box.y),
        w: Number(box.w),
        h: Number(box.h),
        confidence: Number(box.confidence),
      });
    });
    pages.push({
      pageNo: Number(page.pageNo),
      width: Number(page.width),
      height: Number(page.height),
      rotation,
      boxes,
    });
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: pages };
}

export function validateRegion(raw: unknown): { ok: true; value: { pageNo: number; kind: RegionKind; x: number; y: number; w: number; h: number } } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  if (typeof raw !== "object" || raw === null)
    return { ok: false, errors: [{ code: "INVALID_BODY", message: "区域必须是对象" }] };
  const r = raw as Record<string, unknown>;
  const kinds: RegionKind[] = ["body", "table", "header", "footer"];
  if (typeof r.pageNo !== "number" || !Number.isInteger(r.pageNo) || r.pageNo < 1)
    errors.push({ code: "INVALID_PAGE_NO", message: "pageNo 必须是 >=1 的整数", field: "pageNo" });
  if (typeof r.kind !== "string" || !kinds.includes(r.kind as RegionKind))
    errors.push({ code: "INVALID_KIND", message: `kind 必须是 ${kinds.join("/")}`, field: "kind" });
  for (const k of ["x", "y", "w", "h"] as const) {
    if (typeof r[k] !== "number" || !Number.isFinite(r[k]))
      errors.push({ code: "INVALID_COORD", message: `${k} 必须是有限数值`, field: k });
  }
  if (typeof r.w === "number" && r.w <= 0) errors.push({ code: "INVALID_SIZE", message: "w 必须为正", field: "w" });
  if (typeof r.h === "number" && r.h <= 0) errors.push({ code: "INVALID_SIZE", message: "h 必须为正", field: "h" });
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      pageNo: Number(r.pageNo),
      kind: r.kind as RegionKind,
      x: Number(r.x),
      y: Number(r.y),
      w: Number(r.w),
      h: Number(r.h),
    },
  };
}

export function parsePagination(query: URLSearchParams): { limit: number; offset: number; errors: FieldError[] } {
  const errors: FieldError[] = [];
  let limit = 50;
  let offset = 0;
  const l = query.get("limit");
  const o = query.get("offset");
  if (l !== null) {
    limit = Number(l);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
      errors.push({ code: "INVALID_LIMIT", message: "limit 必须是 1..500 的整数", field: "limit" });
  }
  if (o !== null) {
    offset = Number(o);
    if (!Number.isInteger(offset) || offset < 0)
      errors.push({ code: "INVALID_OFFSET", message: "offset 必须是非负整数", field: "offset" });
  }
  return { limit, offset, errors };
}
