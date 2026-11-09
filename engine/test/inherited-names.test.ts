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
type ProtYear = { year: number; need: number; breakdown: { resources: { publicSupport: number }; expenses: { other: number; housing: number; taxSi: number }; lumpResources: { dcLump: number; mutualAidLump?: number } } };
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

describe("必要保障額の近似: 亡くなる人の物件を売った後の年（0170 の2・0173）", () => {
  it("亡くなる人の物件を売った年の後は、その年の表を求め直す（rentalSample の本人。2041-10 に売る物件の譲渡所得の税）", () => {
    const req = model("rentalSample");
    const self = memberOf(req, "self") as string;
    const all = protection(req, self);
    for (const year of [2041, 2042, 2043]) {
      const a = all.find((y) => y.year === year) as ProtYear;
      const e = protection(req, self, year)[0] as ProtYear;
      // 前は 2042年が約553万円多かった（最初の年の表では配偶者が相続した物件を売り、2042〜43年の譲渡所得の税を配偶者の税に数えた。
      // 2042年に亡くなる想定では、売ったのは亡くなった本人で、その税は亡くなった人がまだ払っていない税として数える。下）
      expect(Math.abs(a.need - e.need)).toBeLessThan(300_000);
    }
    expect((all.find((y) => y.year === 2042) as ProtYear).need).toBe((protection(req, self, 2042)[0] as ProtYear).need);
  });
});

describe("必要保障額: 亡くなった人がまだ払っていない税（遺族が払う債務。0170 の追記）", () => {
  /** 亡くなる想定の表で、亡くなった人の名で亡くなった月より後に払う、死亡の年までの所得の税（所得税・住民税・事業税） */
  const unpaidIn = (req: Req, who: string, at: string) => {
    const q = clone(req);
    kill(q, who, at);
    const skip = ["cf.taxSi.incomeTax.capitalGains", "cf.taxSi.residentTax.capitalGains", "cf.taxSi.incomeTax.cryptoAsset", "cf.taxSi.residentTax.cryptoAsset"];
    const isTax = (row: string) => !skip.includes(row) && ["cf.taxSi.incomeTax", "cf.taxSi.residentTax", "cf.taxSi.businessTax"].some((p) => row === p || row.startsWith(`${p}.`));
    return flowsOf(run(q))
      .filter((f) => f.member === who && isTax(f.row) && ym(f.ym) > ym(at) && (f.accrualYear ?? 0) <= Number(at.slice(0, 4)))
      .reduce((s, f) => s + f.amount, 0);
  };

  it("rentalSample の本人が 2042年に亡くなる額は、2041年の物件の売却の譲渡所得の税と 2041年の所得の住民税を必要な資金（税と社会保険料）に数える", () => {
    const req = model("rentalSample");
    const self = memberOf(req, "self") as string;
    const unpaid = unpaidIn(req, self, "2042-01");
    // 譲渡所得の所得税 3,765,100円・住民税 1,229,200円、所得税の確定申告 300,017円、住民税 572,000円
    expect(unpaid).toBe(5_866_317);
    const all = protection(req, self);
    const a = all.find((y) => y.year === 2042) as ProtYear;
    const e = protection(req, self, 2042)[0] as ProtYear;
    // 前は遺族の税だけ（4,896,601円）
    expect(e.breakdown.expenses.taxSi).toBe(4_896_601 + unpaid);
    // 後の年に最初の年の表を使う額と、その年に亡くなる想定の額が同じ
    expect(a.breakdown.expenses.taxSi).toBe(e.breakdown.expenses.taxSi);
    expect(a.need).toBe(e.need);
  });

  it("計算基準年に亡くなる額は、場面の表の準確定申告（還付）と残りの住民税を数える（salariedCoupleTwoKids の本人）", () => {
    const req = model("salariedCoupleTwoKids");
    const self = memberOf(req, "self") as string;
    // 計算基準月（2026-10）に亡くなる想定
    const unpaid = unpaidIn(req, self, req.input.baseMonth);
    // 2025年の所得の住民税の残り（普通徴収に切り替わる）221,200円、2026年の所得の準確定申告の還付 −92,033円
    expect(unpaid).toBe(129_167);
    const y = protection(req, self)[0] as ProtYear;
    expect(y.year).toBe(2026);
    // 前は 6,044,706円
    expect(y.breakdown.expenses.taxSi).toBe(6_044_706 + unpaid);
  });

  it("後の年は、万一なしの計算の前の年の所得の税で数える（その年に亡くなる想定の表の額と数千円の違い。salariedCoupleTwoKids・sampleSelfEmployedFamily の本人）", () => {
    for (const name of ["salariedCoupleTwoKids", "sampleSelfEmployedFamily"]) {
      const req = model(name);
      const self = memberOf(req, "self") as string;
      const plain = clone(req);
      delete plain.input.contingencies;
      const noDeath = flowsOf(run(plain));
      const all = protection(req, self);
      for (const year of [2031, 2035]) {
        const at = `${year}-01`;
        const exact = unpaidIn(req, self, at);
        expect(exact).toBeGreaterThan(0);
        const skip = ["cf.taxSi.incomeTax.capitalGains", "cf.taxSi.residentTax.capitalGains", "cf.taxSi.incomeTax.cryptoAsset", "cf.taxSi.residentTax.cryptoAsset"];
        const fromPlan = noDeath
          .filter((f) => f.member === self && !skip.includes(f.row) && /^cf\.taxSi\.(incomeTax|residentTax|businessTax)(\.|$)/.test(f.row) && ym(f.ym) > ym(at) && f.accrualYear === year - 1)
          .reduce((s, f) => s + f.amount, 0);
        expect(Math.abs(fromPlan - exact)).toBeLessThan(10_000);
        // 後の年に最初の年の表を使う額と、その年に亡くなる想定の額は、前と同じく遺族の税の近似のずれだけ（まだ払っていない税はどちらも万一なしの
        // 計算から同じ額。前の年の所得で決まる遺族の住民税などで、sampleSelfEmployedFamily は約20万円）
        const a = all.find((y) => y.year === year) as ProtYear;
        const e = protection(req, self, year)[0] as ProtYear;
        expect(Math.abs(a.need - e.need)).toBeLessThan(300_000);
      }
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

  it("亡くなった人の車（万一のときの扱いなし）は手放す（利用者の判断 2026-11-09）ので、必要な資金のそのほかは「止める」と同じ", () => {
    const req = model("unexplainedSpending");
    const self = memberOf(req, "self") as string;
    const withOn = (on?: unknown) => {
      const q = clone(req) as unknown as { input: { household: { cars?: { owner: string; onContingency?: unknown }[] } } };
      for (const c of q.input.household.cars ?? []) if (c.owner === self && on !== undefined) c.onContingency = on;
      return q as unknown as Req;
    };
    const other = (q: Req) => (protection(q, self, 2028)[0] as ProtYear).breakdown.expenses.other;
    const r = (() => {
      const q = clone(req);
      kill(q, self, "2028-01");
      return run(q);
    })();
    // 前は相続する人が持ち続け、2029-04 の買い替えと維持費が続いた（場面の表の車のお金は約439万円〔ローンの返済を含む〕）
    const car = flowsOf(r).filter((f) => f.formula.startsWith("expense.car.") && ym(f.ym) > ym("2028-01")).reduce((s, f) => s + f.amount, 0);
    expect(car).toBe(0);
    expect(other(req)).toBe(other(withOn({ mode: "stop" })));
    // 「続ける」を入れれば前の既定のとおり数える
    expect(other(withOn({ mode: "continue" }))).toBeGreaterThan(other(req));
  });
});

describe("亡くなった人の車（万一のときの扱いなし）は手放す（利用者の判断 2026-11-09。0173 の追記）", () => {
  type CarX = { id: string; owner: string; onContingency?: unknown };
  const carsOf = (req: Req) => (req.input.household as unknown as { cars: CarX[] }).cars;
  const scenario = (edit?: (req: Req) => void, kind: "death" | "disability" = "death") => {
    const req = model("dualAssetsTwoKids");
    const self = memberOf(req, "self") as string;
    edit?.(req);
    req.input.contingencies = [{ id: uid(`car-${kind}`), kind, member: self, occurs: { at: "2033-06" }, ...(kind === "disability" ? { grade: 2 } : {}) }];
    return { req, self, sp: memberOf(req, "spouse") as string, r: run(req) };
  };
  const after = (r: EngineResult, car: string, pred: (f: FlowX) => boolean = () => true) => flowsOf(r).filter((f) => f.object === car && ym(f.ym) > ym("2033-06") && pred(f));
  const isLoan = (f: FlowX) => f.row.startsWith("cf.expense.debt");

  it("dualAssetsTwoKids で本人が 2033-06 に亡くなったら、本人の車の買い替え・維持費は止まり、2032-04 に組んだローンの返済は配偶者が続ける", () => {
    const { req, sp, r } = scenario();
    const [mine, theirs] = carsOf(req) as [CarX, CarX];
    // 前は配偶者が持ち続け、2040-04 からの買い替え・車検・保険・自動車税が続いた
    expect(after(r, mine.id, (f) => !isLoan(f))).toEqual([]);
    const loan = after(r, mine.id, isLoan);
    expect(loan.length).toBeGreaterThan(0);
    expect(loan.every((f) => f.member === sp)).toBe(true);
    // 亡くなる前に組んだローン（2032-04 から60回）だけ。前は 2040-04 の買い替えのローンも続いた
    expect(loan.map((f) => f.ym).sort().at(-1)).toBe("2037-04");
    // 配偶者の車は今までどおり（2038-04 の買い替え）
    expect(after(r, theirs.id, (f) => f.formula === "expense.car.purchase").length).toBeGreaterThan(0);
    // 手放した車は、亡くなった年の年末から評価額を持たない（手放す時期と同じ。売却の手取りは入れない）
    const bal = (r.annual as unknown as (Cell & { object?: string })[]).filter((c) => c.row === "cf.balance.account.car" && c.object === mine.id && c.amount !== 0);
    expect(bal.map((c) => c.year).every((y) => y < 2033)).toBe(true);
    expect(bal.some((c) => c.year === 2032)).toBe(true);
  });

  it("「続ける」を入れた車は、相続する人が持ち続ける（前の既定のまま）", () => {
    const { sp, r, req } = scenario((q) => ((carsOf(q)[0] as CarX).onContingency = { mode: "continue" }));
    const mine = carsOf(req)[0] as CarX;
    const buys = after(r, mine.id, (f) => f.formula === "expense.car.purchase");
    expect(buys.length).toBeGreaterThan(0);
    expect(buys.every((f) => f.member === sp)).toBe(true);
    expect((r.annual as unknown as (Cell & { object?: string })[]).some((c) => c.row === "cf.balance.account.car" && c.object === mine.id && c.year === 2045 && c.amount > 0)).toBe(true);
  });

  it("必要保障額の近似（後の年に最初の年の表を使う）でも、亡くなる前に組んだ自動車ローンの返済を住居費に数える（前は 2041年に約152万円抜けた）", () => {
    const req = model("dualAssetsTwoKids");
    const self = memberOf(req, "self") as string;
    const all = protection(req, self);
    for (const year of [2033, 2035, 2037, 2041, 2043]) {
      const a = all.find((y) => y.year === year) as ProtYear;
      const e = protection(req, self, year)[0] as ProtYear;
      expect(a.breakdown.expenses.housing).toBe(e.breakdown.expenses.housing);
    }
  });

  it("「やめる」を入れた車も、万一の月より後の年末に評価額を持たない（利用者の判断 2026-11-09。配偶者の車でも、本人の死亡で止める）", () => {
    const { r, req } = scenario((q) => {
      for (const c of carsOf(q)) c.onContingency = { mode: "stop" };
    });
    const balOf = (car: string) => (r.annual as unknown as (Cell & { object?: string })[]).filter((c) => c.row === "cf.balance.account.car" && c.object === car && c.amount !== 0).map((c) => c.year);
    for (const c of carsOf(req)) {
      // 前は万一の後も買い替えたとして 2077年まで評価額が出た
      expect(balOf(c.id).every((y) => y < 2033)).toBe(true);
      expect(balOf(c.id)).toContain(2032);
      expect(after(r, c.id, (f) => !isLoan(f))).toEqual([]);
    }
  });

  it("名義の人の障害（死亡でない万一）では、車は今までどおり続く", () => {
    const { r, req } = scenario(undefined, "disability");
    const mine = carsOf(req)[0] as CarX;
    expect(after(r, mine.id, (f) => f.formula === "expense.car.purchase").length).toBeGreaterThan(0);
  });
});
