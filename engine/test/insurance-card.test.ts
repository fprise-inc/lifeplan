// 保険のカードの計算（0054）: 医療・がんの給付（病気の想定のとき）、保障の行ごとの被保険者（家族特約）、変額・外貨建の円の目安の形、
// 数表の保障ごとの死亡保障の行（逓減定期）、払込保険料の累計、必要保障額の内訳と契約ごとの死亡保険金
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { InsuranceIncomeOutput, InsurancePolicyOutput } from "../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = EngineRequest;
type Obj = Record<string, unknown>;
const H = uid("h");
const W = uid("w");
const C1 = uid("c1");
const at = (ym: string) => ({ at: ym });
const run = (req: Req) => runEngine(req, realPacks(), { checkInternal: true });
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};

const family = (endYear = 2040) =>
  household({
    baseMonth: "2026-10",
    endYear,
    members: [member("h", "self", "1990-05", { sex: "male" }), member("w", "spouse", "1992-08"), member("c1", "child", "2022-06")],
    relations: [
      { type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null },
      { type: "parentOf", parent: H, child: C1 },
      { type: "parentOf", parent: W, child: C1 },
    ],
    periods: [period("ph", { member: "h", from: "2013-04", annual: 6000000, std: [500000, 500000] })],
    residentTaxAssessments: [{ id: uid("rta"), member: H, fiscalYear: 2026, amount: box(300000) }],
  });

const contract = (o: Obj) => ({
  id: uid("ins"),
  template: "insurance.medical",
  policyholder: H,
  insured: H,
  contractDate: "2020-04",
  currency: "JPY",
  premium: { amount: 5000, frequency: "monthly", payUntil: null },
  deductionCategory: { type: "careMedical", regime: "new" },
  ...o,
});
const medical = [
  { id: uid("hosp"), role: "main", benefit: "hospitalDaily", amount: 10000 },
  { id: uid("surg"), role: "rider", benefit: "surgery", amount: 100000 },
  { id: uid("can"), role: "rider", benefit: "cancerLump", amount: 1000000 },
  { id: uid("three"), role: "rider", benefit: "threeMajorLump", amount: 500000 },
];
const illness = (req: Req, who: string, ill: Obj | undefined, kind = "incapacity") =>
  edit(req, (_h, input) => (input.contingencies = [{ id: uid("cg"), kind, member: who, occurs: at("2030-06"), recovery: at("2031-06"), ...(ill !== undefined ? { illness: ill } : {}) }]));
const policy = (req: Req, id = uid("ins")) => call<InsurancePolicyOutput>(req, "insurance.policy", { object: id });
const lumps = (r: ReturnType<typeof run>, row = "cf.income.lumpSum.insurance") => r.flows.filter((f) => f.row === row).reduce((s, f) => s + f.amount, 0);

describe("医療・がんの給付（病気の想定のとき）", () => {
  const base = edit(family(), (h) => (h.insuranceContracts = [contract({ coverages: medical })]));

  it("がん・入院20日・手術1回: 入院 1万円×20日＋手術 10万円＋がん一時金 100万円＋三大疾病一時金 50万円 を、起きる月の翌月に非課税で受け取る", () => {
    const req = illness(base, H, { disease: "cancer", hospitalDays: 20, surgeries: 1 });
    const out = policy(req);
    const med = out.receipts.filter((x) => x.kind === "medical");
    expect(med.map((x) => [x.coverage, x.amount, x.ym, x.taxClass, x.member])).toEqual([
      [uid("hosp"), 200000, "2030-07", "none", H],
      [uid("surg"), 100000, "2030-07", "none", H],
      [uid("can"), 1000000, "2030-07", "none", H],
      [uid("three"), 500000, "2030-07", "none", H],
    ]);
    const r = run(req);
    expect(lumps(r)).toBe(1800000);
    // 非課税なので一時所得に入らない
    expect(call<InsuranceIncomeOutput>(req, "insurance.income", { member: H, year: 2030 }).temporary).toBe(0);
    expect(notices(r).some((n) => n.ids.includes("insurance.medicalBenefit"))).toBe(false);
  });

  it("心疾患・脳卒中は三大疾病一時金だけ（がん一時金なし）、そのほかの病気は入院と手術だけ。入院の日数は1回の限度日数で止める", () => {
    const heart = policy(illness(base, H, { disease: "heartStroke", hospitalDays: 30, surgeries: 2 })).receipts.filter((x) => x.kind === "medical");
    expect(heart.map((x) => x.amount)).toEqual([300000, 200000, 500000]);
    const capped = edit(base, (h) => (((h.insuranceContracts as Obj[])[0] as { coverages: Obj[] }).coverages[0] = { ...medical[0], maxDays: 60 }));
    const other = policy(illness(capped, H, { disease: "other", hospitalDays: 90 })).receipts.filter((x) => x.kind === "medical");
    expect(other.map((x) => x.amount)).toEqual([600000]);
    // 限度日数の省略は60日
    expect(policy(illness(base, H, { disease: "other", hospitalDays: 120 })).receipts.filter((x) => x.kind === "medical").map((x) => x.amount)).toEqual([600000]);
  });

  it("病気の想定が無ければ受け取りは計算せず、知らせを出す（前と同じ）。保障の期間の外・契約の前の病気は受け取らない", () => {
    const r = run(illness(base, H, undefined));
    expect(lumps(r)).toBe(0);
    expect(notices(r).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("insurance.medicalBenefit"))).toBe(true);
    const ended = edit(base, (h) => (((h.insuranceContracts as Obj[])[0] as { coverages: Obj[] }).coverages = medical.map((x) => ({ ...x, to: at("2029-12") }))));
    expect(policy(illness(ended, H, { disease: "cancer", hospitalDays: 20, surgeries: 1 })).receipts.filter((x) => x.kind === "medical")).toEqual([]);
  });

  it("死亡の想定には病気の想定を使わない（死亡保険金だけ）", () => {
    const req = edit(base, (_h, input) => (input.contingencies = [{ id: uid("cg"), kind: "death", member: H, occurs: at("2030-06"), illness: { disease: "cancer", hospitalDays: 20 } }]));
    expect(policy(req).receipts.filter((x) => x.kind === "medical")).toEqual([]);
  });
});

describe("保障の行ごとの被保険者（家族型の医療保険・家族特約）", () => {
  const fam = edit(family(), (h) =>
    (h.insuranceContracts = [
      contract({
        template: "insurance.term",
        premium: { amount: 8000, frequency: "monthly", payUntil: null },
        deductionCategory: { type: "general", regime: "new" },
        coverages: [
          { id: uid("dh"), role: "main", benefit: "death", amount: 10000000, to: at("2050-04") },
          { id: uid("dw"), role: "rider", benefit: "death", amount: 3000000, insured: W, to: at("2050-04") },
          { id: uid("hw"), role: "rider", benefit: "hospitalDaily", amount: 5000, insured: W },
        ],
      }),
    ]),
  );

  it("年末の死亡保障額は契約の被保険者の分だけで、配偶者の分は others に人ごと", () => {
    const y = policy(fam).years.find((e) => e.year === 2030);
    expect(y?.deathBenefit).toBe(10000000);
    expect(y?.others).toEqual([{ member: W, deathBenefit: 3000000 }]);
  });

  it("配偶者が亡くなったら配偶者の死亡保険金を契約者（夫）が一時所得で受け取り、契約は続く", () => {
    const req = edit(fam, (_h, input) => (input.contingencies = [{ id: uid("cg"), kind: "death", member: W, occurs: at("2030-06") }]));
    const out = policy(req);
    expect(out.receipts.map((x) => [x.kind, x.member, x.amount, x.taxClass])).toEqual([["death", H, 3000000, "temporary"]]);
    // 契約は配偶者の死亡では終わらない（主契約の満期まで）
    expect(out.endsAt).toBe("2050-05");
    expect(out.years.find((e) => e.year === 2031)?.deathBenefit).toBe(10000000);
    expect(out.years.find((e) => e.year === 2031)?.others).toBeUndefined();
  });

  it("配偶者の病気の想定で、配偶者の入院日額を受け取る（夫の病気では受け取らない）", () => {
    expect(policy(illness(fam, W, { disease: "other", hospitalDays: 10 })).receipts.map((x) => [x.kind, x.member, x.amount])).toEqual([["medical", W, 50000]]);
    expect(policy(illness(fam, H, { disease: "other", hospitalDays: 10 })).receipts).toEqual([]);
  });

  it("必要保障額の死亡保険金に、配偶者が被保険者の保障を配偶者の分として数え、契約ごとの内訳を出す", () => {
    const req = edit(fam, (h, input) => {
      h.livingExpenses = [{ id: uid("lv"), mode: "total", monthly: box(300000) }];
      input.protection = { members: [H, W], toYear: 2031 };
    });
    const p = run(req).protection as { members: { member: string; years: { year: number; coverage: number; coverageBy?: { object: string; amount: number }[] }[] }[] };
    const wife = p.members.find((m) => m.member === W)?.years.find((y) => y.year === 2030);
    expect(wife?.coverage).toBe(3000000);
    expect(wife?.coverageBy).toEqual([{ object: uid("ins"), amount: 3000000 }]);
    expect(p.members.find((m) => m.member === H)?.years.find((y) => y.year === 2030)?.coverage).toBe(10000000);
  });
});

describe("変額・外貨建の円の目安の形・逓減定期の数表・払込保険料の累計", () => {
  const variable = (simple: Obj, schedule?: Obj) =>
    edit(family(), (h) =>
      (h.insuranceContracts = [
        contract({
          template: "insurance.variable",
          contractDate: "2020-04",
          premium: { amount: 30000, frequency: "monthly", payUntil: at("2040-04") },
          deductionCategory: { type: "general", regime: "new" },
          coverages: [{ id: uid("dv"), role: "main", benefit: "death", amount: 5000000 }],
          simple,
          ...(schedule !== undefined ? { schedule } : {}),
        }),
      ]),
    );

  it("目安の形は積立金を伸ばさない: 死亡保障は入れた円の目安の額のまま、解約返戻金は数表の行の額だけ", () => {
    const grows = policy(variable({ assetClass: "equity.global", loadRate: "0.1" })).years.find((e) => e.year === 2039);
    expect((grows?.deathBenefit ?? 0) > 5000000).toBe(true);
    const est = policy(variable({ assetClass: "equity.global", loadRate: "0.1", estimate: true }, { rows: [{ policyYear: 17, surrenderValue: 6000000 }] })).years;
    expect(est.find((e) => e.year === 2039)?.deathBenefit).toBe(5000000);
    // 2036年末は16保険年度の終わり（数表の行が無いので0）、2037年末は17保険年度の終わり
    expect(est.find((e) => e.year === 2036)?.surrenderValue).toBe(0);
    expect(est.find((e) => e.year === 2037)?.surrenderValue).toBe(6000000);
  });

  it("保障の ID のある数表の死亡保障の行は、その保障の額だけを置き換える（ほかの死亡保障は残る）", () => {
    const req = edit(family(), (h) =>
      (h.insuranceContracts = [
        contract({
          template: "insurance.term",
          deductionCategory: { type: "general", regime: "new" },
          coverages: [
            { id: uid("dec"), role: "main", benefit: "death", amount: 30000000, to: at("2045-03") },
            { id: uid("rid"), role: "rider", benefit: "death", amount: 2000000, to: at("2045-03") },
          ],
          schedule: { rows: [{ policyYear: 11, coverage: uid("dec"), deathBenefit: 18000000 }] },
        }),
      ]),
    );
    const ys = policy(req).years;
    // 2030年12月は11保険年度（2030年4月〜）
    expect(ys.find((e) => e.year === 2030)?.deathBenefit).toBe(20000000);
    expect(ys.find((e) => e.year === 2031)?.deathBenefit).toBe(32000000);
  });

  it("年ごとの値に、契約の月からの払込保険料の累計を添える", () => {
    const ys = policy(variable({ estimate: true })).years;
    // 2020年4月から2026年12月まで81か月
    expect(ys.find((e) => e.year === 2026)?.paid).toBe(81 * 30000);
    expect(ys.find((e) => e.year === 2040)?.paid).toBe(240 * 30000);
  });
});

describe("必要保障額の内訳", () => {
  it("内訳の合計は必要な資金・準備できる資金と同じ", () => {
    const req = edit(family(2080), (h, input) => {
      h.livingExpenses = [{ id: uid("lv"), mode: "total", monthly: box(300000) }];
      input.protection = { members: [H], toYear: 2030, survivor: { funeral: 2000000, reserveMonths: 6, deathBenefits: { condolence: 500000 } } };
    });
    const p = run(req).protection as {
      members: { years: { expenses: number; resources: number; lumpSum: number; breakdown: { expenses: Record<string, number>; lump: Record<string, number>; resources: Record<string, number>; lumpResources: Record<string, number>; creditLife: number } }[] }[];
    };
    const ys = p.members[0]?.years ?? [];
    expect(ys.length).toBe(5);
    const total = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
    for (const y of ys) {
      expect(total(y.breakdown.expenses) + total(y.breakdown.lump)).toBe(y.expenses);
      expect(total(y.breakdown.lump)).toBe(y.lumpSum);
      expect(total(y.breakdown.resources) + total(y.breakdown.lumpResources)).toBe(y.resources);
      expect(y.breakdown.lump.funeral).toBe(2000000);
      expect(y.breakdown.lumpResources.condolence).toBe(500000);
      expect((y.breakdown.expenses.living ?? 0) > 0).toBe(true);
      expect((y.breakdown.resources.survivorPension ?? 0) > 0).toBe(true);
    }
  });
});
