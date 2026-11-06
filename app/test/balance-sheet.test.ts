// 全資産・全負債のバランスシート: 資産と負債のタブ（4つの分け方・資産の合計＝負債の合計＋純資産・家計の体力の目安・前回と比べる・縮尺）、
// 結果のタブから資産と負債の推移を外したこと、入力の画面の持ち家の評価・売却・その他の資産
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { EngineRequest } from "../src/engine/types.ts";
import { BalanceTab } from "../src/presentation/BalanceTab.tsx";
import { resolveColumns } from "../src/presentation/bsColumns.ts";
import { BsFigure } from "../src/presentation/BsFigure.tsx";
import { allocHeights, columnTotal, figureBoxes, healthOf, scaleFor, spreadLabels, tickStep } from "../src/presentation/bsLayout.ts";
import { trendRange } from "../src/presentation/BsTrend.tsx";
import { CHART_MODES, type MainChartModel } from "../src/presentation/MainChart.tsx";
import { ResultCard } from "../src/presentation/MainView.tsx";
import type { BsYearModel } from "../src/presentation/model.ts";
import { bsSeries } from "../../report/src/index.ts";
import { agoText, balanceTabModel, bsPlan, bsPrev, bsYears, DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS, prevItems, readBsGuide, snapshotHasBalance } from "../src/workspace/balanceTab.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { displayYears, financialOf, rowDefs as rowDefsOf, sumByYear, toPresentation } from "../src/workspace/present.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;
/** 行（とその下の行。不動産は土地と建物の行に分けて出る）の合計 */
const sumRows = (r: { table: { row: string; year: number; amount: number }[] }, rows: string[], y: number) => r.table.filter((c) => c.year === y && rows.some((x) => c.row === x || c.row.startsWith(`${x}.`))).reduce((s, c) => s + c.amount, 0);
const grp = (y: BsYearModel, g: string) => y.lines.filter((l) => l.group === g).reduce((s, l) => s + l.amount, 0);

describe("バランスシートの分け方（提案書と同じ部品）", () => {
  const cell = (row: string, year: number, amount: number, object?: string) => ({ row, year, amount, ...(object !== undefined ? { object } : {}) });
  const table = [
    cell("cf.balance.account.deposit", 2026, 5_000_000),
    cell("cf.balance.account.zaikei", 2026, 1_000_000),
    cell("cf.balance.account.nisa", 2026, 2_000_000),
    cell("cf.balance.account.legacyNisa", 2026, 300_000),
    cell("cf.balance.account.taxable", 2026, 800_000),
    cell("cf.balance.account.pooled", 2026, 400_000),
    cell("cf.balance.account.ideco", 2026, 900_000),
    cell("cf.balance.account.corporateDc", 2026, 2_100_000),
    cell("cf.balance.account.realEstate.land", 2026, 10_000_000, "home1"),
    cell("cf.balance.account.realEstate.building", 2026, 18_000_000, "home1"),
    cell("cf.balance.account.realEstate.land", 2026, 2_000_000, "rental"),
    cell("cf.balance.account.realEstate.building", 2026, 6_000_000, "rental"),
    cell("cf.balance.account.realEstate", 2026, 10_000_000, "flat"),
    cell("cf.balance.account.car", 2026, 1_500_000, "car1"),
    cell("cf.balance.account.insurance", 2026, 600_000),
    cell("cf.balance.debt.mortgage", 2026, 24_000_000, "loan1"),
    cell("cf.balance.debt.unpaidInterest", 2026, 10_000, "loan1"),
    cell("cf.balance.debt.other", 2026, 800_000, "cl"),
    cell("cf.balance.debt.other", 2026, 500_000, "sch"),
    cell("cf.balance.debt.other", 2026, 4_000_000, "rentalLoan"),
    // 2027年: 預金がマイナス（資金の不足）
    cell("cf.balance.account.deposit", 2027, -3_000_000),
    cell("cf.balance.account.realEstate.land", 2027, 10_000_000, "home1"),
    cell("cf.balance.account.realEstate.building", 2027, 17_000_000, "home1"),
  ];
  const hh = { residences: [{ id: "home1" }], debts: [{ id: "loan1", kind: "mortgage" }, { id: "cl", kind: "car" }, { id: "sch", kind: "scholarship" }, { id: "rentalLoan", kind: "other", property: "rental" }] };
  const [a, b] = bsSeries(table, [2026, 2027], hh);

  it("資産を4つ（すぐ使える・値動きあり・引き出せない・換金しにくい）に、負債を住宅ローンとその他に分ける", () => {
    const byKey = Object.fromEntries(a!.lines.map((l) => [l.key, l]));
    expect(byKey.deposit).toMatchObject({ group: "liquid", amount: 5_000_000, label: "預金" });
    expect(byKey.zaikei!.group).toBe("liquid");
    expect(byKey.nisa).toMatchObject({ group: "market", amount: 2_300_000 });
    expect(byKey.taxable!.group).toBe("market");
    expect(byKey.pooled!.group).toBe("market");
    expect(byKey.ideco!.group).toBe("locked");
    expect(byKey.corporateDc!.group).toBe("locked");
    // 不動産は土地と建物に分ける（持ち家と住まい以外の不動産の合計）。分けていない不動産は「その他の不動産」
    expect(byKey.land).toMatchObject({ group: "illiquid", label: "土地", amount: 12_000_000 });
    expect(byKey.building).toMatchObject({ group: "illiquid", label: "建物", amount: 24_000_000 });
    expect(byKey.realEstateOther).toMatchObject({ group: "illiquid", amount: 10_000_000 });
    // 住まい以外の不動産のローンは、分け方も「不動産のローン」（箱の名前と横の見出しをそろえる。0127）
    expect(byKey.propertyLoan).toMatchObject({ group: "propertyLoan", label: "不動産のローン", amount: 4_000_000 });
    expect(byKey.car!.group).toBe("illiquid");
    expect(byKey.insurance).toMatchObject({ group: "illiquid", label: "保険の解約返戻金" });
    expect(byKey.mortgage).toMatchObject({ group: "mortgage", amount: 24_010_000 });
    expect(byKey.carLoan).toMatchObject({ group: "debt", label: "車のローン", amount: 800_000 });
    expect(byKey.scholarship).toMatchObject({ group: "debt", label: "奨学金" });
    expect(a!.financial).toBe(5_000_000 + 1_000_000 + 2_300_000 + 800_000 + 400_000 + 900_000 + 2_100_000);
    expect(a!.totalAssets).toBe(a!.totalLiabilities + a!.netWorth);
  });

  it("金融資産の器のマイナスは資産から外し、負債の側の「資金の不足」に置く（資産の合計＝負債の合計＋純資産）", () => {
    expect(b!.lines.find((l) => l.key === "deposit")).toBeUndefined();
    expect(b!.lines.find((l) => l.key === "short")).toMatchObject({ group: "debt", label: "資金の不足", amount: 3_000_000 });
    expect(b!.shortfall).toBe(3_000_000);
    expect(b!.netWorth).toBe(27_000_000 - 3_000_000);
    expect(b!.lines.filter((l) => l.key === "land" || l.key === "building").map((l) => l.amount)).toEqual([10_000_000, 17_000_000]);
    expect(b!.totalAssets).toBe(b!.totalLiabilities + b!.netWorth);
  });
});

describe("資産と負債のタブ（本物のエンジンの値）", () => {
  const req = modelHousehold("investmentCouple");
  const r = preview(req);
  const p = bsPlan({ key: "A", letter: "A", name: "プランA", title: "現状", base: true, req, table: r.table });

  it("年は計算基準年（今）から表の最後の年まで。今の年だけが事実", () => {
    expect(p.years.map((y) => y.year)).toEqual(bsYears(req));
    expect(p.years[0]!.year).toBe(2026);
    expect(p.years[0]!.fact).toBe(true);
    expect(p.years.slice(1).every((y) => !y.fact)).toBe(true);
    // 結果のタブの表の年（翌年から）より1年多い
    expect(p.years.length).toBe(displayYears(req).length + 1);
  });

  it("どの年も資産の合計＝負債の合計＋純資産。純資産は金融資産＋不動産＋その他の資産−負債", () => {
    const fin = financialOf(r.table);
    const debt = sumByYear(r.table, (c) => c.row.startsWith("cf.balance.debt."));
    for (const y of p.years) {
      expect(y.totalAssets).toBe(y.totalLiabilities + y.netWorth);
      expect(y.lines.reduce((s, l) => s + (l.group === "mortgage" || l.group === "debt" ? 0 : l.amount), 0)).toBe(y.totalAssets);
      const others = sumRows(r, ["cf.balance.account.realEstate", "cf.balance.account.car", "cf.balance.account.insurance", "cf.balance.account.otherAsset"], y.year);
      expect(y.netWorth).toBe((fin.get(y.year) ?? 0) + others - (debt.get(y.year) ?? 0));
      expect(grp(y, "liquid") + grp(y, "market") + grp(y, "locked")).toBe(y.financial);
    }
    const y0 = p.years[0]!;
    expect(grp(y0, "liquid")).toBe(sumRows(r, ["cf.balance.account.deposit"], 2026));
    expect(grp(y0, "market")).toBe(sumRows(r, ["cf.balance.account.nisa", "cf.balance.account.taxable"], 2026));
    expect(grp(y0, "locked")).toBe(sumRows(r, ["cf.balance.account.ideco", "cf.balance.account.corporateDc"], 2026));
    expect(grp(y0, "illiquid")).toBe(sumRows(r, ["cf.balance.account.realEstate"], 2026));
    expect(grp(y0, "mortgage")).toBe(sumRows(r, ["cf.balance.debt.mortgage", "cf.balance.debt.unpaidInterest"], 2026));
  });

  it("今の年の生活費は1年分（計算基準年が年の途中なら翌年の値）。箱の説明・主な年・札がある", () => {
    const y0 = p.years[0]!;
    expect(y0.living).toBe(p.years[1]!.living);
    expect(y0.living).toBeGreaterThan(2_000_000);
    expect(Object.keys(y0.notes).sort()).toEqual(["debt", "illiquid", "liquid", "locked", "market", "mortgage", "neg", "netWorth", "propertyLoan"]);
    expect(p.jumps.map((j) => j.key)).toEqual(["now", "ten", "retire", "age75"]);
    expect(p.marks.some((m) => m.kind === "retire")).toBe(true);
    // ローンを返している年: 元金の分は純資産として残る（箱を押したときの説明）
    expect(y0.notes.mortgage).toContain("元金の分は、純資産として残ります");
    // 物の ID・FP のメモは入らない
    expect(JSON.stringify(p)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("3時点は 今・退職の年・75歳", () => {
    expect(resolveColumns(p, null, DEFAULT_BS_POINTS).map((x) => x.label)).toEqual(["今", "退職の年", "75歳"]);
  });

  it("推移のグラフの目盛りは全部のプランを覆う", () => {
    const rg = trendRange([p]);
    expect(rg.max).toBeGreaterThanOrEqual(Math.max(...p.years.map((y) => y.totalAssets)));
    expect(rg.min).toBeLessThanOrEqual(Math.min(...p.years.map((y) => Math.min(-y.totalLiabilities, y.netWorth))));
  });

  it("見せ方の切り替え: プランが2つ以上なら「プランを比較」（「プランを並べる」とは書かない）", () => {
    const q = bsPlan({ key: "B", letter: "B", name: "プランB", title: "65歳まで働く", base: false, req, table: r.table });
    const model = balanceTabModel({ plans: [p, q], selected: "B", base: "A", guide: DEFAULT_BS_GUIDE, pointDefaults: DEFAULT_BS_POINTS, columns: null, prevChoices: [], prev: { status: "idle", model: null }, provisional: false, who: "ご本人" });
    const html = renderToString(h(BalanceTab, { model, band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop }));
    const i = html.indexOf('data-bs-view="plans"');
    expect(i).toBeGreaterThan(-1);
    expect(html.slice(i, html.indexOf("</button>", i))).toContain(">プランを比較");
    expect(html).not.toContain("プランを並べる");
  });

  it("タブの部品: 図・体力の目安・つまみ・推移のグラフ。控えが無ければ「前回と比べる」は出さない", () => {
    const model = balanceTabModel({ plans: [p], selected: "A", base: "A", guide: DEFAULT_BS_GUIDE, pointDefaults: DEFAULT_BS_POINTS, columns: null, prevChoices: [], prev: { status: "idle", model: null }, provisional: false, who: "ご本人" });
    const html = renderToString(h(BalanceTab, { model, band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop }));
    expect(html).toContain('data-bs-figure="2026"');
    expect(html).toContain("事実（今・入力した値）");
    expect(html).toContain("家計の体力の目安");
    expect(html).toContain("data-bs-range");
    expect(html).toContain("data-bs-trend");
    // カスタマイズで見るものを足していなければ、「見るもの」の切り替えは行ごと出さない（家計のバランスシートだけ）
    expect(html).not.toContain("合算BS");
    expect(html).not.toContain("見るもの");
    expect(html).not.toContain("data-bs-sub");
    expect(html).not.toContain("カスタマイズで追加");
    expect(html).toContain('data-bs-view="three"');
    expect(html).not.toContain('data-bs-view="plans"');
    expect(html).not.toContain('data-bs-view="prev"');
    expect(html).not.toContain("✓ 合っています");
    // 表で見るは既定で閉じる
    expect(html).not.toContain("data-bs-sheet");
    const withPrev = renderToString(h(BalanceTab, { model: { ...model, prevChoices: [{ key: "p1", label: "2025年10月1日の控え（手動）" }] }, band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop, initial: { year: 2046, table: true } }));
    expect(withPrev).toContain('data-bs-view="prev"');
    expect(withPrev).toContain('data-bs-figure="2046"');
    expect(withPrev).toContain("見込み（2046年）");
    expect(withPrev).toContain("data-bs-sheet");
    // 足したものが無ければ、#bsopen=combined で開いても家計のバランスシート
    const opened = renderToString(h(BalanceTab, { model, band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop, initial: { open: "combined" } }));
    expect(opened).toContain('data-bs-figure="2026"');
    expect(opened).not.toContain("data-bs-sub");
  });

  it("カスタマイズで見るもの（例: 合算BS）を足したときだけ、タブの上に「見るもの」の切り替えを出す。押すとその図を共通の縮尺で並べる", () => {
    const base = balanceTabModel({ plans: [p], selected: "A", base: "A", guide: DEFAULT_BS_GUIDE, pointDefaults: DEFAULT_BS_POINTS, columns: null, prevChoices: [], prev: { status: "idle", model: null }, provisional: false, who: "ご本人" });
    const at = p.years[0]!;
    const model = { ...base, customViews: [{ key: "combined", label: "合算BS", columns: [{ name: "会社", at }, { name: "家計", at }, { name: "合算", at }], note: "注記" }] };
    const html = renderToString(h(BalanceTab, { model, band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop }));
    expect(html).toContain("見るもの");
    expect(html).toMatch(/data-bs-sub="home"[^>]*>家計のバランスシート/);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-bs-sub="home"/);
    expect(html).toMatch(/data-bs-sub="combined"[^>]*>合算BS/);
    expect(html).not.toContain("カスタマイズで追加");
    expect(html).toContain('data-bs-figure="2026"');
    const opened = renderToString(h(BalanceTab, { model, band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop, initial: { open: "combined" } }));
    expect(opened).toContain('data-bs-custom="combined"');
    expect(opened).toMatch(/aria-pressed="true"[^>]*data-bs-sub="combined"/);
    expect(opened).not.toContain('id="h-bs"');
  });
});

describe("図の置き方（縮尺・最低限の高さ）", () => {
  it("箱の高さの合計はいつも図の高さ（左右がそろう）。小さい箱は最低限の高さを持ち、そのときは注記の印", () => {
    const { heights, adjusted } = allocHeights([10_000_000, 100_000_000, 500_000, 0], 400, 30);
    expect(heights.reduce((s, x) => s + x, 0)).toBeCloseTo(400, 6);
    expect(heights[2]).toBeCloseTo(30, 6);
    expect(heights[3]).toBe(0);
    expect(adjusted).toBe(true);
    const even = allocHeights([50_000_000, 50_000_000], 400, 30);
    expect(even.heights).toEqual([200, 200]);
    expect(even.adjusted).toBe(false);
    // 30万円より小さい箱は、最低限の高さも額に応じて小さく
    const tiny = allocHeights([100_000_000, 150_000], 400, 30);
    expect(tiny.heights[1]).toBeCloseTo(15, 6);
  });

  it("縮尺: 1年ずつはその年の大きさ、並べるときは並べたものの中のいちばん大きい額", () => {
    const y = (A: number, L: number) => ({ totalAssets: A, totalLiabilities: L, netWorth: A - L });
    expect(scaleFor([y(40_000_000, 25_000_000)])).toBe(40_000_000);
    expect(scaleFor([y(40_000_000, 25_000_000), y(70_000_000, 5_000_000)])).toBe(70_000_000);
    // 純資産がマイナスの年は負債の合計が高さ
    expect(columnTotal(y(26_000_000, 28_000_000))).toBe(28_000_000);
    expect(tickStep(40_000_000, 6)).toBe(10_000_000);
    expect(tickStep(4_000_000, 6)).toBe(1_000_000);
  });

  it("純資産がマイナスの年は、左の下に「純資産のマイナス」、右は負債だけ", () => {
    const lines = [
      { key: "home", label: "持ち家（土地・建物）", group: "illiquid" as const, amount: 26_000_000 },
      { key: "short", label: "資金の不足", group: "debt" as const, amount: 28_000_000 },
    ];
    const { left, right } = figureBoxes({ lines, netWorth: -2_000_000 });
    expect(left.at(-1)).toMatchObject({ key: "neg", value: 2_000_000 });
    expect(left.reduce((s, b) => s + b.value, 0)).toBe(right.reduce((s, b) => s + b.value, 0));
    expect(right.find((b) => b.key === "netWorth")!.value).toBe(0);
  });

  it("引き出し線の札は重ならない", () => {
    const ys = spreadLabels([100, 105, 110, 300], 20, 400, 40);
    const sorted = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(40 - 1e-9);
  });

  it("図の部品だけでも描ける（今は事実の札、先の年は見込みの札。どちらも同じベタ塗りで柱の枠は描かず、色も薄くしない）", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const p = bsPlan({ key: "A", letter: "A", name: "プランA", title: "現状", base: true, req, table: preview(req).table });
    const groups = balanceTabModel({ plans: [p], selected: "A", base: "A", guide: DEFAULT_BS_GUIDE, pointDefaults: DEFAULT_BS_POINTS, columns: null, prevChoices: [], prev: { status: "idle", model: null }, provisional: false, who: "" }).groups;
    const now = renderToString(h(BsFigure, { year: p.years[0]!, groups, height: 560, label: "今" }));
    expect(now).toContain('data-bs-kind="fact"');
    expect(now).toContain("金融資産");
    expect(now).toContain('data-bs-box="netWorth"');
    const later = renderToString(h(BsFigure, { year: p.years[20]!, groups, height: 560, label: "先" }));
    expect(later).toContain('data-bs-kind="est"');
    expect(later).toContain("見込み（");
    // 点線の枠・薄い色は使わない（点線は純資産のマイナスの箱だけ）
    expect(p.years[20]!.netWorth).toBeGreaterThan(0);
    expect(later).not.toContain("stroke-dasharray");
    expect(later).not.toContain("fill-opacity");
  });
});

describe("家計の体力の目安", () => {
  const year = (o: Partial<BsYearModel>): BsYearModel => ({
    year: 2026, age: 45, members: "", fact: true, totalAssets: 0, totalLiabilities: 0, netWorth: 0, financial: 0, shortfall: 0, living: 3_600_000, loanPay: 0, guarantee: 0, events: [], notes: {}, lines: [], ...o,
  });
  const y = year({
    lines: [
      { key: "deposit", label: "預金", group: "liquid", amount: 2_400_000 },
      { key: "nisa", label: "NISA", group: "market", amount: 3_000_000 },
      { key: "home", label: "持ち家", group: "illiquid", amount: 16_000_000 },
      { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 12_000_000 },
    ],
    totalAssets: 21_400_000,
    totalLiabilities: 12_000_000,
    netWorth: 9_400_000,
  });

  it("すぐ使えるお金が生活費の何か月分か・値動きのある資産の割合・負債の重さ（負債÷資産）", () => {
    const hl = healthOf(y, DEFAULT_BS_GUIDE);
    expect(hl.months.value).toBeCloseTo(8, 6);
    expect(hl.months.tone).toBe("in");
    expect(hl.risk.value).toBeCloseTo((3_000_000 / 21_400_000) * 100, 6);
    expect(hl.risk.tone).toBe("in");
    expect(hl.debt.value).toBeCloseTo((12_000_000 / 21_400_000) * 100, 6);
    expect(hl.debt.tone).toBe("high");
    expect(hl.debt.text.map((t) => t.text).join("")).toBe("目安（50%未満）より重めです。ローンの返済とともに軽くなっていきます。");
    // 赤で煽らない言葉（「危険」「赤字」などを使わない）
    expect(JSON.stringify(hl)).not.toMatch(/危険|赤字|要注意/);
  });

  it("目安の幅は事務所の設定で変えられる（最初の値は 6〜12か月分・10〜40%・50%未満）", () => {
    expect(DEFAULT_BS_GUIDE).toEqual({ months: [6, 12], risk: [10, 40], debt: 50 });
    const hl = healthOf(y, { months: [9, 24], risk: [20, 60], debt: 70 });
    expect(hl.months.tone).toBe("low");
    expect(hl.months.text.map((t) => t.text).join("")).toContain("目安（9〜24か月分）より少なめ");
    expect(hl.risk.tone).toBe("low");
    expect(hl.debt.tone).toBe("in");
    expect(readBsGuide({ months: [3, 6], risk: [5, 30], debt: 40 })).toEqual({ months: [3, 6], risk: [5, 30], debt: 40 });
    expect(readBsGuide({ months: [12, 6], debt: 0 })).toEqual(DEFAULT_BS_GUIDE);
    expect(readBsGuide(undefined)).toEqual(DEFAULT_BS_GUIDE);
  });

  it("負債が無い・生活費が無いとき", () => {
    const hl = healthOf(year({ lines: [{ key: "deposit", label: "預金", group: "liquid", amount: 1_000_000 }], totalAssets: 1_000_000, netWorth: 1_000_000, living: 0 }), DEFAULT_BS_GUIDE);
    expect(hl.months.value).toBeNull();
    expect(hl.debt.text[0]!.text).toBe("負債はありません。");
  });
});

describe("前回と比べる（控え）", () => {
  const req = modelHousehold("salariedCoupleTwoKids");
  const r = preview(req);
  const actualPlan = bsPlan({ key: "A", letter: "A", name: "プランA", title: "現状", base: true, req, table: r.table });
  const actual = actualPlan.years[0]!;

  it("控えで見込んでいた今と今の実際を並べ、純資産の差を1文で。差の大きい項目を出す", () => {
    // 半年前の控え（同じ計算基準年）: 預金が200万円多かった見込み
    const old = structuredClone(req);
    const dep = (old.input.household.accounts ?? []).find((a) => a.kind === "deposit")!;
    dep.marketValue = { ...dep.marketValue!, value: (dep.marketValue?.value ?? 0) + 2_000_000 };
    const pm = bsPrev({ key: "p1", label: "2026年4月1日の控え（手動）", createdAt: "2026-04-01T10:00:00+09:00", baseMonth: req.input.baseMonth, actual, snapshot: { req: old, table: preview(old).table } });
    expect(pm.expected).not.toBeNull();
    expect(pm.expected!.year).toBe(2026);
    expect(pm.expected!.fact).toBe(false);
    expect(pm.ago).toBe("6か月前");
    const d = actual.netWorth - pm.expected!.netWorth;
    expect(d).toBeLessThan(0);
    expect(pm.summary.map((x) => x.text).join("")).toMatch(/^6か月前に見込んでいた今の純資産は[\d,]+万円、今の実際は[\d,]+万円。見込みより純資産が [\d,]+万円 少なくなっています。$/);
    expect(pm.items[0]).toMatch(/^預金が見込みより[\d,]+万円少ない$/);
  });

  it("控えに BS を出せるだけの内容が無いとき・計算できないとき・期間の外のときは理由を出す（今の実際だけ見せる）", () => {
    const empty = structuredClone(req);
    empty.input.household.accounts = [];
    empty.input.household.residences = [];
    empty.input.household.debts = [];
    expect(snapshotHasBalance(empty)).toBe(false);
    expect(snapshotHasBalance(req)).toBe(true);
    const a = bsPrev({ key: "p1", label: "x", createdAt: "2025-10-01T10:00:00+09:00", baseMonth: req.input.baseMonth, actual, snapshot: { req: empty, table: [] } });
    expect(a.expected).toBeNull();
    expect(a.reason).toContain("資産・負債の入力が無い");
    const b = bsPrev({ key: "p1", label: "x", createdAt: "2025-10-01T10:00:00+09:00", baseMonth: req.input.baseMonth, actual, snapshot: { error: "計算できませんでした" } });
    expect(b.reason).toBe("計算できませんでした");
    const short = structuredClone(req);
    short.input.endYear = 2025;
    short.input.baseMonth = "2020-01";
    const c = bsPrev({ key: "p1", label: "x", createdAt: "2020-01-01T10:00:00+09:00", baseMonth: req.input.baseMonth, actual, snapshot: { req: short, table: r.table } });
    expect(c.reason).toContain("2026年が入っていない");
  });

  it("差の項目と「○年前」", () => {
    const y = (lines: BsYearModel["lines"]): BsYearModel => ({ year: 2026, age: null, members: "", fact: false, totalAssets: 0, totalLiabilities: 0, netWorth: 0, financial: 0, shortfall: 0, living: 0, loanPay: 0, guarantee: 0, events: [], notes: {}, lines });
    const items = prevItems(
      y([{ key: "deposit", label: "預金", group: "liquid", amount: 6_900_000 }, { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 24_000_000 }]),
      y([{ key: "deposit", label: "預金", group: "liquid", amount: 5_600_000 }, { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 24_500_000 }, { key: "nisa", label: "NISA", group: "market", amount: 3_000 }]),
    );
    expect(items).toEqual(["預金が見込みより130万円少ない", "住宅ローンが見込みより50万円多い（負債）"]);
    expect(agoText("2024-10-03T10:00:00+09:00", "2026-10")).toBe("2年前");
    expect(agoText("2026-04-03T10:00:00+09:00", "2026-10")).toBe("6か月前");
  });
});

describe("結果のタブ: 資産と負債の推移はタブへ移した", () => {
  it("グラフは資産の推移と収支の推移の2つ。グラフの下のその年のバランスシートの表は出さない", () => {
    expect(CHART_MODES.map((m) => m.label)).toEqual(["資産の推移", "収支の推移"]);
    const req = modelHousehold("salariedCoupleTwoKids");
    const r = preview(req);
    const m: MainChartModel = toPresentation({ base: req, proposal: req, current: r, proposed: r, targetAge: 95, selectedYear: 2035, provisional: false, names: { selected: "プランB", base: "プランA", same: false } });
    for (const layout of ["overlay", "side", "all"] as const) {
      const html = renderToString(h(ResultCard, { model: m, verdict: (m as unknown as { result: never }).result, provisional: false, mode: "flows", onMode: noop, explain: null, onExplain: noop, ageMark: null, onSelectYear: noop, layout, pinnedYear: 2040 }));
      expect(html).not.toContain("data-balance-sheet");
      expect(html).not.toContain("資産と負債の推移");
    }
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
    // 評価はお金の流れに効かないので詳細（0078）
    expect(value.level).toBe("detail");
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
    expect(byKey(fieldsOf(wh, "housing"), "/after")).toBeUndefined();
    wh = byKey(fieldsOf(wh, "housing"), "/to")!.set(wh, "2050-03");
    const on = byKey(fieldsOf(wh, "housing"), "/after")!;
    expect(on.get(wh).value).toBe("keep");
    wh = on.set(wh, "sell");
    expect(byKey(fieldsOf(wh, "housing"), "/sale/price")).toBeDefined();
    expect(byKey(fieldsOf(wh, "housing"), "/sale/cost")!.get(wh)).toMatchObject({ value: "0.04", implicit: true });
    const r = preview(wh.request);
    expect(sumRows(r, ["cf.income.lumpSum.realEstateSale"], 2050)).toBeGreaterThan(0);
    expect(sumRows(r, ["cf.balance.account.realEstate"], 2050)).toBe(0);
    wh = byKey(fieldsOf(wh, "housing"), "/after")!.set(wh, "keep");
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

describe("住まい以外の不動産（家賃収入・経費・土地と建物）", () => {
  const fieldsOf = (wh: WorkingHousehold) => allFields(buildStage("rental", wh));
  const key = (fs: FieldDef[], k: string) => fs.find((f) => f.key === k);

  it("資産と負債のタブ: 換金しにくい資産の中を土地と建物に分け、建物は年とともに減り土地は残る。箱の説明にも土地と建物", () => {
    const req = modelHousehold("dualAssetsTwoKids");
    const r = preview(req);
    const p = bsPlan({ key: "A", letter: "A", name: "プランA", title: "現状", base: true, req, table: r.table });
    const amt = (y: BsYearModel, k: string) => y.lines.find((l) => l.key === k)?.amount ?? 0;
    const y0 = p.years[0]!;
    const y20 = p.years[20]!;
    expect(amt(y0, "land") + amt(y0, "building")).toBe(sumRows(r, ["cf.balance.account.realEstate"], y0.year));
    expect(amt(y20, "building")).toBeLessThan(amt(y0, "building"));
    expect(amt(y20, "land")).toBeGreaterThan(0);
    expect(y0.lines.some((l) => l.key === "home")).toBe(false);
    expect(y0.notes.illiquid).toContain("建物は年数とともに価値が減りますが、土地は残ります");
    expect(y20.notes.illiquid).toContain("土地（");
    // 賃貸のマンションのローンは「不動産のローン」
    expect(y0.lines.find((l) => l.key === "propertyLoan")).toMatchObject({ group: "propertyLoan", label: "不動産のローン" });
  });

  it("結果の表に「家賃収入」「不動産の経費」の行が出て、その他の収入・支出から外れる", () => {
    const req = modelHousehold("dualAssetsTwoKids");
    const r = preview(req);
    const defs = rowDefsOf(req);
    const rent = defs.find((d) => d.key === "rent")!;
    const exp = defs.find((d) => d.key === "realEstateExpense")!;
    const other = defs.find((d) => d.key === "incomeOther")!;
    const y = displayYears(req)[1]!;
    const sum = (pred: (c: (typeof r.table)[number]) => boolean) => r.table.filter((c) => c.year === y && pred(c)).reduce((s, c) => s + c.amount, 0);
    expect(sum(rent.match)).toBe(sumRows(r, ["cf.income.other.rental"], y));
    expect(sum(rent.match)).toBeGreaterThan(900000);
    expect(sum(exp.match)).toBe(sumRows(r, ["cf.expense.other.realEstate"], y));
    expect(r.table.some((c) => c.year === y && rent.match(c) && other.match(c))).toBe(false);
    // 不動産の無い世帯には出さない
    expect(rowDefsOf(modelHousehold("salariedCoupleTwoKids")).some((d) => d.key === "rent" || d.key === "realEstateExpense")).toBe(false);
  });

  it("入力: 収益不動産に物件を足し、家賃・空室・経費・取得・ローンを入れると、家賃収入と不動産所得の税が計算に入る（0079。足せば最初から土地と建物の欄）", () => {
    let wh = fromRequest(modelHousehold("single45"));
    const sec = buildStage("rental", wh).sections.find((s) => s.key === "rental/properties")!;
    wh = sec.actions.find((a) => a.key === "rental/add")!.run(wh);
    const acc = (wh.request.input.household.accounts ?? []).find((a) => a.kind === "realEstate")!;
    const k = `sav/${acc.id}`;
    wh = key(fieldsOf(wh), `${k}/value`)!.set(wh, 20000000);
    expect(key(fieldsOf(wh), `${k}/split`)).toBeUndefined();
    wh = key(fieldsOf(wh), `${k}/property/structure`)!.set(wh, "rc");
    wh = key(fieldsOf(wh), `${k}/property/landShare`)!.set(wh, "0.25");
    wh = key(fieldsOf(wh), `${k}/property/acqPrice`)!.set(wh, 22000000);
    // 取得価額を入れると、取得の年月は評価額の時点で埋まる（スキーマの必須）
    expect(acc.asOf).toBeDefined();
    expect((wh.request.input.household.accounts ?? []).find((a) => a.id === acc.id)!.property!.acquisition).toEqual({ price: 22000000, at: acc.asOf });
    wh = key(fieldsOf(wh), `${k}/property/acqAt`)!.set(wh, "2018-04");
    // 足した物件は「貸している」で始まる
    expect(key(fieldsOf(wh), `${k}/property/rented`)!.get(wh).value).toBe(true);
    wh = key(fieldsOf(wh), `${k}/property/rent`)!.set(wh, 90000);
    wh = key(fieldsOf(wh), `${k}/property/vacancy`)!.set(wh, "0.05");
    wh = key(fieldsOf(wh), `${k}/property/expAnnual`)!.set(wh, 300000);
    wh = key(fieldsOf(wh), `${k}/property/expRate`)!.set(wh, "0.05");
    const stage = buildStage("rental", wh);
    const addLoan = stage.sections.flatMap((s) => s.groups).flatMap((g) => g.actions).find((a) => a.key === `${k}/property/addLoan`)!;
    wh = addLoan.run(wh);
    const loan = (wh.request.input.household.debts ?? []).find((d) => d.property === acc.id)!;
    expect(loan).toMatchObject({ kind: "other", start: { at: "2018-04" } });
    // ローンの欄は不動産の欄の中に出る（住まい・ローンの「住宅ローン以外のローン」には出さない）
    expect(fieldsOf(wh).some((f) => f.key === `housing/debt/${loan.id}/principal`)).toBe(true);
    expect(allFields(buildStage("housing", wh)).some((f) => f.key === `housing/debt/${loan.id}/principal`)).toBe(false);
    const r = preview(wh.request);
    const y = displayYears(wh.request)[0]!;
    expect(sumRows(r, ["cf.income.other.rental"], y)).toBe(Math.floor(90000 * 0.95) * 12);
    expect(sumRows(r, ["cf.expense.other.realEstate"], y)).toBe((25000 + Math.floor(Math.floor(90000 * 0.95) * 0.05)) * 12);
    expect(sumRows(r, ["cf.balance.account.realEstate.land"], y)).toBeGreaterThan(0);
    expect(sumRows(r, ["cf.balance.account.realEstate.building"], y)).toBeGreaterThan(0);
    // 物件を外すと、ローンの不動産の指定も外れる（ローンは住宅ローン以外のローンとして残る）
    wh = stage.sections.flatMap((s) => s.groups).flatMap((g) => g.actions).find((a) => a.key === `${k}/remove`)!.run(wh);
    expect((wh.request.input.household.accounts ?? []).some((a) => a.id === acc.id)).toBe(false);
    expect((wh.request.input.household.debts ?? []).find((d) => d.id === loan.id)!.property).toBeUndefined();
  });
});
