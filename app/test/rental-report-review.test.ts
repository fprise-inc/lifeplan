// 収益不動産を持つ見本の世帯（見本 3-4-05。data/modelHouseholds/rentalSample.json。架空）と、その見本で見つかった画面の直し（0127）:
// 見本の一覧に入っていること、表の行で住まいのローンと不動産のローンを分ける、収支の推移の「不動産」の色、数字の根拠の物件ごとの内訳と
// 使った制度の値、収益不動産のタブの減価償却が終わる年と残りの耐用年数、ライフイベントの物件の売却・大きな修繕
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineRequest, TableCell } from "../src/engine/types.ts";
import type { RentalPropertyViewModel } from "../src/presentation/model.ts";
import { DEMO_HOUSEHOLDS, type DemoHousehold } from "../src/workspace/catalog.ts";
import { buildEvidence } from "../src/workspace/evidence.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { BODY_FORMAT_VERSION, bodyOf, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { applyValues, normalizeValues } from "../src/workspace/plans/plans.ts";
import { displayYears, eventsOf, flowChart, rowDefs } from "../src/workspace/present.ts";
import { rentalTabModel } from "../src/workspace/rentalTab.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { full, modelHousehold, preview } from "./helpers.ts";

const ID = "rentalSample";
const HEIGHTS = "a9a0f9af-56d3-4123-af5a-c0969d2fb9f8";
const CONDO = "b12f8ccc-3fed-483a-bf0e-3cfbe55177ed";
const LOAN = "26a240e9-79c4-478d-b52a-cafd73257991";
const MORTGAGE = "1a4ab6d6-d333-45e9-97c8-193f070433a8";
const req = modelHousehold(ID);
const h = req.input.household;
const r = preview(req);
const years = displayYears(req);
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sumIn = (t: readonly TableCell[], y: number, p: (c: TableCell) => boolean) => t.reduce((s, c) => (c.year === y && p(c) ? s + c.amount : s), 0);
const under = (row: string, prefix: string) => row === prefix || row.startsWith(`${prefix}.`);

/** 要求の中の ID（物の id） */
function idsOf(rq: EngineRequest): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string | null) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, null));
    else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (key === "id" && typeof v === "string") out.push(v);
  };
  walk(rq.input.household, null);
  return out;
}

describe("見本の一覧の「収益不動産を持つ会社員の夫婦と子1人（見本）」", () => {
  const demo = DEMO_HOUSEHOLDS.find((d) => d.id === ID) as DemoHousehold;

  it("見本 3-4-05 として一覧にあり、ID は UUID 第4版でほかのモデル世帯と重ならない。物件名・メモは架空", () => {
    expect(demo.sampleNo).toBe("3-4-05");
    expect(DEMO_HOUSEHOLDS.filter((d) => d.sampleNo === "3-4-05").length).toBe(1);
    const mine = idsOf(req);
    for (const id of mine) expect(id).toMatch(UUID4);
    expect(new Set(mine).size).toBe(mine.length);
    const others = new Set(
      readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
        .filter((f) => f.endsWith(".json") && f !== `${ID}.json`)
        .flatMap((f) => idsOf(modelHousehold(f.replace(/\.json$/, "")))),
    );
    for (const id of mine) expect(others.has(id), id).toBe(false);
    for (const a of (h.accounts ?? []).filter((x) => x.property !== undefined)) expect(a.property?.name ?? "").toContain("架空");
  });

  it("プランの値は世帯の物を指し、当てると計算できる（最後の金融資産が現状と変わる）", () => {
    const self = h.members.find((m) => m.kind === "self")!;
    const re = demo.reemployment;
    const wh = fromRequest(req, { memo: demo.memo, ...(re !== undefined ? { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } } : {}) });
    const cat = buildCatalog(wh, self.id, demo);
    const last = (rq: EngineRequest) => sumIn(preview(rq).table, rq.input.endYear, (c) => c.row === "cf.balance.financial");
    expect((demo.plans ?? []).length).toBe(2);
    for (const p of demo.plans ?? []) {
      for (const k of Object.keys(p.values)) expect(cat.byKey.has(k), `${p.name}: ${k}`).toBe(true);
      const values = normalizeValues(p.values, {}, wh, cat);
      expect(last(applyValues(wh, values, cat)), p.name).not.toBe(last(req));
    }
  });
});

describe("世帯ファイルの形式の今の版で開ける", () => {
  it("見本を開いて世帯ファイルの本文にし、読み戻すと同じ（今の版。変換の段を通らずに読める）", () => {
    expect(BODY_FORMAT_VERSION).toBe("0.66");
    const wh = fromRequest(req);
    const text = bodyOf({ wh, workspace: { template: ID, band: [], base: CURRENT, selected: CURRENT, shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY });
    const back = fromBody(text);
    expect(back.wh.request).toEqual(fromBody(bodyOf({ wh: back.wh, workspace: back.workspace, display: back.display, carry: back.carry })).wh.request);
    expect(preview(back.wh.request).table.length).toBeGreaterThan(0);
    // 家賃の入れ方・減価償却の引き継ぎ（0.65 で足した任意の欄）を入れていない見本は、今までどおり満室の家賃から計算する
    expect(JSON.stringify(back.wh.request)).not.toContain("depreciationCarryover");
  });
});

describe("表の行: 住まいのローンと不動産（住まい以外）のローンを分ける", () => {
  const defs = new Map(rowDefs(req).map((d) => [d.key, d]));
  const sum = (key: string, y: number) => sumIn(r.table, y, (defs.get(key) as { match: (c: TableCell) => boolean }).match);

  it("「住宅ローン残高」は住宅ローンだけ、「不動産のローン残高」はアパートローンだけ", () => {
    expect(defs.get("debt")?.label).toBe("住宅ローン残高");
    expect(defs.get("realEstateDebt")?.label).toBe("不動産のローン残高");
    for (const y of [2027, 2035]) {
      expect(sum("debt", y)).toBe(sumIn(r.table, y, (c) => under(c.row, "cf.balance.debt") && c.object === MORTGAGE));
      expect(sum("realEstateDebt", y)).toBe(sumIn(r.table, y, (c) => under(c.row, "cf.balance.debt") && c.object === LOAN));
      expect(sum("realEstateDebt", y)).toBeGreaterThan(0);
    }
  });

  it("アパートローンの返済は「不動産のローンの返済」の行で、「その他の支出」に入らない（売った年の一括の返済も）", () => {
    expect(defs.get("realEstateLoan")?.label).toBe("不動産のローンの返済");
    for (const y of [2029, 2041]) {
      expect(sum("realEstateLoan", y)).toBe(sumIn(r.table, y, (c) => under(c.row, "cf.expense") && c.object === LOAN));
      expect(sumIn(r.table, y, (c) => (defs.get("expenseOther") as { match: (c: TableCell) => boolean }).match(c) && c.object === LOAN)).toBe(0);
    }
    // 支出の行を足すと支出合計（行の分け方が漏れ・重なりなく分ける）
    const parts = [...defs.values()].filter((d) => d.group === "expense" && d.kind === "value");
    for (const y of [2029, 2041]) expect(parts.reduce((s, d) => s + sumIn(r.table, y, d.match), 0)).toBe(sum("expenseTotal", y));
  });

  it("不動産のローンの無い世帯は、行が増えない", () => {
    const keys = rowDefs(modelHousehold("salariedCoupleTwoKids")).map((d) => d.key);
    expect(keys).not.toContain("realEstateLoan");
    expect(keys).not.toContain("realEstateDebt");
  });
});

describe("収支の推移: 不動産の収入と支出を自分の色にする", () => {
  const f = flowChart(req, r.table, years, "収支の推移");
  const series = (side: "income" | "expense", key: string) => f[side].find((s) => s.key === key);

  it("収入に「不動産（家賃・売却）」、支出に「不動産（経費・ローン）」があり、その他の収入・その他（税・社会保険料など）から外れる", () => {
    expect(f.income.map((s) => s.key)).toEqual(["salary", "pension", "realEstateIn", "incomeOther"]);
    expect(f.expense.map((s) => s.key)).toEqual(["living", "housing", "education", "insurance", "realEstateOut", "expenseOther"]);
    const i = years.indexOf(2029);
    const rent = sumIn(r.table, 2029, (c) => c.row === "cf.income.other.rental");
    expect(series("income", "realEstateIn")?.values[i]).toBe(rent);
    const reOut = sumIn(r.table, 2029, (c) => c.row === "cf.expense.other.realEstate" || (under(c.row, "cf.expense") && c.object === LOAN));
    expect(series("expense", "realEstateOut")?.values[i]).toBe(reOut);
    // 売った年: 売却の手取りは不動産の収入、一括の返済は不動産の支出
    const j = years.indexOf(2041);
    expect(series("income", "realEstateIn")?.values[j]).toBe(sumIn(r.table, 2041, (c) => (c.row === "cf.income.other.rental" || c.row === "cf.income.lumpSum.realEstateSale") && (c.object === HEIGHTS || c.object === CONDO)));
    // 系列を足すと収入合計・支出合計（漏れ・重なりが無い）
    for (const k of [i, j]) {
      const y = years[k] as number;
      expect(f.income.reduce((s, x) => s + (x.values[k] ?? 0), 0)).toBe(sumIn(r.table, y, (c) => under(c.row, "cf.income")));
      expect(f.expense.reduce((s, x) => s + (x.values[k] ?? 0), 0)).toBe(sumIn(r.table, y, (c) => under(c.row, "cf.expense") || under(c.row, "cf.taxSi")));
    }
  });

  it("住まい以外の不動産の無い世帯は、今までの5つ・3つのまま", () => {
    const rq = modelHousehold("salariedCoupleTwoKids");
    const g = flowChart(rq, preview(rq).table, displayYears(rq), "収支の推移");
    expect(g.income.map((s) => s.key)).toEqual(["salary", "pension", "incomeOther"]);
    expect(g.expense.map((s) => s.key)).toEqual(["living", "housing", "education", "insurance", "expenseOther"]);
  });
});

describe("数字の根拠（2029年の不動産の経費など）", () => {
  const out = full(req);

  it("内訳は物件ごと・計算式ごとで、計算の部品の名前を出さない。使った制度の値に譲渡所得の値を並べない", () => {
    const v = buildEvidence(out, req, "realEstateExpense", 2029)!;
    expect(v.breakdown.map((b) => b.label)).toEqual(["不動産の経費（見本ハイツ（架空））", "不動産の経費（見本マンション 205号室（架空））", "大きな修繕（見本ハイツ（架空））"]);
    expect(v.breakdown.reduce((s, b) => s + b.amount, 0)).toBe(v.total);
    expect(v.breakdown.find((b) => b.label.startsWith("大きな修繕"))?.amount).toBe(5_500_000);
    expect(JSON.stringify(v)).not.toMatch(/asset\.realEstate|計算式 /);
    expect(v.params).toEqual([]);
    const rent = buildEvidence(out, req, "rent", 2029)!;
    expect(rent.breakdown.length).toBe(2);
    expect(rent.params).toEqual([]);
  });

  it("アパートローンの返済は「ローンの返済（元利均等）（物件名）」で、住宅ローンの名前にしない。売った年は一括の返済の行", () => {
    const v = buildEvidence(out, req, "realEstateLoan", 2041)!;
    expect(v.breakdown.map((b) => b.label)).toEqual(["ローンの返済（元利均等）（見本ハイツ（架空））", "売ったときのローンの返済（見本ハイツ（架空））"]);
    expect(JSON.stringify(v)).not.toContain("住宅ローン");
    // 住まいの住宅ローンの返済は今までの名前のまま（物件名を付けない）
    expect(buildEvidence(out, req, "housing", 2029)!.breakdown.map((b) => b.label)).toContain("住宅ローンの返済");
  });

  it("名前をまだ持たない計算式は、計算の部品の名前の代わりに表の行の名前を出す", () => {
    const v = buildEvidence(out, req, "incomeOther", 2041)!;
    expect(JSON.stringify(v)).not.toMatch(/account\.ideco|計算式 /);
    expect(v.breakdown.map((b) => b.label)).toContain("iDeCo（一時金）");
  });
});

describe("収益不動産のタブ（見本ハイツ・2027年）", () => {
  const v = rentalTabModel({ req, result: r, ui: { view: "1", year: 2027 }, sale: null, provisional: false })!.view as RentalPropertyViewModel;
  const metric = (k: string) => v.metrics.find((m) => m.key === k)?.value;

  it("減価償却が終わる年は、もう終わった設備を「設備は2024年に終わり」と書く", () => {
    expect(metric("depreciationEnd")).toBe("建物 2031年・設備は2024年に終わり");
  });

  it("残りの耐用年数は実際の償却（中古の簡便法で15年・2031年まで）で数え、2027年は5年（法定22年−築19年の3年ではない）", () => {
    expect(metric("age")).toBe("19年／5年");
  });
});

describe("ライフイベント（結果の画面の出来事）", () => {
  it("物件の売却と大きな修繕が載る", () => {
    const evs = eventsOf(req, r.table, years, r.summary);
    const at = (y: number) => evs.filter((e) => e.year === y).map((e) => e.text);
    expect(at(2041).some((t) => t.startsWith("見本ハイツ（架空）を売却"))).toBe(true);
    expect(at(2029)).toContain("見本ハイツ（架空）の大きな修繕（外壁塗装・屋根の葺き替え）");
    expect(at(2036)).toContain("見本ハイツ（架空）の大きな修繕（給湯器・共用部の設備の更新）");
  });
});
