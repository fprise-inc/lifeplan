// 収益不動産を持つ見本の世帯（見本 3-4-05。架空）で、0128 の直し: キャッシュフロー表の「不動産の売却」の行、収益不動産のタブの
// 「年ごとの手残りとローン残高」のグラフ、売る年を変えた比較の行からその売り方のプランを作る
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { EngineRequest, TableCell } from "../src/engine/types.ts";
import type { RentalPropertyViewModel, RentalTotalViewModel } from "../src/presentation/model.ts";
import { RentalChart, RentalChartLegend } from "../src/presentation/RentalChart.tsx";
import { DEMO_HOUSEHOLDS, type DemoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { diffRows, planView } from "../src/workspace/plans/planEdit.ts";
import { savePlan } from "../src/workspace/plans/plans.ts";
import { cashflowTable, displayYears, eventsOf, flowChart, propertyEvents, propertySaleCell, rowDefs } from "../src/workspace/present.ts";
import { recordSaleVariant, rentalPropertyName, rentalTabModel, salePlanName, saleVariantOf } from "../src/workspace/rentalTab.ts";
import { modelHousehold, preview } from "./helpers.ts";

const ID = "rentalSample";
const HEIGHTS = "a9a0f9af-56d3-4123-af5a-c0969d2fb9f8";
const CONDO = "b12f8ccc-3fed-483a-bf0e-3cfbe55177ed";
const req = modelHousehold(ID);
const r = preview(req);
const years = displayYears(req);
const sumIn = (t: readonly TableCell[], y: number, p: (c: TableCell) => boolean) => t.reduce((s, c) => (c.year === y && p(c) ? s + c.amount : s), 0);
const SALE = "cf.income.lumpSum.realEstateSale";

/** 見本の物件の売却の予定を外した世帯 */
function withoutSale(rq: EngineRequest): EngineRequest {
  const out = structuredClone(rq);
  for (const a of out.input.household.accounts ?? []) if (a.property !== undefined) delete (a.property as { sale?: unknown }).sale;
  return out;
}

describe("キャッシュフロー表の「不動産の売却」の行", () => {
  const defs = new Map(rowDefs(req).map((d) => [d.key, d]));
  const sum = (key: string, y: number) => sumIn(r.table, y, (defs.get(key) as { match: (c: TableCell) => boolean }).match);

  it("家賃収入のすぐ下にあり、2041年は見本ハイツを売った手取り。その他の収入には入らない", () => {
    const keys = [...defs.keys()];
    expect(keys.indexOf("realEstateSale")).toBe(keys.indexOf("rent") + 1);
    expect(defs.get("realEstateSale")?.label).toBe("不動産の売却");
    const proceeds = sumIn(r.table, 2041, (c) => c.row === SALE && c.object === HEIGHTS);
    expect(proceeds).toBeGreaterThan(50_000_000);
    expect(sum("realEstateSale", 2041)).toBe(proceeds);
    expect(sumIn(r.table, 2041, (c) => (defs.get("incomeOther") as { match: (c: TableCell) => boolean }).match(c) && c.row === SALE)).toBe(0);
  });

  it("収入の行を足すと収入合計のまま（二重に数えない・漏れない）。年間収支も変わらない", () => {
    const parts = [...defs.values()].filter((d) => d.group === "income" && d.kind === "value");
    for (const y of [2029, 2041, 2042]) expect(parts.reduce((s, d) => s + sumIn(r.table, y, d.match), 0)).toBe(sum("incomeTotal", y));
    const t = cashflowTable(req, r.table, years, "表");
    const row = (k: string) => t.rows.find((x) => x.key === k) as { cells: { amount: number | null }[] } | undefined;
    const i = years.indexOf(2041);
    expect(row("realEstateSale")?.cells[i]?.amount).toBe(sum("realEstateSale", 2041));
    expect(row("net")?.cells[i]?.amount).toBe(sumIn(r.table, 2041, (c) => c.row === "cf.net"));
  });

  it("その他の収入の売却の手取りは収益不動産の物件だけを移し、住まいの売却（住まいの物の ID）は残す", () => {
    const isSale = propertySaleCell(req);
    const at = { year: 2041, ym: "2041-10", amount: 1, member: "x" };
    expect(isSale({ ...at, row: SALE, object: HEIGHTS } as TableCell)).toBe(true);
    expect(isSale({ ...at, row: SALE, object: "home-id" } as TableCell)).toBe(false);
    const other = defs.get("incomeOther")!.match;
    expect(other({ ...at, row: SALE, object: "home-id" } as TableCell)).toBe(true);
    expect(other({ ...at, row: SALE, object: HEIGHTS } as TableCell)).toBe(false);
  });

  it("売る予定の物件が無い世帯・収益不動産の無い世帯は、行が増えない", () => {
    expect(rowDefs(withoutSale(req)).map((d) => d.key)).not.toContain("realEstateSale");
    expect(rowDefs(modelHousehold("salariedCoupleTwoKids")).map((d) => d.key)).not.toContain("realEstateSale");
  });

  it("収支の推移の「不動産（家賃・売却）」と同じ額（表とグラフでそろう）", () => {
    const f = flowChart(req, r.table, years, "収支の推移");
    const i = years.indexOf(2041);
    const re = f.income.find((s) => s.key === "realEstateIn")?.values[i];
    expect(re).toBe(sum("rent", 2041) + sum("realEstateSale", 2041));
  });
});

describe("収益不動産のタブの「年ごとの手残りとローン残高」のグラフ", () => {
  const model = (view: string) => rentalTabModel({ req, result: r, ui: { view, year: null }, sale: null, provisional: false })!.view!;

  it("物件ごと: 年は下の表と同じで、棒は税引前・税引後の手残り、線はローン残高。修繕・売却の年に「不」の印", () => {
    const v = model(HEIGHTS) as RentalPropertyViewModel;
    const c = v.chart;
    expect(c.years).toEqual(v.table.rows.map((x) => x.year));
    const a = r.summary as { realEstateAnalysis: { properties: { object: string; years: { year: number; cashBeforeTax: number; cashAfterTax: number; loanBalance: number }[] }[] } };
    const p = a.realEstateAnalysis.properties.find((x) => x.object === HEIGHTS)!;
    const i = c.years.indexOf(2029);
    const y = p.years.find((x) => x.year === 2029)!;
    expect(c.before[i]).toBe(y.cashBeforeTax);
    expect(c.after[i]).toBe(y.cashAfterTax);
    expect(c.loan?.[i]).toBe(y.loanBalance);
    // 大きな修繕の年は手残りがマイナス（棒が0の線より下）
    expect(c.before[i]).toBeLessThan(0);
    expect(c.events.map((e) => [e.year, e.icon])).toEqual([
      [2029, "不"],
      [2036, "不"],
      [2041, "不"],
    ]);
    // 文は結果のタブの出来事と同じ
    const evs = eventsOf(req, r.table, years, r.summary).filter((e) => e.icon === "不").map((e) => e.text);
    for (const e of c.events) expect(evs).toContain(e.text);
    expect(c.axis.length).toBe(2);
  });

  it("ローンの無い区分マンションは線を出さず、出来事も無い", () => {
    const c = (model(CONDO) as RentalPropertyViewModel).chart;
    expect(c.loan).toBeNull();
    expect(c.events).toEqual([]);
    expect(c.years.length).toBeGreaterThan(0);
  });

  it("全体: 全物件の合計の年ごとの表と同じ年で、全物件の出来事", () => {
    const v = model("total") as RentalTotalViewModel;
    expect(v.chart.years).toEqual(v.table.rows.map((x) => x.year));
    expect(v.chart.events.length).toBe(propertyEvents(req, r.table, r.summary).filter((e) => v.chart.years.includes(e.year)).length);
    expect(v.chart.loan).not.toBeNull();
  });

  it("描くと、マイナスの年の棒に印があり、凡例にローン残高・マイナスの年・「不」がある", () => {
    const c = (model(HEIGHTS) as RentalPropertyViewModel).chart;
    const html = renderToString(<RentalChart model={c} selected={2027} onYear={() => undefined} label="年ごとの手残りとローン残高" />);
    expect(html).toContain('data-rental-neg="2029"');
    expect(html).toContain("data-rental-loan");
    expect((html.match(/data-ev="/g) ?? []).length).toBe(3);
    const lg = renderToString(<RentalChartLegend model={c} />);
    for (const t of ["手残り（税引前）", "手残り（税引後）", "ローン残高", "手残りがマイナスの年", "売却・大きな修繕"]) expect(lg).toContain(t);
    const condo = renderToString(<RentalChartLegend model={(model(CONDO) as RentalPropertyViewModel).chart} />);
    expect(condo).not.toContain("ローン残高");
  });
});

describe("売る年を変えた比較の行から、その売り方のプランを作る", () => {
  const demo = DEMO_HOUSEHOLDS.find((d) => d.id === ID) as DemoHousehold;
  const self = req.input.household.members.find((m) => m.kind === "self")!;
  const wh0 = fromRequest(req, { memo: demo.memo });
  const cat = buildCatalog(wh0, self.id, demo);
  const saleOf = (rq: EngineRequest) => (rq.input.household.accounts ?? []).find((a) => a.id === HEIGHTS)?.property?.sale;

  it("今の予定の行はプランにしない。名前は物件名と売り方", () => {
    expect(saleVariantOf(req, HEIGHTS, "planned")).toBeNull();
    const later = saleVariantOf(req, HEIGHTS, "later")!;
    expect(later.ym).toBe("2046-10");
    expect(salePlanName("プランD", rentalPropertyName(req, HEIGHTS), later)).toBe("プランD 見本ハイツ（架空）を2046年10月に売る");
    expect(salePlanName("プランD", rentalPropertyName(req, HEIGHTS), saleVariantOf(req, HEIGHTS, "hold")!)).toBe("プランD 見本ハイツ（架空）を持ち続ける");
  });

  for (const key of ["earlier", "later", "hold"] as const) {
    it(`${key}: 新しいプランは売る年だけが違う差分を持ち、計算は比較の行と同じ。現状は変えない`, () => {
      const v = saleVariantOf(req, HEIGHTS, key)!;
      const s = savePlan(wh0, cat, { name: "テスト", base: null, values: {}, now: "2026-11-06T00:00:00Z" });
      const wh = recordSaleVariant(s.wh, cat, s.id, HEIGHTS, v);
      expect(wh.request).toEqual(wh0.request);
      const view = planView(wh, cat, s.id).request as EngineRequest;
      if (v.ym === null) expect(saleOf(view)).toBeUndefined();
      // 売る年だけが変わる（見本の売却の費用 4% などほかの中身はそのまま）
      else expect(saleOf(view)).toEqual({ ...saleOf(wh0.request), at: { at: v.ym } });
      expect(diffRows(wh, cat, s.id).length).toBeGreaterThan(0);
      // 物件の売り方のほかは現状と同じ
      const strip = (rq: EngineRequest) => {
        const x = structuredClone(rq);
        for (const a of x.input.household.accounts ?? []) if (a.id === HEIGHTS && a.property !== undefined) delete (a.property as { sale?: unknown }).sale;
        return x.input.household;
      };
      expect(strip(view)).toEqual(strip(wh0.request));
      // 計算の結果の最後の金融資産が、今の予定と変わる
      const fin = (rq: EngineRequest) => sumIn(preview(rq).table, rq.input.endYear, (c) => c.row === "cf.balance.financial");
      expect(fin(view)).not.toBe(fin(req));
    });
  }

  it("見ているプラン（土台）の差分を引き継ぐ", () => {
    const p = demo.plans?.[0];
    expect(p).toBeDefined();
    const base = savePlan(wh0, cat, { name: "土台", base: null, values: p!.values, now: "2026-11-06T00:00:00Z" });
    const s = savePlan(base.wh, cat, { name: "テスト", base: base.id, values: {}, now: "2026-11-06T00:00:00Z" });
    const wh = recordSaleVariant(s.wh, cat, s.id, HEIGHTS, saleVariantOf(req, HEIGHTS, "hold")!);
    const view = planView(wh, cat, s.id).request as EngineRequest;
    const baseView = planView(wh, cat, base.id).request as EngineRequest;
    expect(saleOf(view)).toBeUndefined();
    expect(saleOf(baseView)).toEqual(saleOf(req));
    const strip = (rq: EngineRequest) => {
      const x = structuredClone(rq);
      for (const a of x.input.household.accounts ?? []) if (a.id === HEIGHTS && a.property !== undefined) delete (a.property as { sale?: unknown }).sale;
      return x.input;
    };
    expect(strip(view)).toEqual(strip(baseView));
  });
});
