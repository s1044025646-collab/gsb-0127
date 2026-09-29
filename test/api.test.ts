import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/api/server.js";
import { shuffledGenerated } from "./fixtures.js";

async function api(port: number, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

async function j(res: Response): Promise<any> {
  return res.json();
}

test("API end-to-end: validation, pagination, errors, idempotency, export", async () => {
  const dbPath = join("tmp", "api-test.db");
  rmSync(dbPath, { force: true });
  const { server } = createApp({ dbPath, port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const health = await api(port, "/health");
    assert.equal(health.status, 200);

    let res = await api(port, "/documents", { method: "POST", body: JSON.stringify({}) });
    assert.equal(res.status, 400);
    assert.equal((await j(res)).error.code, "INVALID_NAME");

    res = await api(port, "/documents", { method: "POST", body: JSON.stringify({ name: "E2E" }) });
    const doc = await j(res);
    assert.equal(res.status, 201);

    res = await api(port, `/documents/${doc.id}/versions`, {
      method: "POST",
      body: JSON.stringify({ pages: [{ pageNo: 1, width: -1, height: 1, boxes: [] }] }),
    });
    assert.equal(res.status, 400);
    assert.equal((await j(res)).error.code, "VALIDATION_FAILED");

    const pages = shuffledGenerated();
    const postPages = () =>
      api(port, `/documents/${doc.id}/versions`, {
        method: "POST",
        body: JSON.stringify({ pages, importKey: "e2e-key" }),
      });
    res = await postPages();
    const v1 = await j(res);
    assert.equal(v1.version, 1);
    res = await postPages();
    const v1b = await j(res);
    assert.equal(v1b.version, 1);
    assert.equal(v1b.reused, true);

    res = await api(port, `/documents/${doc.id}/versions/latest/reconstruct`, { method: "POST" });
    assert.equal(res.status, 200);
    const result = await j(res);
    assert.ok(result.pages.length === 2);
    const titlePara = result.pages[0].order.find((p: { text: string }) =>
      p.text.includes("跨栏标题"),
    );
    assert.ok(titlePara);

    res = await api(port, `/documents/${doc.id}/versions/1/issues?limit=1&offset=0`);
    const issues = await j(res);
    assert.ok(Array.isArray(issues.items));
    assert.equal(issues.limit, 1);

    res = await api(port, "/documents/99999/versions/1/issues");
    assert.equal(res.status, 404);
    assert.equal((await j(res)).error.code, "VERSION_NOT_FOUND");

    const target = `order.${titlePara.index}.text`;
    res = await api(port, `/documents/${doc.id}/versions/1/revisions`, {
      method: "POST",
      body: JSON.stringify({ pageNo: 1, target, newValue: "跨栏标题（修订）" }),
    });
    assert.equal(res.status, 201);

    res = await api(port, `/documents/${doc.id}/versions/1/export.json`);
    assert.equal(res.status, 200);
    const exported = await j(res);
    assert.ok(exported.revisions.length >= 1);
    res = await api(port, `/documents/${doc.id}/versions/1/export.csv`);
    assert.equal(res.status, 200);
    const csv = await res.text();
    assert.ok(csv.includes("section"));

    res = await api(port, "/nope");
    assert.equal(res.status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
