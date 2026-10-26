// 提案書の材料（workspace/report/assemble.ts）: 案の選び方・章の選び方から計算の要求を並べ、帳票の入力を組み立てる。
// 主画面の数字（比較の表・目標の年齢）とつじつまが合うこと
import { describe, expect, it } from "vitest";
import type { PreviewResult } from "../src/engine/types.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { CURRENT, planLetters } from "../src/workspace/plans/band.ts";
import { metricsOf } from "../src/workspace/plans/compare.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { mixFromBuckets } from "../src/workspace/plans/allocation.ts";
import { effectiveValues, savePlan } from "../src/workspace/plans/plans.ts";
import { DEFAULT_CHAPTERS, isInvestmentKey, planReport, reportInput, type ReportChoice } from "../src/workspace/report/assemble.ts";
import { roles } from "../src/workspace/roles.ts";
import { bsPlan, DEFAULT_BS_POINTS } from "../src/workspace/balanceTab.ts";
import { bsPointsText } from "../src/workspace/report/ReportTab.tsx";
import { modelHousehold, preview } from "./helpers.ts";

const NOW = "2026-10-18T10:00:00.000Z";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function open(id: string) {
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold(id) ?? null;
  const re = demo?.reemployment;
  let wh = fromRequest(req, { memo: ["MEMO-MARK-report"], ...(re !== undefined ? { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } } : {}) });
  const cat = buildCatalog(wh, self.id, demo);
  const living = cat.byKey.get("lever:livingMonthly")!.read(wh) as number;
  const mix = cat.items.find((x) => x.key.startsWith("mix:") && x.control.kind === "mix")!;
  const b = savePlan(wh, cat, { name: "プランB 生活費とNISA", base: null, values: { "lever:livingMonthly": living - 20000, "lever:nisaMonthly": 30000, ...(cat.byKey.has("lever:fee") ? { "lever:fee": true } : {}) }, now: NOW });
  wh = b.wh;
  const c = savePlan(wh, cat, { name: "プランC 生活費と配分", base: null, values: { "lever:livingMonthly": living - 20000, [mix.key]: mixFromBuckets(undefined, 80, 10) }, now: NOW });
  wh = c.wh;
  const letters = planLetters(wh.proposals);
  const ctx = { wh, catalog: cat, valuesOf: (pid: string) => (pid === CURRENT ? {} : effectiveValues(wh, pid)), letterOf: (pid: string) => letters.get(pid) ?? { letter: "?", name: "" } };
  return { wh, cat, ctx, b: b.id, c: c.id };
}

function run(plan: ReturnType<typeof planReport>): Record<string, PreviewResult> {
  return Object.fromEntries(Object.entries(plan.requests).map(([k, r]) => [k, preview(r)]));
}

const choice = (o: ReturnType<typeof open>, over: Partial<ReportChoice> = {}): ReportChoice => ({
  proposal: o.b,
  compare: [CURRENT, o.b, o.c],
  base: CURRENT,
  chapters: DEFAULT_CHAPTERS,
  targetAge: 95,
  issuedOn: "2026-10-18",
  preparedBy: "",
  ...over,
});

describe("提案書の材料: 案の選び方", () => {
  const o = open("salariedCoupleTwoKids");
  const plan = planReport(o.ctx, choice(o));
  const results = run(plan);
  const bundle = plan.bundle(results);
  const input = reportInput(bundle);

  it("現状は プランA（入力の値）、提案は選んだ案。目標の年齢は表示の設定のまま", () => {
    expect(plan.requests.current).toBe(o.wh.request);
    const self = roles(o.wh.request).find((r) => r.key === "self")!.member;
    expect(input.summary.target.year).toBe(Number(self.birth.birthYearMonth.slice(0, 4)) + 95);
    const m = metricsOf(plan.requests.proposal!, results.proposal!.table, 95);
    expect(input.summary.proposal.financialAtTarget).toBe(m.target);
    expect(input.summary.current.financialAtTarget).toBe(metricsOf(o.wh.request, results.current!.table, 95).target);
  });

  it("比較のページは主画面の比較の表と同じ数字（現状・プランB・プランC、基準は現状）", () => {
    const c = input.comparison!;
    expect(c.columns.map((x) => x.letter)).toEqual(["A", "B", "C"]);
    expect(c.base).toBe(0);
    const ms = [plan.requests.current!, plan.requests.proposal!, plan.requests[`plan:${o.c}`]!].map((r, i) => metricsOf(r, [results.current!, results.proposal!, results[`plan:${o.c}`]!][i]!.table, 95));
    expect(c.rows.find((r) => r.key === "target")!.values).toEqual(ms.map((m) => m.target));
    expect(c.rows.find((r) => r.key === "takeHome")!.values).toEqual(ms.map((m) => m.takeHome));
    expect(c.rows.find((r) => r.key === "expense")!.values).toEqual(ms.map((m) => m.expense));
    expect(c.rows.find((r) => r.key === "depletion")!.values).toEqual(ms.map((m) => m.depletion));
  });

  it("打ち手を1件ずつ足した効果: 最後の累計は提案と現状の差。変える内容は主画面の「変えたこと」と同じ", () => {
    const steps = input.changes.steps!;
    expect(steps.length).toBe(input.changes.items.length);
    expect(steps.at(-1)!.cumulative).toBe(input.summary.diffAtTarget);
    expect(input.changes.items.length).toBeGreaterThanOrEqual(2);
  });

  it("万一・必要保障額・年金の受け取り開始の比較が入る。内部 ID・メモは入らない", () => {
    expect(input.contingency?.scenarios.length).toBeGreaterThan(0);
    expect(input.contingency?.protection.length).toBeGreaterThan(0);
    expect(input.retirement?.deferral?.options.length).toBe(2);
    const text = JSON.stringify(input);
    expect(text).not.toMatch(UUID);
    expect(text).not.toContain("MEMO-MARK-report");
  });

  it("基準の案を変えると、比較のページの基準も変わる", () => {
    const p2 = planReport(o.ctx, choice(o, { base: o.c }));
    const inp = reportInput(p2.bundle(run(p2)));
    expect(inp.comparison!.base).toBe(2);
    expect(inp.comparison!.rows[0]!.diffs[2]).toBeNull();
  });

  it("現状は提案に選べない", () => {
    expect(() => planReport(o.ctx, choice(o, { proposal: CURRENT }))).toThrow("E_REPORT_NO_PROPOSAL");
  });
});

describe("提案書の材料: 章の選び方", () => {
  const o = open("salariedCoupleTwoKids");

  it("外した章の計算はしない（万一・年金の比較・打ち手ごと・比較のページ）", () => {
    const plan = planReport(o.ctx, choice(o, { chapters: ["summary", "cashflow"] }));
    expect(Object.keys(plan.requests).sort()).toEqual(["current", "proposal"]);
    const input = reportInput(plan.bundle(run(plan)));
    expect(input.chapters).toEqual(["cover", "assumptions", "summary", "cashflow"]);
    expect(input.contingency).toBeNull();
    expect(input.retirement).toBeNull();
    expect(input.comparison).toBeNull();
    expect(input.education).toBeNull();
  });

  it("比較のページは2列以上のときだけ", () => {
    const plan = planReport(o.ctx, choice(o, { compare: [o.b], chapters: ["comparison"] }));
    expect(reportInput(plan.bundle(run(plan))).comparison).toBeNull();
  });

  it("運用の前提の変更（配分）は最後に足し、「運用の前提の変更を除いた効果」を出す", () => {
    const plan = planReport(o.ctx, choice(o, { proposal: o.c, chapters: ["changes"] }));
    const input = reportInput(plan.bundle(run(plan)));
    const steps = input.changes.steps!;
    expect(steps.at(-1)!.investment).toBe(true);
    expect(steps.slice(0, -1).every((s) => !s.investment)).toBe(true);
    expect(input.changes.excludingInvestment).toBe(steps.at(-2)!.cumulative);
    expect(isInvestmentKey("mix:abc")).toBe(true);
    expect(isInvestmentKey("lever:livingMonthly")).toBe(false);
  });
});

describe("FP顧問料つきの世帯", () => {
  const o = open("advisoryFeeProposal");
  it("顧問料を入れた提案では、顧問料を除いた提案も計算し、変更点に「顧問料を除くと」が入る", () => {
    expect(o.cat.byKey.has("lever:fee")).toBe(true);
    const plan = planReport(o.ctx, choice(o, { chapters: ["changes"], compare: [] }));
    expect(plan.requests.withoutFee).toBeDefined();
    const input = reportInput(plan.bundle(run(plan)));
    expect(input.changes.fee?.diffWithoutFee).not.toBeNull();
  });
});

describe("提案書の材料: バランスシートの図の時点（資産と負債のタブで並べている時点）", () => {
  const o = open("salariedCoupleTwoKids");
  const figureOf = (over: Partial<ReportChoice>) => {
    const plan = planReport(o.ctx, choice(o, over));
    const results = run(plan);
    const input = reportInput(plan.bundle(results));
    const p = bsPlan({ key: "B", letter: "B", name: "", title: "", base: false, req: plan.requests.proposal!, table: results.proposal!.table });
    return { input, p, yearOf: (k: string) => p.years[p.points.find((x) => x.key === k)!.index]!.year, labels: input.balanceSheet!.figure.columns.map((c) => c.point.label), years: input.balanceSheet!.figure.columns.map((c) => c.point.year) };
  };

  it("並べ方を変えていない世帯は、今・退職の年・75歳（画面の図と同じ年）", () => {
    const f = figureOf({});
    expect(f.years).toEqual([f.yearOf("now"), f.yearOf("retire"), f.yearOf("age75")]);
    expect(f.labels[0]).toBe("今");
    expect(f.labels[1]).toMatch(/^退職の年（ご主人\d+歳）$/);
    expect(f.labels[2]).toBe("ご主人75歳");
    // 表示の設定を省略しても同じ
    const g = figureOf({ bsPoints: DEFAULT_BS_POINTS, bsColumns: null });
    expect(g.years).toEqual(f.years);
  });

  it("既定の時点を変えた・この世帯で時点を選んだ世帯は、その時点（4つ・年を直に選んだ時点を含む）", () => {
    const d = figureOf({ bsPoints: ["now", "childIndep", "age85"] });
    expect(d.years).toEqual([d.yearOf("now"), d.yearOf("childIndep"), d.yearOf("age85")]);
    expect(d.labels[1]).toMatch(/^子の独立（ご主人\d+歳）$/);
    const c = figureOf({ bsColumns: [{ point: "age80" }, { point: "now" }, { year: 2040 }, { point: "loanEnd" }] });
    expect(c.years).toEqual([c.yearOf("now"), 2040, c.yearOf("loanEnd"), c.yearOf("age80")].sort((a, b) => a - b));
    expect(c.labels).toContain("ご主人80歳");
    expect(c.labels.some((l) => l.startsWith("ローン完済（"))).toBe(true);
    // 抜粋の表にも図の時点が入る
    const table = c.input.balanceSheet!.proposal.points.map((x) => x.year);
    for (const y of c.years) expect(table).toContain(y);
  });

  it("退職の年は提案のプランの年で解く（退職の年齢を変えたプランなら、そのプランの退職の年）", () => {
    const cat = o.cat;
    expect(cat.byKey.has("lever:retireAge")).toBe(true);
    const now = cat.byKey.get("lever:retireAge")!.read(o.wh) as number;
    const later = savePlan(o.wh, cat, { name: "プランD 退職を遅らせる", base: null, values: { "lever:retireAge": now + 5 }, now: NOW });
    const letters = planLetters(later.wh.proposals);
    const ctx = { wh: later.wh, catalog: cat, valuesOf: (pid: string) => (pid === CURRENT ? {} : effectiveValues(later.wh, pid)), letterOf: (pid: string) => letters.get(pid) ?? { letter: "?", name: "" } };
    const base = figureOf({});
    const plan = planReport(ctx, { ...choice(o), proposal: later.id, compare: [CURRENT, later.id] });
    const input = reportInput(plan.bundle(run(plan)));
    const retire = input.balanceSheet!.figure.columns.find((c) => c.point.label.startsWith("退職の年"))!;
    // プランB（退職の年齢はそのまま）より5年遅い
    expect(retire.point.year).toBe(base.yearOf("retire") + 5);
    expect(retire.point.year).toBeGreaterThan(base.yearOf("retire"));
  });

  it("提案書の画面に、図の時点の呼び方を出す", () => {
    expect(bsPointsText(null, DEFAULT_BS_POINTS)).toBe("今・退職の年・75歳");
    expect(bsPointsText([{ point: "now" }, { year: 2040 }, { point: "loanEnd" }, { point: "age85" }], DEFAULT_BS_POINTS)).toBe("今・2040年・ローン完済・85歳");
  });
});
