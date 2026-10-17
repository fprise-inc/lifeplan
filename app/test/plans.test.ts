// 案（差分・重ね・現状への反映・要確認）、動かす項目、配分から利回り、比較の数字、収支と資産・負債のグラフ、説明モード
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { REPO_DIR } from "../scripts/lib.ts";
import type { EngineRequest, PreviewResult, TableCell } from "../src/engine/types.ts";
import { CompareTable } from "../src/presentation/Compare.tsx";
import { ExplainBar, MainChart, MainLegend, type MainChartModel } from "../src/presentation/MainChart.tsx";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { explainModel } from "../src/workspace/explain.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { applyLevers } from "../src/workspace/levers.ts";
import { bucketShares, expectedReturn, mixFromBuckets } from "../src/workspace/plans/allocation.ts";
import { compareTable, metricsOf } from "../src/workspace/plans/compare.ts";
import { addRate, mulRate, pctText, subRate } from "../src/workspace/plans/decimal.ts";
import { buildCatalog, loanStarted, type Catalog } from "../src/workspace/plans/items.ts";
import { acknowledge, applyValues, changesOf, deletePlan, dropChange, effectiveValues, normalizeValues, overwritePlan, reflectPlan, savePlan, suggestName, type Values } from "../src/workspace/plans/plans.ts";
import { balanceChart, diffCashflowTable, displayYears, financialOf, flowChart, sumByYear, toPresentation } from "../src/workspace/present.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const NOW = "2026-10-17T10:00:00.000Z";
const under = (row: string, p: string) => row === p || row.startsWith(p + ".");

function openDemo(id = "salariedCoupleTwoKids"): { wh: WorkingHousehold; cat: Catalog; selfId: string } {
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold(id) ?? null;
  const re = demo?.reemployment;
  const wh = fromRequest(req, { memo: ["MEMO-MARK-plans"], ...(re !== undefined ? { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } } : {}) });
  return { wh, cat: buildCatalog(wh, self.id, demo), selfId: self.id };
}

const keyOf = (cat: Catalog, re: RegExp) => cat.items.find((x) => re.test(x.key))!.key;
const fin = (r: PreviewResult, y: number) => r.table.filter((c) => c.row === "cf.balance.financial" && c.year === y).reduce((s, c) => s + c.amount, 0);

describe("動かす項目の一覧", () => {
  const { wh, cat } = openDemo();
  it("対策の固定の項目・よく使う項目・入力の項目の定義から作った数の欄が並ぶ", () => {
    const keys = cat.items.map((i) => i.key);
    expect(keys.filter((k) => k.startsWith("lever:"))).toEqual(["lever:retireAge", "lever:pensionAge", "lever:nisaMonthly", "lever:livingMonthly"]);
    // 借入はもう始まっていて残高があるので、借入額の代わりに繰上返済で減らす
    expect(loanStarted(wh.request, wh.request.input.household.debts![0]!)).toBe(true);
    expect(keys.some((k) => /^loan:.*:prepay$/.test(k))).toBe(true);
    expect(keys.some((k) => /^loan:.*:rate$/.test(k))).toBe(true);
    expect(keys).toContain("rates:shift");
    expect(keys.filter((k) => k.startsWith("mix:"))).toHaveLength(2);
    // 入力の欄から（年収・物価上昇率など）
    expect(cat.items.some((i) => i.key.startsWith("field:work/") && i.label.includes("年収"))).toBe(true);
    expect(cat.byKey.has("field:assume/inflation")).toBe(true);
    // 対策と同じものを動かす欄は重ねて出さない
    expect(keys.filter((k) => k.endsWith("/monthly") && k.startsWith("field:living/"))).toHaveLength(0);
    // 入力項目ID はどれも登録簿の形
    for (const it of cat.items) expect(it.item).toMatch(/^[a-z][A-Za-z0-9]*(\.[a-zA-Z0-9]+)+$|^screen$/);
  });

  it("借入の前の住宅ローン（購入の予定）は借入額を動かす", () => {
    const { cat: c2, wh: w2 } = openDemo("lifetime100Plan");
    const k = keyOf(c2, /^loan:.*:principal$/);
    const it = c2.byKey.get(k)!;
    expect(it.read(w2)).toBe(38_000_000);
    const req = applyValues(w2, { [k]: 33_000_000 }, c2);
    expect(req.input.household.debts![0]!.principal).toBe(33_000_000);
    expect(it.text(33_000_000)).toBe("3,300万円");
    // 借入額が減ると、返済が減り、資産が増える
    const a = preview(w2.request);
    const b = preview(req);
    expect(fin(b, 2060)).toBeGreaterThan(fin(a, 2060));
  });

  it("金利は当初の金利を動かした幅だけ、金利の段階もすべて動かす", () => {
    const k = keyOf(cat, /^loan:.*:rate$/);
    const req = applyValues(wh, { [k]: "0.0115" }, cat);
    expect(req.input.household.debts![0]!.rateSchedule.map((s) => s.rate)).toEqual(["0.0115", "0.016", "0.021"]);
    expect(wh.request.input.household.debts![0]!.rateSchedule.map((s) => s.rate)).toEqual(["0.0065", "0.011", "0.016"]);
  });

  it("変動金利の上昇は前提の loanRateShifts。0 に戻すと前提から消える", () => {
    const req = applyValues(wh, { "rates:shift": { add: "0.01", from: "2030-01" } }, cat);
    expect(req.input.assumptions?.loanRateShifts).toEqual([{ from: "2030-01", add: "0.01" }]);
    const back = applyValues({ ...wh, request: req }, { "rates:shift": { add: "0", from: "2030-01" } }, cat);
    expect(back.input.assumptions?.loanRateShifts).toBeUndefined();
    expect(fin(preview(req), 2060)).toBeLessThan(fin(preview(wh.request), 2060));
  });
});

describe("モデル世帯の結果は、動かした値が無ければ1円も変わらない", () => {
  const ids = readdirSync(join(REPO_DIR, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  it.each(ids)("%s: 動かした値なし・現状の値を入れ直しても、計算の要求が同じ", (id) => {
    const req = modelHousehold(id);
    const self = roles(req).find((r) => r.key === "self");
    if (self === undefined) return;
    const wh = fromRequest(req);
    const cat = buildCatalog(wh, self.member.id, null);
    const text = JSON.stringify(wh.request);
    expect(JSON.stringify(applyValues(wh, {}, cat))).toBe(text);
    // どの項目も、現状の値を当てると要求は変わらない（推定の値は確定に変わるので除く）
    const values: Values = {};
    for (const it of cat.items) {
      if (it.control.kind === "field") {
        const st = it.control.field.get(wh);
        if (st.estimated != null || st.assumed != null || st.derived != null || st.implicit === true) continue;
      }
      values[it.key] = it.read(wh);
    }
    expect(normalizeValues(values, {}, wh, cat)).toEqual({});
    for (const it of cat.items) {
      if (!Object.hasOwn(values, it.key) || it.phase !== "field") continue;
      expect(JSON.stringify(it.apply(wh, values[it.key] ?? null).request), it.key).toBe(text);
    }
  });
});

describe("案: 差分の作成と適用", () => {
  const { wh, cat } = openDemo();
  const prepay = keyOf(cat, /^loan:.*:prepay$/);
  const rate = keyOf(cat, /^loan:.*:rate$/);

  it("案は現状からの差分だけを持つ（0008 の5 の形）", () => {
    const { wh: w1, id } = savePlan(wh, cat, { name: "B案 借入を500万円減らす", base: null, values: { [prepay]: 5_000_000, "lever:livingMonthly": 300000 }, now: NOW });
    const p = w1.proposals.find((x) => x.id === id)!;
    // 生活費は現状と同じ値なので差分にしない
    expect(p.diffs).toHaveLength(1);
    const d = p.diffs[0]!;
    expect(d).toMatchObject({ key: prepay, item: "debt.prepayments", op: "set", enabled: true, origin: { kind: "manual" }, note: null });
    expect(d.target).toEqual({ object: wh.request.input.household.debts![0]!.id });
    expect(d.value).toEqual({ value: 5_000_000, state: "confirmed", origin: { kind: "manual" } });
    expect(d.before.value).toBe(0);
    expect(d.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // 入力（現状）は変わらない
    expect(w1.request).toBe(wh.request);
    // 当てると繰上返済が入り、計算が変わる
    const req = applyValues(w1, effectiveValues(w1.proposals, id), cat);
    expect(req.input.household.debts![0]!.prepayments).toEqual([{ at: { at: "2026-11" }, amount: 5_000_000, mode: "shortenTerm" }]);
    expect(fin(preview(req), 2050)).not.toBe(fin(preview(wh.request), 2050));
  });

  it("案の数に上限は無い", () => {
    let w = wh;
    for (let i = 0; i < 30; i++) w = savePlan(w, cat, { name: `案${i}`, base: null, values: { "lever:livingMonthly": 200000 + i * 1000 }, now: NOW }).wh;
    expect(w.proposals).toHaveLength(30);
  });

  it("上書きは同じキー・同じ値の差分の ID と before を引き継ぐ", () => {
    const { wh: w1, id } = savePlan(wh, cat, { name: "B", base: null, values: { [prepay]: 5_000_000 }, now: NOW });
    const before = w1.proposals[0]!.diffs[0]!;
    const w2 = overwritePlan(w1, cat, id, { [prepay]: 5_000_000, [rate]: "0.008" }, "2026-10-17T11:00:00.000Z");
    const p = w2.proposals[0]!;
    expect(p.diffs.find((d) => d.key === prepay)!.id).toBe(before.id);
    expect(p.diffs.map((d) => d.key).sort()).toEqual([prepay, rate].sort());
    expect(p.updatedAt).toBe("2026-10-17T11:00:00.000Z");
    expect(p.createdAt).toBe(NOW);
  });

  it("案の名前の例と、変えたことの一覧", () => {
    expect(suggestName([], { [prepay]: 5_000_000 }, wh, cat)).toBe("B案 借入を500万円減らす");
    const { wh: w1, id } = savePlan(wh, cat, { name: "B案 借入を500万円減らす", base: null, values: { [prepay]: 5_000_000 }, now: NOW });
    expect(suggestName(w1.proposals, { [prepay]: 5_000_000, [rate]: "0.0115" }, w1, cat, id)).toBe("C案 B案＋金利1.15%");
    const ch = changesOf(w1.proposals, id, w1, cat);
    expect(ch).toEqual([{ key: prepay, label: "住宅ローンの繰上返済（借入を減らす）", from: "なし", to: "500万円（2026年11月）", inherited: false, state: "ok", reviewNote: null }]);
  });
});

describe("案: 重ね（土台の案に案を重ねる）", () => {
  const { wh, cat } = openDemo();
  const prepay = keyOf(cat, /^loan:.*:prepay$/);
  const rate = keyOf(cat, /^loan:.*:rate$/);
  const b = savePlan(wh, cat, { name: "B", base: null, values: { [prepay]: 5_000_000 }, now: NOW });
  const c = savePlan(b.wh, cat, { name: "C", base: b.id, values: { [prepay]: 5_000_000, [rate]: "0.0115" }, now: NOW });
  const w = c.wh;

  it("重ねた案は土台から変えた差分だけを持ち、中身は土台＋自分", () => {
    const pc = w.proposals.find((p) => p.id === c.id)!;
    expect(pc.base).toBe(b.id);
    expect(pc.diffs.map((d) => d.key)).toEqual([rate]);
    expect(effectiveValues(w.proposals, c.id)).toEqual({ [prepay]: 5_000_000, [rate]: "0.0115" });
    const ch = changesOf(w.proposals, c.id, w, cat);
    expect(ch.map((x) => [x.key, x.inherited])).toEqual([
      [prepay, true],
      [rate, false],
    ]);
  });

  it("土台を直すと、重ねた案にも反映される", () => {
    const w2 = overwritePlan(w, cat, b.id, { [prepay]: 8_000_000 }, NOW);
    expect(effectiveValues(w2.proposals, c.id)[prepay]).toBe(8_000_000);
  });

  it("土台から引き継いだ差分を外すと、この案だけで現状に戻す差分を足す", () => {
    const w2 = dropChange(w, cat, c.id, prepay);
    expect(effectiveValues(w2.proposals, c.id)[prepay]).toBe(0);
    expect(effectiveValues(w2.proposals, b.id)[prepay]).toBe(5_000_000);
    expect(JSON.stringify(applyValues(w2, effectiveValues(w2.proposals, c.id), cat).input.household.debts![0]!.prepayments)).toBe("[]");
  });

  it("土台の案を外しても、重ねた案の中身は変わらない", () => {
    const w2 = deletePlan(w, b.id);
    const pc = w2.proposals.find((p) => p.id === c.id)!;
    expect(pc.base).toBeNull();
    expect(effectiveValues(w2.proposals, c.id)).toEqual({ [prepay]: 5_000_000, [rate]: "0.0115" });
  });

  it("土台が巡回していても止まる", () => {
    const loop = w.proposals.map((p) => (p.id === b.id ? { ...p, base: c.id } : p));
    expect(Object.keys(effectiveValues(loop, c.id)).sort()).toEqual([prepay, rate].sort());
  });
});

describe("案: 現状への反映", () => {
  const { wh, cat, selfId } = openDemo();
  const prepay = keyOf(cat, /^loan:.*:prepay$/);
  const rate = keyOf(cat, /^loan:.*:rate$/);
  const b = savePlan(wh, cat, { name: "B", base: null, values: { [prepay]: 5_000_000, "lever:retireAge": 65 }, now: NOW });
  const c = savePlan(b.wh, cat, { name: "C", base: b.id, values: { [prepay]: 5_000_000, "lever:retireAge": 65, [rate]: "0.0115" }, now: NOW });
  const d = savePlan(c.wh, cat, { name: "D", base: null, values: { [rate]: "0.008" }, now: NOW });
  const w = d.wh;

  it("案の差分（土台を含む）を入力（現状）に取り込み、反映した案は差分が無くなる", () => {
    const expected = applyValues(w, effectiveValues(w.proposals, c.id), cat);
    const r = reflectPlan(w, cat, c.id, NOW);
    expect(r.request).toEqual(expected);
    const pc = r.proposals.find((p) => p.id === c.id)!;
    expect(pc.diffs).toEqual([]);
    expect(pc.base).toBeNull();
    expect(pc.reflectedAt).toBe(NOW);
    // 新しい現状で計算しても、反映する前の案と同じ結果
    const self = roles(r.request).find((x) => x.key === "self")!.member.id;
    expect(self).toBe(selfId);
    const cat2 = buildCatalog(r, self, demoHousehold("salariedCoupleTwoKids")!);
    expect(JSON.stringify(preview(applyValues(r, effectiveValues(r.proposals, c.id), cat2)).table)).toBe(JSON.stringify(preview(expected).table));
    // ほかの案は差分のまま。現状が変わった項目は「要確認」
    const dch = changesOf(r.proposals, d.id, r, cat2);
    expect(dch).toHaveLength(1);
    expect(dch[0]).toMatchObject({ key: rate, state: "changed" });
    expect(dch[0]!.reviewNote).toContain("当初0.65%→当初1.15%");
  });
});

describe("案: 入力（現状）を直したときの全案への反映と「要確認」", () => {
  const { wh, cat, selfId } = openDemo();
  const prepay = keyOf(cat, /^loan:.*:prepay$/);
  const rate = keyOf(cat, /^loan:.*:rate$/);
  const salaryKey = cat.items.find((i) => i.key.startsWith("field:work/") && i.label.includes("年収"))!.key;
  const b = savePlan(wh, cat, { name: "B", base: null, values: { [prepay]: 5_000_000, "lever:livingMonthly": 280000 }, now: NOW });
  const c = savePlan(b.wh, cat, { name: "C", base: null, values: { [rate]: "0.0115" }, now: NOW });
  const w = c.wh;
  const demo = demoHousehold("salariedCoupleTwoKids")!;

  it("案が動かしていない項目（年収）を直すと、全部の案にそのまま反映される", () => {
    const it = cat.byKey.get(salaryKey)!;
    const raised = it.apply(w, (it.read(w) as number) + 1_000_000);
    const cat2 = buildCatalog(raised, selfId, demo);
    for (const p of raised.proposals) {
      const req = applyValues(raised, effectiveValues(raised.proposals, p.id), cat2);
      expect(cat2.byKey.get(salaryKey)!.read({ ...raised, request: req })).toBe((it.read(w) as number) + 1_000_000);
      expect(changesOf(raised.proposals, p.id, raised, cat2).every((x) => x.state === "ok")).toBe(true);
    }
  });

  it("案が動かした項目を入力で直すと「要確認」。確かめると消え、案の値はそのまま", () => {
    const now = mutate(w, (h) => {
      for (const s of h.debts![0]!.rateSchedule) s.rate = addRate(s.rate, "0.001");
    });
    const cat2 = buildCatalog(now, selfId, demo);
    const ch = changesOf(now.proposals, c.id, now, cat2);
    expect(ch[0]).toMatchObject({ key: rate, state: "changed", from: "当初0.75%", to: "当初1.15%" });
    // 案の値は案のまま当たる（段階も、新しい現状からの幅で動く）
    expect(applyValues(now, effectiveValues(now.proposals, c.id), cat2).input.household.debts![0]!.rateSchedule[0]!.rate).toBe("0.0115");
    const ok = acknowledge(now, cat2, c.id, rate);
    expect(changesOf(ok.proposals, c.id, ok, cat2)[0]!.state).toBe("ok");
  });

  it("案が指していた物（住宅ローン）が消えると「要確認」になり、その差分は当てない", () => {
    const gone = mutate(w, (h) => void (h.debts = []));
    const cat2 = buildCatalog(gone, selfId, demo);
    const ch = changesOf(gone.proposals, b.id, gone, cat2);
    expect(ch.find((x) => x.key === prepay)).toMatchObject({ state: "missing" });
    expect(ch.find((x) => x.key === "lever:livingMonthly")).toMatchObject({ state: "ok" });
    const req = applyValues(gone, effectiveValues(gone.proposals, b.id), cat2);
    expect(req.input.household.debts).toEqual([]);
    expect(req.input.household.livingExpenses![0]!.monthly!.value).toBe(280000);
    // 外すと消える
    const dropped = dropChange(gone, cat2, b.id, prepay);
    expect(changesOf(dropped.proposals, b.id, dropped, cat2).map((x) => x.key)).toEqual(["lever:livingMonthly"]);
  });
});

describe("資産運用の配分から利回りへの換算", () => {
  it("配分×資産クラスの利回り（前提に無い資産クラスは運用利回り、不動産は0）", () => {
    const req = modelHousehold("idecoPayout");
    expect(expectedReturn(req, { kind: "ideco", assetMix: [{ assetClass: "equity.global", share: "0.6" }, { assetClass: "bond.domestic", share: "0.4" }] }, 2030)).toBe("0.026");
    expect(expectedReturn(req, { kind: "nisa", assetMix: [{ assetClass: "reit.global", share: "0.5" }, { assetClass: "realEstate", share: "0.5" }] }, 2030)).toBe("0.005");
    expect(expectedReturn(req, { kind: "nisa" }, 2030)).toBe("0.01");
    expect(expectedReturn(modelHousehold("marketDropAtRetirement"), { kind: "taxable", assetMix: [{ assetClass: "equity.global", share: "1" }] }, 2030)).toBe("-0.2");
  });

  it("株式・債券の割合から配分を作る（預金は残り。ほかの資産クラスは残す）", () => {
    expect(mixFromBuckets(undefined, 60, 20)).toEqual([
      { assetClass: "equity.global", share: "0.6" },
      { assetClass: "bond.global", share: "0.2" },
      { assetClass: "cash.deposit", share: "0.2" },
    ]);
    expect(mixFromBuckets([{ assetClass: "balanced", share: "0.3" }, { assetClass: "equity.domestic", share: "0.7" }], 50, 10)).toEqual([
      { assetClass: "equity.domestic", share: "0.5" },
      { assetClass: "bond.global", share: "0.1" },
      { assetClass: "cash.deposit", share: "0.1" },
      { assetClass: "balanced", share: "0.3" },
    ]);
    expect(bucketShares(undefined, "deposit")).toEqual({ equity: 0, bond: 0, cash: 100, other: 0 });
  });

  it("換算した利回りが、計算エンジンの NISA の残高の伸びと一致する", () => {
    const { wh, cat } = openDemo();
    const nisa = wh.request.input.household.accounts!.find((a) => a.kind === "nisa")!;
    const k = `mix:${nisa.id}`;
    // 積立を止めて（器の出入りを無くして）、配分を株式60%・債券20%・預金20%に
    const noContrib = mutate(wh, (h) => void (h.accounts!.find((a) => a.id === nisa.id)!.contributions = []));
    const mix = mixFromBuckets(nisa.assetMix, 60, 20);
    const req = applyValues(noContrib, { [k]: mix }, cat);
    const r = expectedReturn(req, { kind: "nisa", assetMix: mix }, 2029);
    expect(r).toBe(addRate(addRate(mulRate("0.04", "0.6"), mulRate("0.01", "0.2")), mulRate("0.001", "0.2")));
    const bal = sumByYear(preview(req).table, (c) => c.row === "cf.balance.account.nisa");
    const y28 = bal.get(2028)!;
    const y29 = bal.get(2029)!;
    expect(Math.abs(y29 - Math.round(y28 * (1 + Number(r))))).toBeLessThanOrEqual(1);
    expect(cat.byKey.get(k)!.text(mix)).toBe(`株式60%・債券20%・預金20%（年${pctText(r)}）`);
  });

  it("率の計算は10進のまま", () => {
    expect(addRate("0.0065", "0.005")).toBe("0.0115");
    expect(subRate("0.0065", "0.01")).toBe("-0.0035");
    expect(mulRate("0.04", "0.6")).toBe("0.024");
    expect(pctText("0.02485")).toBe("2.49%");
  });
});

describe("比較の数字がエンジンの出力と一致する", () => {
  const { wh, cat } = openDemo();
  const prepay = keyOf(cat, /^loan:.*:prepay$/);
  const rate = keyOf(cat, /^loan:.*:rate$/);
  const mixKey = cat.items.find((x) => x.key.startsWith("mix:") && x.control.kind === "mix" && x.control.accountKind === "nisa")!.key;
  const plans: Values[] = [{ [prepay]: 5_000_000 }, { [rate]: "0.0115" }, { [mixKey]: mixFromBuckets(undefined, 80, 10) }, { "lever:retireAge": 70 }, { "rates:shift": { add: "0.01", from: "2030-01" } }];
  const cur = preview(wh.request);
  const results = plans.map((v) => preview(applyValues(wh, v, cat)));
  const years = displayYears(wh.request);

  it("主な数字（95歳時点の資産・尽きる年・生涯の手取り・支出・最少の資産・ローンの返済）", () => {
    for (const r of [cur, ...results]) {
      const m = metricsOf(wh.request, r.table, 95);
      const ys = new Set(years);
      const sum = (pred: (c: TableCell) => boolean) => r.table.filter((c) => ys.has(c.year) && pred(c)).reduce((s, c) => s + c.amount, 0);
      expect(m.targetYear).toBe(2076);
      expect(m.target).toBe(fin(r, 2076));
      expect(m.takeHome).toBe(sum((c) => under(c.row, "cf.income")) - sum((c) => under(c.row, "cf.taxSi")));
      expect(m.expense).toBe(sum((c) => under(c.row, "cf.expense")));
      expect(m.loan).toBe(sum((c) => under(c.row, "cf.expense.housing.loan")));
      const f = financialOf(r.table);
      const dep = years.find((y) => (f.get(y) ?? 0) < 0) ?? null;
      expect(m.depletion).toBe(dep);
      expect(m.min.amount).toBe(Math.min(...years.map((y) => f.get(y) ?? 0)));
    }
  });

  it("比較の表は現状と帯の5案。差は基準の案（列を選べる）から", () => {
    const named = results.map((r, i) => ({ name: `案${i + 1}`, table: r.table }));
    const table = compareTable(wh.request, [{ name: "現状", table: cur.table }, ...named], 95);
    expect(table.columns.map((c) => c.name)).toEqual(["現状", "案1", "案2", "案3", "案4", "案5"]);
    expect(table.columns[0]!.base).toBe(true);
    expect(table.diffLabel).toBe("基準より");
    const target = table.rows.find((r) => r.key === "target")!;
    expect(target.label).toBe("ご主人95歳時点の金融資産");
    expect(target.cells[1]!.text).toBe(`${Math.round(Math.abs(fin(results[0]!, 2076)) / 10000).toLocaleString("en-US")}万円`.replace(/^/, fin(results[0]!, 2076) < 0 ? "▲" : ""));
    expect(target.cells[0]!.diff).toBeNull();
    // 基準を案2にすると、差は案2から
    const t2 = compareTable(wh.request, [{ name: "現状", table: cur.table }, ...named], 95, 2);
    expect(t2.columns[2]!.base).toBe(true);
    expect(t2.rows.find((r) => r.key === "target")!.cells[2]!.diff).toBeNull();
    const man = (n: number) => `${n === 0 ? "±" : n > 0 ? "+" : "▲"}${Math.round(Math.abs(n) / 10000).toLocaleString("en-US")}`.replace("±0", "±0");
    expect(t2.rows.find((r) => r.key === "target")!.cells[1]!.diff).toBe(`${man(fin(results[0]!, 2076) - fin(results[1]!, 2076))}万円`);
    // 7列目以降は比べない（現状＋5案）
    expect(compareTable(wh.request, [{ name: "現状", table: cur.table }, ...named, ...named], 95).columns).toHaveLength(6);
    const html = renderToString(h(CompareTable, { model: table }));
    expect(html).toContain("案5");
    expect(html).toContain("基準");
    expect(html).not.toContain("MEMO-MARK-plans");
  });

  it("キャッシュフロー表の差（案B−案A）は年ごと・行ごとの差", () => {
    const t = diffCashflowTable(wh.request, cur.table, results[0]!.table, years, "差");
    const row = t.rows.find((r) => r.key === "financial");
    expect(row?.kind).toBe("total");
    if (row?.kind !== "total") return;
    years.forEach((y, i) => expect(row.cells[i]!.amount).toBe(fin(results[0]!, y) - fin(cur, y)));
    // 変わらない行は出さない
    expect(t.rows.some((r) => r.key === "education")).toBe(false);
  });
});

describe("収支の推移・資産と負債の推移", () => {
  const { wh, cat } = openDemo();
  const demo = demoHousehold("salariedCoupleTwoKids")!;
  const self = roles(wh.request).find((r) => r.key === "self")!.member;
  const proposal: EngineRequest = applyLevers(wh.request, self.id, demo.firstProposal, { reemployment: demo.reemployment! });
  const r = preview(proposal);
  const years = displayYears(wh.request);
  void cat;

  it("収入・支出の系列の合計が、表の収入・支出（税・社会保険料を含む）と一致し、赤字の年が分かる", () => {
    const f = flowChart(proposal, r.table, years, "収支");
    const inc = sumByYear(r.table, (c) => under(c.row, "cf.income"));
    const exp = sumByYear(r.table, (c) => under(c.row, "cf.expense") || under(c.row, "cf.taxSi"));
    years.forEach((y, i) => {
      expect(f.income.reduce((s, x) => s + x.values[i]!, 0)).toBe(inc.get(y) ?? 0);
      expect(f.expense.reduce((s, x) => s + x.values[i]!, 0)).toBe(exp.get(y) ?? 0);
    });
    expect(f.income.map((s) => s.label)).toEqual(["給与", "年金", "その他の収入"]);
    expect(f.expense.map((s) => s.label)).toEqual(["生活費", "住宅", "教育", "保険", "その他（税・社会保険料など）"]);
    expect(f.net.some((v) => v < 0)).toBe(true);
    const m = toPresentation({ base: wh.request, proposal, current: preview(wh.request), proposed: r, targetAge: 95, selectedYear: 2031, provisional: false, names: { selected: "B案", base: "A案", same: false } });
    const html = renderToString(h("div", null, h(MainLegend, { model: m, mode: "flows", explain: null }), h(MainChart, { model: m, mode: "flows", explain: null, ageMark: null, onSelectYear: () => undefined })));
    expect(html).toContain("flag-band");
    expect(html).toContain("赤字の年");
    expect(html).toContain("net-base");
  });

  it("資産の系列の合計は金融資産（マイナスは不足）、負債は住宅ローンの残高", () => {
    const b = balanceChart(r.table, years, years.map(() => null), "資産と負債");
    const finM = financialOf(r.table);
    const debt = sumByYear(r.table, (c) => under(c.row, "cf.balance.debt"));
    years.forEach((y, i) => {
      const assets = b.assets.reduce((s, x) => s + x.values[i]!, 0);
      const f = finM.get(y) ?? 0;
      if (f >= 0) expect(assets).toBe(f);
      else expect(b.shortfall[i]).toBe(f);
      expect(b.debts.reduce((s, x) => s + x.values[i]!, 0)).toBe(debt.get(y) ?? 0);
      expect(b.netWorth[i]).toBe(f - (debt.get(y) ?? 0));
    });
    const m: MainChartModel = toPresentation({ base: wh.request, proposal, current: preview(wh.request), proposed: r, targetAge: 95, selectedYear: 2031, provisional: false, names: { selected: "B案", base: "A案", same: false } });
    expect(renderToString(h(MainLegend, { model: m, mode: "balance", explain: null }))).toContain("純資産");
    expect(renderToString(h(MainChart, { model: m, mode: "balance", explain: null, ageMark: null, onSelectYear: () => undefined }))).toContain("net-sel");
  });

  it("主画面の提示用の値に入る", () => {
    const m = toPresentation({ base: wh.request, proposal, current: preview(wh.request), proposed: r, targetAge: 95, selectedYear: null, provisional: false });
    expect(m.flows.years).toEqual(years);
    expect(m.balance.assets.map((s) => s.key)).toEqual(["deposit", "nisa", "dc", "assetOther"]);
  });
});

describe("説明モード", () => {
  const { wh } = openDemo();
  const demo = demoHousehold("salariedCoupleTwoKids")!;
  const self = roles(wh.request).find((r) => r.key === "self")!.member;
  const proposal = applyLevers(wh.request, self.id, demo.firstProposal, { reemployment: demo.reemployment! });
  const r = preview(proposal);
  const m = explainModel(proposal, r, 95);

  it("収入 → 年金 → 支出 → 教育 → 住宅 → 資産の推移。数字は計算の結果から", () => {
    expect(m.steps.map((s) => s.key)).toEqual(["income", "pension", "expense", "education", "housing", "assets"]);
    const text = (i: number) => m.steps[i]!.sentence.map((p) => p.text).join("");
    const pension2047 = sumByYear(r.table, (c) => under(c.row, "cf.income.pension")).get(2047)!;
    expect(text(1)).toBe(`ご主人が65歳からは、年金が 年${Math.round(pension2047 / 10000).toLocaleString("en-US")}万円入ります（2047年の世帯の合計）`);
    // ○歳時点の資産は出さない（足りるかどうかだけ）
    expect(text(5)).toBe("その結果、100歳まで資産が足ります");
    expect(text(3)).toMatch(/^教育費がかかるのは\d{4}〜\d{4}年/);
    expect(text(4)).toContain("住宅ローンの返済は");
  });

  it("FPの内部の情報（メモ・物の ID）を含まない（0016 の2）", () => {
    const json = JSON.stringify(m);
    expect(json).not.toContain("MEMO-MARK-plans");
    for (const x of wh.request.input.household.members) expect(json).not.toContain(x.id);
    const html = renderToString(h(ExplainBar, { model: m, step: 2, onStep: () => undefined, onClose: () => undefined }));
    expect(html).toContain("3 / 6");
    expect(html).toContain("次へ");
    expect(html).not.toContain("MEMO-MARK-plans");
  });
});
