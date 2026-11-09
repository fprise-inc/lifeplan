// 必要保障額・死亡の想定・相続税の目安の見張り（0170。調べる係の R1 の再現のテストから）
// 必要保障額（protection.need）は、同じ月の死亡の想定で全体を計算し直した表（万一のタブの場面の表）から遺族の収支を組み立てる。区画ごとに表と合うかを見る
import { describe, expect, it } from "vitest";
import { runBatch, runEngine } from "../src/engine/run.ts";
import { household, member, modelHousehold, period, realPacks, uid, box } from "./helpers.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const model = (name: string): Any => modelHousehold(name);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const run = (req: Any): Any => runEngine(clone({ ...req, trace: "none" }), realPacks());
const ym = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
const DEATH_ID = "0b1e6d2a-1111-4c3b-9d1e-0000000000d1";
const self = (req: Any) => req.input.household.members.find((m: Any) => m.kind === "self");

/** 必要保障額の1年分（本人が亡くなる。期間の終わりは遺族が85歳のときにそろえる） */
function need(req: Any, year: number, extra: Any = {}): Any {
  const q = clone(req);
  delete q.input.contingencies;
  delete q.input.inheritanceTax;
  q.input.protection = { members: [self(req).id], method: "accumulation", fromYear: year, toYear: year, horizon: { kind: "age", age: 85 }, ...extra };
  return run(q).protection.members[0].years[0];
}
/** 同じ月に本人が亡くなる想定で全体を計算し直した表のお金の動き */
function death(req: Any, at: string, survivor?: Any): Any {
  const q = clone(req);
  delete q.input.protection;
  delete q.input.inheritanceTax;
  q.input.contingencies = [{ id: DEATH_ID, kind: "death", member: self(req).id, occurs: { at }, ...(survivor ? { survivor } : {}) }];
  return run(q);
}
/** 遺族が85歳になる月まで（表の終わりで切る） */
function window(req: Any, y: Any): [number, number] {
  const h = req.input.household;
  const z = h.members.find((m: Any) => m.kind === "spouse");
  return [ym(y.death) + 1, Math.min(ym(z.birth.birthYearMonth) + 85 * 12, req.input.endYear * 12 + 11)];
}
const sumFlows = (r: Any, [a, b]: [number, number], pick: (f: Any) => boolean) =>
  (r.flows as Any[]).filter((f) => ym(f.ym) >= a && ym(f.ym) <= b && pick(f)).reduce((s, f) => s + f.amount, 0);

describe("R1 必要保障額の組み立て（近道と全体の計算の食い違い）", () => {
  it("R1-001 遺族の税と社会保険料: 自営業の夫が亡くなった後も、夫の所得で計算した世帯の国保の保険料を数える（survivorSelfEmployed）", () => {
    const req = model("survivorSelfEmployed");
    const y = need(req, 2027);
    const r = death(req, y.death);
    const w = window(req, y);
    const X = self(req).id;
    // 全体の計算で遺族が払う税と社会保険料（遺族の名の行＋世帯主の名で出る国保の行）
    const full = sumFlows(r, w, (f) => f.row.startsWith("cf.taxSi") && (f.member !== X || String(f.formula).startsWith("socialInsurance.nationalHealth")) && req.input.household.members.find((m: Any) => m.id === f.member)?.kind !== "child");
    // 近道は 23,296,532 円、全体は 約606万円（約1,720万円多い）
    expect(y.breakdown.expenses.taxSi).toBeLessThan(full * 1.1);
  });

  it("R1-001 遺族の税と社会保険料: 会社員の夫が亡くなった後の、妻の国民年金・国保の保険料を数えない（protectionNeed）", () => {
    const req = model("protectionNeed");
    const y = need(req, 2027);
    const r = death(req, y.death);
    const w = window(req, y);
    const W = req.input.household.members.find((m: Any) => m.kind === "spouse").id;
    const np = sumFlows(r, w, (f) => f.member === W && f.formula === "socialInsurance.nationalPension.monthly");
    expect(np).toBeGreaterThan(5_000_000); // 全体の計算では妻が国民年金を 5,180,060 円払う
    // 近道の税と社会保険料の内訳には、この国民年金が入っていない（4,447,053 円の中身は夫の退職の後の国保など）
    expect(y.breakdown.expenses.taxSi).toBeGreaterThanOrEqual(np);
  });

  it("R1-002 介護: 亡くなった本人の将来の介護の費用と、世帯の外の親が自分のお金で払う介護の費用を、遺族の必要な資金に数える（sampleParentsCare）", () => {
    const req = model("sampleParentsCare");
    const y = need(req, 2027);
    const r = death(req, y.death);
    const tableCare = sumFlows(r, window(req, y), (f) => f.row.startsWith("cf.expense.care"));
    // 近道 17,299,091 円、全体の表 8,980,426 円の半分ほど（本人の介護 4,324,184 円・父が預金から払う介護 約832万円）
    expect(y.breakdown.expenses.care).toBeLessThanOrEqual(tableCare + 10_000);
  });

  it("R1-003 収益不動産: 物件のローンの返済は住居費に数えるのに、家賃・売却の代金・物件の経費は数えない（rentalSample）", () => {
    const req = model("rentalSample");
    const a = need(req, 2027);
    const q = clone(req);
    for (const acc of q.input.household.accounts) if (acc.kind === "realEstate" && acc.property?.rental?.monthly) acc.property.rental.monthly = box(Math.round((acc.property.rental.monthly.value ?? 0) * 2));
    const b = need(q, 2027);
    // 家賃を倍にすると遺族の収入が増える（前は家賃を見ず、物件のローンの返済 5,980万円だけを住居費に入れていた）
    expect(b.breakdown.resources.survivorIncome).toBeGreaterThan(a.breakdown.resources.survivorIncome);
    // 表の家賃・売却の代金を遺族の収入に、物件の経費をそのほかに、物件のローンの返済を住居費に数える
    const r = death(req, a.death);
    const w = window(req, a);
    const rent = sumFlows(r, w, (f) => f.row === "cf.income.other.rental" || f.row === "cf.income.lumpSum.realEstateSale");
    expect(rent).toBeGreaterThan(100_000_000);
    expect(a.breakdown.resources.survivorIncome).toBeGreaterThanOrEqual(rent);
    expect(a.breakdown.expenses.housing).toBeGreaterThanOrEqual(sumFlows(r, w, (f) => f.object === "26a240e9-79c4-478d-b52a-cafd73257991" && f.row.startsWith("cf.expense")));
  });

  it("R1-004 死亡退職金: 死亡の想定の全体の計算では、勤続の月数で按分せず、定年まで勤めた見込み額をそのまま受け取る（salariedCoupleTwoKids）", () => {
    const req = model("salariedCoupleTwoKids");
    const r = death(req, "2027-01");
    const got = (r.flows as Any[]).filter((f) => f.formula === "retirement.benefit.deathAllowance").reduce((s, f) => s + f.amount, 0);
    // 見込み 1,800万円 × 勤続（2004-04〜2027-01 の 274か月）÷（2004-04〜2041-06 の 447か月）＝ 11,033,557 円（retirement.benefit の頭の決まり・必要保障額と同じ）
    expect(got).toBe(11_033_557);
  });

  it("R1-005 住宅購入の予定の前に本人が亡くなる: 全体の計算は亡くなった本人を債務者とするローンを亡くなった後に始めて遺族が返し、必要保障額は団信で消えたとみなす（housingPurchase）", () => {
    const req = model("housingPurchase");
    const y = need(req, 2027);
    const r = death(req, y.death);
    const loanRepaid = sumFlows(r, window(req, y), (f) => f.row.startsWith("cf.expense.housing.loan"));
    // 前は全体の計算で 56,317,416 円を遺族が返し、近道は同じ額を団信で消える返済として住居費から外していた。
    // 今は、亡くなった人はローンを組めないので借入の額を購入の月に現金で払う（debt.schedule 改訂7）。どちらの計算も同じ
    expect(loanRepaid).toBe(0);
    expect(y.breakdown.creditLife).toBe(0);
    const cash = (r.flows as Any[]).filter((f) => f.formula === "debt.schedule.cashInstead");
    expect(cash.length).toBe(1);
    expect(cash[0].row).toBe("cf.expense.housing.purchase");
    expect(cash[0].ym).toBe("2028-03");
    expect((r.header.notices as Any[]).some((n) => n.code === "N_ESTIMATED" && n.ids.includes("debt.startsAfterDeath"))).toBe(true);
    expect(y.breakdown.expenses.housing).toBe(sumFlows(r, window(req, y), (f) => f.row.startsWith("cf.expense.housing") || f.row.startsWith("cf.expense.debt")));
  });

  it("R1-006 加入中の死亡保険金: 亡くなる月は1月なのに、その年の年末の死亡保障額を見るので、年の途中で終わる定期保険が0円・収入保障が11か月分少ない", () => {
    const req = model("protectionNeed");
    const S = self(req).id;
    const W = req.input.household.members.find((m: Any) => m.kind === "spouse").id;
    req.input.household.insuranceContracts.push({
      id: "0b1e6d2a-4444-4c3b-9d1e-0000000000e1",
      template: "insurance.termLife",
      policyholder: S,
      insured: S,
      contractDate: "2015-07",
      currency: "JPY",
      premium: { amount: 5000, frequency: "monthly", payUntil: { at: "2030-06" } },
      deductionCategory: { type: "general", regime: "new" },
      beneficiaries: [{ member: W, share: "1" }],
      coverages: [{ id: "0b1e6d2a-4444-4c3b-9d1e-0000000000e2", role: "main", benefit: "death", amount: 30_000_000, to: { at: "2030-06" } }],
    });
    const y = need(req, 2030);
    const r = death(req, y.death);
    const paid = sumFlows(r, [ym(y.death), ym(y.death) + 300], (f) => f.object === "0b1e6d2a-4444-4c3b-9d1e-0000000000e1" && f.row.startsWith("cf.income"));
    expect(paid).toBe(30_000_000); // 2030-01 に亡くなれば受け取る
    expect(y.coverageBy.find((c: Any) => c.object === "0b1e6d2a-4444-4c3b-9d1e-0000000000e1")?.amount ?? 0).toBe(30_000_000); // 前は無かった（0円）
    // 収入保障保険（月10万円・2046年1月まで）は、亡くなる月の残り（2027年1月から 228か月）で数える（前は年末の 217か月）
    const z = need(model("protectionNeed"), 2027);
    const r2 = death(model("protectionNeed"), z.death);
    const ip = sumFlows(r2, [ym(z.death), ym(z.death) + 400], (f) => f.formula === "insurance.policy.incomeProtection");
    expect(z.coverage).toBe(ip);
  });

  it("R1-007 教育費: 奨学金の受け取り（入るお金）を教育費（出るお金）に足す（educationTwoKids）", () => {
    const req = model("educationTwoKids");
    const y = need(req, 2027);
    const r = death(req, y.death);
    const w = window(req, y);
    const fromTable = sumFlows(r, w, (f) => f.row.startsWith("cf.expense.education"));
    // 前は 23,529,844 円＝表の教育費と結婚の援助 20,937,844 円＋奨学金の受け取り 2,592,000 円。奨学金の受け取りは公的な支援（準備できる資金）に
    expect(y.breakdown.expenses.education).toBe(fromTable);
    expect(y.breakdown.resources.publicSupport).toBeGreaterThanOrEqual(sumFlows(r, w, (f) => f.row === "cf.income.other.scholarship"));
  });

  it("R1-008 住居費: 住宅購入の親からの援助（入るお金 2,300万円）を住居費（出るお金）に足す（housingGiftFromParents）", () => {
    const req = model("housingGiftFromParents");
    const a = need(req, 2027);
    const q = clone(req);
    for (const res of q.input.household.residences) if (res.purchase) delete res.purchase.gifts;
    const b = need(q, 2027);
    // 援助あり 47,031,565 円・援助なし 24,031,565 円。援助を受けると住居費が 2,300万円増える
    expect(a.breakdown.expenses.housing).toBeLessThanOrEqual(b.breakdown.expenses.housing);
  });

  it("R1-009 公的な支援: 亡くなった後に受けられる高等教育の修学支援（給付の奨学金・授業料の減免）と年金生活者支援給付金を、準備できる資金に数えない（salariedCoupleTwoKids）", () => {
    const req = model("salariedCoupleTwoKids");
    const y = need(req, 2027);
    const r = death(req, y.death);
    const full = sumFlows(r, window(req, y), (f) => f.row === "cf.income.benefit.education" || f.row === "cf.income.benefit.childAllowance");
    // 近道 3,128,000 円、全体の計算 約1,468万円（修学支援 約1,155万円）
    expect(y.breakdown.resources.publicSupport).toBeGreaterThanOrEqual(full * 0.9);
  });
});

describe("R1 相続税の目安", () => {
  it("R1-010 死亡の想定の時点: 収入保障保険の年金（相続税の対象）を財産に数えない。いまの時点では死亡保障額 2,290万円を数える（protectionNeed）", () => {
    const req = model("protectionNeed");
    const q = clone(req);
    delete q.input.protection;
    q.input.contingencies = [{ id: DEATH_ID, kind: "death", member: self(req).id, occurs: { at: "2027-01" } }];
    q.input.inheritanceTax = { points: ["contingency"] };
    const p = run(q).inheritanceTax.points[0];
    // 全体の計算では、契約者・被保険者が本人、受取人が妻の収入保障で、月10万円を2046年1月まで（228か月・2,280万円）受け取る（相続税法3条1項1号・24条）
    expect(p.assets.insurance).toBeGreaterThan(0);
  });

  it("R1-011 二人とも亡くなった後: 先に亡くなった夫の団信つき住宅ローンの残高を、後に亡くなる妻の債務として引く", () => {
    const H = uid("h"), W = uid("w"), C1 = uid("c1"), C2 = uid("c2");
    const req: Any = household({
      baseMonth: "2026-01",
      endYear: 2030,
      members: [{ ...member("h", "self", "1960-04"), sex: "male" }, member("w", "spouse", "1962-04"), member("c1", "child", "1990-05"), member("c2", "child", "1992-05")],
      relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }, ...[C1, C2].flatMap((c) => [{ type: "parentOf", parent: H, child: c }, { type: "parentOf", parent: W, child: c }])],
      accounts: [{ id: uid("dep"), kind: "deposit", owner: H, marketValue: box(80_000_000), asOf: "2026-01", contributions: [] }],
    });
    req.input.household.debts = [
      { id: uid("loan"), kind: "mortgage", debtors: [{ member: H, role: "primary" }], principal: 20_000_000, start: { at: "2025-12" }, rateSchedule: [{ from: { at: "2025-12" }, type: "fixed", rate: "0" }], repayment: { method: "equalPayment", termMonths: 240 }, creditLife: { covered: [H] } },
    ];
    req.input.inheritanceTax = { points: ["bothAfter"] };
    const p = run(req).inheritanceTax.points[0];
    expect(p.decedent).toBe(W);
    // 夫が先に亡くなっていれば団信で残高は消えている（今は 15,000,020 円を引く）
    expect(p.assets.debts).toBe(0); // 前は 15,000,020 円を引いていた
  });
});

describe("R1 遺族年金", () => {
  it("R1-012 妻（会社員）が亡くなり夫が55歳未満・子あり: 遺族厚生年金を夫の名で出す（受給権は子。厚生年金保険法59条1項・66条1項）", () => {
    const H = uid("r1.h"), W = uid("r1.w"), K = uid("r1.k");
    const req: Any = household({
      baseMonth: "2026-10",
      endYear: 2040,
      members: [member("r1.h", "self", "1984-05", { sex: "male" }), member("r1.w", "spouse", "1986-06"), member("r1.k", "child", "2020-04")],
      relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: { at: "2015-04" }, to: null }, { type: "parentOf", parent: H, child: K }, { type: "parentOf", parent: W, child: K }],
      periods: [period("r1.hp", { member: "r1.h", from: "2007-04", to: null, annual: 6000000, std: [500000, 500000] }), period("r1.wp", { member: "r1.w", from: "2009-04", to: null, annual: 5000000, std: [410000, 410000] })],
      residentTaxAssessments: [{ id: uid("r1.rta"), member: H, fiscalYear: 2026, amount: box(300000) }, { id: uid("r1.rtb"), member: W, fiscalYear: 2026, amount: box(250000) }],
    });
    req.input.contingencies = [{ id: uid("r1.cg"), kind: "death", member: W, occurs: { at: "2027-01" } }];
    const out = runEngine(req, realPacks(), { entry: { component: "pension.survivor", input: { member: H } } }).entryOutput as Any;
    const m = out.months.find((x: Any) => x.month === "2027-06");
    expect(m.employee).toBe(0); // 前は 513,305 円（0171 の後なら 513,341 円）（夫は死亡の当時42歳で遺族厚生年金の遺族でない）
    expect(m.basic).toBeGreaterThan(0); // 遺族基礎年金は夫が受ける
    // 遺族厚生年金は子が受け取る（額は同じ）
    const kid = runEngine(req, realPacks(), { entry: { component: "pension.survivor", input: { member: K } } }).entryOutput as Any;
    const k = kid.months.find((x: Any) => x.month === "2027-06");
    // 0171 から死亡の月（2027-01）は加入の記録に入らない（平均標準報酬額から外れて 513,305 → 513,341 円。300月のみなし）
    expect(k.employee).toBe(513_341);
    expect(k.basic).toBe(0);
  });
});

describe("R1 必要保障額（そのほか）", () => {
  it("R1-013 逆算方式: 「資産が尽きないようにする遺族の年齢」を95歳にしても、期間の終わり（既定は配偶者の平均余命）で計算を打ち切る（salariedCoupleTwoKids）", () => {
    const req = model("salariedCoupleTwoKids");
    const a = need(req, 2027, { method: "reverse", reverseUntilAge: 95, horizon: { kind: "lifeExpectancy" } });
    const b = need(req, 2027, { method: "reverse", reverseUntilAge: 95, horizon: { kind: "age", age: 95 } });
    // a: 期間の終わり 2072年・55,645,000 円、b: 2078年・58,893,000 円（95歳まで見ると 325万円多い）
    expect(a.need).toBe(b.need);
  });

  it("R1-014 死亡退職金: 勤続の始まりより前に亡くなると、まだ勤めていない勤め先の見込み額を全額受け取る（必要保障額・全体の計算とも。相続税の目安の『いま』は0円）", () => {
    const req = model("salariedCoupleTwoKids");
    req.input.household.retirementBenefits[0].service = { from: { at: "2028-10" }, to: { at: "2041-06" } };
    const y = need(req, 2027);
    expect(y.breakdown.lumpResources.retirementAllowance).toBe(0); // 前は 18,000,000 円
    // 全体の計算（死亡の想定）も0
    const r = death(req, y.death);
    expect((r.flows as Any[]).filter((f) => f.formula === "retirement.benefit.deathAllowance").length).toBe(0);
  });

  it("R1-015 予備の生活資金: 生活費に『万一のときの扱い』を入れると、予備の生活資金（遺族の生活費の n か月分）が0円になる（protectionNeed）", () => {
    const req = model("protectionNeed");
    const survivor = req.input.protection.survivor; // 整理資金 200万円・予備 6か月
    const a = need(req, 2027, { survivor });
    const q = clone(req);
    q.input.household.livingExpenses[0].onContingency = { mode: "ratio", ratio: "0.7" };
    const b = need(q, 2027, { survivor });
    expect(a.breakdown.lump.reserve).toBe(1_187_760); // 28万円×0.7×6か月（物価上昇の後）
    // 遺族の割合を同じ0.7にしただけなのに、予備の生活資金が0円になる
    expect(b.breakdown.lump.reserve).toBeGreaterThan(0);
  });
});

describe("必要保障額の区画が、同じ月の死亡の想定の表と合う（0170）", () => {
  const NAMES = ["salariedCoupleTwoKids", "survivorSelfEmployed", "sampleParentsCare", "educationTwoKids", "protectionNeed", "sampleSelfEmployedFamily", "investmentCouple"];
  for (const name of NAMES) {
    it(name, () => {
      const req = model(name);
      const y = need(req, 2027);
      const r = death(req, y.death);
      const w = window(req, y);
      const X = self(req).id;
      const W = req.input.household.members.find((m: Any) => m.kind === "spouse").id;
      const kind = (id: string) => req.input.household.members.find((m: Any) => m.id === id)?.kind;
      const s = (pick: (f: Any) => boolean) => sumFlows(r, w, pick);
      const b = y.breakdown;
      expect(b.expenses.living).toBe(s((f) => f.row.startsWith("cf.expense.living") && !["cf.expense.living.car", "cf.expense.living.drawdown", "cf.expense.living.surplus"].includes(f.row) && !String(f.formula).startsWith("expense.car.")));
      expect(b.expenses.education).toBe(s((f) => f.row.startsWith("cf.expense.education")));
      expect(b.expenses.care).toBe(s((f) => f.row.startsWith("cf.expense.care")));
      expect(b.resources.publicSupport).toBe(s((f) => ["cf.income.benefit.childAllowance", "cf.income.benefit.education", "cf.income.other.scholarship"].includes(f.row)));
      expect(b.resources.survivorPension).toBe(s((f) => String(f.formula).startsWith("pension.survivor")));
      const skip = new Set(["cf.taxSi.incomeTax.capitalGains", "cf.taxSi.residentTax.capitalGains", "cf.taxSi.incomeTax.cryptoAsset", "cf.taxSi.residentTax.cryptoAsset", "cf.taxSi.inheritanceTax"]);
      const health = (f: Any) => String(f.formula).startsWith("socialInsurance.nationalHealth.") || String(f.formula).startsWith("socialInsurance.continuation.");
      const tax = s((f) => f.row.startsWith("cf.taxSi") && !skip.has(f.row) && ((health(f) && kind(f.member) !== "child") || f.member === W || (f.member === X && f.accrualYear > 2027)));
      // 亡くなった人がまだ払っていない前の年（2026年）の所得の税（所得税・住民税・事業税）は、万一なしの計算の額で数える（0170 の追記）
      const plain = clone(req);
      delete plain.input.contingencies;
      const unpaid = sumFlows(run(plain), w, (f) => f.member === X && !skip.has(f.row) && /^cf\.taxSi\.(incomeTax|residentTax|businessTax)(\.|$)/.test(f.row) && f.accrualYear === 2026);
      expect(unpaid).toBeGreaterThan(0);
      expect(b.expenses.taxSi).toBe(tax + unpaid);
    });
  }
});

describe("必要保障額の近似と使い回し（0170）", () => {
  it("後の年は最初の年の表を使う: 修学支援の無い世帯では、その年に亡くなる想定で計算し直した額と20万円以内", () => {
    const req = model("protectionNeed");
    const q = clone(req);
    delete q.input.contingencies;
    delete q.input.inheritanceTax;
    q.input.protection = { members: [self(req).id], method: "accumulation", horizon: { kind: "age", age: 85 } };
    const all = run(q).protection.members[0].years;
    for (const year of [2031, 2036]) {
      const a = all.find((y: Any) => y.year === year);
      const e = need(req, year);
      expect(Math.abs(a.need - e.need)).toBeLessThan(200_000);
      expect(a.breakdown.expenses.living).toBe(e.breakdown.expenses.living);
      expect(a.breakdown.resources.survivorPension).toBe(e.breakdown.resources.survivorPension);
    }
  });

  it("まとめて計算: 死亡の場面だけに効く入力（団信の対象）を変えた要求でも、1件ずつ計算したときと同じ", () => {
    const req = model("salariedCoupleTwoKids");
    const q = clone(req);
    delete q.input.contingencies;
    delete q.input.inheritanceTax;
    q.input.protection = { members: [self(req).id], method: "accumulation" };
    q.trace = "none";
    const r = clone(q);
    const loan = r.input.household.debts.find((d: Any) => d.kind === "mortgage");
    if (loan.creditLife !== undefined) delete loan.creditLife;
    else loan.creditLife = { covered: [self(req).id] };
    const packs = realPacks();
    const batch = runBatch([q, r, q], packs) as Any[];
    const one = [q, r].map((x) => runEngine(clone(x), packs) as Any);
    expect(batch[0].protection).toEqual(one[0].protection);
    expect(batch[1].protection).toEqual(one[1].protection);
    expect(batch[2].protection).toEqual(one[0].protection);
    expect(one[1].protection).not.toEqual(one[0].protection);
  });
});
