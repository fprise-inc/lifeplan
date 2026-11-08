// 提案書と画面の出口をそろえる（0168）: アプリが書く形の時点（打ち手の年金の受け取り開始・子の独立の標準の形など）、目標の年齢、
// プランごとの万一の前提を、提案書も画面と同じに読む。画面の出来事の文と提案書のライフイベント表の中身も同じにする
import { describe, expect, it } from "vitest";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { premiseFor, writePremise } from "../src/workspace/contingency/planPremise.ts";
import { defaultYear, scenarioRequest, scenarios } from "../src/workspace/contingency/requests.ts";
import { fromRequest, standardLeavesPoint } from "../src/workspace/input/household.ts";
import { CURRENT, planLetters } from "../src/workspace/plans/band.ts";
import { metricsOf } from "../src/workspace/plans/compare.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { effectiveValues, savePlan } from "../src/workspace/plans/plans.ts";
import { cashflowTable, displayYears, eventsOf } from "../src/workspace/present.ts";
import { DEFAULT_CHAPTERS, planReport, reportInput, type ReportChoice } from "../src/workspace/report/assemble.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const NOW = "2026-11-07T10:00:00.000Z";

/** 世帯を開いて、プランB（生活費−2万円・NISA 月3万円・FP顧問料）とプランC（既定は67歳まで働く・年金70歳）を作る */
function open(id: string, reqIn?: EngineRequest, cValues?: Record<string, unknown>) {
  const req = reqIn ?? modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold(id) ?? null;
  const re = demo?.reemployment;
  let wh = fromRequest(req, { memo: [], ...(re !== undefined ? { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } } : {}) });
  const cat = buildCatalog(wh, self.id, demo);
  const lv = cat.byKey.get("lever:livingMonthly");
  const living = lv === undefined ? null : (lv.read(wh) as number);
  const bv: Record<string, unknown> = { ...(living !== null ? { "lever:livingMonthly": living - 20000 } : {}), ...(cat.byKey.has("lever:nisaMonthly") ? { "lever:nisaMonthly": 30000 } : {}), ...(cat.byKey.has("lever:fee") ? { "lever:fee": true } : {}) };
  const b = savePlan(wh, cat, { name: "プランB", base: null, values: bv as never, now: NOW });
  wh = b.wh;
  const cv: Record<string, unknown> = cValues ?? { ...(cat.byKey.has("lever:retireAge") ? { "lever:retireAge": 67 } : {}), ...(cat.byKey.has("lever:pensionAge") ? { "lever:pensionAge": 70 } : {}) };
  const c = savePlan(wh, cat, { name: "プランC", base: null, values: cv as never, now: NOW });
  wh = c.wh;
  const letters = planLetters(wh.proposals);
  const ctx = { wh, catalog: cat, valuesOf: (pid: string) => (pid === CURRENT ? {} : effectiveValues(wh, pid)), letterOf: (pid: string) => letters.get(pid) ?? { letter: "?", name: "" } };
  return { wh, cat, ctx, b: b.id, c: c.id };
}
type Opened = ReturnType<typeof open>;

function report(o: Opened, over: Partial<ReportChoice> = {}) {
  const choice: ReportChoice = { proposal: o.c, compare: [CURRENT, o.b, o.c], base: CURRENT, chapters: DEFAULT_CHAPTERS, targetAge: 95, issuedOn: "2026-11-07", preparedBy: "", ...over };
  const plan = planReport(o.ctx, choice);
  const results = Object.fromEntries(Object.entries(plan.requests).map(([k, r]) => [k, preview(forEngine(r))])) as Record<string, PreviewResult>;
  return { plan, results, input: reportInput(plan.bundle(results)) };
}
type Reported = ReturnType<typeof report>;

const proposalOf = (r: Reported) => ({ req: r.plan.requests.proposal as EngineRequest, res: r.results.proposal as PreviewResult });
const reportEvents = (r: Reported, pred: (t: string) => boolean) => r.input.events.flatMap((e) => e.items.filter(pred).map((t) => `${e.year} ${t}`));

describe("年金の記録の無い世帯で、受け取り開始を70歳にした案（打ち手は構成員の受け取り開始に書く）", () => {
  it("提案書のライフイベント表も、画面と同じ70歳の年に「年金の受け取りを開始」", () => {
    const r = report(open("housingPurchase", undefined, { "lever:pensionAge": 70 }));
    const { req, res } = proposalOf(r);
    expect(req.input.household.members.find((m) => m.kind === "self")!.pensionClaim?.basic).toBeDefined();
    const screen = eventsOf(req, res.table, displayYears(req), res.summary).filter((e) => e.text.startsWith("ご本人 年金"));
    expect(screen.map((e) => `${e.year} ${e.text}`)).toEqual(["2064 ご本人 年金の受け取り開始（70歳）"]);
    expect(reportEvents(r, (t) => t.startsWith("ご本人が年金"))).toEqual(["2064 ご本人が年金の受け取りを開始（70歳）"]);
    expect(r.input.retirement?.pensions[0]?.start?.year).toBe(2064);
  });
});

describe("特別支給の老齢厚生年金を受けている人の受け取り開始を70歳にした案", () => {
  it("提案書の年金の章の開始は受け取り開始の年、70歳からの年額は翌年の年額（特別支給の分で決めない）", () => {
    const r = report(open("parentMoney"));
    const t = r.results.proposal!.table;
    const at70 = t.filter((c) => c.row.startsWith("cf.income.pension") && c.year === 2033).reduce((s, c) => s + c.amount, 0);
    const ret = r.input.retirement!;
    expect(ret.pensions[0]?.start?.year).toBe(2032);
    expect(ret.pensions[0]?.annual).toBe(at70);
    expect(ret.deferral?.options.find((x) => x.label.startsWith("70歳"))?.annual).toBe(at70);
    // 65歳から受け取る案は今までどおり（2027年に受け取り開始、年額は翌年）
    const at65 = ret.deferral?.options.find((x) => x.label.startsWith("65歳"))?.annual;
    const r65 = r.results.defer65!.table.filter((c) => c.row.startsWith("cf.income.pension") && c.year === 2028).reduce((s, c) => s + c.amount, 0);
    expect(at65).toBe(r65);
  });
});

describe("子の独立を、アプリが子を足すときの標準の形（年齢の時点）で持つ世帯", () => {
  const req0 = modelHousehold("salariedCoupleTwoKids");
  for (const m of req0.input.household.members) if (m.kind === "child") m.leaves = standardLeavesPoint(m.id);
  const r = report(open("salariedCoupleTwoKids", req0));
  const { req, res } = proposalOf(r);
  it("家族の年齢の行が、画面の表の年齢の行と同じ（独立の翌年から空）", () => {
    const years = displayYears(req);
    const t = cashflowTable(req, res.table, years, "x");
    for (const key of ["self", "spouse", "child1", "child2"]) {
      const s = t.rows.find((x) => x.kind === "age" && x.key === `age:${key}`);
      expect(r.input.members.find((m) => m.key === key)?.ages).toEqual(s?.kind === "age" ? s.ages : []);
    }
  });
  it("ライフイベント表の「独立」が、画面の出来事と同じ年", () => {
    const screen = eventsOf(req, res.table, displayYears(req)).filter((e) => e.icon === "独").map((e) => e.year);
    expect(screen).toEqual([2035, 2038]);
    expect(r.input.events.filter((e) => e.items.some((t) => t.endsWith("が独立"))).map((e) => e.year)).toEqual(screen);
  });
});

describe("表示の設定の「○歳時点」が今の年齢より前", () => {
  it("提案書の目標の年・金融資産が画面と同じ（表の最初の年に寄せる）", () => {
    const r = report(open("pensionCouple"), { targetAge: 75 });
    const { req, res } = proposalOf(r);
    const m = metricsOf(req, res.table, 75);
    expect(m.targetYear).toBe(2027);
    expect(m.target).toBeGreaterThan(0);
    expect(r.input.summary.target.year).toBe(m.targetYear);
    expect(r.input.summary.proposal.financialAtTarget).toBe(m.target);
    expect(r.input.comparison?.rows.find((x) => x.key === "target")?.values.every((v) => v !== 0)).toBe(true);
  });
});

describe("万一の前提を「このプランだけ」に書いた提案", () => {
  it("提案書の万一の章が、そのプランの前提で計算する（万一のタブでそのプランを見たときと同じ）", () => {
    const o = open("salariedCoupleTwoKids");
    const shown = premiseFor(o.wh, o.c);
    const next = { ...shown, survivor: { ...shown.survivor, livingRatio: { beforeIndependence: "0.5", afterIndependence: "0.4", noChildren: "0.5" } } };
    const wh2 = writePremise(o.wh, o.c, shown, next, "plan");
    // 共通の前提は変えていない
    expect(wh2.contingency).toEqual(o.wh.contingency);
    const o2 = { ...o, wh: wh2, ctx: { ...o.ctx, wh: wh2 } };
    const r = report(o2);
    const planReq = r.plan.requests.proposal as EngineRequest;
    const tabWh = { ...wh2, contingency: premiseFor(wh2, o.c), request: planReq };
    const sc = scenarios(tabWh).find((s) => s.kind === "death" && s.who === "ご本人")!;
    const tab = preview(forEngine(scenarioRequest(tabWh, sc, defaultYear(planReq))));
    const fin = (res: PreviewResult) => res.table.filter((c) => c.row === "cf.balance.financial" && c.year === 2040).reduce((s, c) => s + c.amount, 0);
    expect(fin(r.results.death0!)).toBe(fin(tab));
    // 必要保障額の要求と前提の注も、そのプランの前提
    expect((r.plan.requests.protection as EngineRequest).input.protection?.survivor?.livingRatio).toEqual(next.survivor.livingRatio);
    expect(r.input.assumptions.survivor).not.toBeNull();
  });
});

describe("医歯系の大学", () => {
  it("画面のライフイベントの文にも「医歯系」が出る（提案書と同じ）", () => {
    const req0 = modelHousehold("salariedCoupleTwoKids");
    for (const g of req0.input.household.goals ?? []) for (const s of g.education?.stages ?? []) if (s.stage === "university") s.field = "medical";
    const r = report(open("salariedCoupleTwoKids", req0));
    const { req, res } = proposalOf(r);
    const screen = eventsOf(req, res.table, displayYears(req)).filter((e) => e.text.includes("大学入学")).map((e) => e.text);
    const rep = r.input.events.flatMap((e) => e.items.filter((t) => t.includes("大学に入学")));
    expect(screen.length).toBeGreaterThan(0);
    expect(rep.every((t) => t.includes("医歯系"))).toBe(true);
    expect(screen.every((t) => t.includes("医歯系"))).toBe(true);
  });
});
