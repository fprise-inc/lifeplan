// 住まいと不動産の見直しの残り（2026-11-06。不動産に詳しい FP の声）: 収益不動産の額の変化のボタンの言葉（地代・駐車料・売上）、住宅の種類（控除）の
// 説明と2028年からの新築の仮の条件、フラット35の団信の既定、全期間固定の5年ルール・125%ルールの欄、貸していない不動産の持ち始める年の評価額
import { describe, expect, it } from "vitest";
import type { Account, Debt } from "../src/engine/types.ts";
import { allFields, type ActionDef, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { FLAT35_CREDIT_LIFE } from "../src/workspace/input/stages/housingLoans.ts";
import { rentalProperties } from "../src/workspace/input/stages/rental.ts";
import { heldEstateTax, heldValueAt } from "../src/workspace/input/heldEstateTax.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
const settle = (wh: WorkingHousehold) => withProvisionalHousing(withRefreshedEstimates(wh));
const actionsOf = (s: StageDef): ActionDef[] => s.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]);
const fieldMaybe = (wh: WorkingHousehold, suffix: string, card: string): FieldDef | undefined => allFields(buildStage(card as never, wh)).find((x) => x.key.endsWith(suffix));
function fieldOf(wh: WorkingHousehold, suffix: string, card = "housing"): FieldDef {
  const f = fieldMaybe(wh, suffix, card);
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1], card = "housing"): WorkingHousehold => settle(fieldOf(wh, suffix, card).set(wh, v));
function action(wh: WorkingHousehold, key: string, card = "housing"): WorkingHousehold {
  const a = actionsOf(buildStage(card as never, wh)).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return settle(a.run(wh));
}
function salaried(): WorkingHousehold {
  let wh = blankHousehold(BASE);
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!;
  return annual.set(wh, 6000000);
}
const loans = (wh: WorkingHousehold): Debt[] => (wh.request.input.household.debts ?? []).filter((d) => d.kind === "mortgage");

describe("収益不動産の額の変化のボタン", () => {
  const ofKind = (kind: string, f: (p: Record<string, unknown>) => void = () => undefined) =>
    mutate(fromRequest(modelHousehold("dualAssetsTwoKids")), (hh) => {
      const a = (hh.accounts ?? []).find((x) => x.kind === "realEstate" && x.property !== undefined)!;
      const p = a.property as Record<string, unknown>;
      p.kind = kind;
      f(p);
    });
  const rentChange = (wh: WorkingHousehold): string | undefined => {
    const id = rentalProperties(wh.request.input.household)[0]!.id;
    return actionsOf(buildStage("rental", wh)).find((a) => a.key.includes(id) && a.key.endsWith("/rental/addStage"))?.choice?.label;
  };
  it("駐車場は「＋ 駐車料の変化」、貸している土地は「＋ 地代の変化」、アパートは「＋ 家賃の変化」（変化率の欄の名前と同じ言葉）", () => {
    expect(rentChange(ofKind("parking"))).toBe("＋ 駐車料の変化");
    expect(rentChange(ofKind("land"))).toBe("＋ 地代の変化");
    expect(rentChange(ofKind("apartment"))).toBe("＋ 家賃の変化");
  });
  it("民泊・宿は「＋ 売上の変化」", () => {
    expect(rentChange(ofKind("lodging", (p) => void (p.lodging = {})))).toBe("＋ 売上の変化");
  });
});

describe("住宅の種類（控除）の説明", () => {
  it("2028年からの入居の新築は ZEH水準省エネ住宅で計算すると書く", () => {
    const wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const help = fieldOf(wh, `${loans(wh)[0]!.id}/credit`).help ?? "";
    expect(help).toContain("2027年までなら省エネ基準適合住宅");
    expect(help).toContain("2028年からならZEH水準省エネ住宅");
  });
});

describe("フラット35の団信と、全期間固定の5年ルール・125%ルール", () => {
  it("フラット35にしても団信の対象は変えない（金利の目安が新機構団信付き）。説明にそう書く", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const id = loans(wh)[0]!.id;
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!.id;
    expect(loans(wh)[0]!.creditLife?.covered).toEqual([self]);
    wh = set(wh, `${id}/product`, "flat35");
    expect(loans(wh)[0]!.creditLife?.covered).toEqual([self]);
    expect(fieldOf(wh, `${id}/creditLife`).help).toContain(FLAT35_CREDIT_LIFE);
    // 手で「入っていない」にしたら、そのまま
    wh = set(wh, `${id}/creditLife`, "");
    expect(loans(wh)[0]!.creditLife).toBeUndefined();
  });

  it("全期間固定のローンに5年ルール・125%ルールが入っていれば、欄の代わりに知らせ、外せる", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const id = loans(wh)[0]!.id;
    expect(fieldMaybe(wh, `${id}/fiveYear`, "housing")).toBeDefined();
    // 金利の種類の欄で全期間固定にする（5年ルール・125%ルールは残る）
    wh = set(wh, `${id}/rateType`, "fixed");
    expect(loans(wh)[0]!.repayment.variableRules).toEqual({ fiveYear: true, cap125: true });
    expect(fieldMaybe(wh, `${id}/fiveYear`, "housing")).toBeUndefined();
    expect(fieldMaybe(wh, `${id}/cap125`, "housing")).toBeUndefined();
    const note = fieldOf(wh, `${id}/variableRules`).get(wh);
    expect(note.warn).toContain("計算には使っていません");
    wh = settle(note.warnFix!.run(wh));
    expect(loans(wh)[0]!.repayment.variableRules).toBeUndefined();
    expect(fieldMaybe(wh, `${id}/variableRules`, "housing")).toBeUndefined();
    expect(() => preview(wh.request)).not.toThrow();
  });
});

describe("貸していない不動産の持ち始める年の評価額", () => {
  function held(subtype: string, value = 15_000_000): { wh: WorkingHousehold; id: string } {
    let wh = salaried();
    const add = actionsOf(buildStage("savings", wh)).find((a) => a.key.endsWith("/add/realEstate") || a.key.endsWith("addRealEstate"));
    if (add === undefined) throw new Error("no add realEstate");
    wh = settle(add.run(wh));
    const a = (wh.request.input.household.accounts ?? []).find((x) => x.kind === "realEstate")!;
    wh = set(wh, `sav/${a.id}/subtype`, subtype, "savings");
    wh = set(wh, `sav/${a.id}/value`, value, "savings");
    return { wh, id: a.id };
  }
  const cost = (wh: WorkingHousehold, id: string) => (wh.request.input.household.periodicExpenses ?? []).find((p) => p.object === id)!.amount;
  const basis = (wh: WorkingHousehold, id: string) => (cost(wh, id) as { estimate?: { basis?: string } }).estimate?.basis ?? "";
  const account = (wh: WorkingHousehold, id: string): Account => (wh.request.input.household.accounts ?? []).find((x) => x.id === id)!;

  it("持ち始める時点が2030年なら、根拠の文の評価額と年は2030年の初めの見込み（築年数を数える年と同じ）", () => {
    const h = held("vacantHouse");
    let wh = set(h.wh, `sav/${h.id}/builtYear`, 2000, "savings");
    wh = set(wh, `sav/${h.id}/holdFrom`, "2030-04", "savings");
    // 増減率0（前提条件の不動産の利回りも0）なら額は同じで、年が2030年
    expect(basis(wh, h.id)).toContain("評価額1,500万円（2030年の初めの見込み。2026年の1,500万円から評価額の増減率0%で動かした）");
    expect(basis(wh, h.id)).toContain("2030年度の評価替え");
    expect(cost(wh, h.id).value).toBe(heldEstateTax({ value: 15_000_000, valueYear: 2030, kind: "vacantHouse", landShare: 0.3, builtYear: 2000, firstYear: 2030 }).value);
    // 増減率1%なら、2026年10月から2029年末まで動かした額（2026年は10〜12月の3か月分、2027〜2029年は1年ずつ）
    wh = set(wh, `sav/${h.id}/growth`, "0.01", "savings");
    expect(account(wh, h.id).valueGrowth).toBe("0.01");
    const v = heldValueAt({ valueGrowth: "0.01" }, 15_000_000, BASE, 2030).value;
    expect(v).toBe(Math.round(Math.round(Math.round(Math.round(15_000_000 * (1 + (0.01 * 3) / 12)) * 1.01) * 1.01) * 1.01));
    expect(basis(wh, h.id)).toContain(`（2030年の初めの見込み。2026年の1,500万円から評価額の増減率1%で動かした）`);
    expect(cost(wh, h.id).value).toBe(heldEstateTax({ value: v, valueYear: 2030, kind: "vacantHouse", landShare: 0.3, builtYear: 2000, firstYear: 2030 }).value);
  });

  it("持ち始める時点が無いか今年なら、今までどおり入れた評価額のまま", () => {
    const h = held("villa");
    const before = cost(h.wh, h.id).value;
    expect(basis(h.wh, h.id)).toContain("評価額1,500万円（2026年）");
    const wh = set(h.wh, `sav/${h.id}/holdFrom`, "2026-12", "savings");
    expect(cost(wh, h.id).value).toBe(before);
    expect(basis(wh, h.id)).toContain("評価額1,500万円（2026年）");
  });
});
