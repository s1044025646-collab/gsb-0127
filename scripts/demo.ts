import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../src/db/database.js";
import { Service } from "../src/core/service.js";
import { generateDocument } from "../src/generator/generator.js";
import { toJson, toCsv } from "../src/core/exporters.js";
import { diffVersions } from "../src/core/diff.js";
import { writeFileSync, mkdirSync } from "node:fs";

/**
 * Repeatable end-to-end demo: generate -> import (twice, idempotent) ->
 * mark a table region -> reconstruct -> review issues -> revise -> compare ->
 * export JSON/CSV. All artifacts stay under ./tmp and ./data.
 */
function main(): void {
  const dbPath = resolve("data/demo.db");
  rmSync(dbPath, { force: true });
  rmSync(dbPath + "-wal", { force: true });
  rmSync(dbPath + "-shm", { force: true });
  mkdirSync(resolve("tmp"), { recursive: true });

  const db = openDatabase({ path: dbPath });
  const svc = new Service(db);

  const docId = svc.createDocument("演示文档 Demo");
  console.log("created document", docId);

  const v1Pages = generateDocument(2, { seed: 42, shuffle: true, rotation: 90, header: true });
  writeFileSync(resolve("tmp/demo-v1-input.json"), JSON.stringify(v1Pages, null, 2));

  const imp1 = svc.importPages(docId, v1Pages, "demo-v1");
  console.log("import v1 ->", imp1);
  const imp1again = svc.importPages(docId, v1Pages, "demo-v1");
  console.log("re-import same key ->", imp1again, "(should reuse)");

  // Table region in upright coordinates (covers generated table area).
  svc.addRegion(docId, 1, { pageNo: 1, kind: "table", x: 30, y: 410, w: 320, h: 110 });
  svc.addRegion(docId, 1, { pageNo: 2, kind: "table", x: 30, y: 410, w: 320, h: 110 });

  const r1 = svc.reconstruct(docId, 1);
  for (const p of r1.pages) {
    console.log(`page ${p.pageNo}: ${p.order.length} paragraphs, ${p.tables.length} tables, ${p.issues.length} issues`);
  }

  console.log("issues sample:");
  for (const issue of svc.listIssues(docId, 1).slice(0, 5)) console.log("  -", issue.code, issue.message);

  // Human revision on a paragraph.
  const first = r1.pages[0]!.order[0]!;
  svc.revise(docId, 1, 1, `order.${first.index}.text`, first.text + " [人工修订]");

  // Version 2 with a tweak.
  const v2Pages = generateDocument(2, { seed: 43, shuffle: true, rotation: 0, header: true });
  svc.importPages(docId, v2Pages, "demo-v2");
  svc.addRegion(docId, 2, { pageNo: 1, kind: "table", x: 30, y: 410, w: 320, h: 110 });
  svc.addRegion(docId, 2, { pageNo: 2, kind: "table", x: 30, y: 410, w: 320, h: 110 });
  const r2 = svc.reconstruct(docId, 2);

  const changes = diffVersions(r1, r2);
  console.log(`compare v1 -> v2: ${changes.length} changes`);

  writeFileSync(resolve("tmp/demo-v1.json"), toJson(r1, { revisions: svc.listRevisions(docId, 1) }));
  writeFileSync(resolve("tmp/demo-v1.csv"), toCsv(r1, { revisions: svc.listRevisions(docId, 1) }));
  writeFileSync(resolve("tmp/demo-v2.json"), toJson(r2));
  writeFileSync(resolve("tmp/demo-diff.json"), JSON.stringify(changes, null, 2));
  console.log("exports written to tmp/demo-*.{json,csv}");
  db.close();
}

main();
