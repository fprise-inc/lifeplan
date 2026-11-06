// 万一（死亡・障害・就業不能）・団信・保険・贈与・介護・医療・ストレステスト・必要保障額の部品（L1）。
// 新しい制度の値は【架空の見本】に無いので、製品の制度データ（原本での確認待ちの値を含む）で手計算と突き合わせる
import { describe, expect, it } from "vitest";
import { createSession, runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type {
  ContingencyEventOutput,
  CreditLifeOutput,
  DebtScheduleOutput,
  DisabilityPensionOutput,
  GiftTaxOutput,
  InsuranceIncomeOutput,
  InsurancePolicyOutput,
  SurvivorPensionOutput,
} from "../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = EngineRequest;
type Flow = EngineResult["flows"][number];
type Cell = { row: string; year: number; amount: number };
type Obj = Record<string, unknown>;
const H = uid("h");
const W = uid("w");
const C1 = uid("c1");
const C2 = uid("c2");
const at = (ym: string) => ({ at: ym });
const run = (req: Req) => runEngine(req, realPacks(), { checkInternal: true });
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const sumFlows = (fs: readonly Flow[], f: (x: Flow) => boolean) => fs.filter(f).reduce((s, x) => s + x.amount, 0);
const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
const spouse = { type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null };
const parentOf = (child: string) => [
  { type: "parentOf", parent: H, child },
  { type: "parentOf", parent: W, child },
];

/** 会社員の夫（1990年生まれ）・専業主婦の妻（1992年生まれ）・子2人（2022年・2025年生まれ） */
const family = (o: { endYear?: number; children?: boolean } = {}) =>
  household({
    baseMonth: "2026-10",
    endYear: o.endYear ?? 2060,
    members: [
      member("h", "self", "1990-05", { sex: "male" }),
      member("w", "spouse", "1992-08"),
      ...(o.children === false ? [] : [member("c1", "child", "2022-06"), member("c2", "child", "2025-09")]),
    ],
    relations: [spouse, ...(o.children === false ? [] : [...parentOf(C1), ...parentOf(C2)])],
    periods: [period("ph", { member: "h", from: "2013-04", annual: 6000000, std: [500000, 500000] })],
    residentTaxAssessments: [{ id: uid("rta"), member: H, fiscalYear: 2026, amount: box(300000) }],
  });
const withContingency = (req: Req, c: Obj) => edit(req, (_h, input) => (input.contingencies = [{ id: uid("cg"), ...c }]));
const selfEmployed = { id: uid("ph"), member: H, from: at("2010-04"), to: null, type: "selfEmployed", business: { income: box(4000000) } };
const death = (req: Req, ym: string, who = H, extra: Obj = {}) => withContingency(req, { kind: "death", member: who, occurs: at(ym), ...extra });

describe("万一の重ね（overlay）と判定の部品（contingency.event）", () => {
  it("死亡: その月で給与が止まり、翌月に世帯から離れる。見出しに万一の想定を返す", () => {
    const req = death(family({ endYear: 2034 }), "2030-06");
    const r = run(req);
    const salary = (ym: string) => sumFlows(r.flows, (f) => f.row.startsWith("cf.income.salary") && f.ym === ym && f.member === H);
    expect(salary("2030-06")).toBeGreaterThan(0);
    expect(salary("2030-07")).toBe(0);
    expect((r.header as { contingency?: { kind: string; member: string } }).contingency).toMatchObject({ kind: "death", member: H });
    const ev = call<ContingencyEventOutput>(req, "contingency.event", { member: H }).event;
    expect(ev).toMatchObject({ kind: "death", month: "2030-06" });
    expect(call<ContingencyEventOutput>(req, "contingency.event", { member: W }).event).toBeNull();
  });

  it("障害: 障害認定日は初診日から1年6か月。勤め先の健康保険なら、その間は休業（病気）で傷病手当金", () => {
    const req = withContingency(family({ endYear: 2034 }), { kind: "disability", member: H, occurs: at("2030-01"), grade: 2 });
    const ev = call<ContingencyEventOutput>(req, "contingency.event", { member: H }).event;
    expect(ev?.recognition).toBe("2031-07");
    const r = run(req);
    const benefit = r.flows.filter((f) => f.row.startsWith("cf.income.benefit") && f.member === H && f.formula?.startsWith("benefit.health"));
    expect(benefit.length).toBeGreaterThan(0);
    expect(benefit.every((f) => f.ym >= "2030-02" && f.ym <= "2031-08")).toBe(true);
    expect(sumFlows(r.flows, (f) => f.row.startsWith("cf.income.salary") && f.member === H && f.ym > "2030-01")).toBe(0);
  });

  it("就業不能で働けるようになる月があれば、その月から元の働き方に戻る", () => {
    const req = withContingency(family({ endYear: 2034 }), { kind: "incapacity", member: H, occurs: at("2030-01"), recovery: at("2031-01") });
    const r = run(req);
    const salary = (ym: string) => sumFlows(r.flows, (f) => f.row.startsWith("cf.income.salary") && f.ym === ym && f.member === H);
    expect(salary("2030-06")).toBe(0);
    expect(salary("2031-02")).toBeGreaterThan(0);
  });

  it("働き方の置き換え（workChanges。0085）: 万一の想定の有無によらず、期間の始まりからその人の働き方を置き換える", () => {
    // 妻（今は働いていない）が 2030-07 からパートで働く。万一の想定が無い要求でも、就業不能の想定と重ねても効く
    const part = { ...period("wp", { member: "w", from: "2030-07", to: "2057-07", annual: 1200000, healthInsurance: { kind: "national" }, pensionCategory: "none" }), type: "partTime" };
    const wife = (r: EngineResult, from: string, to: string) => sumFlows(r.flows, (f) => f.row.startsWith("cf.income.salary") && f.member === W && f.ym >= from && f.ym <= to);
    const plain = run(family({ endYear: 2034 }));
    const alone = run(edit(family({ endYear: 2034 }), (_h, input) => (input.workChanges = [part])));
    expect(wife(plain, "2026-10", "2034-12")).toBe(0);
    expect(wife(alone, "2026-10", "2030-06")).toBe(0);
    expect(wife(alone, "2030-07", "2030-12")).toBe(600000);
    const both = run(edit(withContingency(family({ endYear: 2034 }), { kind: "disability", member: H, occurs: at("2030-01"), grade: 2 }), (_h, input) => (input.workChanges = [part])));
    expect(wife(both, "2030-07", "2030-12")).toBe(600000);
    expect(sumFlows(both.flows, (f) => f.row.startsWith("cf.income.salary") && f.member === H && f.ym > "2030-01")).toBe(0);
    // 今の期間をまたぐ置き換え: 夫の会社員の期間は置き換えの前の月で終わり、その後は置き換えた期間
    const switched = run(edit(family({ endYear: 2034 }), (_h, input) => (input.workChanges = [{ ...period("hp", { member: "h", from: "2029-04", annual: 3000000, std: [250000, 250000] }) }])));
    const husband = (ym: string) => sumFlows(switched.flows, (f) => f.row.startsWith("cf.income.salary") && f.member === H && f.ym === ym);
    expect(husband("2029-03")).toBe(500000);
    expect(husband("2029-04")).toBe(250000);
    expect(() => run(edit(family({ endYear: 2034 }), (_h, input) => (input.workChanges = [{ ...part, member: uid("nobody") }])))).toThrow();
  });

  it("遺族の生活費は、末子の独立まで0.7・独立の後0.5（総額。万一の想定で書き換えられる）", () => {
    const base = edit(family({ endYear: 2050 }), (h) => (h.livingExpenses = [{ id: uid("lv"), mode: "total", monthly: box(300000) }]));
    const year = (req: Req, y: number) => sumFlows(call<{ flows: Flow[] }>(req, "expense.living", {}).flows, (f) => f.ym.startsWith(`${y}-`));
    const r1 = death(base, "2030-06");
    expect(year(r1, 2031)).toBe(300000 * 12 * 0.7);
    // 末子（2025年9月生まれ）が22歳に達した後の最初の3月31日（2048年3月）の翌月から0.5
    expect(year(r1, 2049)).toBe(300000 * 12 * 0.5);
    const r2 = death(base, "2030-06", H, { survivor: { livingRatio: { beforeIndependence: "0.8" } } });
    expect(year(r2, 2031)).toBe(300000 * 12 * 0.8);
  });

  it("子のいない世帯の遺族の生活費は、全期間0.7（万一の想定の noChildren で書き換えられる）", () => {
    const base = edit(family({ endYear: 2050, children: false }), (h) => (h.livingExpenses = [{ id: uid("lv"), mode: "total", monthly: box(300000) }]));
    const year = (req: Req, y: number) => sumFlows(call<{ flows: Flow[] }>(req, "expense.living", {}).flows, (f) => f.ym.startsWith(`${y}-`));
    const r1 = death(base, "2030-06");
    expect(year(r1, 2031)).toBe(300000 * 12 * 0.7);
    expect(year(r1, 2049)).toBe(300000 * 12 * 0.7);
    const r2 = death(base, "2030-06", H, { survivor: { livingRatio: { noChildren: "0.6" } } });
    expect(year(r2, 2049)).toBe(300000 * 12 * 0.6);
  });
});

describe("遺族年金（pension.survivor）", () => {
  it("子のある妻: 遺族基礎年金（子の加算）＋遺族厚生年金（300月みなし）。末子の18歳の年度末の後は中高齢寡婦加算", () => {
    const req = death(family(), "2030-06");
    const out = call<SurvivorPensionOutput>(req, "pension.survivor", { member: W });
    expect(out.deceased).toBe(H);
    const m = (ym: string) => out.months.find((x) => x.month === ym);
    expect(m("2030-06")).toBeUndefined();
    const first = m("2030-07");
    expect(first?.basic).toBeGreaterThan(0);
    expect(first?.employee).toBeGreaterThan(0);
    expect(first?.widowAddition).toBe(0);
    // 子が2人のときと1人（第1子が18歳の年度末の後）のときの差が2人目の子の加算
    const two = m("2040-01")?.basic ?? 0;
    const one = m("2041-04")?.basic ?? 0;
    expect(two).toBeGreaterThan(one);
    // 末子（2025年9月生まれ）の18歳の年度末（2044年3月）の後は遺族基礎年金が無く、妻は51歳なので中高齢寡婦加算（65歳まで）
    expect(m("2044-04")?.basic).toBe(0);
    expect(m("2044-04")?.widowAddition).toBeGreaterThan(0);
    // 65歳に達した月（2057年8月）まで
    expect(m("2057-08")?.widowAddition).toBeGreaterThan(0);
    expect(m("2057-09")?.widowAddition).toBe(0);
    // 偶数月に前2か月分
    expect(out.flows.every((f) => Number(f.ym.slice(5)) % 2 === 0)).toBe(true);
  });

  it("30歳未満で子の無い妻の遺族厚生年金は5年で終わる", () => {
    const req = edit(death(family({ children: false }), "2027-06"), (h) => ((h.members as Obj[])[1] = member("w", "spouse", "1998-08")));
    const out = call<SurvivorPensionOutput>(req, "pension.survivor", { member: W });
    const m = (ym: string) => out.months.find((x) => x.month === ym);
    expect(m("2032-06")?.employee).toBeGreaterThan(0);
    expect(m("2032-07")?.employee ?? 0).toBe(0);
  });

  it("2028年4月以後の死亡には、見直し前の制度で計算している知らせを必ず出す", () => {
    expect(notices(run(death(family({ endYear: 2034 }), "2028-04")))).toContainEqual(expect.objectContaining({ code: "N_REFORM_NOT_REFLECTED" }));
    expect(notices(run(death(family({ endYear: 2034 }), "2028-03"))).some((n) => n.code === "N_REFORM_NOT_REFLECTED")).toBe(false);
  });

  it("自営業の夫の死亡: 子が無ければ寡婦年金（60〜65歳）か死亡一時金の多い方", () => {
    const req = edit(death(family({ children: false }), "2040-06"), (h) => {
      h.employmentPeriods = [selfEmployed];
    });
    const out = call<SurvivorPensionOutput>(req, "pension.survivor", { member: W });
    const widow = out.months.filter((x) => x.widowPension > 0);
    expect(out.months.every((x) => x.basic === 0 && x.employee === 0)).toBe(true);
    if (widow.length > 0) {
      expect(widow[0]?.month).toBe("2052-09");
      expect(out.lumpSum).toBe(0);
    } else expect(out.lumpSum).toBeGreaterThan(0);
  });
});

describe("障害年金（pension.disability）", () => {
  it("障害認定日の翌月から。会社員は障害基礎年金（2級）＋障害厚生年金。自営業は障害基礎年金だけ", () => {
    const req = withContingency(family({ endYear: 2040 }), { kind: "disability", member: H, occurs: at("2030-01"), grade: 2 });
    const out = call<DisabilityPensionOutput>(req, "pension.disability", { member: H });
    expect(out.months.find((x) => x.month === "2031-07")).toBeUndefined();
    const m = out.months.find((x) => x.month === "2031-08");
    expect(m?.basic).toBeGreaterThan(0);
    expect(m?.employee).toBeGreaterThan(0);
    const g1 = call<DisabilityPensionOutput>(withContingency(family({ endYear: 2040 }), { kind: "disability", member: H, occurs: at("2030-01"), grade: 1 }), "pension.disability", { member: H });
    const m1 = g1.months.find((x) => x.month === "2031-08");
    // 1級は2級の1.25倍（子の加算・配偶者の加給年金額を除いて比べる代わりに、1級の方が多いことだけ確かめる）
    expect(m1?.basic).toBeGreaterThan(m?.basic ?? 0);
    expect(m1?.employee).toBeGreaterThan(m?.employee ?? 0);
    const self = edit(req, (h) => {
      h.employmentPeriods = [selfEmployed];
    });
    const s = call<DisabilityPensionOutput>(self, "pension.disability", { member: H }).months.find((x) => x.month === "2031-08");
    expect(s?.basic).toBe(m?.basic);
    expect(s?.employee).toBe(0);
  });
});

describe("団信（debt.creditLifeEvents と debt.schedule）", () => {
  const loan = (name: string, debtor: string, extra: Obj = {}) => ({
    id: uid(name),
    kind: "mortgage",
    debtors: [{ member: debtor, role: "primary" }],
    principal: 30000000,
    start: at("2026-12"),
    rateSchedule: [{ from: at("2027-01"), type: "fixed", rate: "0.01" }],
    repayment: { method: "equalPayment", termMonths: 420 },
    creditLife: { covered: [debtor], events: ["death"] },
    ...extra,
  });
  const yearEnd = (req: Req, id: string, y: number) =>
    call<DebtScheduleOutput>(req, "debt.schedule", { object: uid(id) }).yearEnd.find((x) => x.year === y)?.balance ?? 0;

  it("ペアローン: 亡くなった人のローンだけが、死亡の月の返済の後に消える", () => {
    const base = edit(family({ endYear: 2040 }), (h) => (h.debts = [loan("lh", H, { pairWith: uid("lw") }), loan("lw", W, { pairWith: uid("lh") })]));
    const req = death(base, "2030-06");
    expect(call<CreditLifeOutput>(req, "debt.creditLifeEvents", { object: uid("lh") }).events).toEqual([{ month: "2030-06", ratio: "1", cause: "death", member: H }]);
    expect(call<CreditLifeOutput>(req, "debt.creditLifeEvents", { object: uid("lw") }).events).toEqual([]);
    expect(yearEnd(req, "lh", 2029)).toBe(yearEnd(base, "lh", 2029));
    expect(yearEnd(req, "lh", 2030)).toBe(0);
    expect(yearEnd(req, "lw", 2030)).toBe(yearEnd(base, "lw", 2030));
    const r = run(req);
    expect(sumFlows(r.flows, (f) => f.object === uid("lh") && f.ym > "2030-06")).toBe(0);
  });

  it("連帯債務: 亡くなった人の負担割合だけ残高が減り、その後の返済も減る", () => {
    const joint = loan("lj", H, { debtors: [{ member: H, role: "primary", share: "0.6" }, { member: W, role: "joint", share: "0.4" }], creditLife: { covered: [H, W], events: ["death"] } });
    const base = edit(family({ endYear: 2040 }), (h) => (h.debts = [joint]));
    const req = death(base, "2030-06");
    expect(call<CreditLifeOutput>(req, "debt.creditLifeEvents", { object: uid("lj") }).events[0]?.ratio).toBe("0.6");
    // 残高の6割が消え、その後の返済も4割の残高で計算し直す（年末の残高は、万一なしの4割にほぼ等しい）
    const before = yearEnd(base, "lj", 2031);
    const after = yearEnd(req, "lj", 2031);
    expect(Math.abs(after - before * 0.4)).toBeLessThan(100);
  });

  it("夫婦連生は、どちらの死亡でも全額", () => {
    const joint = loan("lj", H, { debtors: [{ member: H, role: "primary", share: "0.6" }, { member: W, role: "joint", share: "0.4" }], creditLife: { covered: [H, W], events: ["death"], spouseJoint: true } });
    const req = death(edit(family({ endYear: 2040 }), (h) => (h.debts = [joint])), "2030-06", W);
    expect(call<CreditLifeOutput>(req, "debt.creditLifeEvents", { object: uid("lj") }).events[0]?.ratio).toBe("1");
  });
});

describe("保険（insurance.policy・insurance.income）", () => {
  const contract = (o: Obj) => ({
    id: uid("ins"),
    template: "insurance.wholeLife",
    policyholder: H,
    insured: H,
    contractDate: "2016-04",
    currency: "JPY",
    premium: { amount: 20000, frequency: "monthly", payUntil: at("2036-04") },
    deductionCategory: { type: "general", regime: "new" },
    ...o,
  });

  it("契約者＝被保険者の死亡保険金は相続税の対象（区分と知らせだけ）、契約者＝受取人なら一時所得、ほかは贈与税", () => {
    const cov = [{ id: uid("cov"), role: "main", benefit: "death", amount: 10000000 }];
    const mk = (policyholder: string, beneficiary: string) =>
      death(edit(family({ endYear: 2034 }), (h) => (h.insuranceContracts = [contract({ policyholder, beneficiaries: [{ member: beneficiary, share: "1" }], coverages: cov, simple: { returnRate: "0.9" } })])), "2030-06");
    const cls = (req: Req) => call<InsurancePolicyOutput>(req, "insurance.policy", { object: uid("ins") }).receipts.map((x) => [x.kind, x.taxClass, x.amount, x.ym]);
    expect(cls(mk(H, W))).toEqual([["death", "inheritance", 10000000, "2030-07"]]);
    expect(cls(mk(W, W))).toEqual([["death", "temporary", 10000000, "2030-07"]]);
    expect(cls(mk(W, C1))).toEqual([["death", "gift", 10000000, "2030-07"]]);
  });

  it("満期金の一時所得: (満期金−払込保険料−50万円)×1/2 を総所得金額に入れる", () => {
    const req = edit(family({ endYear: 2034 }), (h) => {
      h.insuranceContracts = [
        contract({
          template: "insurance.education",
          contractDate: "2022-07",
          premium: { amount: 10000, frequency: "monthly", payUntil: at("2032-07") },
          coverages: [{ id: uid("mat"), role: "main", benefit: "maturity", amount: 2000000, to: at("2032-07") }],
          deductionCategory: { type: "general", regime: "new" },
        }),
      ];
    });
    const out = call<InsurancePolicyOutput>(req, "insurance.policy", { object: uid("ins") });
    const mat = out.receipts.find((x) => x.kind === "maturity");
    expect(mat).toMatchObject({ ym: "2032-08", amount: 2000000, taxClass: "temporary", cost: 1200000 });
    const inc = call<InsuranceIncomeOutput>(req, "insurance.income", { member: H, year: 2032 });
    expect(inc.temporary).toBe(2000000 - 1200000 - 500000);
    expect(inc.temporaryIncluded).toBe(150000);
  });

  it("解約返戻金の残高は年末の解約返戻金（払込の累計×返戻率×経過の割合）", () => {
    const req = edit(family({ endYear: 2040 }), (h) => (h.insuranceContracts = [contract({ coverages: [{ id: uid("cov"), role: "main", benefit: "death", amount: 5000000 }], simple: { returnRate: "1.1" } })]));
    const out = call<InsurancePolicyOutput>(req, "insurance.policy", { object: uid("ins") });
    // 払込の終わり（2036年3月まで240か月）の後は 480万円×1.1 のまま
    expect(out.years.find((y) => y.year === 2038)?.surrenderValue).toBe(5280000);
    expect(out.years.find((y) => y.year === 2038)?.premium).toBe(0);
  });
});

describe("贈与税（gift.tax）: 国税庁の計算例", () => {
  const giftReq = (gifts: Obj[], recipientBirth = "1995-01") =>
    edit(
      household({ baseMonth: "2026-01", endYear: 2030, members: [member("a", "self", recipientBirth)] }),
      (h) =>
        (h.residences = [{ id: uid("home"), kind: "own", from: at("2026-04"), to: null, purchase: { price: 50000000, downPayment: 0, costs: 0, gifts }, ownership: [{ member: uid("a"), share: "1" }] }]),
    );
  const tax = (gifts: Obj[]) => call<GiftTaxOutput>(giftReq(gifts), "gift.tax", { member: uid("a"), year: 2026 });
  const A = uid("a");

  it("一般税率: 500万円 → (500万−110万)×20%−25万 = 53万円", () => {
    expect(tax([{ recipient: A, giver: "other", amount: 5000000, housingExemption: "none" }]).tax).toBe(530000);
  });
  it("特例税率（直系尊属から18歳以上）: 500万円 → (500万−110万)×15%−10万 = 48.5万円", () => {
    expect(tax([{ recipient: A, giver: "parent", amount: 5000000, housingExemption: "none" }]).tax).toBe(485000);
  });
  it("一般と特例の両方: 一般100万円・特例400万円 → 53万×1/5＋48.5万×4/5 = 49.4万円", () => {
    expect(tax([
      { recipient: A, giver: "other", amount: 1000000, housingExemption: "none" },
      { recipient: A, giver: "parent", amount: 4000000, housingExemption: "none" },
    ]).tax).toBe(494000);
  });
  it("相続時精算課税: 3,000万円 → (3,000万−110万−2,500万)×20% = 78万円", () => {
    const out = tax([{ recipient: A, giver: "parent", amount: 30000000, taxMethod: "settlement", housingExemption: "none" }]);
    expect(out.tax).toBe(780000);
    // 構成員でない贈与者は、贈与者の区分と援助の物で分ける
    expect(out.settlementRemaining).toEqual([{ giver: `parent|${uid("home")}`, remaining: 0 }]);
  });
  it("住宅取得等資金の非課税（省エネ等住宅1,000万円）と基礎控除で、1,110万円まで税は0。世帯の外からの贈与の税は翌年3月", () => {
    expect(tax([{ recipient: A, giver: "parent", amount: 11100000, housingExemption: "energySaving" }]).tax).toBe(0);
    const out = tax([{ recipient: A, giver: "parent", amount: 12100000, housingExemption: "energySaving" }]);
    expect(out.exempt).toBe(10000000);
    expect(out.tax).toBe(100000);
    expect(out.flows.map((f) => [f.row, f.ym, f.amount])).toEqual([["cf.taxSi.giftTax", "2027-03", 100000]]);
  });
});

describe("医療費（medical.highCost）・介護（care.expense）", () => {
  it("高額療養費（2027年8月診療分からの細分化の後）: 標準報酬月額50万円（第7区分。44万円以上53万円未満）で医療費100万円 → 110,400＋(100万−368,000)×1% = 116,720円。4回目から多数回該当 44,400円", () => {
    const req = withContingency(family({ endYear: 2032 }), { kind: "incapacity", member: H, occurs: at("2030-01"), medical: { monthly: 1000000, months: 6 } });
    const fs = call<{ flows: Flow[] }>(req, "medical.highCost", { member: H }).flows;
    const m = (ym: string) => sumFlows(fs, (f) => f.ym === ym);
    expect(m("2030-01")).toBe(116720);
    expect(m("2030-03")).toBe(116720);
    expect(m("2030-04")).toBe(44400);
  });

  it("介護保険の対象の費用は自己負担1割（65歳未満）、保険の対象外の費用と一時費用はそのまま", () => {
    const req = edit(family({ endYear: 2032 }), (h, input) => {
      (input.assumptions as Obj).inflation = { default: "0" };
      h.careExpenses = [{ id: uid("care"), member: W, from: at("2030-01"), months: 12, serviceMonthly: box(100000), otherMonthly: box(30000), initial: box(200000) }];
    });
    const fs = call<{ flows: Flow[] }>(req, "care.expense", {}).flows;
    expect(sumFlows(fs, (f) => f.ym === "2030-02")).toBe(10000 + 30000);
    expect(sumFlows(fs, (f) => f.ym.startsWith("2030"))).toBe(40000 * 12 + 200000);
    expect(sumFlows(fs, (f) => f.ym.startsWith("2031"))).toBe(0);
  });

  it("高額介護サービス費: 住民税が非課税で、年金収入等が基準（令和8年8月から82万6,500円）以下の人は個人の上限15,000円。1〜7月のサービスは前々年の所得で判定する", () => {
    const P = uid("p");
    const req = edit(family({ endYear: 2032 }), (h, input) => {
      (input.assumptions as Obj).inflation = { default: "0" };
      (h.members as Obj[]).push(member("p", "parent", "1950-03"));
      h.careExpenses = [{ id: uid("care"), member: P, from: at("2030-01"), months: 12, serviceMonthly: box(300000) }];
    });
    // 親: 公的年金等の収入 年70万円（偶数月に11万6,666円ほど）。2029年だけ、ほかに合計所得金額20万円
    const stubs = (pension: number) => ({
      "residentTax.exemption": (i: unknown) => ({ perCapitaExempt: (i as { member: string }).member === P, incomeLevyExempt: true, persons: 1 }),
      "tax.totalIncome": (i: unknown) => ({ total: (i as { year: number }).year === 2029 ? 200000 : 0, employment: 0, publicPension: 0 }),
      "pension.oldAge": () => ({ flows: [], months: [], payments: Array.from({ length: 8 }, (_, k) => 2026 + k).flatMap((y) => [2, 4, 6, 8, 10, 12].map((mo) => ({ ym: `${y}-${String(mo).padStart(2, "0")}`, part: "basic", amount: pension / 6, accrualYear: y }))) }),
    });
    const care = (pension: number) => runEngine(req, realPacks(), { checkInternal: true, entry: { component: "care.expense", input: {} }, stubs: stubs(pension) }).entryOutput as { flows: Flow[] };
    const month = (fs: { flows: Flow[] }, ym: string) => sumFlows(fs.flows, (f) => f.ym === ym && f.formula === "care.expense.service");
    const low = care(700002);
    // 2030年3月のサービス: 前々年（2028年）の 70万円 ≦ 80万9千円 → 個人15,000円（1割の30,000円から）
    expect(month(low, "2030-03")).toBe(15000);
    // 2030年9月のサービス: 前年（2029年）の 70万円＋20万円 ＞ 82万6,500円 → 世帯の上限24,600円
    expect(month(low, "2030-09")).toBe(24600);
    // 年金収入が基準を超える人は、非課税でも24,600円
    expect(month(care(900000), "2030-03")).toBe(24600);
  });

  it("介護保険の対象の費用（10割）を入れたとき、月々の費用は保険の対象外の費用として、自己負担の額に足す（合計ではない）", () => {
    const req = edit(family({ endYear: 2032 }), (h, input) => {
      (input.assumptions as Obj).inflation = { default: "0" };
      h.careExpenses = [{ id: uid("care"), member: W, from: at("2030-01"), months: 12, serviceMonthly: box(200000), otherMonthly: box(50000), initial: box(0) }];
    });
    const fs = call<{ flows: Flow[] }>(req, "care.expense", {}).flows;
    expect(sumFlows(fs, (f) => f.ym === "2030-03" && f.formula === "care.expense.service")).toBe(20000);
    expect(sumFlows(fs, (f) => f.ym === "2030-03" && f.formula === "care.expense.other")).toBe(50000);
  });

  it("介護を受ける人が亡くなる見込みの月からは、期間が残っていても介護の費用を出さない（世帯の外の家族）", () => {
    const P = uid("p");
    const req = edit(family({ endYear: 2040 }), (h, input) => {
      (input.assumptions as Obj).inflation = { default: "0" };
      (h.members as Obj[]).push({ ...member("p", "parent", "1950-03"), leaves: at("2031-06"), outside: { of: H, periods: [] } });
      h.careExpenses = [{ id: uid("care"), member: P, from: at("2030-01"), months: 60, otherMonthly: box(100000), initial: box(0) }];
    });
    const fs = call<{ flows: Flow[] }>(req, "care.expense", {}).flows;
    expect(sumFlows(fs, (f) => f.ym === "2031-05")).toBe(100000);
    expect(sumFlows(fs, (f) => f.ym >= "2031-06")).toBe(0);
    // 亡くなった後に始まる介護は、一時費用も出さない
    const later = edit(req, (h) => ((h.careExpenses as Obj[])[0]!.from = at("2032-01")));
    expect(sumFlows(call<{ flows: Flow[] }>(later, "care.expense", {}).flows, () => true)).toBe(0);
  });

  it("万一の想定で介護を受ける人が亡くなると、その月の翌月から介護の費用を出さない", () => {
    const req = death(
      edit(family({ endYear: 2040 }), (h, input) => {
        (input.assumptions as Obj).inflation = { default: "0" };
        h.careExpenses = [{ id: uid("care"), member: W, from: at("2030-01"), months: 60, otherMonthly: box(100000), initial: box(0) }];
      }),
      "2031-03",
      W,
    );
    const fs = call<{ flows: Flow[] }>(req, "care.expense", {}).flows;
    expect(sumFlows(fs, (f) => f.ym === "2031-03")).toBe(100000);
    expect(sumFlows(fs, (f) => f.ym >= "2031-04")).toBe(0);
  });

  it("何も入れなければ統計の既定（知らせ）", () => {
    const req = edit(family({ endYear: 2040 }), (h) => (h.careExpenses = [{ id: uid("care"), member: W, from: at("2030-01") }]));
    const r = run(req);
    expect(notices(r)).toContainEqual(expect.objectContaining({ code: "N_DEFAULT_USED" }));
    expect(sumFlows(r.flows, (f) => f.object === uid("care"))).toBeGreaterThan(0);
  });
});

describe("介護の自己負担割合・高額介護サービス費の判定の年と世帯（介護保険法施行令22条の2・22条の2の2）", () => {
  /** 年金生活の夫婦（夫1955年生まれ・妻1957年生まれ。2030年にどちらも65歳以上）。介護を受けるのは who */
  const couple = (who: string, service: number, extra: (h: Obj) => void = () => undefined) =>
    edit(household({ baseMonth: "2026-10", endYear: 2032, members: [member("h", "self", "1955-05", { sex: "male" }), member("w", "spouse", "1957-08")], relations: [spouse] }), (h, input) => {
      (input.assumptions as Obj).inflation = { default: "0" };
      h.careExpenses = [{ id: uid("care"), member: who, from: at("2030-01"), months: 24, serviceMonthly: box(service) }];
      extra(h);
    });
  type Stub = {
    /** 構成員×年の合計所得金額（公的年金等の雑所得は0とみなし、年金の収入も0にする。年金収入＋その他の合計所得＝合計所得金額） */
    total?: (member: string, year: number) => number;
    /** 構成員×年の課税所得 */
    taxable?: (member: string, year: number) => number;
    /** 構成員×年度の住民税の非課税 */
    exempt?: (member: string, fiscalYear: number) => boolean;
  };
  const stubs = (s: Stub) => ({
    "tax.totalIncome": (i: unknown) => {
      const { member: m, year } = i as { member: string; year: number };
      return { total: s.total?.(m, year) ?? 0, employment: 0, publicPension: 0 };
    },
    "incomeTax.annual": (i: unknown) => {
      const { member: m, year } = i as { member: string; year: number };
      return { flows: [], total: 0, taxable: s.taxable?.(m, year) ?? 0, computedTax: 0, reconstructionSurtax: 0, defenseSurtax: 0 };
    },
    "residentTax.exemption": (i: unknown) => {
      const { member: m, fiscalYear } = i as { member: string; fiscalYear: number };
      const e = s.exempt?.(m, fiscalYear) ?? false;
      return { perCapitaExempt: e, incomeLevyExempt: e, persons: 1 };
    },
    "pension.oldAge": () => ({ flows: [], months: [], payments: [] }),
  });
  const copay = (req: Req, s: Stub, ym: string) => {
    const fs = (runEngine(req, realPacks(), { checkInternal: true, entry: { component: "care.expense", input: {} }, stubs: stubs(s) }).entryOutput as { flows: Flow[] }).flows;
    return sumFlows(fs, (f) => f.ym === ym && f.formula === "care.expense.service");
  };

  it("自己負担割合: 1〜7月のサービスは前々年、8〜12月は前年の所得で判定する（22条の2第1項）", () => {
    // 夫が介護を受ける。合計所得金額は2028年だけ400万円（2割の段。3割は夫婦の合計463万円に届かない）
    const req = couple(H, 100000);
    const s: Stub = { total: (m, y) => (m === H && y === 2028 ? 4000000 : 0) };
    expect(copay(req, s, "2030-03")).toBe(20000);
    expect(copay(req, s, "2030-07")).toBe(20000);
    expect(copay(req, s, "2030-08")).toBe(10000);
    expect(copay(req, s, "2031-03")).toBe(10000);
  });

  it("自己負担割合の2割・3割は、世帯の65歳以上の人の年金収入＋その他の合計所得金額の合計で判定する（22条の2第4項1号・第7項1号）", () => {
    // 夫200万円・妻150万円: 夫だけでは346万円に届かないが、夫婦の合計350万円で2割
    const req = couple(H, 100000);
    expect(copay(req, { total: (m) => (m === H ? 2000000 : 1500000) }, "2030-09")).toBe(20000);
    // 夫300万円・妻170万円: 夫婦の合計470万円で3割（夫の合計所得金額が220万円以上）
    expect(copay(req, { total: (m) => (m === H ? 3000000 : 1700000) }, "2030-09")).toBe(30000);
    // 妻が65歳未満なら、一人の基準（280万円）で見て、妻の所得は足さない: 夫200万円 ＜ 280万円で1割
    const young = edit(req, (h) => ((h.members as Obj[])[1] = member("w", "spouse", "1970-08")));
    expect(copay(young, { total: (m) => (m === H ? 2000000 : 1500000) }, "2030-09")).toBe(10000);
  });

  it("住民税が非課税の人は、所得があっても1割（22条の2第4項2号）", () => {
    const req = couple(H, 100000);
    expect(copay(req, { total: () => 4000000, exempt: (m) => m === H }, "2030-09")).toBe(10000);
  });

  it("24,600円の段は、世帯の全員が住民税非課税のときだけ。介護を受ける妻が非課税でも、夫が課税なら44,400円（22条の2の2第7項1号）", () => {
    const req = couple(W, 600000);
    expect(copay(req, { exempt: (m) => m === W }, "2030-09")).toBe(44400);
    // 夫婦とも非課税で、妻の年金収入等が基準以下なら個人の上限15,000円。基準を超えれば24,600円
    expect(copay(req, { exempt: () => true }, "2030-09")).toBe(15000);
    expect(copay(req, { exempt: () => true, total: () => 1000000 }, "2030-09")).toBe(24600);
  });

  it("住民税の非課税は、4〜7月のサービスは前年度、8月からはその年度で見る（22条の2の2第7項1号）", () => {
    const req = couple(W, 600000);
    // 2029年度は夫婦とも非課税、2030年度は夫が課税
    const s: Stub = { total: () => 1000000, exempt: (m, fy) => m === W || fy <= 2029 };
    expect(copay(req, s, "2030-03")).toBe(24600);
    expect(copay(req, s, "2030-05")).toBe(24600);
    expect(copay(req, s, "2030-07")).toBe(24600);
    expect(copay(req, s, "2030-08")).toBe(44400);
  });

  it("課税の段（93,000円・140,100円）は、世帯の65歳以上の人のいずれかの課税所得で、1〜7月は前々年で判定する（22条の2の2第5項・第6項）", () => {
    // 妻が介護を受ける。夫の課税所得が2028年は400万円、2029年は700万円
    const req = couple(W, 2000000);
    const s: Stub = { taxable: (m, y) => (m === H ? (y === 2028 ? 4000000 : y === 2029 ? 7000000 : 0) : 0) };
    expect(copay(req, s, "2030-03")).toBe(93000);
    expect(copay(req, s, "2030-09")).toBe(140100);
    expect(copay(req, s, "2031-09")).toBe(44400);
  });

  it("世帯は、同居していない親・祖父母を分ける（別の世帯）", () => {
    // 同居していない母が介護を受ける: 母の世帯は母だけ（子の夫婦が課税でも24,600円）
    const P = uid("p");
    const req = couple(P, 600000, (h) => (h.members as Obj[]).push(member("p", "parent", "1935-03")));
    expect(copay(req, { total: () => 1000000, exempt: (m) => m === P }, "2030-09")).toBe(24600);
    // 同居している母なら、子の夫婦も同じ世帯: 夫が課税なら44,400円
    const living = couple(P, 600000, (h) => (h.members as Obj[]).push(member("p", "parent", "1935-03", { support: { dependent: false, cohabiting: true } })));
    expect(copay(living, { total: () => 1000000, exempt: (m) => m === P }, "2030-09")).toBe(44400);
  });
});

describe("亡くなった年の配偶者控除・扶養控除（所得税法85条3項・地方税法314条の2第8項: 死亡の時の現況で判定）", () => {
  type Ded = { spouse: number; spouseSpecial: number; dependents: number };
  const P = uid("p");
  /** 夫（会社員）・専業主婦の妻・同居して扶養する夫の母 */
  const withParent = (birth: string) =>
    edit(family({ endYear: 2034, children: false }), (h) => {
      (h.members as Obj[]).push(member("p", "parent", birth, { support: { dependent: true, cohabiting: true } }));
    });
  const ded = (req: Req, year: number, regime: "incomeTax" | "residentTax" = "incomeTax") =>
    call<Ded>(req, "tax.deductions", { member: H, year, regime });

  it("配偶者が亡くなった年は配偶者控除を受けられる（所得税・翌年度の住民税）。翌年からは受けない", () => {
    for (const ym of ["2030-01", "2030-06", "2030-12"]) {
      const req = death(family({ endYear: 2034, children: false }), ym, W);
      expect(ded(req, 2030).spouse).toBe(380000);
      expect(ded(req, 2030, "residentTax").spouse).toBe(330000);
      expect(ded(req, 2031).spouse).toBe(0);
      expect(ded(req, 2031, "residentTax").spouse).toBe(0);
    }
  });

  it("扶養する親が亡くなった年は扶養控除を受けられる。老人扶養親族かどうかも死亡の時に判定する", () => {
    // 1950年生まれ（80歳）の同居の母が2030年3月に亡くなる: 同居老親等（58万円）
    const elder = death(withParent("1950-04"), "2030-03", P);
    expect(ded(elder, 2030).dependents).toBe(580000);
    expect(ded(elder, 2030, "residentTax").dependents).toBe(450000);
    expect(ded(elder, 2031).dependents).toBe(0);
    // 1960年10月生まれの母が2030年3月（69歳）に亡くなる: 12月31日なら70歳だが、死亡の時は70歳未満なので一般（38万円）
    const young = death(withParent("1960-10"), "2030-03", P);
    expect(ded(young, 2030).dependents).toBe(380000);
    expect(ded(young, 2030, "residentTax").dependents).toBe(330000);
  });
});

describe("ストレステスト（stressTest）", () => {
  it("収入の減少: 指定の構成員の給与が3年間2割減り、見出しに展開の後の値を返す", () => {
    const base = family({ endYear: 2034 });
    const req = edit(base, (_h, input) => (input.stressTest = { template: "incomeDrop", params: { member: H, from: "2028-01" } }));
    const salary = (r: EngineResult, y: number) => sumFlows(r.flows, (f) => f.row.startsWith("cf.income.salary") && f.member === H && f.ym.startsWith(`${y}-`));
    const a = run(base);
    const b = run(req);
    expect(salary(b, 2028)).toBe(salary(a, 2028) - Math.floor(salary(a, 2028) * 0.2) || salary(b, 2028));
    expect(salary(b, 2028)).toBeLessThan(salary(a, 2028));
    expect(salary(b, 2031)).toBe(salary(a, 2031));
    expect((b.header as { stressTest?: { template: string } }).stressTest?.template).toBe("incomeDrop");
  });

  it("退職の年の相場下落: その年の年末の運用資産の時価が3割下がる", () => {
    const base = edit(family({ endYear: 2034 }), (h) => {
      h.accounts = [
        { id: uid("dep"), kind: "deposit", owner: H, marketValue: box(5000000), asOf: "2026-09", contributions: [] },
        { id: uid("tx"), kind: "taxable", owner: H, marketValue: box(10000000), asOf: "2026-09", contributions: [] },
      ];
    });
    const req = edit(base, (_h, input) => (input.stressTest = { template: "marketDropAtRetirement", params: { year: 2030 } }));
    const bal = (r: EngineResult, y: number) => (r.table as unknown as Cell[]).filter((c) => c.row === "cf.balance.account.taxable" && c.year === y).reduce((s, c) => s + c.amount, 0);
    const a = run(base);
    const b = run(req);
    expect(bal(b, 2029)).toBe(bal(a, 2029));
    expect(bal(b, 2030)).toBeLessThan(bal(a, 2030) * 0.75);
  });
});

describe("必要保障額の推移（protection.need）", () => {
  it("構成員ごとに亡くなる年ごとの必要保障額。金融資産を含めた額は含めない額以下。末子が小さいほど大きい", () => {
    const req = edit(family({ endYear: 2080 }), (h, input) => {
      h.livingExpenses = [{ id: uid("lv"), mode: "total", monthly: box(300000) }];
      h.accounts = [{ id: uid("dep"), kind: "deposit", owner: H, marketValue: box(5000000), asOf: "2026-09", contributions: [] }];
      input.protection = { members: [H], toYear: 2040 };
    });
    const r = run(req);
    const p = r.protection as { method: string; members: { member: string; survivor?: string; years: { year: number; need: number; needWithAssets: number; coverage: number }[] }[] };
    expect(p.method).toBe("accumulation");
    expect(p.members[0]?.member).toBe(H);
    expect(p.members[0]?.survivor).toBe(W);
    const ys = p.members[0]?.years ?? [];
    expect(ys.map((y) => y.year)).toEqual(Array.from({ length: 15 }, (_, i) => 2026 + i));
    expect(ys.every((y) => y.needWithAssets <= y.need)).toBe(true);
    expect((ys[0]?.need ?? 0) > (ys[ys.length - 1]?.need ?? 0)).toBe(true);
  });
});

describe("必要保障額の期間の終わり: 遺族が子（配偶者がいない）なら、標準は末子の独立まで（子の性別を使わない）", () => {
  type P = { members: { member: string; survivor?: string; years: { year: number; horizon: number; need: number }[] }[] };
  const single = (sex: "male" | "female", horizon?: Obj) =>
    edit(family({ endYear: 2130 }), (h, input) => {
      h.members = (h.members as Obj[]).filter((m) => m.kind !== "spouse").map((m) => (m.kind === "child" ? { ...m, sex } : m));
      h.relations = [{ type: "parentOf", parent: H, child: C1 }, { type: "parentOf", parent: H, child: C2 }];
      h.livingExpenses = [{ id: uid("lv"), mode: "total", monthly: box(250000) }];
      input.protection = { members: [H], toYear: 2035, ...(horizon !== undefined ? { horizon } : {}) };
    });
  const prot = (req: Req) => run(req).protection as P;
  it("遺族はいちばん上の子。期間の終わりは末子の独立の年で、子の性別を変えても結果は同じ", () => {
    const m = prot(single("male"));
    const f = prot(single("female"));
    expect(m.members[0]?.survivor).toBe(C1);
    // 末子（2025年9月生まれ）が22歳になった後の最初の3月末の翌月 = 2048年4月
    expect(new Set(m.members[0]?.years.map((y) => y.horizon))).toEqual(new Set([2048]));
    expect(f).toEqual(m);
    expect(prot(single("male", { kind: "youngestIndependence" }))).toEqual(m);
  });
  it("配偶者のいる世帯は今までどおり配偶者の平均余命まで（末子の独立より後）", () => {
    const req = edit(family({ endYear: 2130 }), (h, input) => {
      h.livingExpenses = [{ id: uid("lv"), mode: "total", monthly: box(250000) }];
      input.protection = { members: [H], toYear: 2030 };
    });
    const ys = prot(req).members[0]?.years ?? [];
    expect(prot(req).members[0]?.survivor).toBe(W);
    expect(ys.every((y) => y.horizon > 2048)).toBe(true);
  });
});

describe("必要保障額の推移と車の万一のときの扱い（protection.need 改訂2）", () => {
  const withCar = (owner: string, on?: Obj) =>
    edit(family({ endYear: 2080 }), (h, input) => {
      h.livingExpenses = [{ id: uid("lv"), mode: "total", monthly: box(300000) }];
      h.cars = [{ id: uid("car"), owner, purchase: { first: at("2027-04"), everyYears: 7, price: 2500000 }, parking: { annual: 240000 }, growth: { kind: "none" }, ...(on !== undefined ? { onContingency: on } : {}) }];
      input.protection = { members: [H], toYear: 2030 };
    });
  const need = (req: Req) => ((run(req).protection as { members: { years: { year: number; need: number }[] }[] }).members[0]?.years ?? []).map((y) => y.need);
  it("遺族の車を「止める」にすると必要保障額が減り、入れていなければ今までと同じ（遺族の車は続く）", () => {
    const none = need(edit(withCar(W), (h) => delete h.cars));
    const keep = need(withCar(W));
    const stop = need(withCar(W, { mode: "stop" }));
    const cont = need(withCar(W, { mode: "continue" }));
    expect(keep.every((v, i) => v > (none[i] ?? 0))).toBe(true);
    expect(cont).toEqual(keep);
    expect(stop.every((v, i) => v < (keep[i] ?? 0))).toBe(true);
  });
  it("亡くなった人の車は、入れていなければ数えず、「続ける」なら遺族の支出に足す", () => {
    const none = need(edit(withCar(H), (h) => delete h.cars));
    expect(need(withCar(H))).toEqual(none);
    expect(need(withCar(H, { mode: "stop" }))).toEqual(none);
    expect(need(withCar(H, { mode: "continue" })).every((v, i) => v > (none[i] ?? 0))).toBe(true);
  });
});

describe("セッション: 万一の枠を見ている枠（focus）にする（0005 の追記 2026-10-09）", () => {
  it("万一の画面を見ているときは、その万一の枠だけを先出しし、万一なしの枠は古い（stale）のまま", () => {
    const base = family({ endYear: 2040 });
    const session = createSession(JSON.stringify(realPacks()));
    session.set(JSON.stringify({ none: base, death: death(base, "2030-06") }));
    session.release();
    const changed = edit(base, (h) => (h.livingExpenses = [{ id: uid("lv"), mode: "total", monthly: box(250000) }]));
    const out = JSON.parse(session.slide(JSON.stringify({ none: changed, death: death(changed, "2030-06") }), "death")) as {
      focus: Record<string, { state: string; result: { header: { contingency?: { kind: string } } } }>;
      status: Record<string, { state: string }>;
    };
    expect(Object.keys(out.focus)).toEqual(["death"]);
    expect(out.focus.death?.result.header.contingency?.kind).toBe("death");
    expect(out.status.none?.state).toBe("stale");
  });
});
