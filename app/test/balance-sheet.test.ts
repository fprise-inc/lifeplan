// 全資産・全負債のバランスシート: 資産と負債の推移の系列（不動産・その他の資産を含む）、その年のバランスシートの表、入力の画面の持ち家の評価・売却・その他の資産
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { EngineRequest } from "../src/engine/types.ts";
import { BalanceSheet, sheetAt } from "../src/presentation/BalanceSheet.tsx";
import { MainLegend, type MainChartModel } from "../src/presentation/MainChart.tsx";
import { ResultCard } from "../src/presentation/MainView.tsx";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { balanceChart, displayYears, financialOf, sumByYear, toPresentation } from "../src/workspace/present.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;
const sumRows = (r: { table: { row: string; year: number; amount: number }[] }, rows: string[], y: number) => r.table.filter((c) => c.year === y && rows.includes(c.row)).reduce((s, c) => s + c.amount, 0);

describe("資産と負債の推移（全資産・全負債）", () => {
  const req = modelHousehold("salariedCoupleTwoKids");
  const r = preview(req);
  const years = displayYears(req);
  const b = balanceChart(r.table, years, years.map(() => null), "資産と負債");

  it("持ち家の評価額が不動産に入り、純資産に含まれる（建物が減るので評価額は下がっていく）", () => {
    const re = b.assets.find((x) => x.key === "realEstate")!;
    expect(re.group).toBe("realEstate");
    expect(re.values[0]).toBeGreaterThan(20000000);
    expect(re.values[20]!).toBeLessThan(re.values[0]!);
    const fin = financialOf(r.table);
    years.forEach((y, i) => {
      const debt = sumByYear(r.table, (c) => c.row.startsWith("cf.balance.debt."));
      expect(b.netWorth[i]).toBe((fin.get(y) ?? 0) + re.values[i]! + b.assets.find((x) => x.key === "otherAsset")!.values[i]! - (debt.get(y) ?? 0));
    });
  });

  it("その年のバランスシート: 資産の合計＝負債の合計＋純資産、純資産はグラフの線と同じ", () => {
    for (const i of [0, 10, 30, years.length - 1]) {
      const s = sheetAt(b, i);
      expect(s.totalAssets).toBe(s.totalLiabilities + s.netWorth);
      expect(s.netWorth).toBe(b.netWorth[i]);
      const fin = s.assets.find((x) => x.key === "financial")!;
      expect(fin.amount).toBe(s.assets.filter((x) => x.sub === true).reduce((a, x) => a + x.amount, 0));
      expect(s.assets.find((x) => x.key === "realEstate")!.amount).toBe(sumRows(r, ["cf.balance.account.realEstate"], years[i]!));
      expect(s.liabilities.find((x) => x.key === "mortgage")?.amount ?? 0).toBe(sumRows(r, ["cf.balance.debt.mortgage", "cf.balance.debt.unpaidInterest"], years[i]!));
    }
  });

  it("預金の不足は負債の側に出し、それでも資産の合計＝負債の合計＋純資産", () => {
    const neg = { ...b, assets: b.assets.map((x) => (x.key === "deposit" ? { ...x, values: x.values.map(() => 0) } : x)), shortfall: b.shortfall.map(() => -3000000), netWorth: b.netWorth };
    const i = 3;
    const s = sheetAt(neg, i);
    expect(s.liabilities.find((x) => x.key === "short")?.amount).toBe(3000000);
    expect(s.totalAssets).toBe(s.totalLiabilities + s.netWorth);
  });

  it("グラフの下にその年のバランスシート（左に資産、右に負債と純資産）。左右に並べる表示では基準と選んだ案の2つ", () => {
    const m: MainChartModel = toPresentation({ base: req, proposal: req, current: r, proposed: r, targetAge: 95, selectedYear: 2035, provisional: false, names: { selected: "プランB", base: "プランA", same: false } });
    const props = { model: m, verdict: (m as unknown as { result: never }).result, provisional: false, mode: "balance" as const, onMode: noop, explain: null, onExplain: noop, ageMark: null, onSelectYear: noop };
    const one = renderToString(h(ResultCard, { ...props, layout: "overlay", pinnedYear: 2040 }));
    expect(one).toContain('data-balance-sheet="2040"');
    expect(one).toContain("2040年（");
    expect(one).toContain("負債と純資産の合計");
    expect(one).toContain('data-bs-item="realEstate"');
    expect(one.match(/data-bs-plan=/g)).toHaveLength(1);
    const two = renderToString(h(ResultCard, { ...props, layout: "side", pinnedYear: null }));
    expect(two).toContain('data-balance-sheet="2035"');
    expect(two.match(/data-bs-plan=/g)).toHaveLength(2);
    expect(two).toContain("グラフで年をクリックすると");
    // 資産の推移・収支の推移・説明モードでは出さない
    expect(renderToString(h(ResultCard, { ...props, mode: "assets", layout: "overlay", pinnedYear: 2040 }))).not.toContain("data-balance-sheet");
    // 凡例: 不動産・その他の資産の系列と、不動産を含む純資産
    const lg = renderToString(h(MainLegend, { model: m, mode: "balance", explain: null }));
    expect(lg).toContain("不動産");
    expect(lg).toContain("純資産（不動産を含む）");
  });

  it("表の部品だけでも描ける（年が範囲の外なら何も出さない）", () => {
    expect(renderToString(h(BalanceSheet, { panes: [{ name: "プランA", tag: null, model: b }], year: 1999, head: "1999年", pinned: false }))).toBe("");
  });
});

describe("入力の画面: 持ち家の評価・売却・その他の資産", () => {
  const fieldsOf = (wh: WorkingHousehold, stage: "housing" | "savings" | "assumptions") => allFields(buildStage(stage, wh));
  const byKey = (fs: FieldDef[], suffix: string) => fs.find((f) => f.key.endsWith(suffix));

  it("今住んでいる持ち家: 評価額・構造・建った年を入れると、計算エンジンの評価に入る", () => {
    const req = modelHousehold("pairLoan");
    let wh = fromRequest(req);
    const fs = fieldsOf(wh, "housing");
    const value = byKey(fs, "/valuation/value")!;
    expect(value.level).toBe("simple");
    wh = value.set(wh, 30000000);
    wh = byKey(fieldsOf(wh, "housing"), "/valuation/structure")!.set(wh, "rc");
    wh = byKey(fieldsOf(wh, "housing"), "/valuation/builtYear")!.set(wh, 2015);
    const res = (wh.request.input.household.residences ?? []).find((x) => x.kind === "own")!;
    expect(res.valuation).toMatchObject({ value: { value: 30000000, state: "confirmed" }, structure: "rc", builtYear: 2015 });
    const r = preview(wh.request);
    expect(sumRows(r, ["cf.balance.account.realEstate"], 2030)).toBeGreaterThan(20000000);
    // 構造を既定（木造）に戻すと欄ごと消える
    wh = byKey(fieldsOf(wh, "housing"), "/valuation/structure")!.set(wh, "wood");
    expect((wh.request.input.household.residences ?? []).find((x) => x.kind === "own")!.valuation?.structure).toBeUndefined();
  });

  it("住み終わりがある持ち家だけ「売る」が出て、売ると売却の欄が出る", () => {
    const req = modelHousehold("salariedCoupleTwoKids") as EngineRequest;
    let wh = fromRequest(req);
    expect(byKey(fieldsOf(wh, "housing"), "/sale/on")).toBeUndefined();
    wh = byKey(fieldsOf(wh, "housing"), "/to")!.set(wh, "2050-03");
    const on = byKey(fieldsOf(wh, "housing"), "/sale/on")!;
    expect(on.get(wh).value).toBe(false);
    wh = on.set(wh, true);
    expect(byKey(fieldsOf(wh, "housing"), "/sale/price")).toBeDefined();
    expect(byKey(fieldsOf(wh, "housing"), "/sale/cost")!.get(wh)).toMatchObject({ value: "0.04", implicit: true });
    const r = preview(wh.request);
    expect(sumRows(r, ["cf.income.lumpSum.realEstateSale"], 2050)).toBeGreaterThan(0);
    expect(sumRows(r, ["cf.balance.account.realEstate"], 2050)).toBe(0);
    wh = byKey(fieldsOf(wh, "housing"), "/sale/on")!.set(wh, false);
    expect((wh.request.input.household.residences ?? []).find((x) => x.kind === "own")!.sale).toBeUndefined();
  });

  it("貯蓄・運用に「不動産（住まい以外）・その他の資産」。増減率を入れられ、金融資産には入らない", () => {
    let wh = fromRequest(modelHousehold("single45"));
    const stage = buildStage("savings", wh);
    const sec = stage.sections.find((s) => s.key === "sav/others")!;
    wh = sec.actions.find((a) => a.key === "sav/add/otherAsset")!.run(wh);
    const acc = (wh.request.input.household.accounts ?? []).find((a) => a.kind === "otherAsset")!;
    const fs = fieldsOf(wh, "savings");
    wh = fs.find((f) => f.key === `sav/${acc.id}/value`)!.set(wh, 2000000);
    wh = fs.find((f) => f.key === `sav/${acc.id}/growth`)!.set(wh, "-0.05");
    const r = preview(wh.request);
    const y = displayYears(wh.request)[0]!;
    expect(sumRows(r, ["cf.balance.account.otherAsset"], y)).toBeLessThan(2000000);
    expect(sumRows(r, ["cf.balance.account.otherAsset"], y)).toBeGreaterThan(1700000);
    // 金融資産の欄の一覧には出ない
    expect(buildStage("savings", wh).sections.find((s) => s.key === "sav/accounts")!.groups.some((g) => g.key === `sav/${acc.id}`)).toBe(false);
  });

  it("前提条件: 持ち家の評価の前提（空欄は目安）", () => {
    let wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const fs = fieldsOf(wh, "assumptions");
    expect(byKey(fs, "realEstate/life/wood")!.get(wh)).toMatchObject({ value: 22, implicit: true });
    wh = byKey(fs, "realEstate/floor")!.set(wh, "0.1");
    expect(wh.request.input.assumptions?.realEstateValuation).toEqual({ residualFloor: "0.1" });
    wh = byKey(fieldsOf(wh, "assumptions"), "realEstate/floor")!.set(wh, null);
    expect(wh.request.input.assumptions?.realEstateValuation).toBeUndefined();
  });
});
