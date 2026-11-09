// 亡くなった人の名義の物を、相続する人（配偶者。いなければ子を等分）が亡くなった月の翌月から持つ（0173）の見張り
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { clone, modelHousehold, realPacks, uid } from "./helpers.ts";

type Mem = { id: string; kind: string };
type Rel = { type: string; a?: string; b?: string };
type Acc = { kind: string; owner: string; property?: { rental?: { monthly?: { value: number } } } };
type Input = { household: { members: Mem[]; relations: Rel[]; accounts: Acc[] }; contingencies?: unknown[]; calcConventions: { aggregation: string }; baseMonth: string; endYear: number };
type Req = { input: Input };
type FlowX = { row: string; ym: string; amount: number; member?: string; object?: string; formula: string; accrualYear?: number };
type Cell = { year: number; row: string; member?: string; amount: number };
const run = (req: unknown) => runEngine(clone({ ...(req as object), trace: "none" }), realPacks()) as EngineResult;
const model = (n: string) => modelHousehold(n) as unknown as Req;
const ym = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
const fmt = (m: number) => `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
const memberOf = (req: Req, kind: string) => req.input.household.members.find((m) => m.kind === kind)?.id;
const kill = (req: Req, member: string, at: string) => {
  req.input.contingencies = [{ id: uid(`inherited-${member}-${at}`), kind: "death", member, occurs: { at } }];
};
const flowsOf = (r: EngineResult) => r.flows as unknown as FlowX[];
const sumBy = (r: EngineResult, pred: (c: Cell) => boolean) => (r.table as unknown as Cell[]).filter(pred).reduce((s, c) => s + c.amount, 0);

/** 名義の物から出るお金の動き（亡くなった後は相続する人の名になるはずの部品） */
const HELD = ["asset.realEstate.", "asset.heldSale.", "tax.realEstateSale.", "debt.schedule.", "housing.residence.", "expense.car.", "care.expense.", "plan.cashflow.", "expense.advisoryFee."];

describe("H1-004 亡くなった人の名義の収益不動産", () => {
  it("sampleSeniorRental で本人が 2045-11 に亡くなったら、2047年の家賃は配偶者の所得で、本人の所得税は立たない", () => {
    const req = model("sampleSeniorRental");
    const self = memberOf(req, "self") as string;
    const sp = memberOf(req, "spouse") as string;
    kill(req, self, "2045-11");
    req.input.calcConventions.aggregation = "accrual";
    for (const a of req.input.household.accounts) if (a.property?.rental?.monthly) a.property.rental.monthly.value *= 3;
    const r = run(req);
    // 前は 2047年に亡くなった本人の所得税 57,800 円（家賃 2,394,000 円が本人の名で続いた）
    expect(sumBy(r, (c) => c.year === 2047 && c.row.startsWith("cf.taxSi") && c.member === self)).toBe(0);
    const rent = (who: string, y: number) => flowsOf(r).filter((f) => f.formula === "asset.realEstate.rent" && f.member === who && f.ym.startsWith(`${y}-`)).reduce((s, f) => s + f.amount, 0);
    expect(rent(self, 2047)).toBe(0);
    expect(rent(sp, 2047)).toBeGreaterThan(0);
    // 亡くなった年は 11月分まで本人、12月分から配偶者
    expect(flowsOf(r).filter((f) => f.formula === "asset.realEstate.rent" && f.ym === "2045-11")[0]?.member).toBe(self);
    expect(flowsOf(r).filter((f) => f.formula === "asset.realEstate.rent" && f.ym === "2045-12")[0]?.member).toBe(sp);
    // 配偶者の所得税（家賃の不動産所得が配偶者に入る）
    expect(sumBy(r, (c) => c.year === 2047 && c.row === "cf.taxSi.incomeTax" && c.member === sp)).toBeGreaterThan(0);
  });

  it("配偶者がいなければ、子が等分で受け継ぐ（dualAssetsTwoKids の配偶者の関係を外して本人が亡くなる）", () => {
    const req = model("dualAssetsTwoKids");
    const h = req.input.household;
    const self = memberOf(req, "self") as string;
    const sp = memberOf(req, "spouse") as string;
    h.relations = h.relations.filter((x) => x.type !== "spouse");
    // 配偶者の構成員は残るが、配偶者の関係が無い（相続する人にならない）
    const kids = h.members.filter((m) => m.kind === "child").map((m) => m.id);
    kill(req, self, "2030-03");
    const r = run(req);
    const rentOf = (who: string, at: string) => flowsOf(r).filter((f) => f.formula === "asset.realEstate.rent" && f.member === who && f.ym === at).reduce((s, f) => s + f.amount, 0);
    const total = flowsOf(r).filter((f) => f.formula === "asset.realEstate.rent" && f.ym === "2031-06").reduce((s, f) => s + f.amount, 0);
    expect(total).toBeGreaterThan(0);
    expect(rentOf(self, "2031-06")).toBe(0);
    expect(rentOf(sp, "2031-06")).toBe(0);
    const a = rentOf(kids[0] as string, "2031-06");
    const b = rentOf(kids[1] as string, "2031-06");
    expect(a + b).toBe(total);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });
});

describe("H1-004 全モデル世帯で、亡くなった人の名のお金の動きが亡くなった後に残らない", () => {
  const names = readdirSync(join(REPO_DIR, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  for (const n of names) {
    it(n, () => {
      const base = model(n);
      const left: string[] = [];
      for (const kind of ["self", "spouse"]) {
        const who = memberOf(base, kind);
        if (who === undefined) continue;
        for (const off of [13, 121]) {
          const D = ym(base.input.baseMonth) + off;
          if (Math.floor(D / 12) >= base.input.endYear - 1) continue;
          const req = clone(base);
          kill(req, who, fmt(D));
          // 相続する人（配偶者・子）のいない人は名義を変えない（世帯にほかの人がいない・親だけの世帯）
          const h = base.input.household;
          const hasSpouse = h.relations.some((x) => x.type === "spouse" && (x.a === who || x.b === who));
          const hasChild = h.members.some((m) => m.kind === "child");
          if (!hasSpouse && !hasChild) continue;
          const r = run(req);
          const dy = Math.floor(D / 12);
          for (const f of flowsOf(r)) {
            if (f.member !== who || ym(f.ym) <= D) continue;
            const held = HELD.some((p) => f.formula.startsWith(p));
            // 亡くなった年より後に帰属する所得税・住民税（亡くなった後の所得の税）
            const laterTax = (f.row.startsWith("cf.taxSi.incomeTax") || f.row.startsWith("cf.taxSi.residentTax")) && (f.accrualYear ?? dy) > dy;
            if (held || laterTax) left.push(`${kind}+${off} ${f.formula} ${f.ym} ${f.amount}`);
          }
          // 亡くなった年の翌年からの年末の残高の行も、亡くなった人の名で出さない
          const bal = (r.annual as unknown as Cell[]).filter((c) => c.row.startsWith("cf.balance.account.") && c.member === who && c.year > dy && c.amount !== 0);
          for (const c of bal) left.push(`${kind}+${off} ${c.row} ${c.year} ${c.amount}`);
        }
      }
      expect(left.slice(0, 10)).toEqual([]);
    });
  }
});

/** 必要保障額（本人が亡くなる）。year を渡すとその年だけ（その年に亡くなる想定の表から組み立てる） */
type ProtYear = { year: number; need: number; breakdown: { resources: { publicSupport: number }; expenses: { other: number }; lumpResources: { dcLump: number; mutualAidLump?: number } } };
function protection(req: Req, who: string, year?: number): ProtYear[] {
  const q = clone(req) as Req & { input: { protection?: unknown; inheritanceTax?: unknown } };
  delete q.input.contingencies;
  delete q.input.inheritanceTax;
  q.input.protection = { members: [who], method: "accumulation", ...(year !== undefined ? { fromYear: year, toYear: year } : {}) };
  return (run(q) as unknown as { protection: { members: { years: ProtYear[] }[] } }).protection.members[0]?.years ?? [];
}

describe("修学支援の家計急変（生計維持者が亡くなった後に判定し直す。0170 の未確定・0173）", () => {
  it("salariedCoupleTwoKids で本人が亡くなった後の修学支援は、亡くなった本人の前の年の所得で変わらない", () => {
    const base = model("salariedCoupleTwoKids");
    const self = memberOf(base, "self") as string;
    kill(base, self, "2031-05");
    const low = clone(base) as unknown as { input: { household: { employmentPeriods: { member: string; salary?: { annual: { value: number } }; standardMonthlyRemuneration?: unknown }[] } } };
    for (const p of low.input.household.employmentPeriods) {
      if (p.member !== self) continue;
      delete p.standardMonthlyRemuneration;
      if (p.salary !== undefined) p.salary.annual.value = Math.round(p.salary.annual.value * 0.05);
    }
    const support = (r: EngineResult) => flowsOf(r).filter((f) => f.formula.startsWith("education.support.") && f.formula !== "education.support.highSchool" && ym(f.ym) > ym("2031-05")).reduce((s, f) => s + f.amount, 0);
    const a = support(run(base));
    expect(a).toBeGreaterThan(0);
    expect(support(run(low))).toBe(a);
  });

  it("必要保障額の近似（後の年に最初の年の表を使う）が、修学支援のある世帯でも、その年に亡くなる想定の額と30万円以内（前は約256万円）", () => {
    const req = model("salariedCoupleTwoKids");
    const self = memberOf(req, "self") as string;
    const all = protection(req, self);
    for (const year of [2029, 2032, 2035]) {
      const a = all.find((y) => y.year === year) as ProtYear;
      const e = protection(req, self, year)[0] as ProtYear;
      expect(a.breakdown.resources.publicSupport).toBe(e.breakdown.resources.publicSupport);
      expect(Math.abs(a.need - e.need)).toBeLessThan(300_000);
    }
  });
});

describe("必要保障額: 小規模企業共済の死亡一時金と、亡くなった人の車（0170 の未確定・0173）", () => {
  it("executiveOwner の本人の必要保障額は、共済の死亡を事由とする共済金（亡くなる年の前の年末の残高）を準備できる資金に数える", () => {
    const req = model("executiveOwner");
    const self = memberOf(req, "self") as string;
    const ys = protection(req, self);
    const y = ys.find((x) => x.year === 2027) as ProtYear;
    // 2026年末の残高 2,610,000円（掛金だけで運用益なし）
    expect(y.breakdown.lumpResources.mutualAidLump).toBe(2_610_000);
    // 計算基準年は計算基準月の前の残高（2,400,000円）
    expect(ys[0]?.breakdown.lumpResources.mutualAidLump).toBe(2_400_000);
  });

  it("亡くなった人の車（万一のときの扱いなし）の維持費は、場面の表のとおりに必要な資金のそのほかに入る", () => {
    const req = model("unexplainedSpending");
    const self = memberOf(req, "self") as string;
    const y = protection(req, self, 2028)[0] as ProtYear;
    const noCar = clone(req) as unknown as { input: { household: { cars?: { owner: string }[] } } };
    noCar.input.household.cars = (noCar.input.household.cars ?? []).filter((c) => c.owner !== self);
    const n = protection(noCar as unknown as Req, self, 2028)[0] as ProtYear;
    const r = (() => {
      const q = clone(req);
      kill(q, self, "2028-01");
      return run(q);
    })();
    const car = flowsOf(r).filter((f) => f.formula.startsWith("expense.car.") && f.row.startsWith("cf.expense.") && !f.row.startsWith("cf.expense.debt") && ym(f.ym) > ym("2028-01")).reduce((s, f) => s + f.amount, 0);
    expect(car).toBeGreaterThan(0);
    // 前は数えなかった（車を外したときと同じ額）
    expect(y.breakdown.expenses.other - n.breakdown.expenses.other).toBeGreaterThan(0);
  });
});
