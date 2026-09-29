import type { PageInput, Rotation, TextBox } from "../core/types.js";

/** Deterministic PRNG (mulberry32) so demos/tests are repeatable. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GenOptions {
  seed?: number;
  /** Emit boxes in shuffled order to test out-of-order input. */
  shuffle?: boolean;
  /** Wrap boxes in a rotated page. */
  rotation?: Rotation;
  /** Add a repeated running header across pages. */
  header?: boolean;
}

const LOREM = [
  "系统支持横排中文与英文的版面重建",
  "Reading order reconstruction keeps every source box id",
  "双栏文档应当先读完左栏再读右栏",
  "Adjacent numeric cells in a table must never merge into prose",
  "页眉和页脚不会被插入正文段落",
  "Low confidence boxes are flagged for human confirmation",
];

/**
 * Generate a deterministic two-column document with a spanning title, an
 * optional repeated header, a table region, rotated coordinates and shuffled
 * box order. Coordinates are produced in upright space then transformed by the
 * requested rotation so they can be round-tripped by the pipeline.
 */
export function generateDocument(pages = 2, opts: GenOptions = {}): PageInput[] {
  const rng = seededRandom(opts.seed ?? 42);
  const W = 595;
  const H = 842;
  const result: PageInput[] = [];

  for (let pi = 0; pi < pages; pi++) {
    const boxes: TextBox[] = [];
    let seq = 0;
    const add = (
      text: string,
      x: number,
      y: number,
      w: number,
      h: number,
      confidence = 0.95,
    ) => {
      boxes.push({ id: `p${pi + 1}-b${++seq}`, text, x, y, w, h, confidence });
    };

    if (opts.header) {
      add(`期刊标题 第${pi + 1}页`, 40, 20, 200, 18, 0.99);
    }

    // Spanning title across both columns.
    add("跨栏标题：版面阅读顺序研究", 90, 55, 420, 26, 0.98);

    const colY0 = 100;
    const lineH = 20;
    const colW = 260;
    const colX = [40, 305] as const;
    for (let col = 0; col < 2; col++) {
      for (let line = 0; line < 10; line++) {
        const text = LOREM[((opts.seed ?? 42) + pi * 2 + col + line) % LOREM.length]!;
        const x = colX[col]! + (line === 0 && col === 0 ? 16 : 0);
        const w = colW - 20 - rng() * 40;
        add(text, x, colY0 + line * (lineH + 6), w, lineH - 4, 0.9 + rng() * 0.09);
      }
    }

    // Table near the bottom: 3 cols x 3 rows incl. empty cell and a merged cell.
    const tX = 40;
    const tY = 420;
    const cw = 100;
    const rh = 26;
    const tadd = (text: string, r: number, c: number, w = cw - 6, h = rh - 6) =>
      add(text, tX + c * cw + 3, tY + r * rh + 3, w, h, 0.97);
    tadd("项目", 0, 0);
    tadd("数量", 0, 1);
    tadd("金额", 0, 2);
    tadd("A", 1, 0);
    tadd("12", 1, 1);
    tadd("34.5", 1, 2);
    // Row 2: merged across columns 1..2 (one wide box), col0 present.
    tadd("B", 2, 0);
    tadd("合计 99", 2, 1, cw * 2 - 6, rh - 6);

    const upright: PageInput = { pageNo: pi + 1, width: W, height: H, rotation: 0, boxes };
    const withRot = opts.rotation ? rotatePage(upright, opts.rotation) : upright;
    if (opts.shuffle) {
      withRot.boxes = shuffleBoxes(withRot.boxes, rng);
    }
    result.push(withRot);
  }
  return result;
}

function shuffleBoxes(boxes: TextBox[], rng: () => number): TextBox[] {
  const arr = boxes.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Apply a clockwise scan rotation to upright boxes, swapping page size. */
export function rotatePage(page: PageInput, rotation: Rotation): PageInput {
  if (rotation === 0) return page;
  const swap = rotation === 90 || rotation === 270;
  const scanW = swap ? page.height : page.width;
  const scanH = swap ? page.width : page.height;
  const boxes = page.boxes.map((b) => {
    let x = b.x;
    let y = b.y;
    let w = b.w;
    let h = b.h;
    if (rotation === 90) {
      x = page.height - (b.y + b.h);
      y = b.x;
      w = b.h;
      h = b.w;
    } else if (rotation === 180) {
      x = page.width - (b.x + b.w);
      y = page.height - (b.y + b.h);
    } else if (rotation === 270) {
      x = b.y;
      y = page.width - (b.x + b.w);
      w = b.h;
      h = b.w;
    }
    return { ...b, x, y, w, h };
  });
  return { pageNo: page.pageNo, width: scanW, height: scanH, rotation, boxes };
}
