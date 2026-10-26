// 住まい・ローンのカード（0052・0053）: 住まいの種類（家賃なし）・目安のボタンの値の推定・援助の額の未入力・譲渡所得の税の額の口・
// 住宅ローンの入れ方の区分と逆算・ペアローン・控除の条件の欄・ほかのローン・相続する家・建て方
import { describe, expect, it } from "vitest";
import type { Debt, PreviewResult, Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { fittedRateText, monthlyPayment, monthsFromPayment, principalFromPayment, rateFromPayment } from "../src/workspace/input/loanMath.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { principalRow, rateRow, termRow } from "../src/workspace/input/stages/housingLoans.ts";
import { confirmAll, fieldStatus } from "../src/workspace/input/valueState.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";

const stage = (wh: WorkingHousehold) => buildStage("housing", wh);
function action(wh: WorkingHousehold, key: string): WorkingHousehold {
  const s = stage(wh);
  const a = s.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return withProvisionalHousing(a.run(wh));
}
function fieldOf(wh: WorkingHousehold, suffix: string): FieldDef {
  const f = allFields(stage(wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1]): WorkingHousehold => withProvisionalHousing(fieldOf(wh, suffix).set(wh, v));
const status = (wh: WorkingHousehold, suffix: string) => fieldStatus(fieldOf(wh, suffix), wh).status;

/** 会社員の本人（年収600万円）の空の世帯 */
function salaried(): WorkingHousehold {
  let wh = blankHousehold(BASE);
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!;
  return annual.set(wh, 6000000);
}
/** 配偶者のいる世帯 */
function couple(): WorkingHousehold {
  const wh = salaried();
  const add = buildStage("family", wh)
    .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
    .find((a) => a.key === "family/add/spouse");
  if (add === undefined) throw new Error("no addSpouse");
  return add.run(wh);
}

const residencesOf = (wh: WorkingHousehold): Residence[] => wh.request.input.household.residences ?? [];
const debtsOf = (wh: WorkingHousehold): Debt[] => wh.request.input.household.debts ?? [];
/** 譲渡所得の税（所得税・住民税の明細の合計） */
const saleTax = (r: PreviewResult, year: number) => sum(r, "cf.taxSi.incomeTax.realEstateSale", year) + sum(r, "cf.taxSi.residentTax.realEstateSale", year);
const sum = (r: PreviewResult, row: string, year: number) => r.table.filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year).reduce((s, c) => s + c.amount, 0);

describe("ローンの逆算（loanMath）", () => {
  it("返済額 → 借入額 → 返済額、残高と返済額 → 金利 → 返済額、残高と返済額と金利 → 月数がそろう", () => {
    const pay = monthlyPayment(30000000, 0.008, 420, "equalPayment");
    expect(pay).toBe(81918);
    expect(Math.abs(principalFromPayment(pay, 0.008, 420, "equalPayment")! - 30000000)).toBeLessThan(500);
    const r = rateFromPayment(30000000, pay, 420, "equalPayment");
    expect(r).toBeCloseTo(0.008, 5);
    const t = fittedRateText(30000000, 90000, 360, "equalPayment");
    expect(monthlyPayment(30000000, Number(t), 360, "equalPayment")).toBe(90000);
    expect(monthsFromPayment(500000, 20000, 0.15, "equalPayment")).toBe(31);
    // 利息に届かない返済額・残高に届かない返済額は解かない
    expect(monthsFromPayment(1000000, 1000, 0.15, "equalPayment")).toBeNull();
    expect(rateFromPayment(30000000, 10000, 120, "equalPayment")).toBeNull();
    // 元金均等は最初の月の返済額
    expect(monthlyPayment(12000000, 0.012, 120, "equalPrincipal")).toBe(112000);
    expect(principalFromPayment(112000, 0.012, 120, "equalPrincipal")).toBe(12000000);
  });
});

describe("住まい", () => {
  it("家賃なし（実家・親の家）は賃貸で家賃が該当なし。家賃は0円で、賃貸に戻すと目安の家賃（推定）", () => {
    let wh = action(salaried(), "housing/addFree");
    const r = residencesOf(wh)[0]!;
    expect(r).toMatchObject({ kind: "rent", rent: { monthly: { state: "notApplicable" } } });
    expect(fieldOf(wh, "/kind").get(wh).value).toBe("free");
    expect(allFields(stage(wh)).some((f) => f.key.endsWith("/rent"))).toBe(false);
    expect(sum(preview(wh.request), "cf.expense.housing.rent", 2027)).toBe(0);
    wh = set(wh, "/kind", "rent");
    expect(residencesOf(wh)[0]!.rent?.monthly).toMatchObject({ value: 80000, state: "estimated" });
    expect(status(wh, "/rent")).toBe("estimated");
  });

  it("賃貸 ⇄ 持ち家は形の違う値を消さずに残し（隠すだけ）、計算は種類に合う値だけ", () => {
    let wh = action(salaried(), "housing/addRent");
    wh = set(wh, "/rent", 95000);
    wh = set(wh, "/kind", "own");
    const r = residencesOf(wh)[0]!;
    expect(r.kind).toBe("own");
    expect(r.rent?.monthly.value).toBe(95000);
    expect(r.propertyTax?.annual).toMatchObject({ value: 120000, state: "estimated" });
    const p = preview(wh.request);
    expect(sum(p, "cf.expense.housing.rent", 2027)).toBe(0);
    expect(sum(p, "cf.expense.housing.propertyTax", 2027)).toBe(120000);
    wh = set(wh, "/kind", "rent");
    expect(residencesOf(wh)[0]!.rent?.monthly.value).toBe(95000);
  });

  it("建て方をマンションにすると、建物の構造を鉄筋コンクリート造（推定）にする。構造を入れてあれば変えない", () => {
    let wh = action(salaried(), "housing/addOwn");
    expect(fieldOf(wh, "/style").get(wh)).toMatchObject({ value: "house", implicit: true });
    wh = set(wh, "/style", "condo");
    expect(residencesOf(wh)[0]!.valuation?.structure).toBe("rc");
    expect(status(wh, "/valuation/structure")).toBe("estimated");
    wh = set(wh, "/valuation/structure", "steel");
    wh = set(wh, "/style", "house");
    expect(residencesOf(wh)[0]!.valuation?.structure).toBe("steel");
  });

  it("今の持ち家の評価額は、入れるまで未入力の警告（0円で数えている）", () => {
    const wh = action(salaried(), "housing/addOwn");
    expect(status(wh, "/valuation/value")).toBe("missing");
    expect(status(set(wh, "/valuation/value", 30000000), "/valuation/value")).toBe("confirmed");
  });

  it("名義を夫婦の共有にすると半分ずつ、本人の持分を直せる", () => {
    let wh = action(couple(), "housing/addOwn");
    wh = set(wh, "/owner", "shared");
    expect(residencesOf(wh)[0]!.ownership).toHaveLength(2);
    wh = set(wh, "/ownerShare", "0.7");
    expect(residencesOf(wh)[0]!.ownership!.map((o) => o.share)).toEqual(["0.7", "0.3"]);
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("この家を相続する: 家賃なしの住まいを終え、翌月から同じ家の持ち家（評価額は未入力）。貯蓄・運用の不動産は作らない", () => {
    let wh = action(salaried(), "housing/addFree");
    const id = residencesOf(wh)[0]!.id;
    wh = action(wh, `housing/res/${id}/inherit`);
    const [a, b] = residencesOf(wh);
    expect(a!.to).toEqual({ at: "2036-09" });
    expect(b).toMatchObject({ kind: "own", from: { at: "2036-10" }, to: null });
    expect((wh.request.input.household.accounts ?? []).some((x) => x.kind === "realEstate")).toBe(false);
    const own = b!.id;
    const value = allFields(stage(wh)).find((f) => f.key === `housing/res/${own}/valuation/value`)!;
    expect(fieldStatus(value, wh).status).toBe("missing");
    // 住まいが2つになったので、住み始め・住み終わりは簡易に出る
    expect(allFields(stage(wh)).find((f) => f.key === `housing/res/${own}/from`)?.level).toBe("simple");
    expect(() => preview(wh.request)).not.toThrow();
  });
});

describe("購入の予定と住宅資金の援助", () => {
  it("目安のボタンの値は推定（物件の価格4,000万円・頭金は価格の1割・諸費用は価格の5%）。価格を直すと、推定のままの頭金・諸費用がついていく", () => {
    let wh = action(salaried(), "housing/addPurchase");
    expect(status(wh, "/purchase/price")).toBe("estimated");
    expect(status(wh, "/purchase/down")).toBe("estimated");
    expect(status(wh, "/purchase/costs")).toBe("estimated");
    wh = set(wh, "/purchase/price", 50000000);
    const p = residencesOf(wh).find((r) => r.purchase !== undefined)!.purchase!;
    expect(p).toMatchObject({ price: 50000000, downPayment: 5000000, costs: 2500000 });
    expect(status(wh, "/purchase/price")).toBe("confirmed");
    expect(status(wh, "/purchase/down")).toBe("estimated");
    // FP が頭金を入れると、もうついていかない
    wh = set(wh, "/purchase/down", 8000000);
    wh = set(wh, "/purchase/price", 60000000);
    expect(residencesOf(wh).find((r) => r.purchase !== undefined)!.purchase).toMatchObject({ downPayment: 8000000, costs: 3000000 });
  });

  it("援助の額は目安を作らず未入力（0円で計算中）。入れると確定", () => {
    let wh = action(salaried(), "housing/addPurchase");
    wh = action(wh, "/addGiftAction");
    expect(residencesOf(wh).find((r) => r.purchase !== undefined)!.purchase!.gifts![0]!.amount).toBe(0);
    expect(status(wh, "/gift/0/amount")).toBe("missing");
    wh = set(wh, "/gift/0/amount", 5000000);
    expect(status(wh, "/gift/0/amount")).toBe("confirmed");
  });
});

describe("住み終わりの後と譲渡所得の税の額（0053）", () => {
  const sold = (): WorkingHousehold => {
    let wh = action(salaried(), "housing/addOwn");
    wh = set(wh, "/valuation/value", 40000000);
    wh = set(wh, "/to", "2035-03");
    return set(wh, "/after", "sell");
  };

  it("売るを選ぶと、税の額の口が出て、空なら未入力の警告（税0円で計算中）", () => {
    const wh = sold();
    expect(residencesOf(wh)[0]!.sale).toEqual({});
    expect(status(wh, "/sale/tax")).toBe("missing");
    const p = preview(wh.request);
    expect(saleTax(p, 2035)).toBe(0);
  });

  it("入れた税の額は売った年の出るお金になる。0円を入れれば税なし", () => {
    let wh = sold();
    const none = preview(wh.request);
    wh = set(wh, "/sale/tax", 3000000);
    expect(status(wh, "/sale/tax")).toBe("confirmed");
    const p = preview(wh.request);
    expect(saleTax(p, 2035)).toBe(3000000);
    expect(sum(none, "cf.net", 2035) - sum(p, "cf.net", 2035)).toBe(3000000);
    const zero = preview(set(wh, "/sale/tax", 0).request);
    expect(saleTax(zero, 2035)).toBe(0);
  });

  it("そのまま持つに戻すと売却の値は外れる", () => {
    const wh = set(sold(), "/after", "keep");
    expect(residencesOf(wh)[0]!.sale).toBeUndefined();
  });
});

describe("住宅ローンの入れ方の区分", () => {
  const ownLoan = () => action(action(salaried(), "housing/addOwn"), "housing/addMortgage");
  const loan = (wh: WorkingHousehold) => debtsOf(wh).find((d) => d.kind === "mortgage")!;

  it("今の残高から: 残高・毎月の返済額・完済の年を入れると金利を逆算し、計算エンジンの返済額が入れた額になる", () => {
    let wh = ownLoan();
    const id = loan(wh).id;
    expect(status(wh, `${id}/payment`)).toBe("estimated");
    expect(status(wh, `${id}/balance`)).toBe("estimated");
    wh = set(wh, `${id}/balance`, 25000000);
    wh = set(wh, `${id}/payoff`, "2051-09");
    wh = set(wh, `${id}/payment`, 95000);
    const d = loan(wh);
    expect(d.repayment.termMonths).toBe(299);
    expect(fieldOf(wh, `${id}/payment`).get(wh).value).toBe(95000);
    expect(rateRow(wh, d)?.estimate?.basis).toContain("逆算");
    expect(status(wh, `${id}/rate`)).toBe("estimated");
    const p = preview(wh.request);
    expect(Math.abs(sum(p, "cf.expense.housing.loan", 2027) - 95000 * 12)).toBeLessThanOrEqual(12);
    // 残高を直すと、入れた返済額のまま金利を解き直す
    wh = set(wh, `${id}/balance`, 24000000);
    expect(fieldOf(wh, `${id}/payment`).get(wh).value).toBe(95000);
    expect(Number(loan(wh).rateSchedule[0]!.rate)).toBeGreaterThan(Number(d.rateSchedule[0]!.rate));
    // 金利を FP が入れると確定（返済額は計算の値に変わる）
    wh = set(wh, `${id}/rate`, "0.012");
    expect(status(wh, `${id}/rate`)).toBe("confirmed");
  });

  it("毎月の返済額から: 返済額・金利・期間から借入額を逆算し、金利を直すと同じ返済額のまま借入額を解き直す", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const id = loan(wh).id;
    wh = set(wh, `${id}/entry`, "payment");
    wh = set(wh, `${id}/payment`, 100000);
    const p1 = loan(wh).principal;
    expect(p1).toBe(principalFromPayment(100000, 0.008, loan(wh).repayment.termMonths, "equalPayment"));
    expect(principalRow(wh, id)?.estimate?.basis).toContain("逆算");
    expect(wh.assumed[`housing/debt/${id}/principal`]).toBeUndefined();
    wh = set(wh, `${id}/rate`, "0.015");
    expect(loan(wh).principal).toBeLessThan(p1);
    expect(fieldOf(wh, `${id}/payment`).get(wh).value).toBe(100000);
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("借入額からに戻しても値は消えない。今の残高からにすると、残高が無ければ借入額と金利から今の残高を推定で置く", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const id = loan(wh).id;
    const before = structuredClone(loan(wh));
    wh = set(wh, `${id}/entry`, "payment");
    wh = set(wh, `${id}/entry`, "principal");
    expect(loan(wh)).toEqual(before);
    // 前に借りたローン（借りた年を前にずらす）
    wh = set(wh, `${id}/start`, "2020-04");
    wh = set(wh, `${id}/entry`, "balance");
    const d = loan(wh);
    expect(d.balance).toMatchObject({ state: "estimated" });
    expect(d.balance!.value).toBeLessThan(d.principal);
    expect(d.balanceAsOf).toBe(BASE);
    // 今の残高からのローンには控除の仮の条件を置かない（仮の条件は外す）
    expect(d.housing).toBeUndefined();
  });
});

describe("借りる人とペアローン", () => {
  it("ペアローン: 配偶者の2本目を足し、借入額を2本に分ける（合計は物件の価格−頭金のまま）。団信は1本ずつ", () => {
    let wh = action(action(couple(), "housing/addPurchase"), "housing/addMortgage");
    const first = debtsOf(wh)[0]!;
    wh = action(wh, `housing/debt/${first.id}/addPair`);
    const [a, b] = debtsOf(wh);
    expect(a!.pairWith).toBe(b!.id);
    expect(b!.pairWith).toBe(a!.id);
    expect(a!.principal + b!.principal).toBe(36000000);
    expect(b!.creditLife?.covered).toEqual([b!.debtors[0]!.member]);
    expect(b!.debtors[0]!.member).not.toBe(a!.debtors[0]!.member);
    expect(fieldOf(wh, `${b!.id}/principal`).get(wh).warn).toBeNull();
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("連帯債務は1本を2人で（負担割合は半分ずつ。直せる）", () => {
    let wh = action(action(couple(), "housing/addPurchase"), "housing/addMortgage");
    const id = debtsOf(wh)[0]!.id;
    wh = set(wh, `${id}/debtors`, "joint");
    expect(debtsOf(wh)[0]!.debtors.map((x) => [x.role, x.share])).toEqual([
      ["primary", "0.5"],
      ["joint", "0.5"],
    ]);
    wh = set(wh, `${id}/share`, "0.6");
    expect(debtsOf(wh)[0]!.debtors.map((x) => x.share)).toEqual(["0.6", "0.4"]);
    expect(() => preview(wh.request)).not.toThrow();
  });
});

describe("住宅ローン控除の条件の欄", () => {
  it("住宅の種類を直すと仮の印が外れて確定になり、2028年以後の新築の省エネ基準適合住宅は控除の対象外と知らせる", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const id = debtsOf(wh)[0]!.id;
    expect(status(wh, `${id}/credit`)).toBe("estimated");
    expect(fieldOf(wh, `${id}/credit`).get(wh).warn).toContain("2028年以後");
    wh = set(wh, `${id}/credit`, "zeh");
    expect(debtsOf(wh)[0]!.housing?.propertyType).toBe("zeh");
    expect(status(wh, `${id}/credit`)).toBe("confirmed");
    expect(fieldOf(wh, `${id}/credit`).get(wh).warn).toBeNull();
    wh = set(wh, `${id}/credit/on`, false);
    expect(debtsOf(wh)[0]!.housing?.creditDisabled).toBe(true);
    expect(String(fieldOf(wh, `${id}/creditSummary`).get(wh).value)).toBe("控除を受けない");
  });

  it("「✓ この値で確定」で仮の条件をまとめて確定にできる", () => {
    const wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const id = debtsOf(wh)[0]!.id;
    const { wh: w } = confirmAll(wh, allFields(stage(wh)));
    expect(w.assumed[`housing/debt/${id}/credit`]).toBeUndefined();
    expect(status(w, `${id}/credit`)).toBe("confirmed");
    expect(status(w, `${id}/rate`)).toBe("confirmed");
  });

  it("今の残高から入れたローンで入居の年月が空なら、黙って控除を0円にせず未入力の警告（確かめの一覧にも出る）。当てはまらなければ「該当なし」で消せる", () => {
    let wh = action(action(salaried(), "housing/addOwn"), "housing/addMortgage");
    wh = set(wh, "/valuation/value", 30000000);
    const id = debtsOf(wh)[0]!.id;
    expect(status(wh, `${id}/credit/moveIn`)).toBe("missing");
    expect(fieldStatus(fieldOf(wh, `${id}/credit/moveIn`), wh).basis).toContain("入居の年月を入れると住宅ローン控除を計算します");
    expect(fieldOf(wh, `${id}/credit/moveIn`).level).toBe("simple");
    expect(checkList(wh).some((r) => r.fieldKey === `housing/debt/${id}/credit/moveIn` && r.kind === "missing")).toBe(true);
    expect(inputItems(wh).find((i) => i.id === "housing")?.status).toBe("missing");
    // 該当なし（入居から13年を過ぎたなど）
    wh = action(wh, `housing/debt/${id}/creditNa`);
    expect(status(wh, `${id}/credit/moveIn`)).toBe("notApplicable");
    expect(String(fieldOf(wh, `${id}/creditSummary`).get(wh).value)).toContain("該当なし");
    expect(inputItems(wh).find((i) => i.id === "housing")?.status).not.toBe("missing");
    expect(() => preview(wh.request)).not.toThrow();
    // 外すと警告に戻り、入居の年月を入れると控除の条件を置いて「該当なし」の行は消える
    expect(status(action(wh, `housing/debt/${id}/creditNa`), `${id}/credit/moveIn`)).toBe("missing");
    wh = set(wh, `${id}/credit/moveIn`, "2024-04");
    expect(debtsOf(wh)[0]!.housing).toBeDefined();
    expect(debtsOf(wh)[0]!.valueStates?.["debt.housing"]).toBeUndefined();
    // 借入額から入れたローン・古い世帯には出さない
    const old = fromRequest(modelHousehold("protectionNeed"));
    for (const d of old.request.input.household.debts ?? []) if (d.kind === "mortgage") expect(status(old, `${d.id}/credit/moveIn`)).not.toBe("missing");
  });

  it("今の残高から入れたローンも、入居の年月を入れると控除を計算する（住宅の種類は控えめの既定）", () => {
    let wh = action(action(salaried(), "housing/addOwn"), "housing/addMortgage");
    const id = debtsOf(wh)[0]!.id;
    const none = preview(wh.request);
    wh = set(wh, `${id}/credit/moveIn`, "2024-04");
    expect(debtsOf(wh)[0]!.housing).toMatchObject({ propertyType: "other", newBuild: false });
    const p = preview(wh.request);
    expect(sum(p, "cf.taxSi.incomeTax", 2027)).toBeLessThan(sum(none, "cf.taxSi.incomeTax", 2027));
  });
});

describe("ほかのローン", () => {
  it("カードローン・リボ: 残高と毎月の返済額は未入力、金利は種類の目安（推定）。入れると完済の年を逆算する", () => {
    let wh = action(salaried(), "housing/add/cardLoan");
    const d0 = debtsOf(wh)[0]!;
    expect(d0).toMatchObject({ kind: "other", subtype: "cardLoan", rateSchedule: [{ rate: "0.15" }] });
    expect(wh.loanEntry?.[d0.id]).toBe("balance");
    expect(status(wh, `${d0.id}/balance`)).toBe("missing");
    expect(status(wh, `${d0.id}/payment`)).toBe("missing");
    expect(status(wh, `${d0.id}/rate`)).toBe("estimated");
    wh = set(wh, `${d0.id}/balance`, 500000);
    wh = set(wh, `${d0.id}/payment`, 20000);
    const d = debtsOf(wh)[0]!;
    expect(d.repayment.termMonths).toBe(31);
    expect(d.principal).toBe(500000);
    expect(termRow(wh, d.id)?.estimate?.basis).toContain("逆算");
    expect(status(wh, `${d.id}/payoff`)).toBe("estimated");
    expect(status(wh, `${d.id}/payment`)).toBe("confirmed");
    const p = preview(wh.request);
    expect(Math.abs(sum(p, "cf.expense.debt.other", 2027) - 20000 * 12)).toBeLessThan(13000);
    // 金利を直すと、同じ返済額のまま完済の年を解き直す
    wh = set(wh, `${d.id}/rate`, "0.18");
    expect(debtsOf(wh)[0]!.repayment.termMonths).toBeGreaterThan(31);
  });

  it("種類を変えると、金利が目安のままなら新しい種類の目安に（入れた金利は変えない）", () => {
    let wh = action(salaried(), "housing/add/cardLoan");
    const id = debtsOf(wh)[0]!.id;
    wh = set(wh, `${id}/subtype`, "scholarship");
    expect(debtsOf(wh)[0]).toMatchObject({ kind: "scholarship", subtype: "scholarship", rateSchedule: [{ rate: "0.005" }] });
    wh = set(wh, `${id}/rate`, "0.01");
    wh = set(wh, `${id}/subtype`, "renovation");
    expect(debtsOf(wh)[0]!.rateSchedule[0]!.rate).toBe("0.01");
  });
});

describe("古い世帯", () => {
  it("開いただけでは書き換えない（入れ方は「借入額から」、売却のある住まいの税の欄は未入力の警告だけ）", () => {
    for (const id of ["housingPurchase", "pairLoan", "lifetime100Assets"]) {
      const wh = fromRequest(modelHousehold(id));
      expect(wh.loanEntry).toBeUndefined();
      for (const d of wh.request.input.household.debts ?? []) if (d.property === undefined) expect(fieldOf(wh, `${d.id}/entry`).get(wh).value).toBe("principal");
      expect(JSON.stringify(stage(wh)) !== "").toBe(true);
    }
  });
});
