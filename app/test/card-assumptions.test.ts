// 前提条件のカードの中身（0070）: FPライズの標準（仮の値）の推定・空欄で標準に戻す・確定、ほかの前提と同じ値になる前提（教育費・厚生年金の
// 調整率）、高すぎる値の注意の線、例外の年（範囲で入れる）、表の最後の年（推定・人の年齢で入れる・確定したら追いかけない・古い世帯の注意）、
// 利回りの選び方、計算の基準の月と計算の決まり（読むだけ）、FP顧問料の料金の段階、前提と推定の一覧と確かめた記録
import { describe, expect, it } from "vitest";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, followStandards, fromRequest, mutate, standardEndYear, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { assumptionRows, setAgreed } from "../src/workspace/input/assumptionList.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { endYearNotice, rateWarning, STANDARD_BASIS, yearRanges } from "../src/workspace/input/stages/assumptions.ts";
import { addAdvisoryFee } from "../src/workspace/input/stages/fees.ts";
import { applyStateOp, fieldStatus } from "../src/workspace/input/valueState.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import type { Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

/** モデル世帯（表の最後の年は標準にそろえる） */
const open = (id = "salariedCoupleTwoKids"): WorkingHousehold => mutate(fromRequest(modelHousehold(id)), (h, req) => void (req.input.endYear = standardEndYear(h)));
const stage = (wh: WorkingHousehold) => buildStage("assumptions", wh);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const action = (wh: WorkingHousehold, key: string) => {
  const a = stage(wh)
    .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
    .find((x) => x.key === key);
  if (a === undefined) throw new Error(`操作が無い: ${key}`);
  return a;
};
const total = (req: WorkingHousehold["request"], row: string) => preview(req).table.filter((c) => c.row === row).reduce((s, c) => s + c.amount, 0);

describe("経済の前提: FPライズの標準（仮の値）の推定", () => {
  it("標準と同じ値で行が無ければ推定。確定は「✓ この値で確定」だけで、値は変えない", () => {
    const wh = open();
    const f = fieldOf(wh, "assume/inflation");
    expect(fieldStatus(f, wh)).toMatchObject({ status: "estimated", basis: STANDARD_BASIS });
    // 同じ値を書き戻しても確定にしない（0041）
    expect(f.set(wh, "0.01")).toBe(wh);
    const c = applyStateOp(wh, f, "confirm");
    expect(fieldStatus(f, c).status).toBe("confirmed");
    expect(c.request.input.assumptions?.inflation?.default).toBe("0.01");
    // 違う値を打つと確定。空欄にすると標準（推定）に戻る
    const w2 = f.set(wh, "0.02");
    expect(fieldStatus(f, w2).status).toBe("confirmed");
    const w3 = f.set(w2, null);
    expect(w3.request.input.assumptions?.inflation?.default).toBe("0.01");
    expect(fieldStatus(f, w3).status).toBe("estimated");
  });

  it("教育費の上昇率・厚生年金の調整率は、空欄なら物価・基礎年金の調整率と同じ（推定）。確定すると値を書く。結果は変わらない", () => {
    const wh = open();
    const edu = fieldOf(wh, "assume/educationInflation");
    expect(wh.request.input.assumptions?.educationInflation).toBeUndefined();
    expect(edu.get(wh)).toMatchObject({ value: "0.01", estimated: "物価上昇率と同じ" });
    const c = applyStateOp(wh, edu, "confirm");
    expect(c.request.input.assumptions?.educationInflation).toEqual({ default: "0.01" });
    expect(fieldStatus(edu, c).status).toBe("confirmed");
    expect(preview(c.request).table).toEqual(preview(wh.request).table);
    const emp = fieldOf(wh, "assume/pensionMacroSlideEmployee");
    expect(emp.get(wh)).toMatchObject({ value: "0.004", estimated: "基礎年金の調整率と同じ" });
    // 厚生年金だけ調整率を変えると、年金の額が変わる
    const w2 = emp.set(wh, "0.01");
    expect(w2.request.input.assumptions?.pensionMacroSlideEmployee).toEqual({ default: "0.01" });
    expect(total(w2.request, "cf.income.pension")).toBeLessThan(total(wh.request, "cf.income.pension"));
  });

  it("高すぎる値の注意の線: 欄の知らせと確かめの一覧の注意（値は変えない）", () => {
    const a = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { default: v }])) as never;
    expect(rateWarning("investmentReturn", a({ investmentReturn: "0.06" }))).toContain("5%");
    expect(rateWarning("investmentReturn", a({ investmentReturn: "0.05" }))).toBeNull();
    expect(rateWarning("inflation", a({ inflation: "-0.01" }))).toContain("0%未満");
    expect(rateWarning("wageGrowth", a({ inflation: "0.01", wageGrowth: "0.04" }))).toContain("2ポイント");
    const wh = fieldOf(open(), "assume/investmentReturn").set(open(), "0.07");
    expect(checkList(wh).find((r) => r.fieldKey === "assume/investmentReturn")).toMatchObject({ kind: "notice" });
  });

  it("利回りの選び方（控えめ・ふつう・積極的）は運用利回りに入る。選んでいるボタンに印", () => {
    const wh = action(open(), "assume/investmentReturn/preset/mid").run(open());
    expect(wh.request.input.assumptions?.investmentReturn?.default).toBe("0.02");
    expect(action(wh, "assume/investmentReturn/preset/mid").pressed).toBe(true);
    expect(action(wh, "assume/investmentReturn/preset/low").pressed).toBe(false);
  });
});

describe("例外の年（範囲で入れる）", () => {
  it("続いた年で同じ率は1つの範囲。足す・範囲を直す・外す。簡易の率を直しても例外の年はそのまま。計算に入る", () => {
    expect(yearRanges({ "2027": "0.03", "2028": "0.03", "2030": "0.03", "2031": "0.02" })).toEqual([
      { from: 2027, to: 2028, rate: "0.03" },
      { from: 2030, to: 2030, rate: "0.03" },
      { from: 2031, to: 2031, rate: "0.02" },
    ]);
    let wh = open();
    wh = action(wh, "assume/inflation/ex/add").run(wh);
    const y = Number(wh.request.input.baseMonth.slice(0, 4));
    expect(wh.request.input.assumptions?.inflation?.byYear).toEqual({ [String(y)]: "0.01" });
    wh = fieldOf(wh, "assume/inflation/ex/0/to").set(wh, y + 2);
    wh = fieldOf(wh, "assume/inflation/ex/0/rate").set(wh, "0.03");
    expect(wh.request.input.assumptions?.inflation?.byYear).toEqual({ [String(y)]: "0.03", [String(y + 1)]: "0.03", [String(y + 2)]: "0.03" });
    // 始まりの年を直すと範囲ごと動く
    const moved = fieldOf(wh, "assume/inflation/ex/0/from").set(wh, y + 1);
    expect(Object.keys(moved.request.input.assumptions?.inflation?.byYear ?? {})).toEqual([String(y + 1), String(y + 2), String(y + 3)]);
    // 簡易の率を直しても例外の年は残る
    const w2 = fieldOf(wh, "assume/inflation").set(wh, "0.015");
    expect(w2.request.input.assumptions?.inflation).toEqual({ default: "0.015", byYear: wh.request.input.assumptions?.inflation?.byYear });
    expect(fieldOf(w2, "assume/inflation").get(w2).derived).toContain("例外の年 3年");
    expect(total(wh.request, "cf.expense.living")).toBeGreaterThan(total(open().request, "cf.expense.living"));
    const back = action(wh, "assume/inflation/ex/0/remove").run(wh);
    expect(back.request.input.assumptions?.inflation).toEqual({ default: "0.01" });
  });

  it("資産の種類ごとの利回り・土地の上昇率にも例外の年", () => {
    let wh = open("investmentCouple");
    if (wh.request.input.assumptions?.assetReturns?.["equity.global"] === undefined) wh = action(wh, "assume/addReturn/equity.global").run(wh);
    wh = action(wh, "assume/assetReturns/equity.global/ex/add").run(wh);
    expect(Object.keys(wh.request.input.assumptions?.assetReturns?.["equity.global"]?.byYear ?? {}).length).toBeGreaterThan(0);
    wh = action(wh, "assume/realEstate/landGrowth/ex/add").run(wh);
    expect(wh.request.input.assumptions?.realEstateValuation?.landGrowth?.byYear).toBeDefined();
  });
});

describe("表の最後の年", () => {
  it("標準なら推定。人の年齢で入れると、その人がその年齢になる年。空欄で標準に戻る", () => {
    const wh = open();
    const h = wh.request.input.household;
    const std = standardEndYear(h);
    const f = fieldOf(wh, "assume/endYear");
    expect(wh.request.input.endYear).toBe(std);
    expect(fieldStatus(f, wh).status).toBe("estimated");
    expect(f.level).toBe("simple");
    const spouse = h.members.find((m) => m.kind === "spouse")!;
    const w2 = fieldOf(wh, `assume/endYear/age/${spouse.id}`).set(wh, 95);
    expect(w2.request.input.endYear).toBe(Number(spouse.birth.birthYearMonth.slice(0, 4)) + 95);
    expect(fieldStatus(f, w2).status).toBe("confirmed");
    expect(f.set(w2, null).request.input.endYear).toBe(std);
  });

  it("確定にしたら、家族の生年月を直しても追いかけない（推定のままなら追いかける）", () => {
    const wh = open();
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const younger = (w: WorkingHousehold) =>
      mutate(w, (h) => {
        for (const m of h.members) if (m.kind === "self" || m.kind === "spouse") m.birth = { ...m.birth, birthYearMonth: "1995-04" };
      });
    void self;
    const after = followStandards(wh, younger(wh));
    expect(after.request.input.endYear).toBe(2095);
    const pinned = applyStateOp(wh, fieldOf(wh, "assume/endYear"), "confirm");
    expect(followStandards(pinned, younger(pinned)).request.input.endYear).toBe(wh.request.input.endYear);
  });

  it("古い世帯の表の最後の年が若い方の105歳を超えるときは、確かめの注意に「標準にする」（押したときだけ直す）", () => {
    const wh = mutate(open(), (_h, req) => void (req.input.endYear = 2106));
    expect(endYearNotice(wh)).toContain("標準");
    const row = checkList(wh).find((r) => r.fieldKey === "assume/endYear");
    expect(row?.kind).toBe("notice");
    const fixed = row!.actions.find((a) => a.key === "fix")!.run(wh);
    expect(fixed.request.input.endYear).toBe(standardEndYear(wh.request.input.household));
    expect(endYearNotice(open())).toBeNull();
  });

  it("計算の基準の月・計算の決まりは読むだけ", () => {
    const wh = open();
    expect(fieldOf(wh, "assume/baseMonth")).toMatchObject({ item: "plan.baseMonth", readOnly: expect.any(String) });
    expect(fieldOf(wh, "assume/conv/timing").get(wh).value).toContain("年の真ん中");
  });

  it("プランで表の最後の年を直すと、要求の入力の差分（plan.endYear）になる", () => {
    const wh0 = open();
    const self = roles(wh0.request).find((r) => r.key === "self")!.member;
    const plan: Proposal = { id: "00000000-0000-4000-8000-00000000b070", name: "プランB", base: null, diffs: [], tags: [], createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z", origin: { kind: "manual" } } as unknown as Proposal;
    const wh = { ...wh0, proposals: [plan] };
    const cat = buildCatalog(wh, self.id, null);
    const before = planView(wh, cat, plan.id);
    const after = fieldOf(before, "assume/endYear").set(before, 2070);
    const n = recordPlanEdit(wh, cat, plan.id, before, after);
    expect(n.proposals[0]!.diffs).toMatchObject([{ op: "set", target: { plan: "input" }, item: "plan.endYear", at: [] }]);
  });
});

describe("FP顧問料の料金の段階", () => {
  it("段階を足す・額を直す・外す。計算に入る", () => {
    let wh = addAdvisoryFee(open(), () => "00000000-0000-4000-8000-00000000f070");
    wh = mutate(wh, (h) => void (h.advisoryFees![0]!.enabled = true));
    const fee = (w: WorkingHousehold) => total(w.request, "cf.expense.advisoryFee");
    const base = fee(wh);
    wh = action(wh, "ev/fee/00000000-0000-4000-8000-00000000f070/addStep").run(wh);
    const steps = wh.request.input.household.advisoryFees![0]!.terms!.recurring!.revision!.steps!;
    expect(steps).toHaveLength(1);
    const sid = steps[0]!.id!;
    wh = fieldOf(wh, `ev/fee/00000000-0000-4000-8000-00000000f070/rec/step/${sid}/annual`).set(wh, 240000);
    expect(fee(wh)).toBeGreaterThan(base);
    wh = action(wh, `ev/fee/00000000-0000-4000-8000-00000000f070/rec/step/${sid}/remove`).run(wh);
    expect(wh.request.input.household.advisoryFees![0]!.terms!.recurring!.revision?.steps).toBeUndefined();
    expect(fee(wh)).toBe(base);
  });
});

describe("前提と推定の一覧", () => {
  it("経済の前提・計算の範囲・推定の目安（各カード）・万一の前提を並べる。確かめた記録はプランごと", () => {
    const wh = open();
    const rows = assumptionRows(wh);
    expect(rows.find((r) => r.id === "field:assume/inflation")).toMatchObject({ group: "economy", state: "推定", value: "1%" });
    expect(rows.find((r) => r.id === "field:assume/endYear")).toMatchObject({ group: "range" });
    expect(assumptionRows(blankHousehold("2026-10")).some((r) => r.group === "estimate" && r.card === "家族")).toBe(true);
    expect(rows.find((r) => r.id === "cg:living/before")).toMatchObject({ group: "contingency", value: "70%" });
    const a = setAgreed(wh, null, "field:assume/inflation", "2026-10-27");
    expect(a.agreed).toEqual({ current: { "field:assume/inflation": { on: "2026-10-27" } } });
    const b = setAgreed(a, "plan-b", "field:assume/inflation", "2026-10-28");
    expect(Object.keys(b.agreed ?? {})).toEqual(["current", "plan-b"]);
    expect(setAgreed(setAgreed(b, "plan-b", "field:assume/inflation", null), null, "field:assume/inflation", null).agreed).toBeUndefined();
    // 計算には使わない
    expect(preview(b.request).table).toEqual(preview(wh.request).table);
  });
});
