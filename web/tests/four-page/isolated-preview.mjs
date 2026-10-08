// Local test harness only. Never part of the production Next routes.
import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, createHmac } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeFixture } from "./fixture.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url)),
  folder = process.env.FOUR_PAGE_TEST_OUTPUT ?? "/tmp/boat-four-page-tests";
await mkdir(folder, { recursive: true });
const path = folder + "/fixture.json",
  secret = randomBytes(32).toString("hex");
await writeFile(path, JSON.stringify(makeFixture()));
const clean = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      ![
        "SUPABASE",
        "VERCEL",
        "RESEARCH",
        "INGEST",
        "NEXT_PUBLIC",
        "FOUR_PAGE",
      ].some((prefix) => k.startsWith(prefix)),
  ),
);
const env = {
  ...clean,
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: "--require=" + root + "tests/four-page/network-guard.cjs",
  FOUR_PAGE_NETWORK_LOG: folder + "/blocked-network.log",
  FOUR_PAGE_ISOLATED: "1",
  FOUR_PAGE_FIXTURE_FILE: path,
  RESEARCH_OWNER_KEY: secret,
};
const child = spawn(
  process.execPath,
  [
    root + "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "4999",
    "--hostname",
    "127.0.0.1",
  ],
  { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] },
);
const cookie = () => {
  const issued = String(Date.now());
  return (
    issued + "." + createHmac("sha256", secret).update(issued).digest("hex")
  );
};
const harness = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>4ページ隔離検証</title><style>body{margin:0;background:#e1e8f2;font:14px sans-serif}header{padding:12px;background:#fff;display:flex;gap:10px;align-items:center;flex-wrap:wrap}button,select{padding:7px}iframe{display:block;margin:15px auto;background:white;border:1px solid #ccd8e7;min-height:1700px}label{display:flex;gap:5px;align-items:center}</style><header><strong>テストデータ・本番接続なし</strong><label>画面幅<select id="width"><option>1440</option><option>360</option><option selected>390</option><option>412</option><option>768</option></select></label><label>ページ<select id="page"><option value="/today">今後の買い目</option><option value="/signal-log">判断履歴</option><option value="/performance">運用成績</option><option value="/settings">判定設定</option></select></label><button data-state="active">テスト稼働状態</button><button data-state="stopped">停止状態</button><button data-state="error">取得失敗</button><button data-state="empty">候補なし</button><button data-state="deadline">締切まで5秒</button></header><iframe title="検証画面" id="preview" width="390" src="/today"></iframe><script>const f=document.querySelector('iframe');document.querySelector('#width').onchange=e=>f.width=e.target.value;document.querySelector('#page').onchange=e=>f.src=e.target.value;document.querySelectorAll('[data-state]').forEach(b=>b.onclick=async()=>{await fetch('/__fixture/'+b.dataset.state,{method:'POST'});f.src=document.querySelector('#page').value;});</script></html>`;
const server = createServer(async (req, res) => {
  if (req.url === "/__test") {
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(harness);
    return;
  }
  if (req.url?.startsWith("/__fixture/") && req.method === "POST") {
    const state = req.url.split("/").at(-1),
      fixture = makeFixture();
    if (state === "stopped") fixture.feed.stopped = true;
    if (state === "error") {
      fixture.feed.stopped = true;
      fixture.feed.error = "テスト：保存データの取得に失敗しました";
    }
    if (state === "empty") fixture.feed.observations = [];
    if (state === "deadline")
      fixture.feed.observations.forEach(
        (o) => (o.closeAt = new Date(Date.now() + 5000).toISOString()),
      );
    await writeFile(path, JSON.stringify(fixture));
    res.end("ok");
    return;
  }
  if (req.url === "/__auth-check") {
    try {
      const unauth = await fetch("http://127.0.0.1:4999/settings", {
          redirect: "manual",
        }),
        bad = await fetch("http://127.0.0.1:4999/settings", {
          headers: { Cookie: "research_owner=invalid" },
          redirect: "manual",
        }),
        authorized = await fetch("http://127.0.0.1:4999/settings", {
          headers: { Cookie: "research_owner=" + cookie() },
          redirect: "manual",
        }),
        api = await fetch("http://127.0.0.1:4999/api/poc/status", {
          redirect: "manual",
        });
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          unauth: unauth.status,
          bad: bad.status,
          authorized: authorized.status,
          api: api.status,
        }),
      );
    } catch {
      res.statusCode = 503;
      res.end("Local preview starting");
    }
    return;
  }
  const headers = {
    ...req.headers,
    host: "127.0.0.1:4999",
    cookie: "research_owner=" + cookie(),
  };
  if (headers.origin) headers.origin = "http://127.0.0.1:4999";
  delete headers["x-forwarded-host"];
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: 4999,
      path: req.url,
      method: req.method,
      headers,
    },
    (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.statusCode = 503;
    res.end("Local preview starting");
  });
  req.pipe(upstream);
});
server.listen(4998, "0.0.0.0", () =>
  console.log("Isolated test harness http://localhost:4998/__test"),
);
process.on("SIGTERM", () => {
  child.kill();
  server.close();
});
process.on("SIGINT", () => {
  child.kill();
  server.close();
});

process.on("exit", () => child.kill());
