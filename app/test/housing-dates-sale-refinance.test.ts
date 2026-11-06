// 住まい・ローンの時期の連動・売却・借り換え（0052・0025 の追記 2026-11-07）のテスト:
// 購入の時期についてくる日付・住み替えで前の持ち家を終える・住まいの重なりと住まいの無い期間の知らせ・売らない家を空き家として持ち続ける・
// 売ったときに住宅ローンを返す・相続する家の住み始め・住宅ローンの借り換え・ペアローンの2本目の金利・今の残高から入れたローンの借りた年月・持ち家の評価の入れ方
import { describe, expect, it } from "vitest";
import type { Debt, Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { rateRow } from "../src/workspace/input/stages/housingLoans.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { modelHousehold, preview } from "./helpers.ts";
import { fromRequest } from "../src/workspace/input/household.ts";

const BASE = "2026-10";
const settle = (wh: WorkingHousehold) => withProvisionalHousing(withRefreshedEstimates(wh));
const stage = (wh: WorkingHousehold, card = "housing") => buildStage(card as never, wh);
const actions = (wh: WorkingHousehold, card = "housing") => stage(wh, card).sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]);
function action(wh: WorkingHousehold, key: string, card = "housing"): WorkingHousehold {
  const a = actions(wh, card).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return settle(a.run(wh));
}
const hasAction = (wh: WorkingHousehold, key: string) => actions(wh).some((a) => a.key === key || a.key.endsWith(key));
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
  return actions(wh, "family").find((a) => a.key === "family/add/spouse")!.run(wh);
}
const hh = (wh: WorkingHousehold) => wh.request.input.household;
const residences = (wh: WorkingHousehold): Residence[] => hh(wh).residences ?? [];
const bought = (wh: WorkingHousehold): Residence => residences(wh).find((r) => r.purchase !== undefined)!;
const loans = (wh: WorkingHousehold): Debt[] => (hh(wh).debts ?? []).filter((d) => d.kind === "mortgage");
const eventAt = (wh: WorkingHousehold, id: string | undefined) => hh(wh).events?.find((e) => e.id === id)?.at.at;
const notes = (wh: WorkingHousehold) => stage(wh).sections.flatMap((s) => [s.note ?? "", ...s.groups.map((g) => g.note ?? "")]).join("\n");
const sum = (wh: WorkingHousehold, pred: (c: { row: string; year: number; object?: string }) => boolean) =>
  preview(wh.request)
    .table.filter(pred)
    .reduce((s, c) => s + c.amount, 0);

describe("購入の時期を直すと、ほかの日付がついてくる", () => {
  const buying = () => {
    let wh = action(action(action(couple(), "housing/addRent"), "housing/addPurchase"), "housing/addMortgage");
    wh = action(wh, `housing/debt/${loans(wh)[0]!.id}/addPair`);
    return wh;
  };

  it("この家の住み始め・前の賃貸の住み終わり・ペアローンの2本の借入の年月と金利の段・控除の入居が一緒に動く", () => {
    const wh0 = buying();
    const at0 = bought(wh0).purchase!.at.at!;
    expect(loans(wh0).map((d) => d.start.at)).toEqual([at0, at0]);
    const wh = set(wh0, "/purchase/at", "2030-04");
    expect(bought(wh).from).toEqual({ at: "2030-04" });
    const rent = residences(wh).find((r) => r.kind === "rent")!;
    expect(rent.to).toEqual({ at: "2030-03" });
    for (const d of loans(wh)) {
      expect(d.start).toEqual({ at: "2030-04" });
      expect(d.rateSchedule[0]!.from).toEqual({ at: "2030-04" });
      // 金利の見込みの段（5年ごと）も同じだけずれる
      expect(d.rateSchedule.slice(1).map((s) => s.from.at)).toEqual(["2035-04", "2040-04"]);
      expect(eventAt(wh, d.housing?.moveIn)).toBe("2030-04");
    }
    // 表で、買う前の年に住宅ローンの残高・返済が出ない
    const ids = new Set(loans(wh).map((d) => d.id));
    expect(sum(wh, (c) => c.year === 2029 && c.object !== undefined && ids.has(c.object) && c.row.startsWith("cf.balance.debt"))).toBe(0);
    expect(sum(wh, (c) => c.year === 2029 && c.row === "cf.expense.housing.loan")).toBe(0);
    // 賃貸の家賃は購入の前の月まで続く（2029年も家賃を払う）
    expect(sum(wh, (c) => c.year === 2029 && c.row.startsWith("cf.expense.housing.rent"))).toBeGreaterThan(0);
  });

  it("購入の1件には住み始めの欄を出さない。控除の入居は住まいの住み始めから読むだけ", () => {
    const wh = buying();
    expect(fieldMaybe(wh, `${bought(wh).id}/from`)).toBeUndefined();
    expect(fieldMaybe(wh, `${bought(wh).id}/to`)).toBeDefined();
    const mi = fieldOf(wh, `${loans(wh)[0]!.id}/credit/moveIn`);
    expect(mi.readOnly).toBeDefined();
    expect(String(mi.get(wh).value)).toContain("住まいの住み始めから");
  });

  it("住み始めがずれた前の版の世帯には、購入の時期の欄に知らせと「購入の時期に合わせる」", () => {
    let wh = buying();
    const id = bought(wh).id;
    wh = mutate(wh, (h) => void ((h.residences ?? []).find((r) => r.id === id)!.from = { at: "2028-01" }));
    const f = fieldOf(wh, "/purchase/at");
    expect(f.get(wh).warn).toContain("住み始め（2028年1月）と購入の時期");
    const fixed = settle(f.get(wh).warnFix!.run(wh));
    expect(bought(fixed).from).toEqual(bought(fixed).purchase!.at);
    expect(fieldOf(fixed, "/purchase/at").get(fixed).warn ?? null).toBeNull();
  });

  it("借入の年月を手で変えたローンには、借入額の欄に知らせと「購入の時期に合わせる」", () => {
    let wh = buying();
    const d = loans(wh)[0]!;
    wh = set(wh, `${d.id}/start`, "2028-07");
    const f = fieldOf(wh, `${d.id}/principal`);
    expect(f.get(wh).warn).toContain("と借入の年月（2028年7月）が違います");
    const fixed = settle(f.get(wh).warnFix!.run(wh));
    expect(loans(fixed)[0]!.start).toEqual(bought(fixed).purchase!.at);
  });
});

describe("住み替え・住まいの重なりと住まいの無い期間", () => {
  it("今の持ち家がある世帯で購入を足すと、今の家を購入の前の月で住み終わらせ（推定の印）、住み終わりの後を標準に出す", () => {
    const wh = action(fromRequest(modelHousehold("dualAssetsTwoKids")), "housing/addPurchase");
    const own = residences(wh).find((r) => r.kind === "own" && r.purchase === undefined)!;
    expect(own.to).toEqual({ at: "2028-09" });
    const to = fieldOf(wh, `housing/res/${own.id}/to`);
    expect(fieldStatus(to, wh).status).toBe("estimated");
    expect(fieldStatus(to, wh).basis).toContain("住み替え");
    expect(fieldOf(wh, `housing/res/${own.id}/after`).level).toBe("simple");
    expect(notes(wh)).not.toContain("2つ重なっています");
  });

  it("住まいが2つ重なると住まいの見出しに知らせ（二拠点ならそのままでよい）", () => {
    const wh = action(fromRequest(modelHousehold("dualAssetsTwoKids")), "housing/addRent");
    expect(notes(wh)).toContain("住まいが2つ重なっています");
    expect(notes(wh)).toContain("二拠点");
  });

  it("最後の住まいの住み終わりが表の最後より前なら、知らせと「＋ 次の住まい」", () => {
    let wh = settle(fromRequest(modelHousehold("salariedCoupleTwoKids")));
    const own = residences(wh)[0]!;
    wh = set(wh, `housing/res/${own.id}/to`, "2050-03");
    expect(notes(wh)).toContain("2050年4月から先の住まいが入っていません");
    wh = action(wh, "housing/addNextRent");
    const next = residences(wh).at(-1)!;
    expect(next).toMatchObject({ kind: "rent", from: { at: "2050-04" }, to: null });
    expect(notes(wh)).not.toContain("先の住まいが入っていません");
    expect(hasAction(wh, "housing/addNextRent")).toBe(false);
  });
});

describe("住み終わりの後: 売らない・空き家として持ち続ける・売るときにローンを返す", () => {
  const ended = () => {
    const wh = settle(fromRequest(modelHousehold("salariedCoupleTwoKids")));
    return set(wh, `housing/res/${residences(wh)[0]!.id}/to`, "2050-03");
  };

  it("売らないなら、住み終わりの年で計算から外すと書き、「空き家として持ち続ける」で貸していない不動産を作る", () => {
    let wh = ended();
    const r = residences(wh)[0]!;
    const after = fieldOf(wh, `housing/res/${r.id}/after`);
    expect(after.kind === "select" ? after.options.find((o) => o.value === "keep")?.label : null).toBe("売らない（住み終わりで計算から外す）");
    expect(notes(wh)).toContain("住み終わりの年（2050年）で資産・固定資産税・修繕費から外しています");
    wh = action(wh, `housing/res/${r.id}/keepVacant`);
    const a = (hh(wh).accounts ?? []).find((x) => x.subtype === "vacantHouse")!;
    expect(a).toMatchObject({ kind: "realEstate", holdFrom: { at: "2050-04" }, asOf: "2050-04" });
    expect(a.owner).toBe(r.ownership![0]!.member);
    expect((a.marketValue as { state?: string }).state).toBe("estimated");
    expect(a.marketValue!.value).toBeGreaterThan(0);
    expect(hasAction(wh, `housing/res/${r.id}/keepVacant`)).toBe(false);
    expect(notes(wh)).toContain("空き家）で持ち続けます");
    // 2051年も不動産として資産に残る（作った空き家の器で）
    expect(sum(wh, (c) => c.year === 2051 && c.object === a.id && c.row.startsWith("cf.balance.account.realEstate"))).toBeGreaterThan(0);
    // 住み終わりを直すと、空き家の持ち始めも翌月についてくる
    wh = set(wh, `housing/res/${r.id}/to`, "2048-09");
    expect((hh(wh).accounts ?? []).find((x) => x.id === a.id)).toMatchObject({ holdFrom: { at: "2048-10" }, asOf: "2048-10" });
    // 売るに変えると、作った空き家が残っている知らせと「作った空き家を外す」（二重に数えない）
    wh = set(wh, `housing/res/${r.id}/after`, "sell");
    const sell = fieldOf(wh, `housing/res/${r.id}/after`).get(wh);
    expect(sell.warn).toContain("二重に数えます");
    wh = settle(sell.warnFix!.run(wh));
    expect((hh(wh).accounts ?? []).some((x) => x.id === a.id)).toBe(false);
    expect(fieldOf(wh, `housing/res/${r.id}/after`).get(wh).warn ?? null).toBeNull();
  });

  it("住宅ローンの残る家を売ると、売る月に残りを返す（既定）。欄の下に残高の目安。返さないなら返済が続く", () => {
    let wh = settle(fromRequest(modelHousehold("salariedCoupleTwoKids")));
    const r = residences(wh)[0]!;
    wh = set(wh, `housing/res/${r.id}/to`, "2035-03");
    wh = set(wh, `housing/res/${r.id}/after`, "sell");
    expect(String(fieldOf(wh, `${r.id}/sale/price`).get(wh).hint)).toMatch(/売る月に住宅ローンが約[\d,.]+万円残ります（売った月に一括で返します）/);
    expect(fieldOf(wh, `${r.id}/sale/repayLoan`).get(wh).value).toBe(true);
    const loan = sum(wh, (c) => c.year === 2037 && c.row === "cf.expense.housing.loan");
    expect(loan).toBe(0);
    const keep = set(wh, `${r.id}/sale/repayLoan`, false);
    expect(residences(keep)[0]!.sale!.repayLoan).toBe(false);
    expect(sum(keep, (c) => c.year === 2037 && c.row === "cf.expense.housing.loan")).toBeGreaterThan(0);
    expect(String(fieldOf(keep, `${r.id}/sale/price`).get(keep).hint)).toContain("売った後も返済が続きます");
  });
});

describe("相続する家の住み始め", () => {
  it("10年後で置いた住み始めは推定の印。受け取る相続の行を入れると、その月に合わせる（家賃なしの住み終わりも）", () => {
    let wh = salaried();
    const r0 = residences(wh)[0];
    wh = action(r0 === undefined ? action(wh, "housing/addFree") : wh, "housing/addFree");
    const free = residences(wh).find((r) => r.kind === "rent" && r.rent?.monthly.state === "notApplicable")!;
    wh = action(wh, `housing/res/${free.id}/inherit`);
    const home = residences(wh).find((r) => r.kind === "own")!;
    const from = fieldOf(wh, `housing/res/${home.id}/from`);
    expect(fieldStatus(from, wh).status).toBe("estimated");
    expect(fieldStatus(from, wh).basis).toContain("10年後");
    // 受け取る相続の行を足し、時期を2031年4月にする
    wh = action(wh, "money/inherit/in/add/inheritance", "inheritance");
    const flow = (hh(wh).incomeFlows ?? []).find((f) => f.kind === "inheritance")!;
    wh = settle(mutate(wh, (h) => void ((h.incomeFlows ?? []).find((f) => f.id === flow.id)!.from = { at: "2031-04" })));
    const home2 = residences(wh).find((r) => r.id === home.id)!;
    expect(home2.from).toEqual({ at: "2031-04" });
    expect(residences(wh).find((r) => r.id === free.id)!.to).toEqual({ at: "2031-03" });
    expect(fieldStatus(fieldOf(wh, `housing/res/${home.id}/from`), wh).basis).toContain("受け取る相続の時期");
    // FP が住み始めを直したら、もう合わせない
    wh = set(wh, `housing/res/${home.id}/from`, "2032-01");
    wh = settle(mutate(wh, (h) => void ((h.incomeFlows ?? []).find((f) => f.id === flow.id)!.from = { at: "2033-04" })));
    expect(residences(wh).find((r) => r.id === home.id)!.from).toEqual({ at: "2032-01" });
  });
});

describe("住宅ローンの借り換え", () => {
  it("住宅ローンに「借り換え」の中枠と「＋ 借り換え」。足すと5年後に完済の年月を変えずに借り換え、控除は借り換えの後も続く", () => {
    let wh = settle(fromRequest(modelHousehold("salariedCoupleTwoKids")));
    const d = loans(wh)[0]!;
    const band = stage(wh).sections.flatMap((s) => s.groups).find((g) => g.key === `housing/debt/${d.id}/band/refinance`)!;
    expect(band.title).toBe("借り換え");
    expect(band.actions.map((a) => a.label)).toEqual(["＋ 借り換え"]);
    wh = action(wh, `housing/debt/${d.id}/addRefinance`);
    const rf = loans(wh)[0]!.refinance![0]!;
    expect(rf.at).toEqual({ at: "2031-10" });
    expect(rf.rateSchedule[0]).toMatchObject({ type: "variable" });
    expect(fieldOf(wh, `housing/debt/${d.id}/refinance/0/rate`).level).toBe("detail");
    // 借り換えの金利を下げると、その後の返済が減る
    const before = sum(wh, (c) => c.year === 2033 && c.row === "cf.expense.housing.loan");
    const lower = set(wh, `housing/debt/${d.id}/refinance/0/rate`, "0.001");
    expect(sum(lower, (c) => c.year === 2033 && c.row === "cf.expense.housing.loan")).toBeLessThan(before);
  });
});

describe("ペアローンの2本目の金利", () => {
  it("1本目の金利が推定なら2本目も推定（ペアローンの1本目と同じ）。1本目を直すと2本目も入れ直す。2本目を直したら追わない", () => {
    let wh = action(action(couple(), "housing/addPurchase"), "housing/addMortgage");
    const a = loans(wh)[0]!;
    wh = action(wh, `housing/debt/${a.id}/addPair`);
    const b = loans(wh)[1]!;
    expect(rateRow(wh, b)).toMatchObject({ state: "estimated" });
    expect(rateRow(wh, b)?.estimate?.basis).toContain("ペアローンの1本目と同じ");
    expect(b.rateSchedule.map((s) => [s.from, s.type, s.rate])).toEqual(a.rateSchedule.map((s) => [s.from, s.type, s.rate]));
    wh = set(wh, `${a.id}/rate`, "0.009");
    expect(loans(wh)[1]!.rateSchedule[0]!.rate).toBe("0.009");
    wh = set(wh, `${b.id}/rate`, "0.011");
    wh = set(wh, `${a.id}/rate`, "0.008");
    expect(loans(wh)[1]!.rateSchedule[0]!.rate).toBe("0.011");
  });
});

describe("今の残高から入れた住宅ローンの借りた年月", () => {
  it("借りた年月を入れると、持ち家の住み始め（入れていなければ）と控除の入居も同じ年月。逆算した金利を完済の年月の下に", () => {
    let wh = action(salaried(), "housing/addOwn");
    wh = action(wh, "housing/addMortgage");
    const d = loans(wh)[0]!;
    expect(d.housing).toBeUndefined();
    wh = set(wh, `${d.id}/payment`, 100000);
    expect(String(fieldOf(wh, `${d.id}/payoff`).get(wh).hint)).toMatch(/＝金利 年[\d.]+%（逆算）/);
    wh = set(wh, `${d.id}/start`, "2018-04");
    const own = residences(wh).find((r) => r.kind === "own")!;
    expect(own.from).toEqual({ at: "2018-04" });
    const d2 = loans(wh)[0]!;
    expect(d2.housing).toBeDefined();
    expect(eventAt(wh, d2.housing?.moveIn)).toBe("2018-04");
    expect(String(fieldOf(wh, `${d.id}/creditSummary`).get(wh).value)).toContain("入居 2018年4月");
  });
});

describe("持ち家の評価の入れ方（今の時価で／買った値段で）", () => {
  it("今の時価で入れた1995年築の木造は、時点が今月・土地の割合は建った年からの目安で、建物を新築の値で数えない", () => {
    let wh = action(salaried(), "housing/addOwn");
    const r = residences(wh).find((x) => x.kind === "own")!;
    wh = set(wh, `housing/res/${r.id}/valuation/basis`, "market");
    wh = set(wh, `housing/res/${r.id}/valuation/value`, 30_000_000);
    expect(fieldOf(wh, `housing/res/${r.id}/valuation/basis`).get(wh).warn).toContain("建物が建った年を入れてください");
    wh = set(wh, `housing/res/${r.id}/valuation/builtYear`, 1995);
    const v = residences(wh).find((x) => x.id === r.id)!.valuation!;
    // 入れ方の既定は今の時価（時点の省略は計算の基準の月）
    expect(fieldOf(wh, `housing/res/${r.id}/valuation/basis`).get(wh).value).toBe("market");
    expect(v.asOf ?? BASE).toBe(BASE);
    expect(v.builtYear).toBe(1995);
    // 木造22年・下限2割: 新築の土地30%なら 0.3÷(0.3＋0.7×0.2)＝0.68
    expect(v.landShare).toBe("0.68");
    expect(fieldStatus(fieldOf(wh, `housing/res/${r.id}/valuation/landShare`), wh).basis).toContain("建った年からの目安");
    const building = sum(wh, (c) => c.year === 2026 && c.object === r.id && c.row === "cf.balance.account.realEstate.building");
    expect(building).toBeLessThan(10_000_000);
    // 買った値段に変えると、時点を住み始めにし、土地の割合の目安を外す
    wh = set(wh, `housing/res/${r.id}/from`, "2012-04");
    wh = set(wh, `housing/res/${r.id}/valuation/basis`, "purchase");
    const v2 = residences(wh).find((x) => x.id === r.id)!.valuation!;
    expect(v2).toMatchObject({ basis: "purchase", asOf: "2012-04" });
    expect(v2.landShare).toBeUndefined();
  });
});
