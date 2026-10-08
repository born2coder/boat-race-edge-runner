import test from "node:test";
import assert from "node:assert/strict";
import { policy as p } from "./four-page/load-policy.mjs";
import { makeFixture } from "./four-page/fixture.mjs";
const now = Date.parse("2026-10-08T05:00:00Z"),
  iso = (t) => new Date(t).toISOString();
const obs = {
  raceId: "BR:20261008:07:10",
  combination: "1-2-3",
  closeAt: iso(now + 1200000),
  observedAt: iso(now - 1000),
  receivedAt: iso(now),
  generatedAt: iso(now - 2000),
  probability: 0.01,
  calibratedProbability: null,
  conservativeProbability: 0.008,
  odds: 150,
  officialCloseVerified: true,
  cancelled: false,
  resultKnown: false,
  modelVersion: p.MODEL_VERSION,
  ruleVersion: p.RULE_VERSION,
};
for (const [name, patch, expected] of [
  [
    "推定0.99％",
    { probability: 0.0099, conservativeProbability: 0.00792 },
    "excluded",
  ],
  ["推定1％", {}, "recommended"],
  ["EV100％", { odds: 125 }, "excluded"],
  ["EV100.01％", { odds: 1.0001 / 0.008 }, "optional"],
  ["EV119.99％", { odds: 1.1999 / 0.008 }, "optional"],
  ["EV120％", { odds: 150 }, "recommended"],
  ["20分1秒", { closeAt: iso(now + 1201000) }, "excluded"],
  ["20分ちょうど", {}, "recommended"],
  ["締切到達", { closeAt: iso(now) }, "excluded"],
  ["保守欠損", { conservativeProbability: null }, "excluded"],
  ["オッズ欠損", { odds: null }, "excluded"],
  ["締切欠損", { closeAt: null }, "excluded"],
  ["鮮度切れ", { observedAt: iso(now - 300001) }, "excluded"],
  ["中止", { cancelled: true }, "excluded"],
  ["結果判明済", { resultKnown: true }, "excluded"],
  ["公式締切未確認", { officialCloseVerified: false }, "excluded"],
  ["受信未来", { receivedAt: iso(now + 1000) }, "excluded"],
  ["誤識別", { raceId: "BR:20261008:25:10" }, "excluded"],
  ["重複艇", { combination: "1-1-2" }, "excluded"],
]) {
  test("分類境界 " + name, () =>
    assert.equal(p.classify({ ...obs, ...patch }, now).category, expected),
  );
}
test("停止中は古い推奨を表示しない", () => {
  const a = p.classify(obs, now, true);
  assert.equal(a.category, "excluded");
  assert.ok(a.reasons.includes("取得停止中"));
});
test("110→125→115→130％は3方式ごとに初回だけ。両方を足さない", () => {
  const seen = new Set(),
    entries = [];
  for (const [i, ev] of [1.1, 1.25, 1.15, 1.3, 0.9].entries()) {
    const at = now + i * 1000;
    const o = {
      ...obs,
      odds: ev / 0.008,
      observedAt: iso(at - 1000),
      receivedAt: iso(at),
    };
    const added = p.firstPurchases(o, seen, iso(now - 2000), at);
    entries.push(...added);
    for (const e of added) seen.add(e.id);
  }
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => [e.mode, e.ev]),
    [
      ["optional", 1.1],
      ["both", 1.1],
      ["recommended", 1.25],
    ],
  );
  assert.equal(entries.find((e) => e.mode === "both").recordedAt, iso(now));
  assert.equal(
    entries.find((e) => e.mode === "recommended").recordedAt,
    iso(now + 1000),
  );
});
test("無承認・過去観測・結果後の補完は購入しない", () => {
  assert.deepEqual(p.firstPurchases(obs, new Set(), null, now), []);
  assert.deepEqual(p.firstPurchases(obs, new Set(), iso(now + 1000), now), []);
  assert.deepEqual(
    p.firstPurchases(
      { ...obs, resultKnown: true },
      new Set(),
      iso(now - 2000),
      now,
    ),
    [],
  );
});
const entry = p.firstPurchases(obs, new Set(), iso(now - 2000), now)[0];
const result = {
  cancelled: false,
  refundedLanes: [],
  combination: "1-2-3",
  payoutPer100Yen: 1520,
  unsupported: false,
  confirmedAt: iso(now + 2000000),
};
test("公式払戻1520円：3点300円→1220円、ROI506.67％。参考オッズは不使用", () => {
  const entries = ["1-2-3", "1-3-2", "2-1-3"].map((combination, i) =>
    p.settle({ ...entry, id: String(i), combination, odds: 999 }, result),
  );
  const a = p.aggregate(entries);
  assert.equal(a.stake, 300);
  assert.equal(a.payout, 1520);
  assert.equal(a.profit, 1220);
  assert.ok(Math.abs(a.roi - 506.6666666667) < 1e-8);
  assert.equal(a.curve.at(-1).profit, a.profit);
  assert.equal(a.hits, 1);
  assert.equal(a.races, 1);
  assert.equal(a.maxLosing, 0);
  assert.equal(
    p
      .groupRaces(entries)[0]
      .reduce((sum, e) => sum + e.payoutYen - e.stakeYen, 0),
    a.profit,
  );
});
test("結果待ち・確認中は0円損失にしない。返還を両側除外", () => {
  const refund = p.settle(entry, { ...result, cancelled: true });
  const pending = { ...entry, id: "pending" };
  const checked = p.settle(
    { ...entry, id: "checked" },
    { ...result, unsupported: true },
  );
  const a = p.aggregate([refund, pending, checked]);
  assert.equal(a.stake, 0);
  assert.equal(a.payout, 0);
  assert.equal(a.roi, null);
  assert.equal(a.pending, 2);
  assert.equal(a.pendingStake, 200);
  assert.equal(a.refunds, 1);
  assert.equal(a.refundAmount, 100);
  assert.equal(refund.payoutYen, 100);
  assert.equal(refund.hit, null);
});
test("艇返還・同着・欠損・再精算・重複イベント", () => {
  assert.equal(
    p.settle(entry, { ...result, refundedLanes: [2] }).outcome,
    "refunded",
  );
  assert.equal(
    p.settle(entry, { ...result, combination: "1-1-2" }).outcome,
    "checking",
  );
  assert.equal(
    p.settle(entry, { ...result, payoutPer100Yen: null }).outcome,
    "checking",
  );
  const paid = p.settle(entry, result);
  assert.deepEqual(p.settle(paid, { ...result, payoutPer100Yen: 9999 }), paid);
  assert.equal(p.aggregate([paid, paid]).stake, 100);
});
test("全敗の連敗はレース単位、初期0円からDD、同時精算は一括", () => {
  const miss = p.settle({ ...entry, combination: "2-1-3" }, result);
  const hit = p.settle(
    { ...entry, id: "hit", raceId: "BR:20261008:07:11" },
    result,
  );
  const a = p.aggregate([miss, { ...miss, id: "miss2" }, hit]);
  assert.equal(a.maxLosing, 1);
  assert.equal(a.drawdown, 0);
  assert.equal(a.profit, 1220);
  const allLoss = p.aggregate([
    miss,
    { ...miss, id: "same" },
    {
      ...miss,
      id: "next",
      raceId: "BR:20261008:07:12",
      settledAt: iso(now + 3000000),
    },
  ]);
  assert.equal(allLoss.maxLosing, 2);
  assert.equal(allLoss.drawdown, 300);
  assert.deepEqual(
    p.aggregate([hit, miss, { ...miss, id: "miss2" }]).curve,
    a.curve,
  );
});
test("0件・日本時間日付境界・任意の月年・不正日付", () => {
  assert.equal(p.aggregate([]).roi, null);
  assert.equal(p.jstDate(Date.parse("2026-10-07T15:00:00Z")), "2026-10-08");
  assert.equal(p.jstDate(Date.parse("2026-10-07T14:59:59Z")), "2026-10-07");
  const month = p.filtersFrom({ period: "month", month: "2024-02" });
  assert.equal(month.to, "2024-02-29");
  assert.equal(
    p.filtersFrom({ period: "year", year: "2025" }).from,
    "2025-01-01",
  );
  assert.throws(() =>
    p.filtersFrom({ period: "custom", from: "2026-02-30", to: "2026-03-01" }),
  );
});
test("帯が重複・欠落せず、保守1％未満も残す", () => {
  for (const [v, id] of [
    [1.0001, "100-110"],
    [1.1, "110-120"],
    [1.2, "120-130"],
    [1.3, "130-150"],
    [1.5, "150-200"],
    [2, "200+"],
  ])
    assert.equal(p.bandFor(v, p.EV_BANDS), id);
  assert.equal(p.bandFor(0.008, p.PROBABILITY_BANDS), "0-1");
  for (const [v, id] of [
    [20, "20-15"],
    [15, "15-10"],
    [10, "10-5"],
    [5, "10-5"],
    [4.99, "5-0"],
  ])
    assert.equal(p.timeBand(v), id);
});
test("版・運用方法・期間・履歴リンク条件と集計が一致", () => {
  const fixture = makeFixture(now);
  const f = p.filtersFrom({ period: "all" }, true, now);
  const entries = p.selectEntries(fixture.entries, f);
  assert.ok(
    entries.every(
      (e) => e.ruleVersion === p.RULE_VERSION && e.mode === "recommended",
    ),
  );
  for (const band of p.EV_BANDS) {
    const q = new URL(
      p.linkFilters(f, { evBand: band.id }),
      "http://localhost",
    );
    const target = p.selectEntries(
      fixture.entries,
      p.filtersFrom(Object.fromEntries(q.searchParams), true, now),
    );
    const expected = entries.filter(
      (e) => p.bandFor(e.ev, p.EV_BANDS) === band.id,
    );
    assert.deepEqual(target, expected);
    assert.equal(p.aggregate(target).profit, p.aggregate(expected).profit);
  }
});
test("下書き入力の上下限・固定研究係数を検証", () => {
  assert.equal(p.validateRule(p.DEFAULT_RULE).stakeYen, 100);
  for (const patch of [
    { minimumProbability: 0 },
    { minimumProbability: 1.01 },
    { recommendedEv: 1 },
    { windowSeconds: 1201 },
    { stakeYen: 200 },
    { conservativeFactor: 0.9 },
    { maxOddsAgeSeconds: 60 },
  ])
    assert.throws(() => p.validateRule({ ...p.DEFAULT_RULE, ...patch }));
});

test("境界付近を120％・100％ちょうどに丸めない", () => {
  assert.equal(p.expectedReturnText(1.1996), "119.96％");
  assert.equal(p.expectedReturnText(1.199999), "119.9999％");
  assert.equal(p.expectedReturnText(1.000001), "100.0001％");
  assert.equal(p.expectedReturnText(1.2), "120.00％");
  assert.equal(p.classify(obs, NaN).category, "excluded");
  assert.deepEqual(p.firstPurchases(obs, new Set(), "invalid", now), []);
});

test("適用途中のレースに新ルールを差し込まない", () => {
  assert.deepEqual(
    p.firstPurchases(
      { ...obs, closeAt: iso(now + 600000) },
      new Set(),
      iso(now - 1000),
      now,
    ),
    [],
  );
});

test("暫定係数とEVの10進積は境界を浮動小数誤差で越えない", () => {
  assert.equal(p.decimalProduct(0.025, 0.8), 0.02);
  assert.equal(p.decimalProduct(0.02, 50), 1);
  assert.equal(p.decimalProduct(1e-7, 1e6), 0.1);
  assert.equal(
    p.classify(
      {
        ...obs,
        probability: 0.025,
        conservativeProbability: p.decimalProduct(0.025, 0.8),
        odds: 50,
      },
      now,
    ).category,
    "excluded",
  );
});
