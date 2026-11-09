// 住まいと不動産の見直し（2026-11-05。不動産に詳しい FP の声）: 相続する家の固定資産税の推定の持ち始めの年・建った年の推定・その額の時点の欄の名前、
// 住宅取得等資金の非課税の期限、フラット35の欄のそろえ方、ペアローンと家の名義と持分・控除の要約、2028年からの入居の新築の仮の条件、
// 借入額の推定と住宅資金の援助・根拠の文、相続税の内訳の文、貸していない不動産の持ち始める時点と建物の古くなった分
import { afterEach, describe, expect, it } from "vitest";
import type { Account, Debt, Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { principalEstimateText, principalKey, withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { rateEstimateOf } from "../src/workspace/input/stages/housingLoans.ts";
import { exemptionDeadline, exemptionOpen } from "../src/workspace/input/stages/housing.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { heldEstateTax } from "../src/workspace/input/heldEstateTax.ts";
import { PROPERTY_TAX_BASIS } from "../src/workspace/input/propertyTax.ts";
import { inheritanceRequest, inheritanceView } from "../src/workspace/input/inheritanceLine.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { setOfficeEstimates } from "../../hearing/src/statistics.ts";
import { preview } from "./helpers.ts";

const BASE = "2026-10";
const stage = (wh: WorkingHousehold, card = "housing") => buildStage(card as never, wh);
const settle = (wh: WorkingHousehold) => withProvisionalHousing(withRefreshedEstimates(wh));
function action(wh: WorkingHousehold, key: string, card = "housing"): WorkingHousehold {
  const s = stage(wh, card);
  const a = s.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return settle(a.run(wh));
}
const hasAction = (wh: WorkingHousehold, key: string): boolean => stage(wh).sections.some((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)].some((a) => a.key.endsWith(key)));
const fieldMaybe = (wh: WorkingHousehold, suffix: string, card = "housing"): FieldDef | undefined => allFields(stage(wh, card)).find((x) => x.key.endsWith(suffix));
function fieldOf(wh: WorkingHousehold, suffix: string, card = "housing"): FieldDef {
  const f = fieldMaybe(wh, suffix, card);
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1], card = "housing"): WorkingHousehold => settle(fieldOf(wh, suffix, card).set(wh, v));
function salaried(): WorkingHousehold {
  let wh = blankHousehold(BASE);
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!;
  return annual.set(wh, 6000000);
}
function couple(): WorkingHousehold {
  const wh = salaried();
  const add = buildStage("family", wh)
    .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
    .find((a) => a.key === "family/add/spouse");
  return add!.run(wh);
}
/** 共働きの夫婦（配偶者も会社員・年収500万円） */
function dual(): WorkingHousehold {
  let wh = couple();
  const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!.id;
  const start = buildStage("work", wh).sections.flatMap((x) => x.groups.flatMap((g) => g.actions)).find((a) => a.key.endsWith("/start") && a.key.includes(spouse));
  if (start === undefined) throw new Error("no spouse start");
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key === `work/${spouse}/now/total`)!;
  return annual.set(wh, 5000000);
}
const residences = (wh: WorkingHousehold): Residence[] => wh.request.input.household.residences ?? [];
const bought = (wh: WorkingHousehold): Residence => residences(wh).find((r) => r.purchase !== undefined)!;
const loans = (wh: WorkingHousehold): Debt[] => (wh.request.input.household.debts ?? []).filter((d) => d.kind === "mortgage");
const basisOf = (r: Residence): string => (r.propertyTax?.annual as { estimate?: { basis?: string } } | undefined)?.estimate?.basis ?? "";
const stageYears = (r: Residence): number[] => (r.propertyTax?.stages ?? []).map((s) => Number((s.at.at ?? "").slice(0, 4)));

afterEach(() => setOfficeEstimates({}));

describe("相続する家（この家を相続する）", () => {
  /** 家賃なしの住まいから相続する家を足す（相続は10年後の2036年10月） */
  function inherited(): { wh: WorkingHousehold; id: string } {
    let wh = action(salaried(), "housing/addFree");
    wh = action(wh, `housing/res/${residences(wh)[0]!.id}/inherit`);
    return { wh, id: residences(wh).find((r) => r.kind === "own")!.id };
  }

  it("建った年は相続する家の築年数の目安（いま築30年）の推定。その額の時点の欄は「相続の年月」", () => {
    const { wh, id } = inherited();
    const r = residences(wh).find((x) => x.id === id)!;
    expect(r.valuation).toMatchObject({ asOf: "2036-10", builtYear: 1996 });
    const built = fieldOf(wh, `${id}/valuation/builtYear`);
    expect(fieldStatus(built, wh).status).toBe("estimated");
    expect(fieldOf(wh, `${id}/valuation/asOf`).label).toBe("その額の時点（相続の年月）");
    // 事務所の推定の値で年数を変えられる
    setOfficeEstimates({ "preset.housing.inheritedHomeAge": { value: 40, basis: "事務所の目安" } });
    const again = inherited();
    expect(residences(again.wh).find((x) => x.id === again.id)!.valuation?.builtYear).toBe(1986);
  });

  it("固定資産税の推定は持ち始めの年（2036年）の額で、段も2037年からだけ置く（2027年からの評価替えの段を付けない）", () => {
    const { wh: w0, id } = inherited();
    const wh = set(w0, `${id}/valuation/value`, 30000000);
    const r = residences(wh).find((x) => x.id === id)!;
    expect(basisOf(r).startsWith(PROPERTY_TAX_BASIS)).toBe(true);
    expect(basisOf(r)).toContain("2036年の額（2036年から持つ）");
    expect(basisOf(r)).toContain("1996年に建った（築40年。推定）");
    // 築40年の木造は下限（20%）まで下がっているので、その後の評価替えでも変わらない
    expect(stageYears(r)).toEqual([]);
    // 新築とみなすと（建った年を相続の年にする）、評価替えの段は持ち始めの次の年より後にだけ置く（2027年からの段は付けない）
    const asNew = residences(set(wh, `${id}/valuation/builtYear`, 2036)).find((x) => x.id === id)!;
    expect(stageYears(asNew).length).toBeGreaterThan(0);
    expect(stageYears(asNew).every((y) => y >= 2037)).toBe(true);
    expect(() => preview(wh.request)).not.toThrow();
  });
});

describe("住宅取得等資金の非課税の期限", () => {
  it("制度データの写しでは、2026年12月31日までの贈与だけ非課税がある", () => {
    expect(exemptionOpen("energySaving", "2026-12")).toBe(true);
    expect(exemptionOpen("energySaving", "2027-01")).toBe(false);
    expect(exemptionOpen("other", "2028-10")).toBe(false);
    expect(exemptionDeadline("energySaving")).toBe("2026年12月31日");
  });

  it("期限の後に受け取る援助（2028年の購入）は、既定で「使わない」。非課税を選ぶと知らせる", () => {
    let wh = action(salaried(), "housing/addPurchase");
    wh = action(wh, "/purchase/addGiftAction");
    const g = bought(wh).purchase!.gifts![0]!;
    expect(g.housingExemption).toBe("none");
    expect(fieldOf(wh, "/purchase/gift/0/exempt").get(wh).warn ?? null).toBeNull();
    wh = set(wh, "/purchase/gift/0/exempt", "energySaving");
    expect(fieldOf(wh, "/purchase/gift/0/exempt").get(wh).warn).toContain("2026年12月31日までの贈与");
    // 選択肢に期限を添える
    const ex = fieldOf(wh, "/purchase/gift/0/exempt");
    expect(ex.kind === "select" ? ex.options.find((o) => o.value === "energySaving")?.label : null).toContain("2026年12月31日までの贈与");
    // 「使わない」を選ぶと、省略（計算エンジンの既定は「それ以外の住宅」）にせず書く
    wh = set(wh, "/purchase/gift/0/exempt", "none");
    expect(bought(wh).purchase!.gifts![0]!.housingExemption).toBe("none");
  });

  it("期限の前に受け取る援助（2026年12月の購入）は、既定で省エネ等住宅の非課税。知らせは出さない", () => {
    let wh = action(salaried(), "housing/addPurchase");
    wh = set(wh, "/purchase/at", "2026-12");
    wh = action(wh, "/purchase/addGiftAction");
    expect(bought(wh).purchase!.gifts![0]!.housingExemption).toBe("energySaving");
    expect(fieldOf(wh, "/purchase/gift/0/exempt").get(wh).warn ?? null).toBeNull();
  });
});

describe("借入額の推定と住宅資金の援助", () => {
  it("援助の額は、推定のままの頭金に足す（借入額の推定はその分少ない）。FP が入れた頭金は変えない", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    expect(bought(wh).purchase!.downPayment).toBe(4000000);
    expect(loans(wh)[0]!.principal).toBe(36000000);
    wh = action(wh, "/purchase/addGiftAction");
    wh = set(wh, "/purchase/gift/0/amount", 5000000);
    expect(bought(wh).purchase!.downPayment).toBe(9000000);
    expect(loans(wh)[0]!.principal).toBe(31000000);
    expect(wh.assumed[principalKey(loans(wh)[0]!.id)]).toContain("頭金（住宅資金の援助を含む）");
    expect(fieldStatus(fieldOf(wh, "/purchase/down"), wh).status).toBe("estimated");
    // 援助を外すと元に戻る
    wh = action(wh, "/purchase/gift/0/remove");
    expect(bought(wh).purchase!.downPayment).toBe(4000000);
    expect(loans(wh)[0]!.principal).toBe(36000000);
    // FP が入れた頭金は変えない
    wh = set(wh, "/purchase/down", 6000000);
    wh = action(wh, "/purchase/addGiftAction");
    wh = set(wh, "/purchase/gift/0/amount", 5000000);
    expect(bought(wh).purchase!.downPayment).toBe(6000000);
    expect(loans(wh)[0]!.principal).toBe(34000000);
  });

  it("注文住宅の土地の分のローンの根拠の文は「土地の代金から、土地の決済で払う頭金を引いた額」", () => {
    let wh = action(salaried(), "housing/addPurchase");
    wh = set(wh, "/purchase/at", "2029-03");
    wh = set(wh, "/purchase/type", "custom");
    wh = action(action(wh, "housing/addMortgage"), "/purchase/addLandLoan");
    const land = loans(wh).find((d) => d.start.at === "2028-06")!;
    const main = loans(wh).find((d) => d.start.at === "2029-03")!;
    expect(wh.assumed[principalKey(land.id)]).toBe(principalEstimateText(wh.request.input.household, land));
    expect(wh.assumed[principalKey(land.id)]).toContain("土地の代金から、土地の決済で払う頭金を引いた額");
    expect(wh.assumed[principalKey(main.id)]).toContain("注文住宅の土地と建物の合計から頭金と土地の分のローンの借入額を引いた額");
  });
});

describe("フラット35を選んだとき", () => {
  it("金利の種類を全期間固定・金利を全期間固定の推定にし、5年ルール・125%ルールを外す", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const id = loans(wh)[0]!.id;
    expect(loans(wh)[0]!.rateSchedule[0]).toMatchObject({ type: "variable", rate: rateEstimateOf("variable").rate });
    expect(loans(wh)[0]!.repayment.variableRules).toEqual({ fiveYear: true, cap125: true });
    wh = set(wh, `${id}/product`, "flat35");
    const d = loans(wh)[0]!;
    expect(d.product).toBe("flat35");
    expect(d.rateSchedule[0]).toMatchObject({ type: "fixed", rate: rateEstimateOf("fixed").rate });
    expect(d.repayment.variableRules).toBeUndefined();
    // 全期間固定では5年ルール・125%ルールの欄を出さない（2026-11-06 の追記）
    expect(fieldMaybe(wh, `${id}/fiveYear`)).toBeUndefined();
    expect(fieldMaybe(wh, `${id}/cap125`)).toBeUndefined();
    expect(fieldMaybe(wh, `${id}/variableRules`)).toBeUndefined();
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("FP が入れた金利は変えない", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const id = loans(wh)[0]!.id;
    wh = set(wh, `${id}/rate`, "0.0095");
    wh = set(wh, `${id}/product`, "flat35");
    expect(loans(wh)[0]!.rateSchedule[0]).toMatchObject({ type: "fixed", rate: "0.0095" });
  });
});

describe("ペアローンと家の名義と持分", () => {
  it("ペアローンを足すと、FP が名義と持分を選んでいなければ借入の割合で分けて推定の印。控除の持分も家の名義と持分から", () => {
    let wh = action(action(dual(), "housing/addPurchase"), "housing/addMortgage");
    wh = settle(action(wh, `housing/debt/${loans(wh)[0]!.id}/addPair`));
    const [a, b] = loans(wh);
    // 2本の借入額は半分ずつ → 持分も半分ずつ（推定。「登記の持分に直してください」）
    expect(bought(wh).ownership?.map((o) => o.share)).toEqual(["0.5", "0.5"]);
    const owner = fieldOf(wh, `${bought(wh).id}/owner`);
    expect(fieldStatus(owner, wh)).toMatchObject({ status: "estimated", basis: "借入の割合で分けた持分（登記の持分に直してください）" });
    expect(a!.housing?.ownership).toEqual(bought(wh).ownership);
    expect(b!.housing?.ownership).toEqual(bought(wh).ownership);
    expect(String(fieldOf(wh, `${b!.id}/creditSummary`).get(wh).value)).toContain("持分 ご本人 50%・配偶者 50%");
    expect(fieldOf(wh, `${b!.id}/creditSummary`).get(wh).warn ?? null).toBeNull();
    expect(hasAction(wh, "/shareByLoans")).toBe(false);
    // 推定のままなら、借入額を直すと分け直す
    wh = set(wh, `${b!.id}/principal`, 10_000_000);
    const total = loans(wh).reduce((sum, d) => sum + d.principal, 0);
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!.id;
    expect(Number(bought(wh).ownership?.find((o) => o.member === self)?.share)).toBeCloseTo(Math.round((loans(wh)[0]!.principal / total) * 1000) / 1000, 3);
  });

  it("FP が名義と持分を選んであれば、ペアローンを足しても変えず、持分の無い人に知らせと「借入の割合で持分を分ける」", () => {
    let wh = action(action(dual(), "housing/addPurchase"), "housing/addMortgage");
    const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!.id;
    wh = set(wh, `${bought(wh).id}/owner`, spouse);
    wh = settle(action(wh, `housing/debt/${loans(wh)[0]!.id}/addPair`));
    const [a] = loans(wh);
    expect(bought(wh).ownership).toEqual([{ member: spouse, share: "1" }]);
    expect(a!.housing?.ownership).toEqual([{ member: spouse, share: "1" }]);
    expect(fieldOf(wh, `${a!.id}/creditSummary`).get(wh).warn).toContain("ご本人に家の持分が無い");
    const owner = fieldOf(wh, `${bought(wh).id}/owner`);
    expect(owner.level).toBe("simple");
    expect(owner.get(wh).warn).toContain("に、この家の持分がありません");
    expect(owner.get(wh).warnFix?.label).toBe("借入の割合で持分を分ける");
    expect(hasAction(wh, "/shareByLoans")).toBe(true);
    // 借入の割合で分ける（2本の借入額は半分ずつ）
    wh = action(wh, "/shareByLoans");
    expect(bought(wh).ownership?.map((o) => o.share)).toEqual(["0.5", "0.5"]);
    const [a2, b2] = loans(wh);
    expect(a2!.housing?.ownership).toEqual(bought(wh).ownership);
    expect(String(fieldOf(wh, `${b2!.id}/creditSummary`).get(wh).value)).toContain("持分 ご本人 50%・配偶者 50%");
    expect(fieldOf(wh, `${bought(wh).id}/owner`).get(wh).warn ?? null).toBeNull();
    expect(hasAction(wh, "/shareByLoans")).toBe(false);
    // 配偶者のローンの控除が計算に入る（配偶者の所得税が少なくなる）
    const before = action(action(dual(), "housing/addPurchase"), "housing/addMortgage");
    const paired = settle(action(set(before, `${bought(before).id}/owner`, spouse), `housing/debt/${loans(before)[0]!.id}/addPair`));
    const spouseOf = (w: WorkingHousehold) => w.request.input.household.members.find((m) => m.kind === "spouse")!.id;
    const tax = (w: WorkingHousehold) => preview(w.request).table.filter((c) => c.row.startsWith("cf.taxSi.incomeTax") && c.member === spouseOf(w) && c.year === 2030).reduce((s, c) => s + c.amount, 0);
    expect(tax(wh)).toBeLessThan(tax(paired));
  });
});

describe("相続税の目安の内訳の文", () => {
  it("不動産の行に評価の割合（既定は80%）を書く", () => {
    let wh = action(couple(), "housing/addOwn");
    const id = residences(wh)[0]!.id;
    wh = set(wh, `${id}/valuation/value`, 50000000);
    const view = inheritanceView(wh, preview(forEngine(inheritanceRequest(wh.request))));
    const line = view.points.flatMap((p) => p.details).find((d) => d.includes("不動産"));
    expect(line).toMatch(/不動産 [\d,]+万円（時価 [\d,]+万円 の80%）/u);
  });
});

describe("貸していない不動産", () => {
  /** 貯蓄・運用に貸していない不動産を足し、中身を選んで評価額を入れる */
  function held(subtype: string, value = 10_000_000): { wh: WorkingHousehold; id: string } {
    let wh = salaried();
    const s = buildStage("savings", wh);
    const add = s.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((a) => a.key.endsWith("/add/realEstate") || a.key.endsWith("addRealEstate"));
    if (add === undefined) throw new Error("no add realEstate");
    wh = settle(add.run(wh));
    const a = (wh.request.input.household.accounts ?? []).find((x) => x.kind === "realEstate")!;
    wh = set(wh, `sav/${a.id}/subtype`, subtype, "savings");
    wh = set(wh, `sav/${a.id}/value`, value, "savings");
    return { wh, id: a.id };
  }
  const account = (wh: WorkingHousehold, id: string): Account => (wh.request.input.household.accounts ?? []).find((x) => x.id === id)!;
  const cost = (wh: WorkingHousehold, id: string) => (wh.request.input.household.periodicExpenses ?? []).find((p) => p.object === id);

  it("持ち始める時点の欄がある。入れると、評価額はその年の年末から・毎年の費用はその月から入る", () => {
    const h = held("villa");
    const id = h.id;
    let wh = h.wh;
    expect(fieldOf(wh, `sav/${id}/holdFrom`, "savings").label).toBe("持ち始める時点");
    wh = set(wh, `sav/${id}/holdFrom`, "2031-06", "savings");
    expect(account(wh, id).holdFrom).toEqual({ at: "2031-06" });
    const p = preview(wh.request);
    const bal = (y: number) => p.table.filter((c) => c.object === id && c.year === y && c.row.startsWith("cf.balance.account.")).reduce((s, c) => s + c.amount, 0);
    expect(bal(2030)).toBe(0);
    expect(bal(2031)).toBeGreaterThan(0);
    const paid = p.table.filter((c) => c.row === "cf.expense.other.realEstate" && c.amount > 0).map((c) => c.year);
    expect(Math.min(...paid)).toBe(2031);
  });

  it("空き家・別荘の固定資産税の目安は、建った年を入れると建物を古くなった分だけ下げる（経年減点補正率の下限0.20）", () => {
    const h = held("vacantHouse");
    const id = h.id;
    let wh = h.wh;
    const fresh = cost(wh, id)!.amount.value as number;
    expect(fresh).toBe(heldEstateTax({ value: 10_000_000, valueYear: 2026, kind: "vacantHouse", landShare: 0.3 }).value);
    wh = set(wh, `sav/${id}/builtYear`, 1980, "savings");
    const old = cost(wh, id)!.amount;
    // 築25年を超えた木造は経年減点補正率の下限0.20（新築の0.80の25%。2024年度の再建築費評点補正率1.11を掛けても下限の前の額より上がるので据え置き。0181）
    expect(old.value).toBe(heldEstateTax({ value: 10_000_000, valueYear: 2026, kind: "vacantHouse", landShare: 0.3, builtYear: 1980, firstYear: 2026 }).value);
    expect(old.value as number).toBeLessThan(fresh);
    expect((old as { estimate?: { basis?: string } }).estimate?.basis).toContain("新築の評価額の25%に下げた（固定資産評価基準の経年減点補正率 0.2）");
    // 式: 土地 L＝1,000万円×30%×70%、建物 B＝1,000万円×70%×40%×25%
    const L = 10_000_000 * 0.3 * 0.7;
    const B = 10_000_000 * 0.7 * 0.4 * 0.25;
    expect(old.value).toBe(Math.round((L / 6 * 0.014 + (L / 3) * 0.003 + B * 0.017) / 100) * 100);
    // 土地（更地）には建物の欄を出さない
    const land = held("vacantLand");
    expect(fieldMaybe(land.wh, `sav/${land.id}/builtYear`, "savings")).toBeUndefined();
  });
});
