import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePage } from "../src/core/geometry.js";
import { analyzeTable } from "../src/core/table.js";
import { tablePage } from "./fixtures.js";

test("table preserves empty cell and does not invent text", () => {
  const page = tablePage();
  const norm = normalizePage(page.pageNo, page.width, page.height, page.rotation, page.boxes);
  const marks: string[] = [];
  const table = analyzeTable(
    page.pageNo,
    norm.boxes,
    { id: 1, x: 30, y: 90, w: 320, h: 160 },
    (c) => marks.push(c),
  );
  const empty = table.cells.find((c) => c.row === 2 && c.col === 1);
  assert.ok(empty, "empty cell exists");
  assert.equal(empty!.text, "");
  assert.equal(empty!.empty, true);
  assert.equal(empty!.boxIds.length, 0);
});

test("adjacent numeric cells are kept separate, never concatenated", () => {
  const page = tablePage();
  const norm = normalizePage(page.pageNo, page.width, page.height, page.rotation, page.boxes);
  const table = analyzeTable(
    page.pageNo,
    norm.boxes,
    { id: 1, x: 30, y: 90, w: 320, h: 160 },
    () => {},
  );
  const n90 = table.cells.find((c) => c.text === "90");
  const n88 = table.cells.find((c) => c.text === "88");
  assert.ok(n90 && n88);
  assert.notEqual(n90!.col, n88!.col);
  for (const c of table.cells) assert.ok(!c.text.includes("90 88"), "numbers not joined");
});

test("wide box produces a horizontal span covering the empty neighbor", () => {
  const page = tablePage();
  const norm = normalizePage(page.pageNo, page.width, page.height, page.rotation, page.boxes);
  const table = analyzeTable(
    page.pageNo,
    norm.boxes,
    { id: 1, x: 30, y: 90, w: 320, h: 160 },
    () => {},
  );
  const merged = table.cells.find((c) => c.text.includes("合计"));
  assert.ok(merged);
  assert.ok(merged!.colSpan >= 2, "wide box spans >=2 columns");
});

test("each table cell retains its source box ids", () => {
  const page = tablePage();
  const norm = normalizePage(page.pageNo, page.width, page.height, page.rotation, page.boxes);
  const table = analyzeTable(
    page.pageNo,
    norm.boxes,
    { id: 1, x: 30, y: 90, w: 320, h: 160 },
    () => {},
  );
  const header = table.cells.find((c) => c.text === "姓名");
  assert.deepEqual(header!.boxIds, ["t1"]);
});
