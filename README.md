# OCR 版面阅读顺序与表格重建后端

纯本地运行的后端：输入 OCR 阶段（外部）给出的页面尺寸、旋转角、文字内容、矩形框坐标与
置信度，重建横排中文/英文的行、段落、双栏阅读顺序，以及规则矩形表格的行列与合并单元格。

本项目**不**包含真实图像识别、网页界面或任何外部 OCR 服务调用。它只提供：

- HTTP API（仅绑定 `127.0.0.1`，默认自动端口）
- 命令行工具（CLI）
- 合成页面文字框生成器（可复现，带种子）
- 自动化测试

## 支持与不支持的范围

支持：
- 横排中文与英文；单栏 / 双栏正文；跨栏标题保持完整不拆栏。
- 旋转角为 `0/90/180/270` 的页面，先把坐标统一回正再分析（坐标可往返）。
- 规则矩形表格：行列重建、空单元格保留、水平/垂直合并推断、相邻数字单元格绝不串成句子。
- 多页重复页眉/页脚识别并排除在正文之外。
- 重叠框、低置信度、缺失边界、无法确定的合并关系标记为“待确认”，绝不臆造缺失文字。
- 文档版本、页码、区域标注、抽取规则（区域）、人工修订与结果报告；版本差异比较。

不支持（明确范围外）：
- 竖排文字、从右到左文字；三栏及以上或不规则分栏。
- 无框线/不规则表格、嵌套表格、斜线表、跨页表格。
- 图文混排语义理解、脚注环绕、公式识别。
- 真实图像 OCR、云端服务、Web 前端。

## 技术栈与目录

- Node.js（内置实验性 `node:sqlite`，**无需编译原生模块**）、TypeScript、`tsx`。
- `src/core/` 几何/阅读顺序/表格/区域/校验/差异/导出；`src/db/` SQLite 与仓储；
  `src/api/` HTTP 服务；`src/cli/` 命令行；`src/generator/` 合成生成器。
- 所有数据库在 `data/`，所有临时与导出文件在 `tmp/`，均位于本项目内。

## 依赖安装

```powershell
node --version   # 需要 >= v22.5（开发于 v25）
npm install
```

## 运行测试

```powershell
npm test
npm run typecheck
```

测试夹具覆盖：双栏、跨栏标题、重复页眉、90° 旋转、空单元格、合并单元格、乱序输入；
并断言阅读顺序、坐标往返、内容不重不漏、来源框编号映射、修订隔离、失败路径、
事务回滚以及“关闭后重开仍持久化”。

## 可重复的端到端演示

```powershell
npm run demo
```

演示固定随机种子，依次执行：生成 2 页（90° 旋转 + 乱序 + 重复页眉 + 表格）→
幂等导入两次 → 自动/表格区域 → 重建 → 列出待确认 → 人工修订 → 比较版本 →
导出 `tmp/demo-v1.json`、`tmp/demo-v1.csv`、`tmp/demo-v2.json`、`tmp/demo-diff.json`。
数据库写到 `data/demo.db`。重复运行结果一致。

## 启动 / 停止 API

```powershell
npm start
# 或使用仅管理本项目进程的脚本（自动端口，信息写入 tmp/server.json）
powershell -ExecutionPolicy Bypass -File scripts/start.ps1
powershell -ExecutionPolicy Bypass -File scripts/stop.ps1
```

服务只监听 `127.0.0.1`，端口传 `0` 时由系统自动分配。数据库默认 `data/app.db`，
可用环境变量 `OCR_DB_PATH` 覆盖。启动/停止脚本只记录并结束自己启动的 PID，
不会影响其他进程。

健康检查：`GET http://127.0.0.1:<port>/health`。

## API 摘要

所有请求/响应为 JSON；错误统一为 `{ "error": { "code", "message", "fields?" } }`，
带明确 HTTP 状态码与错误码（如 `VALIDATION_FAILED`、`VERSION_NOT_FOUND`、
`DUP_PAGE_NO`、`TARGET_NOT_FOUND`、`NOT_FOUND`）。列表接口支持 `limit`（1..500）与
`offset` 分页。

- `POST /documents` `{name}`
- `GET  /documents?limit&offset`
- `POST /documents/:id/versions` `{ pages:[...], importKey? }`（相同 `importKey` +
  相同内容重复提交为幂等，返回已存在版本与 `reused:true`）
- `POST /documents/:id/versions/:v/regions` / `GET .../regions?pageNo=`（手动区域）
- `POST /documents/:id/versions/:v|latest/reconstruct`
- `GET  /documents/:id/versions/:v/issues?limit&offset`（待确认项分页）
- `POST /documents/:id/versions/:v/revisions` `{pageNo,target,newValue}`
  （目标形如 `order.3.text`、`table.0.cell.1.2.text`；修订按版本隔离）
- `GET  /documents/:id/versions/:v/revisions`
- `GET  /documents/:id/compare?from=A&to=B`
- `GET  /documents/:id/versions/:v/export.json`
- `GET  /documents/:id/versions/:v/export.csv`

## CLI 摘要

```powershell
npm run cli -- generate --pages 2 --seed 42 --rotate 90 --header --shuffle --out tmp/in.json
npm run cli -- init-db
npm run cli -- import --doc 1 --file tmp/in.json --key run-1
npm run cli -- add-region --doc 1 --version 1 --region-file tmp/region.json
npm run cli -- reconstruct --doc 1 --version latest
npm run cli -- issues --doc 1 --version 1
npm run cli -- revise --doc 1 --version 1 --page 1 --target order.0.text --value "新文本"
npm run cli -- revisions --doc 1 --version 1
npm run cli -- compare --doc 1 --from 1 --to 2
npm run cli -- export --doc 1 --version 1 --format json --out tmp/out.json
npm run cli -- export --doc 1 --version 1 --format csv  --out tmp/out.csv
```

默认数据库为 `data/app.db`，可用全局参数 `--db data/xxx.db` 指定。CLI 在关键操作前后
打印状态（新建/幂等复用、修订前后值、版本差异数量、导出路径等）。

## 数据模型与迁移

表：`documents`、`pages`、`boxes`、`regions`、`results`、`revisions`、`schema_meta`。
迁移使用 `CREATE TABLE IF NOT EXISTS` 且重复执行幂等；每次启动都会安全重跑。
导入在单个事务中完成，校验或约束失败会整体回滚，不产生半成品版本。

## 清理

- 删除数据库：删除 `data/*.db*`。
- 删除临时/导出文件：删除 `tmp/` 内容。
- 停止服务：`scripts/stop.ps1`（仅停止本项目记录的 PID）。
