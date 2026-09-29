import type { DocumentResult } from "./types.js";

export interface ChangeEntry {
  pageNo: number;
  kind: "paragraph" | "table";
  path: string;
  type: "added" | "removed" | "modified";
  oldValue?: string;
  newValue?: string;
}

/** Compare two reconstructed versions paragraph-by-paragraph and cell-by-cell. */
export function diffVersions(a: DocumentResult, b: DocumentResult): ChangeEntry[] {
  const changes: ChangeEntry[] = [];
  const pageNos = new Set([...a.pages.map((p) => p.pageNo), ...b.pages.map((p) => p.pageNo)]);
  for (const pageNo of [...pageNos].sort((x, y) => x - y)) {
    const pa = a.pages.find((p) => p.pageNo === pageNo);
    const pb = b.pages.find((p) => p.pageNo === pageNo);
    const parasA = pa?.order ?? [];
    const parasB = pb?.order ?? [];
    const n = Math.max(parasA.length, parasB.length);
    for (let i = 0; i < n; i++) {
      const ta = parasA[i]?.text;
      const tb = parasB[i]?.text;
      if (ta === undefined && tb !== undefined)
        changes.push({ pageNo, kind: "paragraph", path: `order.${i}`, type: "added", newValue: tb });
      else if (tb === undefined && ta !== undefined)
        changes.push({ pageNo, kind: "paragraph", path: `order.${i}`, type: "removed", oldValue: ta });
      else if (ta !== tb)
        changes.push({ pageNo, kind: "paragraph", path: `order.${i}`, type: "modified", oldValue: ta, newValue: tb });
    }
    const tablesA = pa?.tables ?? [];
    const tablesB = pb?.tables ?? [];
    const tn = Math.max(tablesA.length, tablesB.length);
    for (let ti = 0; ti < tn; ti++) {
      const mapA = new Map((tablesA[ti]?.cells ?? []).map((c) => [`${c.row}.${c.col}`, c]));
      const mapB = new Map((tablesB[ti]?.cells ?? []).map((c) => [`${c.row}.${c.col}`, c]));
      for (const key of new Set([...mapA.keys(), ...mapB.keys()])) {
        const ca = mapA.get(key);
        const cb = mapB.get(key);
        const path = `table.${ti}.cell.${key}`;
        if (!ca && cb) changes.push({ pageNo, kind: "table", path, type: "added", newValue: cb.text });
        else if (ca && !cb) changes.push({ pageNo, kind: "table", path, type: "removed", oldValue: ca.text });
        else if (ca && cb && ca.text !== cb.text)
          changes.push({ pageNo, kind: "table", path, type: "modified", oldValue: ca.text, newValue: cb.text });
      }
    }
  }
  return changes;
}
