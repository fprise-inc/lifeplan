// 介護・親と相続・贈与のつながり: 介護の費用は介護を受ける人の亡くなる見込みで止まる、推定のままの相続の受け取る時期は相手の亡くなる見込みと
// 相手の変更についてくる、介護・親の親・祖父母を援助の贈与する人に選べる、介護の物の欄（払う人の選択肢・誰が払うかの1行・10割の欄があるときの
// 名前・空欄の推定と「この値にする」・プランの編集中の印）、仕送りの行があるときの扶養の判定の欄（0059・0060 の追記）
import { describe, expect, it } from "vitest";
import type { CareExpense } from "../src/engine/types.ts";
import { careEstimate } from "../../hearing/src/estimates.ts";
import { allFields, resolveTimepoint, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { confirmedBox, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { donorOptions } from "../src/workspace/input/labels.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addOutside, withDeathEstimate } from "../src/workspace/input/stages/care.ts";
import { removeMember } from "../src/workspace/input/stages/family.ts";
import { INHERIT_AFTER_MONTHS } from "../src/workspace/input/stages/inheritance.ts";
import { applyStateOp, fieldStatus } from "../src/workspace/input/valueState.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { fieldMark, planView } from "../src/workspace/plans/planEdit.ts";
import { roles } from "../src/workspace/roles.ts";
import { shiftMonth } from "../src/workspace/timepoint.ts";
import { modelHousehold, preview } from "./helpers.ts";

type StageId = Parameters<typeof buildStage>[0];
const stage = (id: StageId, wh: WorkingHousehold): StageDef => buildStage(id, wh);
const fieldOf = (id: StageId, wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(id, wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
const actionOf = (id: StageId, wh: WorkingHousehold, key: string) => {
  const a = stage(id, wh)
    .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
    .find((x) => x.key === key);
  if (a === undefined) throw new Error(`no action ${key}`);
  return a;
};
const open = (id: string) => fromRequest(modelHousehold(id));
const hh = (wh: WorkingHousehold) => wh.request.input.household;
const parentOf = (wh: WorkingHousehold, sex: "male" | "female") => hh(wh).members.find((m) => m.kind === "parent" && m.sex === sex)!;
const leavesYm = (wh: WorkingHousehold, id: string) => resolveTimepoint(hh(wh), hh(wh).members.find((m) => m.id === id)!.leaves ?? null)!;
const flowFrom = (wh: WorkingHousehold, id: string) => resolveTimepoint(hh(wh), (hh(wh).incomeFlows ?? []).find((f) => f.id === id)!.from)!;

/** 父・母を足して、父から相続を受け取る行を足した世帯 */
function withInheritance(): { wh: WorkingHousehold; flow: string } {
  let wh = open("salariedCoupleTwoKids");
  wh = actionOf("care", wh, "care/add/selfParents").run(wh);
  const before = new Set((hh(wh).incomeFlows ?? []).map((f) => f.id));
  wh = actionOf("inheritance", wh, "money/inherit/in/add/inheritance").run(wh);
  const flow = (hh(wh).incomeFlows ?? []).find((f) => !before.has(f.id))!.id;
  return { wh, flow };
}

describe("推定のままの相続の受け取る時期は、相手の亡くなる見込みについてくる", () => {
  it("相手を父から母に変えると、母の亡くなる見込みの10か月後に入れ直す（印は推定のまま）", () => {
    const { wh: wh0, flow } = withInheritance();
    const father = parentOf(wh0, "male");
    const mother = parentOf(wh0, "female");
    const wh = (hh(wh0).incomeFlows ?? []).find((f) => f.id === flow)!.counterparty === father.id ? wh0 : fieldOf("inheritance", wh0, `in/${flow}/counterparty`).set(wh0, father.id);
    expect(flowFrom(wh, flow)).toBe(shiftMonth(leavesYm(wh, father.id), INHERIT_AFTER_MONTHS));
    const changed = fieldOf("inheritance", wh, `in/${flow}/counterparty`).set(wh, mother.id);
    expect(flowFrom(changed, flow)).toBe(shiftMonth(leavesYm(changed, mother.id), INHERIT_AFTER_MONTHS));
    expect(changed.assumed[`in/${flow}/from`]).toBeDefined();
  });

  it("相手の亡くなる見込みを直すと、受け取る時期もついてくる。FP が入れた時期は変えない", () => {
    const { wh: wh0, flow } = withInheritance();
    const cp = (hh(wh0).incomeFlows ?? []).find((f) => f.id === flow)!.counterparty!;
    const earlier = shiftMonth(leavesYm(wh0, cp), -36);
    const moved = fieldOf("care", wh0, `family/${cp}/leaves`).set(wh0, earlier);
    expect(leavesYm(moved, cp)).toBe(earlier);
    expect(flowFrom(moved, flow)).toBe(shiftMonth(earlier, INHERIT_AFTER_MONTHS));
    // FP が受け取る時期を入れたら（印が外れる）、亡くなる見込みを直しても動かさない
    const fixed = fieldOf("inheritance", wh0, `in/${flow}/from`).set(wh0, "2040-01");
    expect(fixed.assumed[`in/${flow}/from`]).toBeUndefined();
    const moved2 = fieldOf("care", fixed, `family/${cp}/leaves`).set(fixed, earlier);
    expect(flowFrom(moved2, flow)).toBe("2040-01");
  });

  it("亡くなる見込みを平均余命で入れ直しても、推定のままの受け取る時期がついてくる", () => {
    const { wh: wh0, flow } = withInheritance();
    const cp = (hh(wh0).incomeFlows ?? []).find((f) => f.id === flow)!.counterparty!;
    const cleared = mutate(wh0, (h) => void (h.members.find((m) => m.id === cp)!.leaves = { at: "2030-01" }));
    const re = withDeathEstimate(mutate(cleared, (h) => void (h.members.find((m) => m.id === cp)!.leaves = null)), cp);
    expect(flowFrom(re, flow)).toBe(shiftMonth(leavesYm(re, cp), INHERIT_AFTER_MONTHS));
  });
});

describe("介護の費用は、介護を受ける人の亡くなる見込みで止まる", () => {
  it("施設の介護（2027年4月から60か月）の途中で母が亡くなる見込みなら、その月から介護の費用が無く、見出しは「亡くなる見込みまで」", () => {
    const wh0 = open("parentCare");
    const mother = hh(wh0).members.find((m) => m.kind === "parent")!;
    const wh = fieldOf("care", wh0, `family/${mother.id}/leaves`).set(wh0, "2029-03");
    const care = hh(wh).careExpenses!.find((c) => c.member === mother.id)!;
    const t = preview(wh.request).table.filter((c) => c.object === care.id && c.row.startsWith("cf.expense.care"));
    expect(t.filter((c) => c.year >= 2030).reduce((s, c) => s + c.amount, 0)).toBe(0);
    expect(t.filter((c) => c.year === 2028).reduce((s, c) => s + c.amount, 0)).toBeGreaterThan(0);
    const g = stage("care", wh).sections.find((s) => s.key === "care/costs")!.groups.find((x) => x.key === `ev/care/${care.id}`)!;
    expect(g.title).toBe("母の介護");
    expect(g.summary).toContain("施設・2027年4月から2029年2月まで（亡くなる見込みまで）");
  });
});

describe("介護・親の親・祖父母を、住宅資金・教育資金の援助の贈与する人に選べる", () => {
  it("候補に介護・親の父・母と、生年月を入れない贈与する人が並ぶ", () => {
    let wh = open("salariedCoupleTwoKids");
    wh = addOutside(wh, "parent", { sex: "male" });
    wh = mutate(wh, (h) => void (h.donors = [{ id: "d0000000-0000-4000-8000-000000000001", kind: "grandparent" }]));
    const father = parentOf(wh, "male");
    const opts = donorOptions(wh);
    expect(opts.map((o) => o.value)).toEqual(["", father.id, "d0000000-0000-4000-8000-000000000001"]);
    expect(opts[1]!.label).toBe("父");
    expect(opts[2]!.label).toContain("生年月を入れない贈与する人");
  });

  it("父を選んだ援助は、父からの贈与として計算し（世帯から出さない）、父を外すと援助の贈与する人も外れる", () => {
    let wh = addOutside(open("salariedCoupleTwoKids"), "parent", { sex: "male" });
    const father = parentOf(wh, "male");
    const goal = (hh(wh).goals ?? []).find((g) => g.kind === "education")!;
    wh = mutate(wh, (h) => void ((h.goals ?? []).find((g) => g.id === goal.id)!.education!.gifts = [{ id: "e0000000-0000-4000-8000-000000000001", at: { at: "2030-04" }, amount: 1_000_000, purpose: "wedding", donor: father.id }]));
    const r = preview(wh.request);
    expect(r.table.filter((c) => c.object === goal.id && c.year === 2030 && c.row.startsWith("cf.expense")).every((c) => c.amount < 1_000_000)).toBe(true);
    // 介護・親の父のまとまりに、援助で選ばれていることが出る
    const g = stage("care", wh).sections.find((s) => s.key === "care/outside")!.groups.find((x) => x.key === `family/${father.id}`)!;
    expect(g.note).toContain("贈与する人に選ばれています");
    // 相続・贈与の贈与する人の区画にも並ぶ
    const row = stage("inheritance", wh).sections.find((s) => s.key === "family/donors")!.groups.find((x) => x.key === `inherit/person/${father.id}`)!;
    expect(row.title?.startsWith("父（")).toBe(true);
    expect(row.fields.map((f) => f.get(wh).value)).toEqual(["援助の贈与する人 1件"]);
    const gone = removeMember(wh, father.id);
    expect((hh(gone).goals ?? []).find((g) => g.id === goal.id)!.education!.gifts![0]!.donor).toBeUndefined();
  });
});

describe("介護の物の欄", () => {
  const carePair = () => {
    const wh = open("parentCare");
    const cares = hh(wh).careExpenses!;
    return { wh, parentCare: cares.find((c) => hh(wh).members.find((m) => m.id === c.member)?.kind === "parent")!, selfCare: cares.find((c) => hh(wh).members.find((m) => m.id === c.member)?.kind === "self")! };
  };
  const optionsOf = (wh: WorkingHousehold, c: CareExpense) => {
    const f = fieldOf("care", wh, `ev/care/${c.id}/payer`);
    return f.kind === "select" ? f.options.map((o) => o.label) : [];
  };

  const withBalance = (wh: WorkingHousehold, c: CareExpense) => mutate(wh, (h) => void (h.members.find((m) => m.id === c.member)!.wallet = { balance: confirmedBox(5_000_000) }));
  const helpOf = (wh: WorkingHousehold, c: CareExpense) => fieldOf("care", wh, `ev/care/${c.id}/payer`).help ?? "";

  it("払う人の選択肢: 親のお金を見ていない親の介護は「世帯が払う」、見ていれば「まず母のお金から（尽きたら世帯）」。ご本人の介護は「介護を受ける人（ご本人）」", () => {
    const { wh, parentCare, selfCare } = carePair();
    expect(optionsOf(wh, parentCare)).toEqual(["世帯が払う", "世帯が払う（ご本人の支出にする）"]);
    expect(optionsOf(withBalance(wh, parentCare), parentCare)).toEqual(["まず母のお金から（尽きたら世帯）", "まず母のお金から（尽きたらご本人の支出）"]);
    // 年金の欄だけ（預金の欄が無い）では親のお金を見ない（エンジンの outside.wallet と同じ）
    const pensionOnly = mutate(wh, (h) => void (h.members.find((m) => m.id === parentCare.member)!.wallet = { pension: confirmedBox(1_200_000) }));
    expect(optionsOf(pensionOnly, parentCare)[0]).toBe("世帯が払う");
    expect(optionsOf(wh, selfCare)).toEqual(["介護を受ける人（ご本人）"]);
    expect(optionsOf(withBalance(wh, parentCare), selfCare)).toEqual(["介護を受ける人（ご本人）"]);
  });

  it("払う人の「?」: 親のお金を見ていなければ、入れる場所と入れたときの計算を書く。見ていれば、まず親のお金から払うと書く", () => {
    const { wh, parentCare, selfCare } = carePair();
    expect(helpOf(wh, parentCare)).toContain("今は母のお金を見ていないので、介護の費用は全部世帯が払います");
    expect(helpOf(wh, parentCare)).toContain("母のお金（預金・年金）を入れると、まず母のお金から払い、尽きた月から世帯が払う計算にできます");
    expect(helpOf(wh, parentCare)).toContain("区画「親のお金が持つか」の「＋ 母のお金が持つかを見る」");
    expect(helpOf(withBalance(wh, parentCare), parentCare)).toContain("まず母のお金");
    expect(helpOf(withBalance(wh, parentCare), parentCare)).toContain("尽きた月から世帯が払います");
    expect(helpOf(withBalance(wh, parentCare), parentCare)).not.toContain("見ていない");
    expect(helpOf(wh, selfCare)).toBe("世帯の中では、ここで選んだ人の支出にします");
  });

  it("見出しの下に誰が払うかの1行（親のお金を見ているかで変わる。選択肢と同じ決まり）", () => {
    const { wh, parentCare } = carePair();
    const note = (w: WorkingHousehold) => stage("care", w).sections.find((s) => s.key === "care/costs")!.groups.find((g) => g.key === `ev/care/${parentCare.id}`)!.note ?? "";
    expect(note(wh)).toContain("この費用は世帯が払います。母のお金を入れると、まず母のお金から払います");
    // 空のお金の欄（預金の欄が無い）では、エンジンは親のお金を見ないので世帯が払う
    const empty = mutate(wh, (h) => void (h.members.find((m) => m.id === parentCare.member)!.wallet = {}));
    expect(note(empty)).toContain("この費用は世帯が払います");
    expect(note(withBalance(wh, parentCare))).toContain("まず母のお金から払い、尽きた月から世帯が払います");
  });

  it("介護保険のサービスの額（10割）が入っていれば、月々の費用は「介護保険の対象外の費用」", () => {
    const { wh, parentCare, selfCare } = carePair();
    expect(fieldOf("care", wh, `ev/care/${parentCare.id}/other`).label).toBe("介護保険の対象外の費用（食費・居住費など・月額）");
    expect(fieldOf("care", wh, `ev/care/${selfCare.id}/other`).label).toBe("月々の費用（自己負担の合計）");
    expect(fieldOf("care", wh, `ev/care/${selfCare.id}/service`).label).toBe("介護保険のサービスの額（1割負担の前・月額）");
  });

  it("空欄の月々の費用・期間・一時費用は統計の平均を推定として見せ、「この値にする」でその値を書く（計算は変わらない）", () => {
    const { wh, selfCare } = carePair();
    const est = careEstimate("home")!;
    const other = fieldOf("care", wh, `ev/care/${selfCare.id}/other`);
    expect(fieldStatus(other, wh).status).toBe("estimated");
    expect(other.get(wh).hint).toContain("推定");
    const done = applyStateOp(wh, other, "confirm");
    expect(hh(done).careExpenses!.find((c) => c.id === selfCare.id)!.otherMonthly?.value).toBe(est.monthly);
    const months = fieldOf("care", wh, `ev/care/${selfCare.id}/months`);
    expect(fieldStatus(months, wh).status).toBe("estimated");
    expect(hh(applyStateOp(wh, months, "confirm")).careExpenses!.find((c) => c.id === selfCare.id)!.months).toBe(est.months);
    const sum = (w: WorkingHousehold) => preview(w.request).table.filter((c) => c.object === selfCare.id).reduce((s, c) => s + c.amount, 0);
    expect(sum(done)).toBe(sum(wh));
  });

  it("プランの編集中に介護の場所を変えると、欄に「現状」の印が出る（どの欄も当て先を持つ）", () => {
    const { wh: wh0, parentCare } = carePair();
    const wh: WorkingHousehold = { ...wh0, proposals: [{ id: "B", name: "プランB", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] }] };
    const self = roles(wh.request).find((r) => r.key === "self")!.member.id;
    const cat = buildCatalog(wh, self, null);
    const view = planView(wh, cat, "B");
    const edited = fieldOf("care", view, `ev/care/${parentCare.id}/place`).set(view, "home");
    const f = fieldOf("care", edited, `ev/care/${parentCare.id}/place`);
    expect(f.address).toBeDefined();
    expect(fieldMark(wh, cat, "B", f, edited)).not.toBeNull();
    for (const x of stage("care", edited).sections.find((s) => s.key === "care/costs")!.groups.find((g) => g.key === `ev/care/${parentCare.id}`)!.fields) if (x.item !== null) expect(x.address, x.key).toBeDefined();
  });
});

describe("仕送りの行と扶養の判定の欄", () => {
  it("この親を相手にした仕送りの行があれば、仕送りの額の欄は出さず「行の額を使います」。行が無ければ「＋ 仕送り（毎月）」で行を足せる", () => {
    const wh0 = open("parentCare");
    const mother = hh(wh0).members.find((m) => m.kind === "parent")!;
    expect(allFields(stage("care", wh0)).some((f) => f.key === `family/${mother.id}/allowance`)).toBe(true);
    const wh = actionOf("care", wh0, `family/${mother.id}/allowanceAdd`).run(wh0);
    const row = (hh(wh).periodicExpenses ?? []).find((p) => p.kind === "allowance")!;
    expect(row).toMatchObject({ counterparty: mother.id, monthly: true });
    const fields = allFields(stage("care", wh));
    expect(fields.some((f) => f.key === `family/${mother.id}/allowance`)).toBe(false);
    expect(fields.find((f) => f.key === `ro/care/outside/${mother.id}/allowanceRows`)?.get(wh).value).toContain("仕送りの行の額");
  });
});
