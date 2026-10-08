/** Automated tests in a disposable local browser; never the user's browser session. */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { prepareBrowser } from "./prepare-test-browser.mjs";
const require = createRequire(import.meta.url);
const { chromium: playwright } = require(
  process.env.FOUR_PAGE_PLAYWRIGHT_MODULE ?? "playwright",
);
const { default: chromium } = await import(
  process.env.FOUR_PAGE_CHROMIUM_MODULE ?? "@sparticuz/chromium"
);
const output = process.env.FOUR_PAGE_TEST_OUTPUT ?? "/tmp/boat-four-page-tests";
await mkdir(output, { recursive: true });
await rm(output + "/fixture.json.drafts", { recursive: true, force: true });
const env = { ...process.env, FOUR_PAGE_TEST_OUTPUT: output },
  child = spawn(
    process.execPath,
    [fileURLToPath(new URL("isolated-preview.mjs", import.meta.url))],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
child.stdout.on("data", (d) => process.stdout.write(d));
child.stderr.on("data", (d) => process.stderr.write(d));
let browser;
const checks = [];
const check = (name) => {
  checks.push(name);
  console.log("PASS: " + name);
};
try {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch("http://127.0.0.1:4998/__auth-check");
      if (r.ok) {
        assert.deepEqual(await r.json(), {
          unauth: 307,
          bad: 307,
          authorized: 200,
          api: 401,
        });
        check("owner authentication: valid, missing, forged and API");
        break;
      }
    } catch {}
    if (i === 99) throw Error("Local preview did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  const executablePath = await prepareBrowser(
    process.env.FOUR_PAGE_CHROMIUM_MODULE ??
      require.resolve("@sparticuz/chromium"),
  );
  await mkdir("/tmp/fonts", { recursive: true });
  if (process.env.FOUR_PAGE_CJK_FONT)
    await copyFile(
      process.env.FOUR_PAGE_CJK_FONT,
      "/tmp/fonts/NotoSansCJKjp-Regular.otf",
    );
  process.env.FONTCONFIG_PATH = "/tmp/fonts";
  browser = await playwright.launch({
    executablePath,
    headless: true,
    args: chromium.args,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Asia/Tokyo",
    locale: "ja-JP",
  });
  const external = [],
    requests = [],
    errors = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      external.push(url.hostname);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  const go = async (path) => {
    const response = await page.goto("http://127.0.0.1:4998" + path);
    assert.equal(response.status(), 200);
    await page.locator("h1").waitFor();
  };
  const state = async (name) => {
    await fetch("http://127.0.0.1:4998/__fixture/" + name, { method: "POST" });
  };
  for (const width of [1440, 360, 390, 412]) {
    await page.setViewportSize({ width, height: 1000 });
    await state("active");
    for (const [path, name] of [
      ["/today", "今後の買い目"],
      ["/signal-log", "判断履歴"],
      ["/performance", "運用成績"],
      ["/settings", "判定設定"],
    ]) {
      await go(path);
      assert.equal(await page.locator("h1").innerText(), name);
      assert.ok(
        (await page.locator(".fp-test").innerText()).includes("テストデータ"),
      );
      if (path === "/today") {
        await page.locator(".fp-race-card").first().waitFor();
        assert.equal(await page.locator(".fp-race-card").count(), 2);
        assert.equal(
          await page.locator(".fp-recommended .fp-pick:visible").count(),
          2,
        );
        assert.equal(
          await page.locator(".fp-optional .fp-pick:visible").count(),
          0,
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: output + `/today-${width}.png`,
          fullPage: true,
        });
        const button = page.getByRole("button", {
          name: "▼ 買ってもよい3点を表示",
        });
        await button.focus();
        await button.press("Enter");
        assert.equal(
          await page
            .getByRole("button", { name: "▲ 買ってもよいを閉じる" })
            .getAttribute("aria-expanded"),
          "true",
        );
        assert.equal(
          await page.locator(".fp-recommended .fp-pick:visible").count(),
          2,
        );
        assert.equal(
          await page.locator(".fp-optional .fp-pick:visible").count(),
          3,
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: output + `/today-expanded-${width}.png`,
          fullPage: true,
        });
        check(
          `${width}px upcoming: single race cards, recommended stays visible, independent optional disclosure`,
        );
      } else if (path === "/signal-log") {
        const cards = page.locator(".fp-race-card");
        assert.equal(await cards.count(), 5);
        for (const count of [4, 5, 8]) {
          const card = cards.filter({
            hasText:
              count === 4 ? "浜名湖 11R" : count === 5 ? "若松 8R" : "蒲郡 10R",
          });
          assert.equal(
            await card.locator(".fp-history-row:visible").count(),
            4,
          );
          if (count === 4)
            assert.equal(await card.locator(".fp-expand").count(), 0);
          else {
            const toggle = card.getByRole("button", {
              name: `▼ 残り${count - 4}点の買い目を表示`,
            });
            await toggle.focus();
            await toggle.press("Enter");
            assert.equal(
              await card.locator(".fp-history-row:visible").count(),
              count,
            );
            await card.getByRole("button", { name: "▲ 閉じる" }).click();
          }
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: output + `/signal-log-${width}.png`,
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "▼ 残り4点の買い目を表示" })
          .click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: output + `/signal-log-expanded-${width}.png`,
          fullPage: true,
        });
        check(`${width}px history: 4/5/8 rows and keyboard expansion`);
      } else await page.evaluate(() => window.scrollTo(0, 0));
      // Preserve the separately captured initial and expanded states.
      if (path !== "/today" && path !== "/signal-log")
        await page.screenshot({
          path: output + `${path}-${width}.png`,
          fullPage: true,
        });
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        scroll: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll("body *")]
          .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 4)
          .map((e) => e.className),
      }));
      assert.ok(
        layout.scroll <= layout.viewport + 1,
        JSON.stringify({ width, path, ...layout }),
      );
    }
    check(`${width}px all four pages: no horizontal overflow`);
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await state("active");
  await go("/signal-log");
  await page.getByLabel("レース・買い目検索").fill("蒲郡");
  await page.getByRole("button", { name: "条件を適用", exact: true }).click();
  await page.waitForURL(/search=/);
  assert.equal(await page.locator(".fp-race-card").count(), 1);
  check("history search is applied on the server");
  await go("/signal-log");
  await page.locator(".fp-filter-details>summary").click();
  await page.getByLabel("期間", { exact: true }).selectOption("custom");
  await page.getByLabel("開始日").fill("2025-01-01");
  await page.getByLabel("終了日").fill("2025-01-02");
  await page.getByRole("button", { name: "条件を適用", exact: true }).click();
  await page.waitForURL(/period=custom/);
  assert.equal(await page.locator(".fp-race-card").count(), 0);
  assert.ok(
    (await page.locator(".fp-empty").innerText()).includes(
      "保存記録はありません",
    ),
  );
  check("custom period and empty state");
  await go("/performance");
  await page.locator(".fp-filter-details>summary").click();
  await page.getByLabel("期間", { exact: true }).selectOption("month");
  await page.getByLabel("対象月").fill("2025-02");
  await page.getByRole("button", { name: "条件を適用", exact: true }).click();
  await page.waitForURL(/month=2025-02/);
  assert.ok(
    (await page.locator(".fp-selection").innerText()).includes(
      "2025-02-01〜2025-02-28",
    ),
  );
  check("past month navigation");
  await go("/performance");
  const roi = await page.locator(".fp-kpi.roi>strong").innerText();
  await page
    .locator(".fp-breakdown")
    .filter({ hasText: "期待回収率帯別" })
    .getByRole("link")
    .first()
    .click();
  await page.waitForURL(/evBand=/);
  assert.ok(page.url().includes("mode=recommended"));
  assert.ok((await page.locator(".fp-test").innerText()).includes("テスト"));
  await page.goBack();
  assert.equal(await page.locator(".fp-kpi.roi>strong").innerText(), roi);
  check("breakdown drill-down and back preserves filter/ROI");
  await state("stopped");
  await go("/today");
  assert.equal(await page.locator(".fp-race-card").count(), 0);
  assert.ok(
    (await page.locator(".fp-empty").innerText()).includes("取得停止中"),
  );
  const before = requests.length;
  await page.waitForTimeout(2500);
  assert.equal(requests.length, before);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: output + "/today-stopped-390.png",
    fullPage: true,
  });
  check("stopped: no old recommendations, no repeating requests");
  await go("/settings");
  await page.getByLabel("掲載開始（締切何分前）").fill("19");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await page.getByRole("status").waitFor();
  assert.ok((await page.getByRole("status").innerText()).includes("未適用"));
  let drafts = await readdir(output + "/fixture.json.drafts");
  assert.equal(drafts.length, 1);
  const draft = JSON.parse(
    await readFile(output + "/fixture.json.drafts/" + drafts[0], "utf8"),
  );
  assert.equal(draft.after_values.windowSeconds, 1140);
  assert.equal(draft.before_values.windowSeconds, 1200);
  assert.equal(
    JSON.parse(await readFile(output + "/fixture.json", "utf8")).feed.stopped,
    true,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: output + "/settings-saved-390.png",
    fullPage: true,
  });
  await page.reload();
  assert.ok(
    (await page.locator(".fp-settings").last().innerText()).includes(
      draft.rule_version,
    ),
  );
  check(
    "draft save: durable before/after/version/future timestamp, remains stopped",
  );
  await page.getByLabel("買ってもよいの下限（％超）").fill("130");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await page.locator(".fp-notice[role=alert]").waitFor();
  assert.equal(await page.getByRole("status").count(), 0);
  assert.equal((await readdir(output + "/fixture.json.drafts")).length, 1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: output + "/settings-validation-error-390.png",
    fullPage: true,
  });
  check("invalid thresholds: error only, no false success or new version");
  await state("error");
  await go("/today");
  assert.ok(
    (await page.locator(".fp-notice[role=alert]").innerText()).includes(
      "取得に失敗",
    ),
  );
  assert.equal(await page.locator(".fp-race-card").count(), 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: output + "/today-error-390.png",
    fullPage: true,
  });
  check("read failure differs from genuine no candidates");
  await state("empty");
  await go("/today");
  assert.ok(
    (await page.locator(".fp-empty").innerText()).includes(
      "表示条件を満たす買い目はありません",
    ),
  );
  check("genuine empty candidate state");
  await state("deadline");
  await go("/today");
  await page.locator(".fp-race-card").first().waitFor();
  const deadlineRequests = requests.length;
  await page.waitForTimeout(6000);
  assert.equal(await page.locator(".fp-race-card").count(), 0);
  assert.equal(requests.length, deadlineRequests);
  check("client deadline expiration removes cards without API calls");
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  check("no external browser requests or client runtime errors");
  const report = {
    passed: true,
    checks,
    widths: [1440, 360, 390, 412],
    externalRequests: external,
    clientErrors: errors,
  };
  await writeFile(
    output + "/browser-check.json",
    JSON.stringify(report, null, 2),
  );
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
}
