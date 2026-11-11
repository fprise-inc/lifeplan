// 収益不動産の分析の数字（0082）: 結果の画面の収益不動産のタブ（出す・出さない、指標の書き方、民泊・宿、元金の返済が減価償却費を上回る年の印、
// 全体と合計）、売る年を変えた比較（写しの要求の形と、結果からの行）、入力項目の物件の一覧表の利回り・月の手残り、提案書の材料の写しの要求
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { pctText, timesText, type RealEstateAnalysis } from "../../report/src/index.ts";
import type { Account, EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { RentalTab, yearRowScroll } from "../src/presentation/RentalTab.tsx";
import type { RentalPropertyViewModel, RentalTotalViewModel } from "../src/presentation/model.ts";
import { parseHash, TABS, tabsFor } from "../src/workspace/App.tsx";
import { confirmedBox, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { RentalOverview } from "../src/workspace/input/RentalOverview.tsx";
import { rentalProperties } from "../src/workspace/input/stages/rental.ts";
import { CURRENT, planLetters } from "../src/workspace/plans/band.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { effectiveValues, savePlan } from "../src/workspace/plans/plans.ts";
import { DEFAULT_CHAPTERS, planReport, type ReportChoice } from "../src/workspace/report/assemble.ts";
import { analysisOf, hasRentalProperty, man1, monthlyOf, rentalFigures, rentalTabModel, resolveRentalView, saleCompareFrom, saleJobs, type RentalSaleState } from "../src/workspace/rentalTab.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id = "dualAssetsTwoKids"): WorkingHousehold => fromRequest(modelHousehold(id));
const ui = (view: string | null = null, year: number | null = null) => ({ view, year });
const modelOf = (req: EngineRequest, r: PreviewResult, u = ui(), sale: RentalSaleState | null = null) => rentalTabModel({ req, result: r, ui: u, sale, provisional: false })!;
const metric = (v: RentalPropertyViewModel, key: string) => v.metrics.find((m) => m.key === key);

/** 見本の世帯に民泊・宿の物件を1件足す（1泊2万円×稼働率60%×住宅宿泊事業の180日） */
function withLodging(wh: WorkingHousehold): WorkingHousehold {
  return mutate(wh, (hh) => {
    const self = hh.members.find((m) => m.kind === "self")!;
    const a: Account = {
      id: "00000000-0000-4000-8000-00000000a001",
      kind: "realEstate",
      owner: self.id,
      marketValue: confirmedBox(12_000_000),
      asOf: wh.request.input.baseMonth,
      contributions: [],
      property: { name: "海辺の宿", kind: "lodging", structure: "wood", builtYear: 2015, acquisition: { price: 15_000_000, at: "2020-04" }, rental: { monthly: confirmedBox(0) }, lodging: { business: "privateLodging", salesBy: "night", nightly: 20_000, occupancy: "0.6" } },
    };
    hh.accounts!.push(a);
  });
}

describe("収益不動産のタブ: 出す・出さない", () => {
  it("上のタブは「資産と負債」と「万一のとき」の間。物件のある世帯だけ出す", () => {
    expect(TABS.map((t) => t.label)).toEqual(["入力", "結果", "資産と負債", "収益不動産", "万一のとき", "提案書"]);
    const rental = modelHousehold("dualAssetsTwoKids");
    const none = modelHousehold("salariedCoupleTwoKids");
    expect(hasRentalProperty(rental)).toBe(true);
    expect(hasRentalProperty(none)).toBe(false);
    expect(tabsFor(rental).map((t) => t.id)).toEqual(["input", "main", "balance", "rental", "contingency", "report"]);
    expect(tabsFor(none).map((t) => t.id)).toEqual(["input", "main", "balance", "contingency", "report"]);
    expect(tabsFor(null).map((t) => t.id)).not.toContain("rental");
    // 物件の無い世帯ではタブの中身も作らない
    expect(rentalTabModel({ req: none, result: preview(none), ui: ui(), sale: null, provisional: false })).toBeNull();
  });

  it("画面の確かめ用の #: #tab=rental・#rental=total|2・#rentalyear=2034", () => {
    expect(parseHash("#tab=rental&rental=2&rentalyear=2034")).toEqual({ big: false, selfcheck: false, tab: "rental", rental: "2", rentalYear: 2034 });
    expect(parseHash("#rental=total").rental).toBe("total");
    expect(parseHash("#rental=<x>&rentalyear=20").rental).toBeUndefined();
  });
});

describe("収益不動産のタブ: 物件", () => {
  const wh = open();
  const req = wh.request;
  const r = preview(req);
  const a = analysisOf(r)!;
  const p = a.properties[0]!;
  const id = rentalProperties(req.input.household)[0]!.id;

  it("物件が1件なら全体は出さず、その物件。見出しは物件名（種類）と名義・構造・築年・取得", () => {
    const m = modelOf(req, r);
    expect(m.views).toEqual([{ key: id, label: "物件1" }]);
    expect(m.selected).toBe(id);
    const v = m.view as RentalPropertyViewModel;
    expect(v.kind).toBe("property");
    expect(v.title).toBe("物件1");
    expect(v.facts).toEqual([`名義 ${roles(req).find((x) => x.member.id === p.owner)!.label}`, "鉄筋コンクリート造", "2008年築", "2016年3月に取得 2,100万円"]);
  });

  it("指標は表の最初の年（計算基準月が1月でなければ翌年）。率は提案書と同じ書き方、月の手残りは年の額÷貸している月数", () => {
    const v = modelOf(req, r).view as RentalPropertyViewModel;
    expect(v.year).toBe(2027);
    const y = p.years.find((x) => x.year === 2027)!;
    expect(metric(v, "grossYield")!.value).toBe(pctText(y.grossYield));
    expect(metric(v, "grossYield")!.value).toMatch(/^\d+\.\d%$/);
    expect(metric(v, "netYield")!.value).toBe(pctText(y.netYield));
    expect(metric(v, "breakEven")!.label).toBe("損益分岐の入居率");
    expect(metric(v, "dscr")!.value).toBe(timesText(y.dscr));
    expect(metric(v, "dscr")!.value).toMatch(/倍$/);
    expect(metric(v, "ccr")!.value).toBe("—"); // 自己資金を入れていない
    expect(metric(v, "monthlyBefore")!.value).toBe(`${y.cashBeforeTax < 0 ? "▲" : ""}${Math.abs(Math.trunc(y.cashBeforeTax / 12)).toLocaleString("en-US")}円`);
    expect(metric(v, "age")!.value).toBe(`${y.age}年／${y.remainingLife}年`);
    expect(metric(v, "depreciationEnd")!.value).toBe(`${p.depreciationEnd.building}年`);
    // 見本の世帯は計算基準年（計算の最初の年）からもう上回っている（表は翌年から）
    expect(p.deadCross).toBe(2026);
    expect(metric(v, "deadCross")!.value).toBe("もう上回っています");
    expect(metric(v, "occupancy")).toBeUndefined();
    // 説明は「?」の中（どの指標にも説明がある）
    expect(v.metrics.every((m) => m.help.length > 0)).toBe(true);
    // 年を選ぶとその年の指標
    const v34 = modelOf(req, r, ui(null, 2034)).view as RentalPropertyViewModel;
    expect(v34.year).toBe(2034);
    expect(metric(v34, "netYield")!.value).toBe(pctText(p.years.find((x) => x.year === 2034)!.netYield));
    // 表に無い年は既定に戻す
    expect((modelOf(req, r, ui(null, 2026)).view as RentalPropertyViewModel).year).toBe(2027);
  });

  it("年ごとの表: 表の年の並び・万円・大きな修繕は無ければ列を出さない。元金の返済が減価償却費を上回る年の行に印", () => {
    const v = modelOf(req, r).view as RentalPropertyViewModel;
    expect(v.table.columns.map((c) => c.label)).toEqual(["年", "家賃収入", "経費", "減価償却", "利息", "不動産所得", "返済", "手残り（税引前）", "手残り（税引後）", "ローン残高", "評価額"]);
    expect(v.table.rows[0]!.year).toBe(2027);
    expect(v.table.rows.at(-1)!.year).toBe(req.input.endYear);
    const y = p.years.find((x) => x.year === 2027)!;
    expect(v.table.rows[0]!.cells[0]).toBe(man1(y.rent));
    // 見本の世帯は計算基準年（2026年。表の前の年）からもう上回っているので、表の行に印は無く、凡例も出さない（指標の欄に年を出す）
    expect(p.deadCross).toBe(2026);
    expect(v.table.rows.filter((x) => x.deadCross)).toEqual([]);
    expect(renderToString(h(RentalTab, { model: modelOf(req, r), band: null, onView: () => {}, onYear: () => {} }))).not.toContain("data-rental-legend");
    // 借入を小さくして上回る年を表の途中にすると、その年の行に印と凡例
    const w3 = mutate(wh, (hh) => {
      const d = hh.debts!.find((x) => x.property === id)!;
      (d as { balance?: unknown }).balance = { value: 5_500_000, state: "confirmed", origin: { kind: "manual" } };
    });
    const p3 = analysisOf(preview(w3.request))!.properties[0]!;
    const v3 = modelOf(w3.request, preview(w3.request)).view as RentalPropertyViewModel;
    expect(p3.deadCross! > 2027).toBe(true);
    expect(v3.table.rows.filter((x) => x.deadCross).map((x) => x.year)).toEqual([p3.deadCross]);
    const html = renderToString(h(RentalTab, { model: modelOf(w3.request, preview(w3.request)), band: null, onView: () => {}, onYear: () => {} }));
    expect(html).toContain("元金＞償却");
    expect(html).toContain("data-rental-legend");
    expect(html).toContain(`data-year="${p3.deadCross}" data-dead-cross>`);
    // 物件が1件なら見るものの切り替えを出さない
    expect(html).not.toContain("data-rental-view");
  });

  it("選んだ年（#rentalyear・指標の年）の行が表の枠の外なら、その行が枠の真ん中に来るまで枠の中を送る。見えていれば動かさない", () => {
    // 行の高さ 30・貼り付く見出しの行 30・枠の高さ 480
    expect(yearRowScroll(30, 30, 30, 0, 480)).toBeNull(); // 最初の行
    expect(yearRowScroll(450, 30, 30, 0, 480)).toBeNull(); // 枠の下の端にちょうど入る
    // 後ろの年（枠の下に隠れている）: 行の上端−見出し−（見える高さ−行の高さ）÷2
    expect(yearRowScroll(1230, 30, 30, 0, 480)).toBe(1230 - 30 - (480 - 30 - 30) / 2);
    // 送った後に前の年を選んで、見出しの下に隠れている
    expect(yearRowScroll(600, 30, 30, 600, 480)).toBe(600 - 30 - 210);
    // 頭の近くの行は 0 より前に送らない
    expect(yearRowScroll(60, 30, 30, 500, 480)).toBe(0);
    // 表の描き方: 年ごとの表は送り量を測る枠（.rt-years）の中で、行に年の印がある
    const req = modelHousehold("dualAssetsTwoKids");
    const html = renderToString(h(RentalTab, { model: modelOf(req, preview(req), ui(null, 2040)), band: null, onView: () => {}, onYear: () => {} }));
    expect(html).toMatch(/class="rt-scroll rt-years"/);
    expect(html).toMatch(/<tr class="sel"[^>]*data-year="2040"/);
  });

  it("大きな修繕を入れた物件は列を出す", () => {
    const w2 = mutate(wh, (hh) => void (hh.accounts!.find((x) => x.id === id)!.property!.repairs = [{ id: "00000000-0000-4000-8000-00000000b001", at: { at: "2030-06" }, amount: 1_500_000 }]));
    const v = modelOf(w2.request, preview(w2.request)).view as RentalPropertyViewModel;
    const i = v.table.columns.findIndex((c) => c.key === "repairs");
    expect(v.table.columns[i]!.label).toBe("大きな修繕");
    expect(v.table.rows.find((x) => x.year === 2030)!.cells[i - 1]).toBe("150.0");
  });

  it("万円の書き方: 小数1桁・マイナスは「▲」", () => {
    expect(man1(1_077_576)).toBe("107.8");
    expect(man1(-84_756)).toBe("▲8.5");
    expect(man1(-400)).toBe("0.0");
    expect(man1(123_456_789)).toBe("12,345.7");
    expect(monthlyOf(-84_756, 12)).toBe(-7063);
    expect(monthlyOf(1000, 0)).toBeNull();
  });
});

describe("収益不動産のタブ: 民泊・宿と全体", () => {
  const wh = withLodging(open());
  const req = wh.request;
  const r = preview(req);
  const a = analysisOf(r)!;
  const [first, inn] = rentalProperties(req.input.household);

  it("物件が2件以上なら「全体」を先に出し、既定は全体。物件ごとの1行と合計の行・合計の年ごとの表", () => {
    const m = modelOf(req, r);
    expect(m.views.map((x) => x.label)).toEqual(["全体", "物件1", "海辺の宿（民泊・宿）"]);
    expect(m.selected).toBe("total");
    const v = m.view as RentalTotalViewModel;
    expect(v.kind).toBe("total");
    expect(v.year).toBe(2027);
    expect(v.columns.map((c) => c.label)).toEqual(["物件名", "種類", "表面利回り", "実質利回り", "月の手残り（税引前）", "返済比率", "DSCR", "LTV", "ローン残高", "評価額"]);
    expect(v.rows.map((x) => x.cells.slice(0, 2))).toEqual([
      ["物件1", "—"],
      ["海辺の宿", "民泊・宿"],
    ]);
    // 民泊・宿は表面利回りを出さない
    expect(v.rows[1]!.cells[2]).toBe("—");
    const t = a.total.find((x) => x.year === 2027)!;
    expect(v.totalRow.slice(0, 4)).toEqual(["合計（2件）", "", pctText(t.grossYield), pctText(t.netYield)]);
    // 合計の月の手残りは物件の月の手残り（円未満を切り捨てた、行に出す額）の合計
    const ys = a.properties.map((p) => p.years.find((x) => x.year === 2027)!);
    expect(v.totalRow[4]).toBe(`${(() => {
      const s = ys.reduce((acc, y) => acc + Math.trunc(y.cashBeforeTax / y.months), 0);
      return `${s < 0 ? "▲" : ""}${Math.abs(s).toLocaleString("en-US")}`;
    })()}円`);
    expect(v.table.rows[0]!.cells[0]).toBe(man1(t.rent));
    const html = renderToString(h(RentalTab, { model: m, band: null, onView: () => {}, onYear: () => {} }));
    expect(html).toContain("data-rental-view=\"total\"");
    expect(html).toContain("合計（2件）");
  });

  it("全体の月の手残りは、どの年も物件の行の月の手残りを足した額（円未満を物件ごとに切り捨ててから足す。合計の行と1円もずれない）", () => {
    // 円未満の端数が物件ごとに出るよう、駐車場の物件を足す（月 60,001円・年の経費 120,005円）
    const more = mutate(wh, (hh) => {
      const self = hh.members.find((m) => m.kind === "self")!;
      hh.accounts!.push({
        id: "00000000-0000-4000-8000-00000000a002",
        kind: "realEstate",
        owner: self.id,
        marketValue: confirmedBox(5_000_000),
        asOf: wh.request.input.baseMonth,
        contributions: [],
        property: { name: "月極の駐車場", kind: "parking", rental: { monthly: confirmedBox(60_001) }, expenses: { annual: confirmedBox(120_005) } },
      } as Account);
    });
    const rq = more.request;
    const an = analysisOf(preview(rq))!;
    const parse = (s: string) => (s === "—" ? null : (s.startsWith("▲") ? -1 : 1) * Number(s.replace(/[▲,円]/g, "")));
    let fractional = 0;
    for (const t of an.total) {
      const m = rentalTabModel({ req: rq, result: preview(rq), ui: ui("total", t.year), sale: null, provisional: false })!;
      const v = m.view as RentalTotalViewModel;
      if (v.year !== t.year) continue;
      const rows = v.rows.map((x) => parse(x.cells[4]!)).filter((x): x is number => x !== null);
      if (rows.length === 0) continue;
      expect(parse(v.totalRow[4]!), `${t.year}年`).toBe(rows.reduce((s, x) => s + x, 0));
      // 端数を足してから切り捨てると1円ずれる年がある（この見本の世帯で確かめになっていること）
      const raw = an.properties.map((p) => p.years.find((y) => y.year === t.year)).filter((y) => y !== undefined && y.months > 0).map((y) => y!.cashBeforeTax / y!.months);
      if (Math.trunc(raw.reduce((s, x) => s + x, 0)) !== rows.reduce((s, x) => s + x, 0)) fractional++;
    }
    expect(fractional).toBeGreaterThan(0);
    // 入力項目の一覧表の合計の行も同じ
    const f = rentalFigures(rq, an)!;
    expect(f.total.monthly).toBe([...f.byObject.values()].reduce((s, x) => s + (x.monthly ?? 0), 0));
  });

  it("民泊・宿は表面利回りの代わりに稼働率・1泊の単価・営業日数・年の売上。損益分岐は稼働率", () => {
    expect(resolveRentalView(a, "2")).toBe(inn!.id);
    expect(resolveRentalView(a, "9")).toBe("total");
    expect(resolveRentalView(a, first!.id)).toBe(first!.id);
    const v = modelOf(req, r, ui("2")).view as RentalPropertyViewModel;
    expect(v.title).toBe("海辺の宿（民泊・宿）");
    expect(metric(v, "grossYield")).toBeUndefined();
    expect(metric(v, "occupancy")!.value).toBe("60.0%");
    expect(metric(v, "nightly")!.value).toBe("20,000円");
    expect(metric(v, "days")!.value).toBe("180日");
    expect(metric(v, "sales")!.value).toBe(`${man1(Math.floor(Math.floor(20_000 * 0.6) * 180))}万円`);
    expect(metric(v, "breakEven")!.label).toBe("損益分岐の稼働率");
    expect(v.table.columns[1]!.label).toBe("売上");
    expect(v.table.columns.map((c) => c.label)).toContain("所得");
  });
});

describe("売る年を変えた比較", () => {
  const wh = open();
  const req = wh.request;
  const r = preview(req);
  const id = rentalProperties(req.input.household)[0]!.id;
  const saleOf = (q: EngineRequest) => (q.input.household.accounts ?? []).find((x) => x.id === id)!.property!.sale;

  it("売る予定が無ければ「持ち続ける（今の予定）・5年後・10年後」。今の予定は写しを作らず、ほかは売る年だけを変えた写し", () => {
    const j = saleJobs(req, id)!;
    expect(j.variants.map((v) => v.label)).toEqual(["持ち続ける（今の予定）", "2031年10月に売る（5年後）", "2036年10月に売る（10年後）"]);
    expect(j.requests[0]).toBeNull();
    expect(saleOf(j.requests[1]!)).toEqual({ at: { at: "2031-10" } });
    expect(saleOf(j.requests[2]!)).toEqual({ at: { at: "2036-10" } });
    // 世帯の物は変えない
    expect(saleOf(req)).toBeUndefined();
    // ほかの所は同じ
    const strip = (q: EngineRequest) => JSON.stringify(mutate(fromRequest(q), (hh) => void delete hh.accounts!.find((x) => x.id === id)!.property!.sale).request);
    expect(strip(j.requests[1]!)).toBe(strip(req));
  });

  it("結果からの行: 税引後の手取り・表の最後の年の金融資産・今の予定との差・物件の評価額−ローン残高。画面の値は万円", () => {
    const j = saleJobs(req, id)!;
    const results = j.requests.map((q) => (q === null ? null : preview(q)));
    const c = saleCompareFrom(req, id, j.variants, results, r)!;
    expect(c.endYear).toBe(req.input.endYear);
    expect(c.rows.map((x) => x.key)).toEqual(["hold", "in5", "in10"]);
    const hold = c.rows[0]!;
    expect(hold).toMatchObject({ current: true, net: null, diff: 0 });
    expect(hold.equityEnd).not.toBeNull();
    const in5 = c.rows[1]!;
    const exit = analysisOf(results[1]!)!.properties[0]!.exit!;
    expect(in5.net).toBe(exit.net);
    expect(exit.ym).toBe("2031-10");
    expect(in5.equityEnd).toBeNull();
    expect(in5.diff).toBe(in5.financialEnd - hold.financialEnd);
    const v = modelOf(req, r, ui(), { object: id, status: "ready", compare: c }).view as RentalPropertyViewModel;
    expect(v.sale).toMatchObject({ status: "ready", endYear: req.input.endYear });
    if (v.sale?.status !== "ready") throw new Error("no sale");
    expect(v.sale.rows[0]).toMatchObject({ label: "持ち続ける（今の予定）", current: true, net: "—", diff: "—" });
    expect(v.sale.rows[1]!.net).toBe(`${man1(exit.net)}万円`);
    expect(v.sale.rows[1]!.diff).toMatch(/^[+▲±][\d,]+\.\d万円$/);
    const html = renderToString(h(RentalTab, { model: modelOf(req, r, ui(), { object: id, status: "ready", compare: c }), band: null, onView: () => {}, onYear: () => {} }));
    expect(html).toContain("売る年を変えた比較");
    expect(html).toContain(`${req.input.endYear}年の金融資産`);
    // 初めて求めている間
    const loading = renderToString(h(RentalTab, { model: modelOf(req, r, ui(), { object: id, status: "loading" }), band: null, onView: () => {}, onYear: () => {} }));
    expect(loading).toContain("計算しています…");
    // 別の物件の比較は出さない
    expect((modelOf(req, r, ui(), { object: "other", status: "loading" }).view as RentalPropertyViewModel).sale).toBeNull();
  });

  it("売る予定があれば「5年前・今の予定・5年後・持ち続ける」。今の予定の行はプランの結果", () => {
    const w2 = mutate(wh, (hh) => void (hh.accounts!.find((x) => x.id === id)!.property!.sale = { at: { at: "2040-06" } }));
    const j = saleJobs(w2.request, id)!;
    expect(j.variants.map((v) => [v.key, v.current])).toEqual([
      ["earlier", false],
      ["planned", true],
      ["later", false],
      ["hold", false],
    ]);
    expect(j.requests[1]).toBeNull();
    expect(saleOf(j.requests[3]!)).toBeUndefined();
  });
});

describe("入力項目の物件の一覧表: 表面利回り・実質利回り・月の手残り（税引前）", () => {
  it("計算の結果の表の最初の年の数字。合計の行は全物件の合計", () => {
    const wh = withLodging(open());
    const r = preview(wh.request);
    const a = analysisOf(r) as RealEstateAnalysis;
    const f = rentalFigures(wh.request, a)!;
    expect(f.year).toBe(2027);
    const [first, inn] = rentalProperties(wh.request.input.household);
    const y = a.properties[0]!.years.find((x) => x.year === 2027)!;
    expect(f.byObject.get(first!.id)).toEqual({ grossYield: pctText(y.grossYield), netYield: pctText(y.netYield), monthly: Math.trunc(y.cashBeforeTax / y.months) });
    expect(f.byObject.get(inn!.id)!.grossYield).toBe("—");
    const t = a.total.find((x) => x.year === 2027)!;
    expect(f.total.grossYield).toBe(pctText(t.grossYield));
    const html = renderToString(h(RentalOverview, { wh, figures: f }));
    for (const s of ["表面利回り", "実質利回り", "月の手残り（税引前）", pctText(y.grossYield), pctText(t.netYield)]) expect(html).toContain(s);
    expect(html).not.toContain("計算しています…");
    // 求めている間・計算の道が無いときは「—」
    const loading = renderToString(h(RentalOverview, { wh, figures: "loading" }));
    expect(loading).toContain("計算しています…");
    expect(loading).not.toContain(pctText(y.grossYield));
    expect(renderToString(h(RentalOverview, { wh }))).toContain("data-rental-gross=\"true\">—<");
    // 物件が1件でも合計の行は出す
    expect(renderToString(h(RentalOverview, { wh: open() }))).toContain("data-rental-total");
  });
});

describe("提案書の材料: 収益不動産のまとめの売る年の比較", () => {
  function openPlan(id: string) {
    const req = modelHousehold(id);
    const self = roles(req).find((x) => x.key === "self")!.member;
    let wh = fromRequest(req);
    const cat = buildCatalog(wh, self.id, null);
    const living = cat.byKey.get("lever:livingMonthly")!.read(wh) as number;
    const b = savePlan(wh, cat, { name: "プランB 生活費", base: null, values: { "lever:livingMonthly": living - 20000 }, now: "2026-10-29T00:00:00.000Z" });
    wh = b.wh;
    const letters = planLetters(wh.proposals);
    const ctx = { wh, catalog: cat, valuesOf: (pid: string) => (pid === CURRENT ? {} : effectiveValues(wh, pid)), letterOf: (pid: string) => letters.get(pid) ?? { letter: "?", name: "" } };
    return { wh, ctx, b: b.id };
  }
  const choice = (o: ReturnType<typeof openPlan>, chapters = DEFAULT_CHAPTERS): ReportChoice => ({ proposal: o.b, compare: [CURRENT, o.b], base: CURRENT, chapters, targetAge: 95, issuedOn: "2026-10-29", preparedBy: "" });

  it("章を載せるときだけ、物件ごとに今の予定でない売り方の写しの要求を足し、bundle の rentalSale に入れる（今の予定は提案の計算）", () => {
    expect(DEFAULT_CHAPTERS).toContain("rental");
    const o = openPlan("dualAssetsTwoKids");
    const id = rentalProperties(o.wh.request.input.household)[0]!.id;
    const plan = planReport(o.ctx, choice(o));
    const keys = Object.keys(plan.requests).filter((k) => k.startsWith("rentalSale:"));
    expect(keys).toEqual([`rentalSale:${id}:in5`, `rentalSale:${id}:in10`]);
    const sale = (q: EngineRequest) => (q.input.household.accounts ?? []).find((x) => x.id === id)!.property!.sale;
    expect(sale(plan.requests[`rentalSale:${id}:in5`]!)).toEqual({ at: { at: "2031-10" } });
    // 写しは提案の要求から（打ち手が当たっている）
    expect(sale(plan.requests.proposal!)).toBeUndefined();
    const strip = (q: EngineRequest) => JSON.stringify(mutate(fromRequest(q), (hh) => void delete hh.accounts!.find((x) => x.id === id)!.property!.sale).request.input.household.expenses);
    expect(strip(plan.requests[`rentalSale:${id}:in5`]!)).toBe(strip(plan.requests.proposal!));
    const results = Object.fromEntries(Object.entries(plan.requests).map(([k, q]) => [k, preview(q)]));
    const b = plan.bundle(results);
    expect(b.rentalSale).toHaveLength(1);
    const rs = b.rentalSale![0]!;
    expect(rs.object).toBe(id);
    expect(rs.variants.map((v) => v.variant.key)).toEqual(["hold", "in5", "in10"]);
    expect(rs.variants[0]!.run).toBe(b.proposal);
    expect(rs.variants[1]!.run.result).toBe(results[`rentalSale:${id}:in5`]);
    // 章を外せば入らない
    const off = planReport(o.ctx, choice(o, DEFAULT_CHAPTERS.filter((c) => c !== "rental")));
    expect(Object.keys(off.requests).some((k) => k.startsWith("rentalSale:"))).toBe(false);
    expect(off.bundle(results).rentalSale).toBeUndefined();
  });

  it("収益不動産の無い世帯の要求は、章を載せても外しても同じ", () => {
    const o = openPlan("salariedCoupleTwoKids");
    const on = planReport(o.ctx, choice(o));
    const off = planReport(o.ctx, choice(o, DEFAULT_CHAPTERS.filter((c) => c !== "rental")));
    expect(Object.keys(on.requests)).toEqual(Object.keys(off.requests));
    expect(Object.keys(on.requests).some((k) => k.startsWith("rentalSale:"))).toBe(false);
  });
});
