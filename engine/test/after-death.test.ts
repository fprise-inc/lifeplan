// 亡くなった後のお金の名義・発生の年で集める表の終わり・制度データより先の計算基準月（0165）の見張り
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import { clone, modelHousehold, realPacks, uid } from "./helpers.ts";

type Mem = { id: string; kind: string };
type Period = Record<string, unknown> & { member: string; standardMonthlyRemuneration?: unknown; salary?: { annual: { value: number } } };
type Input = { household: { members: Mem[]; employmentPeriods: Period[] }; contingencies?: unknown[]; calcConventions: { aggregation: string }; baseMonth: string; endYear: number };
type Req = { input: Input };
type Cell = { year: number; row: string; member?: string; object?: string; amount: number };
const run = (req: unknown) => runEngine(clone({ ...(req as object), trace: "none" }), realPacks());
const model = (n: string) => modelHousehold(n) as unknown as Req;
const ym = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
const memberOf = (req: Req, kind: string) => (req.input.household.members.find((m) => m.kind === kind) as Mem).id;
const killSelf = (req: Req, at: string) => {
  const self = memberOf(req, "self");
  req.input.contingencies = [{ id: uid(`after-death-${at}`), kind: "death", member: self, occurs: { at } }];
  return self;
};
const cellsOf = (r: EngineResult) => r.table as unknown as Cell[];
const sumBy = (r: EngineResult, pred: (c: Cell) => boolean) => cellsOf(r).filter(pred).reduce((s, c) => s + c.amount, 0);
const noticeCodes = (r: EngineResult) => (r.header as unknown as { notices: { code: string }[] }).notices.map((n) => n.code);

describe("制度データの最後の年度より先の計算基準月（年金の改定率・再評価率・国民年金の保険料）", () => {
  for (const baseMonth of ["2030-04", "2040-04"]) {
    it(`single25 を計算基準月 ${baseMonth} で計算できる（推定の知らせが出る）`, () => {
      const req = model("single25");
      req.input.baseMonth = baseMonth;
      req.input.endYear = 2110;
      const r = run(req);
      expect(r.table.length).toBeGreaterThan(0);
      expect(noticeCodes(r)).toContain("N_PARAM_PROJECTED");
    });
  }
});

describe("本人（世帯主）が亡くなった後の国民健康保険・後期高齢者医療・介護保険（第1号）", () => {
  it("亡くなった翌年度の遺族の国保の保険料が、亡くなった本人の前の年の所得で変わらない（軽減の判定に入れない）", () => {
    const base = model("investmentCouple");
    const self = killSelf(base, "2029-05");
    for (const p of base.input.household.employmentPeriods) if (p.member === self) delete p.standardMonthlyRemuneration;
    const low = clone(base);
    for (const p of low.input.household.employmentPeriods) if (p.member === self && p.salary !== undefined) p.salary.annual.value = Math.round(p.salary.annual.value * 0.05);
    const nhiFy = (r: EngineResult, fy: number) =>
      r.flows.filter((f) => f.formula.startsWith("socialInsurance.nationalHealth") && ym(f.ym) >= fy * 12 + 3 && ym(f.ym) <= fy * 12 + 14).reduce((s, f) => s + f.amount, 0);
    expect(nhiFy(run(base), 2030)).toBe(nhiFy(run(low), 2030));
  });

  it("亡くなった後の国保の保険料は、遺族が払う（社会保険料控除も遺族に付く）", () => {
    const req = model("survivorSelfEmployed"); // 本人の死亡 2034-06 の想定つき
    const h = req.input.household;
    const self = memberOf(req, "self");
    const sp = memberOf(req, "spouse");
    h.employmentPeriods.push({ id: uid("after-death-spouse-biz"), member: sp, from: { at: "2010-04" }, to: { at: "2048-03" }, type: "selfEmployed", business: { income: { value: 3000000, state: "confirmed", origin: { kind: "manual" } } } });
    req.input.calcConventions.aggregation = "accrual";
    const r = run(req);
    expect(sumBy(r, (c) => c.year === 2036 && c.row === "cf.taxSi.health" && c.member === self)).toBe(0);
    expect(sumBy(r, (c) => c.year === 2036 && c.row === "cf.taxSi.health" && c.member === sp)).toBeGreaterThan(0);
  });

  it("65歳を過ぎた本人が亡くなった後に払う介護保険料（第1号）・後期高齢者医療の保険料は、亡くなった本人の名にならない", () => {
    const req = model("sampleSeniorRental");
    const at = "2045-11";
    const self = killSelf(req, at);
    const r = run(req);
    const after = r.flows.filter(
      (f) => (f.formula.startsWith("socialInsurance.careFirst") || f.formula.startsWith("socialInsurance.lateElderly") || f.formula.startsWith("socialInsurance.nationalHealth")) && f.member === self && ym(f.ym) > ym(at),
    );
    expect(after.map((f) => `${f.formula} ${f.ym} ${f.amount}`)).toEqual([]);
  });
});

describe("小規模企業共済の共済契約者の死亡", () => {
  it("executiveOwner で本人が 2029-01 に亡くなったら、生前の予定の受け取りは無く、翌月に遺族が一時金で受け取る", () => {
    const req = model("executiveOwner");
    const self = killSelf(req, "2029-01");
    const r = run(req);
    const flows = r.flows;
    const after = flows.filter((f) => (f.row.startsWith("cf.income.lumpSum.smallBusiness") || f.row.startsWith("cf.income.corporatePension.smallBusiness")) && ym(f.ym) > ym("2029-01"));
    expect(after.map((f) => `${f.row} ${f.ym} ${f.amount}`)).toEqual([]);
    const death = flows.filter((f) => f.formula === "account.mutualAid.deathLumpSum");
    expect(death.length).toBeGreaterThan(0);
    for (const f of death) {
      expect(f.ym).toBe("2029-02");
      expect(f.row).toBe("cf.income.lumpSum.inheritance");
      expect(f.member).not.toBe(self);
      expect(f.amount).toBeGreaterThan(0);
    }
    expect(noticeCodes(r)).toContain("N_INHERITANCE_TAX");
  });
});

describe("発生の年で集める表（aggregation: accrual）の最後の年", () => {
  it("salariedCoupleTwoKids の 2050年の行は、表の最後の年を 2050 にしても 2081 のときと同じ", () => {
    const req = model("salariedCoupleTwoKids");
    req.input.calcConventions.aggregation = "accrual";
    const long = run(req);
    const short = run({ ...req, input: { ...req.input, endYear: 2050 } });
    const cells = (r: EngineResult) =>
      cellsOf(r)
        .filter((c) => c.year === 2050)
        .map((c) => `${c.row}|${c.member ?? ""}|${c.object ?? ""}|${c.amount}`)
        .sort();
    expect(cells(short)).toEqual(cells(long));
  });

  it("現金主義（cash）の表は、表の最後の年を延ばす計算をしない（今までどおり）", () => {
    const req = model("salariedCoupleTwoKids");
    req.input.calcConventions.aggregation = "cash";
    const r = run({ ...req, input: { ...req.input, endYear: 2050 } });
    expect(Math.max(...r.flows.map((f) => Number(f.ym.slice(0, 4))))).toBeLessThanOrEqual(2050);
  });
});

describe("亡くなった親の名で給付を受け取らない", () => {
  it("investmentCouple で本人が 2029-05 に亡くなったら、2030年の児童手当は残った配偶者の名で出る", () => {
    const req = model("investmentCouple");
    const self = killSelf(req, "2029-05");
    const r = run(req);
    expect(sumBy(r, (c) => c.year === 2030 && c.row === "cf.income.benefit.childAllowance" && c.member === self)).toBe(0);
    expect(sumBy(r, (c) => c.year === 2030 && c.row === "cf.income.benefit.childAllowance")).toBeGreaterThan(0);
  });
});
