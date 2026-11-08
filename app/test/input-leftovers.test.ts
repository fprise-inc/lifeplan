// 入力の残りの直し（0175）: 割合の欄の範囲（0162 の未確定）・住宅購入の「どう買うか」（0161 の購入にローンが無いときの改め）・
// 終わりの無い働き方の退職金（0163 の判断）・休業を挟んだ働き方の年収（同じ勤め先の後の期間も一緒に直す）
import { describe, expect, it } from "vitest";
import type { Debt, PreviewResult, Residence } from "../src/engine/types.ts";
import { readField, rejectReason } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { dropStaleRows } from "../src/workspace/input/rows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { fillCard, inputItems } from "../src/workspace/input/items.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string) => fromRequest(modelHousehold(id));
const O = { unit: "man" as const, period: "monthly" as const, baseMonth: "2026-11" };
const stage = (wh: WorkingHousehold, card: StageId = "housing") => buildStage(card, wh);
const fieldsOf = (wh: WorkingHousehold, card: StageId) => allFields(stage(wh, card));
function fieldOf(wh: WorkingHousehold, card: StageId, test: (f: FieldDef) => boolean): FieldDef {
  const f = fieldsOf(wh, card).find(test);
  if (f === undefined) throw new Error("no field");
  return f;
}
/** 入力のパネルと同じ始末（古い行を外し、推定を入れ直す） */
const panel = (before: WorkingHousehold, next: WorkingHousehold) => (next === before ? next : withProvisionalHousing(withRefreshedEstimates(dropStaleRows(before, next))));

// ---- 1. 割合の欄の範囲 ----

describe("割合の欄は 0〜100%（ご本人の持分・連帯債務の負担割合・団信の保障割合・一時金で受け取る割合・資産の配分の割合・車の頭金の割合）", () => {
  const cases: { name: string; model: string; card: StageId; test: (f: FieldDef) => boolean }[] = [
    { name: "ご本人の持分", model: "lifetime100Assets", card: "housing", test: (f) => f.key.endsWith("/ownerShare") },
    { name: "連帯債務の負担割合", model: "lifetime100Assets", card: "housing", test: (f) => f.item === "debt.debtors" && f.key.endsWith("/share") },
    { name: "団信の保障割合", model: "housingPurchase", card: "housing", test: (f) => f.key.endsWith("/clRatio") },
    { name: "一時金で受け取る割合（退職金）", model: "retirementSequence", card: "retirement", test: (f) => f.key.endsWith("/lumpShare") },
    { name: "一時金で受け取る割合（iDeCo など）", model: "dualAssetsTwoKids", card: "savings", test: (f) => f.key.endsWith("/lumpShare") },
    { name: "資産の配分の割合", model: "dualAssetsTwoKids", card: "savings", test: (f) => /\/mix\/\d+\/share$/.test(f.key) },
    { name: "車の頭金の割合", model: "dualAssetsTwoKids", card: "car", test: (f) => f.item === "car.loan" && f.key.endsWith("/down") },
  ];
  it.each(cases)("$name: 範囲の外は打った時点で理由を出して止める", ({ model, card, test }) => {
    const f = fieldOf(open(model), card, test);
    expect(rejectReason(f, "120")).toBe("100%より大きい値は設定できません。");
    expect(rejectReason(f, "-5")).toBe("0%より小さい値は設定できません。");
    expect(rejectReason(f, "100")).toBeNull();
    expect(rejectReason(f, "0")).toBeNull();
    expect(readField(f, "120", O)).toBeUndefined();
  });

  it("すでに入っている範囲の外の値は、欄の下と確かめの一覧で知らせる（持分・保障割合）", () => {
    const wh = mutate(open("housingPurchase"), (h) => {
      const d = (h.debts ?? []).find((x) => x.creditLife?.ratio !== undefined)!;
      d.creditLife!.ratio = "1.5";
    });
    const f = fieldOf(wh, "housing", (x) => x.key.endsWith("/clRatio"));
    expect(f.get(wh).warn).toMatch(/範囲（0%〜100%）の外の値（150%）/);
    expect(checkList(wh).some((r) => r.fieldKey === f.key && /範囲（0%〜100%）の外の値/.test(r.detail ?? ""))).toBe(true);
  });
});

// ---- 2. 住宅購入の「どう買うか」 ----

/** 会社員の本人（年収600万円）の空の世帯 */
function salaried(): WorkingHousehold {
  let wh = blankHousehold("2026-10");
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!;
  return annual.set(wh, 6000000);
}
const residences = (wh: WorkingHousehold): Residence[] => wh.request.input.household.residences ?? [];
const bought = (wh: WorkingHousehold): Residence => residences(wh).find((r) => r.purchase !== undefined)!;
const mortgages = (wh: WorkingHousehold): Debt[] => (wh.request.input.household.debts ?? []).filter((d) => d.kind === "mortgage");
function withPurchase(): WorkingHousehold {
  const wh = salaried();
  const a = stage(wh).sections.flatMap((s) => s.actions).find((x) => x.key === "housing/addPurchase")!;
  return panel(wh, a.run(wh));
}
const funding = (wh: WorkingHousehold) => fieldOf(wh, "housing", (f) => f.key === `housing/res/${bought(wh).id}/purchase/funding`);
const setFunding = (wh: WorkingHousehold, v: string) => panel(wh, funding(wh).set(wh, v));
const hasField = (wh: WorkingHousehold, suffix: string) => fieldsOf(wh, "housing").some((f) => f.key === `housing/res/${bought(wh).id}/${suffix}`);
const yearSum = (r: PreviewResult, row: string, year: number) => r.table.filter((c) => c.year === year && c.row === row).reduce((s, c) => s + c.amount, 0);

describe("住宅の購入: 物件の価格の次に「どう買うか」（現金で買う・住宅ローンを使う）", () => {
  it("まだ選んでいない（ローンが無く、頭金が物件の価格より少ない）: 未入力の印と「払い方が入っていません」。黙って現金とみなさない", () => {
    const wh = withPurchase();
    const f = funding(wh);
    expect(f.get(wh).value).toBeNull();
    const s = fieldStatus(f, wh);
    expect(s.status).toBe("missing");
    expect(s.basis).toMatch(/払い方が入っていません/);
    expect(checkList(wh).filter((r) => r.fieldKey === f.key && /払い方が入っていません/.test(r.detail ?? "")).length).toBe(1);
    // 欄の並び: 物件の価格のすぐ次
    const keys = fieldsOf(wh, "housing").map((x) => x.key);
    const k = `housing/res/${bought(wh).id}/purchase`;
    expect(keys.indexOf(`${k}/funding`)).toBe(keys.indexOf(`${k}/price`) + 1);
    expect(hasField(wh, "purchase/down")).toBe(true);
  });

  it("現金で買う: 頭金とローンの欄を出さず、物件の価格と諸費用を購入の月に手元のお金から払う。知らせは出さない。価格を直しても現金のまま", () => {
    let wh = setFunding(withPurchase(), "cash");
    const r = bought(wh);
    expect(r.purchase!.downPayment).toBe(r.purchase!.price);
    expect(mortgages(wh)).toEqual([]);
    expect(funding(wh).get(wh).value).toBe("cash");
    expect(fieldStatus(funding(wh), wh).status).not.toBe("missing");
    expect(hasField(wh, "purchase/down")).toBe(false);
    expect(checkList(wh).some((x) => /払い方が入っていません/.test(x.detail ?? ""))).toBe(false);
    const y = Number((r.purchase!.at as { at: string }).at.slice(0, 4));
    const res = preview(wh.request);
    expect(yearSum(res, "cf.expense.housing.purchase.downPayment", y)).toBe(r.purchase!.price);
    expect(yearSum(res, "cf.expense.housing.purchase.costs", y)).toBe(r.purchase!.costs);
    // 物件の価格を直すと、頭金（現金で払う額）もついてくる
    const price = fieldOf(wh, "housing", (x) => x.key === `housing/res/${r.id}/purchase/price`);
    wh = panel(wh, price.set(wh, 52_000_000));
    expect(bought(wh).purchase!.downPayment).toBe(52_000_000);
    expect(funding(wh).get(wh).value).toBe("cash");
  });

  it("住宅ローンを使う: この家の住宅ローン（物件の価格−頭金を借りる）を足し、ローンの欄を同じ住宅の購入の中に続けて出す", () => {
    const wh = setFunding(withPurchase(), "loan");
    const r = bought(wh);
    expect(funding(wh).get(wh).value).toBe("loan");
    expect(mortgages(wh).length).toBe(1);
    const d = mortgages(wh)[0]!;
    expect(d.principal).toBe(r.purchase!.price - (r.purchase!.downPayment ?? 0));
    expect(hasField(wh, "purchase/down")).toBe(true);
    // ローンの欄は「住まい」の区画の住宅の購入に続けて出す（「住宅ローン」の区画には出さない）
    const res = stage(wh).sections.find((s) => s.key === "housing/residences")!;
    const loans = stage(wh).sections.find((s) => s.key === "housing/loans")!;
    expect(res.groups.some((g) => g.key === `housing/debt/${d.id}`)).toBe(true);
    expect(loans.groups.some((g) => g.key.startsWith(`housing/debt/${d.id}`))).toBe(false);
    expect(allFields(stage(wh)).some((f) => f.key === `housing/debt/${d.id}/principal`)).toBe(true);
    expect(checkList(wh).some((x) => /払い方が入っていません/.test(x.detail ?? ""))).toBe(false);
  });

  it("ローンから現金に選び直すと、この家の住宅ローンを外して頭金を物件の価格にする。現金からローンに戻すと、頭金を目安に戻してローンを足す", () => {
    let wh = setFunding(withPurchase(), "loan");
    const down0 = bought(wh).purchase!.downPayment ?? 0;
    wh = setFunding(wh, "cash");
    expect(mortgages(wh)).toEqual([]);
    expect(bought(wh).purchase!.downPayment).toBe(bought(wh).purchase!.price);
    wh = setFunding(wh, "loan");
    expect(bought(wh).purchase!.downPayment).toBe(down0);
    expect(mortgages(wh)[0]!.principal).toBe(bought(wh).purchase!.price - down0);
  });

  it("前からある世帯: ローンが付いていれば「住宅ローンを使う」、外すと未入力（現金とはみなさない）", () => {
    const wh = open("housingPurchase");
    expect(funding(wh).get(wh).value).toBe("loan");
    expect(fieldStatus(funding(wh), wh).status).not.toBe("missing");
    const none = mutate(wh, (h) => void (h.debts = (h.debts ?? []).filter((d) => d.kind !== "mortgage")));
    expect(funding(none).get(none).value).toBeNull();
    expect(fieldStatus(funding(none), none).status).toBe("missing");
  });
});

// ---- 3. 終わりの無い働き方の退職金 ----

describe("終わりの無い働き方の退職金: 「目安で入れる」のときに、働く最後の年齢の推定で期間の終わりを補う", () => {
  it("dualNoKids: 目安で入れた後の退職金のカードは推定で計算中。期間の終わりは推定の印つき。退職一時金が計算に入る", () => {
    const wh = open("dualNoKids");
    expect((wh.request.input.household.employmentPeriods ?? []).some((p) => p.to === null)).toBe(true);
    const filled = fillCard(wh, "retirement");
    expect(inputItems(filled).find((i) => i.id === "retirement")!.status).toBe("est");
    const h = filled.request.input.household;
    for (const b of h.retirementBenefits ?? []) {
      const p = (h.employmentPeriods ?? []).find((x) => x.id === b.employment)!;
      expect(p.to).not.toBeNull();
    }
    // 期間の終わり（定年・働く最後の年齢）は推定の印
    const ends = fieldsOf(filled, "work").filter((f) => /\/(retireAge|mainEnd|mainEndAge|retirement)$/.test(f.key));
    expect(ends.some((f) => fieldStatus(f, filled).status === "estimated")).toBe(true);
    // 見本の表は短い（2027年まで）ので、受け取る年まで伸ばして見る
    const r = preview({ ...filled.request, input: { ...filled.request.input, endYear: 2060 } });
    expect(r.table.filter((c) => c.row === "cf.income.lumpSum.retirement").reduce((s, c) => s + c.amount, 0)).toBeGreaterThan(0);
  });
});

// ---- 4. 休業を挟んだ働き方の年収（H3-006） ----

describe("休業を挟んだ同じ勤め先の期間の年収（H3-006）", () => {
  const afterLeave = (w: WorkingHousehold) => (w.request.input.household.employmentPeriods ?? []).find((p) => (p.from as { at?: string }).at === "2027-07")!;
  const total = (w: WorkingHousehold) => fieldOf(w, "work", (f) => /^work\/[^/]+\/now\/total$/.test(f.key));

  it("parentCare: 今の期間の年収を 460万→470万 にすると、介護休業の後の期間（2027-07〜）も同じ額になる", () => {
    const wh = open("parentCare");
    const w1 = panel(wh, total(wh).set(wh, 4_700_000));
    expect(afterLeave(w1).salary!.annual.value).toBe(4_300_000);
    expect(afterLeave(w1).salary!.bonus?.value).toBe(400_000);
  });

  it("休業の後の期間を FP が別に直していたら（年収が今の期間と違う）、一緒に直さない", () => {
    const wh = mutate(open("parentCare"), (h) => {
      const p = (h.employmentPeriods ?? []).find((x) => (x.from as { at?: string }).at === "2027-07")!;
      p.salary!.annual = { value: 3_800_000, state: "confirmed", origin: { kind: "manual" } };
    });
    const w1 = panel(wh, total(wh).set(wh, 4_700_000));
    expect(afterLeave(w1).salary!.annual.value).toBe(3_800_000);
  });
});
