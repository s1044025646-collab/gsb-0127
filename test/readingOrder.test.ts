import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePage } from "../src/core/geometry.js";
import { analyzeBody } from "../src/core/readingOrder.js";
import { twoColumnPage, rotatedPage } from "./fixtures.js";

const noopMark = () => {};

test("spanning title stays whole and is not split across columns", () => {
  const page = twoColumnPage();
  const norm = normalizePage(page.pageNo, page.width, page.height, page.rotation, page.boxes);
  const { paragraphs } = analyzeBody(
    page.pageNo,
    norm.boxes,
    { x: 0, y: 0, w: page.width, h: page.height },
    noopMark,
  );
  const title = paragraphs.find((p) => p.text.includes("跨栏标题"));
  assert.ok(title, "title present");
  assert.equal(title!.boxIds.length, 1, "title is a single unsplit box");
  assert.equal(title!.column, -1, "title marked as spanning");
});

test("left column is read before right column", () => {
  const page = twoColumnPage();
  const norm = normalizePage(page.pageNo, page.width, page.height, page.rotation, page.boxes);
  const { paragraphs } = analyzeBody(
    page.pageNo,
    norm.boxes,
    { x: 0, y: 0, w: page.width, h: page.height },
    noopMark,
  );
  const body = paragraphs.filter((p) => p.column !== -1);
  const firstRight = body.find((p) => p.column === 1);
  const lastLeft = [...body].reverse().find((p) => p.column === 0);
  assert.ok(firstRight && lastLeft);
  assert.ok(firstRight.index > lastLeft.index, "all left paragraphs precede right");
});

test("90 degree rotation round-trips upright reading order", () => {
  const upright = twoColumnPage();
  const rot = rotatedPage();
  assert.notEqual(rot.boxes[0]!.x, upright.boxes[0]!.x, "coordinates actually rotated");
  const norm = normalizePage(rot.pageNo, rot.width, rot.height, rot.rotation, rot.boxes);
  const { paragraphs } = analyzeBody(
    rot.pageNo,
    norm.boxes,
    { x: 0, y: 0, w: norm.width, h: norm.height },
    noopMark,
  );
  const joined = paragraphs.map((p) => p.text).join("|");
  assert.ok(joined.includes("左栏第一段"));
  assert.ok(joined.includes("Right line one"));
  const title = paragraphs.find((p) => p.text.includes("跨栏标题"));
  assert.equal(title!.boxIds.length, 1);
});

test("content is neither duplicated nor dropped and source ids map 1:1", () => {
  const page = twoColumnPage();
  const norm = normalizePage(page.pageNo, page.width, page.height, page.rotation, page.boxes);
  const { paragraphs } = analyzeBody(
    page.pageNo,
    norm.boxes,
    { x: 0, y: 0, w: page.width, h: page.height },
    noopMark,
  );
  const ids = paragraphs.flatMap((p) => p.boxIds);
  assert.equal(ids.length, new Set(ids).size, "no duplicated box usage");
  assert.equal(ids.length, page.boxes.length, "every box consumed exactly once");
  assert.deepEqual(
    [...ids].sort(),
    page.boxes.map((b) => b.id).sort(),
    "source mapping complete",
  );
});

test("overlapping and low confidence boxes are flagged", () => {
  const page = twoColumnPage();
  page.boxes.push({ id: "low", text: "模糊", x: 40, y: 300, w: 100, h: 16, confidence: 0.3 });
  page.boxes.push({ id: "ov1", text: "重叠甲", x: 40, y: 340, w: 100, h: 20, confidence: 0.9 });
  page.boxes.push({ id: "ov2", text: "重叠乙", x: 50, y: 344, w: 100, h: 20, confidence: 0.9 });
  const norm = normalizePage(page.pageNo, page.width, page.height, page.rotation, page.boxes);
  const codes: string[] = [];
  analyzeBody(page.pageNo, norm.boxes, { x: 0, y: 0, w: page.width, h: page.height }, (c) =>
    codes.push(c),
  );
  assert.ok(codes.includes("LOW_CONFIDENCE"));
  assert.ok(codes.includes("OVERLAPPING_BOXES"));
});
