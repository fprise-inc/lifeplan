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
  const b = savePlan(wh, cat, { name: "B案 生活費とNISA", base: null, values: { "lever:livingMonthly": living - 20000, "lever:nisaMonthly": 30000, ...(cat.byKey.has("lever:fee") ? { "lever:fee": true } : {}) }, now: NOW });
  wh = b.wh;
  const c = savePlan(wh, cat, { name: "C案 生活費と配分", base: null, values: { "lever:livingMonthly": living - 20000, [mix.key]: mixFromBuckets(undefined, 80, 10) }, now: NOW });
  wh = c.wh;
  const letters = planLetters(wh.proposals);
  const ctx = { wh, catalog: cat, valuesOf: (pid: string) => (pid === CURRENT ? {} : effectiveValues(wh.proposals, pid)), letterOf: (pid: string) => letters.get(pid) ?? { letter: "?", name: "" } };
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

  it("現状は A案（入力の値）、提案は選んだ案。目標の年齢は表示の設定のまま", () => {
    expect(plan.requests.current).toBe(o.wh.request);
    const self = roles(o.wh.request).find((r) => r.key === "self")!.member;
    expect(input.summary.target.year).toBe(Number(self.birth.birthYearMonth.slice(0, 4)) + 95);
    const m = metricsOf(plan.requests.proposal!, results.proposal!.table, 95);
    expect(input.summary.proposal.financialAtTarget).toBe(m.target);
    expect(input.summary.current.financialAtTarget).toBe(metricsOf(o.wh.request, results.current!.table, 95).target);
  });

  it("比較のページは主画面の比較の表と同じ数字（現状・B案・C案、基準は現状）", () => {
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
