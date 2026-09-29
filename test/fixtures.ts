import { writeFileSync } from "node:fs";
import { generateDocument, rotatePage } from "../src/generator/generator.js";
import type { PageInput, TextBox } from "../src/core/types.js";

/** A small hand-built two-column page with a spanning title and a table. */
export function twoColumnPage(): PageInput {
  const boxes: TextBox[] = [];
  let n = 0;
  const add = (text: string, x: number, y: number, w: number, h = 16, c = 0.95): void => {
    boxes.push({ id: `b${++n}`, text, x, y, w, h, confidence: c });
  };
  // spanning title
  add("跨栏标题", 120, 40, 360, 24, 0.99);
  // left column
  add("左栏第一段首行", 40, 90, 200);
  add("左栏第一段次行", 40, 112, 200);
  add("左栏第二段独立行", 56, 152, 190);
  // right column
  add("Right line one", 320, 90, 200);
  add("Right line two", 320, 112, 200);
  add("Right paragraph two standalone", 336, 152, 190);
  return { pageNo: 1, width: 595, height: 842, rotation: 0, boxes };
}

export function headerPage(pageNo: number): PageInput {
  const page = twoColumnPage();
  page.pageNo = pageNo;
  page.boxes.forEach((b, i) => (b.id = `p${pageNo}-${b.id}`));
  page.boxes.push({
    id: `p${pageNo}-hdr`,
    text: "重复页眉 Running Header",
    x: 40,
    y: 12,
    w: 220,
    h: 16,
    confidence: 0.99,
  });
  return page;
}

/** Regular 3x3 table: one empty cell and one horizontal merge (wide box). */
export function tablePage(): PageInput {
  const boxes: TextBox[] = [];
  let n = 0;
  const add = (text: string, c: number, r: number, w = 90, h = 24): void => {
    boxes.push({ id: `t${++n}`, text, x: 40 + c * 100, y: 100 + r * 30, w, h, confidence: 0.97 });
  };
  add("姓名", 0, 0);
  add("语文", 1, 0);
  add("数学", 2, 0);
  add("张三", 0, 1);
  add("90", 1, 1);
  add("88", 2, 1);
  add("李四", 0, 2);
  // (2,1) intentionally empty -> empty cell
  add("免考", 2, 2);
  // merged wide cell across columns 1-2 on a 4th row
  add("王五", 0, 3);
  add("合计 178", 1, 3, 190, 24);
  return { pageNo: 1, width: 595, height: 842, rotation: 0, boxes };
}

export function rotatedPage(): PageInput {
  return rotatePage(twoColumnPage(), 90);
}

export function shuffledGenerated(): PageInput[] {
  return generateDocument(2, { seed: 7, shuffle: true, rotation: 90, header: true });
}

export function writeTmpJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data), "utf8");
}
