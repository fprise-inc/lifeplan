// 住まい・ローンのつなぎ目の直し（0161）: 住宅購入の予定を外したときの今の家の住み終わり、空き家の持ち始めと毎年の費用、
// 住宅ローンの入れ方を変えたときの推定の残高、今の残高だけを入れたローン、購入にローンが無いときの知らせ、返せない返済額
import { describe, expect, it } from "vitest";
import type { Debt, PreviewResult, Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { heldCostRow, heldEstateCostEstimate } from "../src/workspace/input/heldEstateTax.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { dropStaleRows } from "../src/workspace/input/rows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { modelHousehold, preview } from "./helpers.ts";

const stage = (wh: WorkingHousehold, card: StageId = "housing") => buildStage(card, wh);
const actions = (wh: WorkingHousehold, card: StageId = "housing") => stage(wh, card).sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]);
/** 入力のパネルと同じ始末（古い行を外し、推定を入れ直す） */
const panel = (before: WorkingHousehold, next: WorkingHousehold) => (next === before ? next : withProvisionalHousing(withRefreshedEstimates(dropStaleRows(before, next))));
function action(wh: WorkingHousehold, key: string, card: StageId = "housing"): WorkingHousehold {
  const a = actions(wh, card).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return panel(wh, a.run(wh));
}
const hasAction = (wh: WorkingHousehold, key: string) => actions(wh).some((x) => x.key.endsWith(key));
function fieldOf(wh: WorkingHousehold, suffix: string, card: StageId = "housing"): FieldDef {
  const f = allFields(stage(wh, card)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1], card: StageId = "housing") => panel(wh, fieldOf(wh, suffix, card).set(wh, v));
/** 時点の欄は画面と同じく time.setWhen で書く */
function setWhen(wh: WorkingHousehold, suffix: string, ym: string): WorkingHousehold {
  const f = fieldOf(wh, suffix);
  return panel(wh, f.time !== undefined ? f.time.setWhen(wh, { at: ym }, "auto") : f.set(wh, ym));
}
const residences = (wh: WorkingHousehold): Residence[] => wh.request.input.household.residences ?? [];
const vacants = (wh: WorkingHousehold) => (wh.request.input.household.accounts ?? []).filter((a) => a.subtype === "vacantHouse");
const mortgage = (wh: WorkingHousehold): Debt => (wh.request.input.household.debts ?? []).find((d) => d.kind === "mortgage")!;
const sum = (r: PreviewResult, pre: string, year: number, object?: string) => r.table.filter((c) => c.year === year && c.row.startsWith(pre) && (object === undefined || c.object === object)).reduce((s, c) => s + c.amount, 0);

/** 会社員の本人（年収600万円）の空の世帯 */
function salaried(): WorkingHousehold {
  let wh = blankHousehold("2026-10");
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!;
  return annual.set(wh, 6000000);
}

describe("住宅購入の予定を外すと、住み替えで入れた今の住まいの住み終わりを戻す（H7-001）", () => {
  it("今の持ち家の住み終わり・「住み終わりの月に売る」・仮の印を外し、計算も足す前と同じになる", () => {
    const w0 = fromRequest(modelHousehold("dualAssetsTwoKids"));
    const own0 = residences(w0).find((r) => r.kind === "own" && r.purchase === undefined)!;
    const w1 = action(w0, "housing/addPurchase");
    expect(residences(w1).find((r) => r.id === own0.id)!.to).not.toBeNull();
    const bought = residences(w1).find((r) => r.purchase !== undefined)!;
    const w2 = action(w1, `housing/res/${bought.id}/remove`);
    const own2 = residences(w2).find((r) => r.id === own0.id)!;
    expect(own2.to).toEqual(own0.to);
    expect(own2.sale).toEqual(own0.sale);
    expect(Object.keys(w2.assumed).filter((k) => k.includes(own0.id))).toEqual([]);
    const r0 = preview(w0.request);
    const r2 = preview(w2.request);
    for (const y of [2029, 2040]) expect(sum(r2, "cf.expense.housing", y)).toBe(sum(r0, "cf.expense.housing", y));
    expect(sum(r2, "cf.balance.financial", 2078)).toBe(sum(r0, "cf.balance.financial", 2078));
  });

  it("今の賃貸の住み終わりも戻す", () => {
    const w0 = action(salaried(), "housing/addRent");
    const rent = residences(w0)[0]!;
    const w1 = action(w0, "housing/addPurchase");
    expect(residences(w1).find((r) => r.id === rent.id)!.to).not.toBeNull();
    const bought = residences(w1).find((r) => r.purchase !== undefined)!;
    const w2 = action(w1, `housing/res/${bought.id}/remove`);
    expect(residences(w2).find((r) => r.id === rent.id)!.to).toBeNull();
  });

  it("FP が住み終わりを直していたら（仮の印が無い）、外しても残す", () => {
    const w0 = fromRequest(modelHousehold("dualAssetsTwoKids"));
    const own0 = residences(w0).find((r) => r.kind === "own" && r.purchase === undefined)!;
    let w = action(w0, "housing/addPurchase");
    w = setWhen(w, `housing/res/${own0.id}/to`, "2028-06");
    const bought = residences(w).find((r) => r.purchase !== undefined)!;
    w = action(w, `housing/res/${bought.id}/remove`);
    expect(residences(w).find((r) => r.id === own0.id)!.to).toEqual({ at: "2028-06" });
  });
});

describe("空き家として持ち続ける（H7-004・H7-005）", () => {
  const kept = () => {
    const w0 = fromRequest(modelHousehold("dualAssetsTwoKids"));
    const own0 = residences(w0).find((r) => r.kind === "own" && r.purchase === undefined)!;
    let w = action(w0, "housing/addPurchase");
    w = set(w, `housing/res/${own0.id}/after`, "keep");
    w = action(w, `housing/res/${own0.id}/keepVacant`);
    return { w, own: own0 };
  };

  it("購入の時期を直して今の家の住み終わりが動くと、空き家の持ち始める時点もついてくる（家を二重に数えない）", () => {
    const { w, own } = kept();
    const bought = residences(w).find((r) => r.purchase !== undefined)!;
    const moved = setWhen(w, `housing/res/${bought.id}/purchase/at`, "2029-10");
    expect(residences(moved).find((r) => r.id === own.id)!.to).toEqual({ at: "2029-09" });
    const [held] = vacants(moved);
    expect(vacants(moved)).toHaveLength(1);
    expect(held!.holdFrom).toEqual({ at: "2029-10" });
    expect(held!.asOf).toBe("2029-10");
    // つながりが切れない（「空き家として持ち続ける」がまた出ない）
    expect(hasAction(moved, `${own.id}/keepVacant`)).toBe(false);
    const r = preview(moved.request);
    expect(sum(r, "cf.balance.account.realEstate", 2028, held!.id)).toBe(0);
  });

  it("作った空き家に、毎年の費用（固定資産税の目安）の推定の行を入れる", () => {
    const { w } = kept();
    const [held] = vacants(w);
    const row = heldCostRow(w.request.input.household, held!.id);
    expect(row).toBeDefined();
    expect(row!.amount.state).toBe("estimated");
    expect(row!.amount.value).toBe(heldEstateCostEstimate(w, held!.id)!.value);
    expect(row!.amount.value).toBeGreaterThan(0);
    const r = preview(w.request);
    // 表の行の物は、つながる行（出るお金の行）の ID
    expect(sum(r, "cf.expense.other.realEstate", 2030, row!.id)).toBe(row!.amount.value);
  });
});

/** 今住んでいる持ち家と、「＋ 住宅ローン」で足したローン（入れ方の既定は「今の残高から」） */
const owning = () => action(action(salaried(), "housing/addOwn"), "housing/addMortgage");

describe("住宅ローンの入れ方を「借入額から」に変える（H6-004）", () => {
  it("推定の今の残高と残高の時点を外し、借入額・借入の年月から計算する", () => {
    let wh = owning();
    const id = mortgage(wh).id;
    expect(mortgage(wh).balance).toBeDefined();
    wh = set(wh, `${id}/entry`, "principal");
    expect(mortgage(wh).balance).toBeUndefined();
    expect(mortgage(wh).balanceAsOf).toBeUndefined();
    wh = set(wh, `${id}/principal`, 30000000);
    wh = setWhen(wh, `${id}/start`, "2015-04");
    const r = preview(wh.request);
    // 3,000万円を2015年4月から返していれば、2027年の年末の残高は借入額よりずっと少ない
    expect(sum(r, "cf.balance.debt", 2027)).toBeLessThan(25000000);
  });

  it("FP が入れた今の残高は、入れ方を変えても消さない", () => {
    let wh = owning();
    const id = mortgage(wh).id;
    wh = set(wh, `${id}/balance`, 15000000);
    wh = set(wh, `${id}/entry`, "principal");
    expect(mortgage(wh).balance?.value).toBe(15000000);
    expect(mortgage(wh).balanceAsOf).toBeDefined();
  });
});

describe("今の残高だけを入れたローン（H6-003）", () => {
  it("「借入額から」の今の残高の欄に入れると、残高の時点が空なら計算の基準の月にする（計算が残高を使う）", () => {
    let wh = owning();
    const id = mortgage(wh).id;
    wh = set(wh, `${id}/entry`, "principal");
    wh = set(wh, `${id}/balance`, 20000000);
    expect(mortgage(wh).balanceAsOf).toBe(wh.request.input.baseMonth);
  });

  it("収益不動産のローンの今の残高でも同じ", () => {
    let wh = fromRequest(modelHousehold("rentalSample"));
    const acc = (wh.request.input.household.accounts ?? []).find((a) => a.kind === "realEstate" && a.property !== undefined)!;
    const add = actions(wh, "rental").find((a) => a.key.endsWith(`${acc.id}/property/addLoan`) || a.key.endsWith("/property/addLoan"))!;
    const before = new Set((wh.request.input.household.debts ?? []).map((d) => d.id));
    wh = panel(wh, add.run(wh));
    const loan = (wh.request.input.household.debts ?? []).find((d) => !before.has(d.id))!;
    expect(loan.balanceAsOf).toBeUndefined();
    wh = set(wh, `housing/debt/${loan.id}/balance`, 40000000, "rental");
    const after = (wh.request.input.household.debts ?? []).find((d) => d.id === loan.id)!;
    expect(after.balanceAsOf).toBe(wh.request.input.baseMonth);
  });
});

describe("住宅購入の予定に住宅ローンが無い（H6-005。0175 で「どう買うか」の欄に改めた）", () => {
  it("物件の価格−頭金の払い方が入っていないと、「どう買うか」の欄の未入力の印と確かめの一覧に知らせる。住宅ローンを使うを選ぶと消える", () => {
    let wh = action(salaried(), "housing/addPurchase");
    const bought = residences(wh).find((r) => r.purchase !== undefined)!;
    const funding = fieldOf(wh, `housing/res/${bought.id}/purchase/funding`);
    expect(fieldStatus(funding, wh).status).toBe("missing");
    expect(fieldStatus(funding, wh).basis).toMatch(/払い方が入っていません/);
    expect(fieldOf(wh, `housing/res/${bought.id}/purchase/price`).get(wh).warn ?? null).toBeNull();
    expect(checkList(wh).some((r) => r.fieldKey === funding.key && /払い方が入っていません/.test(r.detail ?? ""))).toBe(true);
    // 住宅ローンを使う: 住宅ローン（物件の価格−頭金）を足す
    wh = set(wh, `housing/res/${bought.id}/purchase/funding`, "loan");
    const d = mortgage(wh);
    expect(d.principal).toBe(bought.purchase!.price - (bought.purchase!.downPayment ?? 0));
    expect(fieldStatus(fieldOf(wh, `housing/res/${bought.id}/purchase/funding`), wh).status).not.toBe("missing");
  });

  it("頭金を物件の価格にした（自己資金で払う）なら、現金で買う形として知らせない", () => {
    let wh = action(salaried(), "housing/addPurchase");
    const bought = residences(wh).find((r) => r.purchase !== undefined)!;
    wh = set(wh, `housing/res/${bought.id}/purchase/down`, bought.purchase!.price);
    expect(fieldOf(wh, `housing/res/${bought.id}/purchase/funding`).get(wh).value).toBe("cash");
    expect(checkList(wh).some((r) => /払い方が入っていません/.test(r.detail ?? ""))).toBe(false);
  });
});

describe("今の残高から入れた住宅ローンの返済額と完済の年月（H6-006）", () => {
  const start = () => {
    let wh = owning();
    const id = mortgage(wh).id;
    wh = set(wh, `${id}/balance`, 15000000);
    return { wh, id };
  };

  it("返せる組み合わせなら、完済の年月を直しても入れた返済額のまま金利を解き直す", () => {
    const s0 = start();
    const id = s0.id;
    let wh = s0.wh;
    wh = set(wh, `${id}/payment`, 100000);
    wh = set(wh, `${id}/payoff`, "2045-03");
    expect(fieldOf(wh, `${id}/payment`).get(wh).value).toBe(100000);
    wh = set(wh, `${id}/payoff`, "2042-03");
    expect(fieldOf(wh, `${id}/payment`).get(wh).value).toBe(100000);
  });

  it("返せない返済額は入れずに理由を出す（「入れました」にしない）", () => {
    const s0 = start();
    const id = s0.id;
    let wh = s0.wh;
    wh = set(wh, `${id}/payoff`, "2040-03");
    wh = set(wh, `${id}/payment`, 100000);
    const f = fieldOf(wh, `${id}/payment`);
    // 8万円×残りの回数では1,500万円を返せない
    expect(f.refuse?.(wh, 80000)).toMatch(/返せません/);
    expect(f.refuse?.(wh, 110000) ?? null).toBeNull();
    expect(f.set(wh, 80000)).toBe(wh);
  });

  it("完済の年月を直して、入れた返済額で返せなくなったら、返済額の欄に知らせる", () => {
    const s0 = start();
    const id = s0.id;
    let wh = s0.wh;
    wh = set(wh, `${id}/payment`, 80000);
    wh = set(wh, `${id}/payoff`, "2045-03");
    expect(fieldOf(wh, `${id}/payment`).get(wh).value).toBe(80000);
    expect(fieldOf(wh, `${id}/payment`).get(wh).warn ?? null).toBeNull();
    wh = set(wh, `${id}/payoff`, "2040-03");
    const st = fieldOf(wh, `${id}/payment`).get(wh);
    expect(st.warn).toMatch(/80,000円/);
    expect(st.warn).toMatch(/返せません/);
    expect(fieldStatus(fieldOf(wh, `${id}/payment`), wh)).toBeDefined();
  });
});
