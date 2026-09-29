import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../db/database.js";
import { Service } from "../core/service.js";
import { validatePageInput, validateRegion } from "../core/validation.js";
import { generateDocument } from "../generator/generator.js";

function usage(): void {
  console.log(`ocr-layout CLI

用法:
  init-db [--db PATH]
  generate [--pages N] [--seed N] [--rotate 90] [--header] [--shuffle] [--out FILE]
  import --doc ID --file FILE [--key KEY] [--db PATH]
  add-region --doc ID --version V --region-file FILE [--db PATH]
  reconstruct --doc ID [--version V|latest] [--db PATH]
  issues --doc ID --version V [--db PATH]
  revise --doc ID --version V --page N --target TARGET --value TEXT [--db PATH]
  revisions --doc ID --version V [--db PATH]
  compare --doc ID --from A --to B [--db PATH]
  export --doc ID --version V --format json|csv --out FILE [--db PATH]

默认数据库: data/app.db (全部数据留在本项目内)
`);
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function dbPath(args: string[]): string {
  return resolve(arg(args, "--db") ?? "data/app.db");
}

function loadService(args: string[]): Service {
  const db = openDatabase({ path: dbPath(args) });
  return new Service(db);
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") {
    usage();
    return 0;
  }

  try {
    switch (command) {
      case "init-db": {
        openDatabase({ path: dbPath(rest) });
        console.log(`[before] 数据库可能不存在  ->  [after] 已初始化/迁移: ${dbPath(rest)}`);
        return 0;
      }
      case "generate": {
        const pages = Number(arg(rest, "--pages") ?? "2");
        const seed = Number(arg(rest, "--seed") ?? "42");
        const rotation = Number(arg(rest, "--rotate") ?? "0") as 0 | 90 | 180 | 270;
        const header = rest.includes("--header");
        const shuffle = rest.includes("--shuffle");
        const out = arg(rest, "--out") ?? "tmp/generated.json";
        const data = generateDocument(pages, { seed, rotation, header, shuffle });
        writeFileSync(resolve(out), JSON.stringify(data, null, 2), "utf8");
        console.log(`[before] 无  ->  [after] 已生成 ${data.length} 页到 ${out}`);
        return 0;
      }
      case "import": {
        const doc = Number(arg(rest, "--doc"));
        const file = arg(rest, "--file");
        if (!file) throw new Error("需要 --file");
        const raw = JSON.parse(readFileSync(resolve(file), "utf8"));
        const parsed = validatePageInput(Array.isArray(raw) ? raw : raw.pages);
        if (!parsed.ok) {
          console.error("校验失败:", JSON.stringify(parsed.errors, null, 2));
          return 2;
        }
        const svc = loadService(rest);
        const before = `文档 ${doc} 导入前`;
        const r = svc.importPages(doc, parsed.value, arg(rest, "--key"));
        console.log(`[before] ${before}  ->  [after] 版本=${r.version}${r.reused ? " (幂等复用)" : " (新建)"}`);
        return 0;
      }
      case "add-region": {
        const doc = Number(arg(rest, "--doc"));
        const version = Number(arg(rest, "--version"));
        const file = arg(rest, "--region-file");
        if (!file) throw new Error("需要 --region-file");
        const raw = JSON.parse(readFileSync(resolve(file), "utf8"));
        const parsed = validateRegion(raw);
        if (!parsed.ok) {
          console.error("区域校验失败:", parsed.errors);
          return 2;
        }
        const svc = loadService(rest);
        const id = svc.addRegion(doc, version, parsed.value);
        console.log(`[before] 无该区域  ->  [after] 已创建区域 id=${id}`);
        return 0;
      }
      case "reconstruct": {
        const doc = Number(arg(rest, "--doc"));
        const vtok = arg(rest, "--version") ?? "latest";
        const version = vtok === "latest" ? "latest" : Number(vtok);
        const svc = loadService(rest);
        const result = svc.reconstruct(doc, version);
        for (const p of result.pages) {
          console.log(`--- 第 ${p.pageNo} 页: ${p.order.length} 段, ${p.tables.length} 个表格, ${p.issues.length} 个待确认 ---`);
          p.order.slice(0, 5).forEach((para) => console.log(`  [${para.index}] 栏${para.column}: ${para.text.slice(0, 40)}`));
          for (const t of p.tables) console.log(`  表格 region=${t.regionId}: ${t.rows} 行 x ${t.cols} 列`);
        }
        return 0;
      }
      case "issues": {
        const doc = Number(arg(rest, "--doc"));
        const version = Number(arg(rest, "--version"));
        const svc = loadService(rest);
        const issues = svc.listIssues(doc, version);
        if (issues.length === 0) console.log("无待确认项");
        for (const i of issues) console.log(`[${i.severity}] 第${i.pageNo}页 ${i.code}: ${i.message} (${i.refs.join(",")})`);
        return 0;
      }
      case "revise": {
        const doc = Number(arg(rest, "--doc"));
        const version = Number(arg(rest, "--version"));
        const page = Number(arg(rest, "--page"));
        const target = arg(rest, "--target");
        const value = arg(rest, "--value") ?? "";
        if (!target) throw new Error("需要 --target");
        const svc = loadService(rest);
        const rev = svc.revise(doc, version, page, target, value);
        console.log(`[before] "${rev.oldValue}"  ->  [after] "${rev.newValue}" (revision id=${rev.id})`);
        return 0;
      }
      case "revisions": {
        const doc = Number(arg(rest, "--doc"));
        const version = Number(arg(rest, "--version"));
        const svc = loadService(rest);
        for (const r of svc.listRevisions(doc, version))
          console.log(`#${r.id} p${r.pageNo} ${r.target}: "${r.oldValue}" -> "${r.newValue}"`);
        return 0;
      }
      case "compare": {
        const doc = Number(arg(rest, "--doc"));
        const from = Number(arg(rest, "--from"));
        const to = Number(arg(rest, "--to"));
        const svc = loadService(rest);
        const changes = svc.compare(doc, from, to);
        console.log(`[before] 版本${from}  ->  [after] 版本${to}: ${changes.length} 处变化`);
        for (const c of changes) console.log(`  ${c.type} p${c.pageNo} ${c.path}: "${c.oldValue ?? ""}" -> "${c.newValue ?? ""}"`);
        return 0;
      }
      case "export": {
        const doc = Number(arg(rest, "--doc"));
        const version = Number(arg(rest, "--version"));
        const format = arg(rest, "--format") ?? "json";
        const out = arg(rest, "--out") ?? `tmp/export-v${version}.${format}`;
        const svc = loadService(rest);
        const content = format === "csv" ? svc.exportCsv(doc, version) : svc.exportJson(doc, version);
        writeFileSync(resolve(out), content, "utf8");
        console.log(`[before] 无  ->  [after] 已导出 ${format} 到 ${out}`);
        return 0;
      }
      default:
        usage();
        return 2;
    }
  } catch (err) {
    console.error("错误:", err instanceof Error ? err.message : err);
    return 1;
  }
}

runCli(process.argv.slice(2)).then((code) => process.exit(code));
