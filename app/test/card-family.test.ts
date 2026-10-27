// 家族のカード: 関係の形（法律婚・事実婚）と始まり・終わり、関係を期間で持つ、これから生まれる子、本人と配偶者の入れ替え、
// 家族のお金の行（養育費・手当・財産分与・子への仕送り）。書いた形がエンジンでそのまま計算でき、当て先（0036 の2）が付くこと
import { describe, expect, it } from "vitest";
import type { EngineRequest, IncomeFlow, PeriodicExpense } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageDef, type Val } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addMember, addRelationStage, markBorn, relationSummary, spouseRelations, swapSelfSpouse } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { fieldAddress } from "../src/workspace/input/valueState.ts";
import { readAt } from "../src/workspace/store/readings.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { roles } from "../src/workspace/roles.ts";
import { memberLabel } from "../src/workspace/input/labels.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const stage = (wh: WorkingHousehold): StageDef => buildStage("family", wh);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const set = (wh: WorkingHousehold, key: string, v: Val) => fieldOf(wh, key).set(wh, v);
const action = (wh: WorkingHousehold, key: string) => {
  const a = stage(wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((x) => x.key === key);
  if (a === undefined) throw new Error(`ボタンが無い: ${key}`);
  return a;
};
const hasAction = (wh: WorkingHousehold, key: string) => stage(wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).some((x) => x.key === key);
const input = (wh: WorkingHousehold) => wh.request.input as unknown as Record<string, unknown>;
const tax = (req: EngineRequest) => preview(req).table.filter((c) => c.row === "cf.taxSi.incomeTax" || c.row === "cf.taxSi.residentTax").reduce((a, c) => a + c.amount, 0);

function couple(marriage: "legal" | "deFacto" = "legal"): WorkingHousehold {
  let wh = blankHousehold(BASE, ids());
  const self = wh.request.input.household.members[0]!;
  wh = set(wh, `family/${self.id}/birth`, "1985-06");
  return addMember(wh, "spouse", ids(), { marriage });
}
const spouseOf = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "spouse")!;

describe("足すボタン: 配偶者（法律婚）・パートナー（事実婚）・子・これから生まれる子", () => {
  it("配偶者がいなければ法律婚・事実婚の2つのボタン。事実婚で足すと関係の形が事実婚", () => {
    const wh = blankHousehold(BASE, ids());
    expect(hasAction(wh, "family/add/spouse")).toBe(true);
    const w1 = action(wh, "family/add/partner").run(wh);
    const sp = spouseOf(w1);
    const rs = spouseRelations(w1.request.input.household, sp.id);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ marriage: "deFacto", from: null, to: null });
    expect(typeof rs[0]!.id).toBe("string");
    expect(hasAction(w1, "family/add/spouse")).toBe(false);
    // 配偶者のまとまりに関係の1行（読むだけ）
    expect(fieldOf(w1, `family/${sp.id}/relation`).get(w1).value).toBe("事実婚");
  });

  it("事実婚にすると配偶者控除が付かない（税は配偶者として扱わない）", () => {
    const legal = fromRequest(modelHousehold("singleEarnerTwoKids"));
    const sp = spouseOf(legal);
    const rel = spouseRelations(legal.request.input.household, sp.id)[0]!;
    const de = set(legal, `family/relation/${rel.id}/marriage`, "deFacto");
    expect(spouseRelations(de.request.input.household, sp.id)[0]!.marriage).toBe("deFacto");
    expect(tax(de.request)).toBeGreaterThan(tax(legal.request));
  });

  it("これから生まれる子: 予定の印・2年後の推定・生まれる予定の欄で生年月と加わる月をそろえる・生まれました", () => {
    const wh = couple();
    const w1 = action(wh, "family/add/expectedChild").run(wh);
    const kid = w1.request.input.household.members.find((m) => m.kind === "child")!;
    expect(kid).toMatchObject({ expected: true, birth: { birthYearMonth: "2028-10" }, joins: { at: "2028-10" } });
    expect(w1.assumed[`family/${kid.id}/birth`]).toContain("2年後");
    expect(w1.assumed[`family/${kid.id}/sex`]).toContain("わからない");
    const f = fieldOf(w1, `family/${kid.id}/birth`);
    expect(f.label).toBe("生まれる予定");
    expect(f.get(w1).assumed).toContain("2年後");
    const w2 = f.set(w1, "2027-08");
    const k2 = w2.request.input.household.members.find((m) => m.id === kid.id)!;
    expect(k2).toMatchObject({ birth: { birthYearMonth: "2027-08" }, joins: { at: "2027-08" } });
    expect(w2.assumed[`family/${kid.id}/birth`]).toBeUndefined();
    // 今からの入れ方（1年後）も年月にする
    const w3 = fieldOf(w2, `family/${kid.id}/birth`).time!.setWhen(w2, { at: "2027-12" }, "auto");
    expect(w3.request.input.household.members.find((m) => m.id === kid.id)!.birth.birthYearMonth).toBe("2027-12");
    expect(() => preview(w3.request)).not.toThrow();
    const born = markBorn(w3, kid.id);
    expect(born.request.input.household.members.find((m) => m.id === kid.id)).toMatchObject({ expected: false, joins: null });
    expect(fieldOf(born, `family/${kid.id}/birth`).label).toBe("生年月");
  });
});

describe("夫婦の関係を期間で持つ（事実婚 → 入籍・離婚）", () => {
  it("段階を足すと前の段を前の月で終え、別の形の段を始める。始まりを直すと前の段の終わりも合う。エンジンで計算できる", () => {
    const wh = couple("deFacto");
    const sp = spouseOf(wh);
    const w1 = addRelationStage(wh, sp.id);
    const rs = spouseRelations(w1.request.input.household, sp.id);
    expect(rs.map((r) => [r.marriage, r.from, r.to])).toEqual([
      ["deFacto", null, { at: "2027-09" }],
      ["legal", { at: "2027-10" }, null],
    ]);
    expect(relationSummary(w1.request.input.household, rs)).toBe("事実婚（2027年9月まで） → 2027年10月から法律婚");
    const w2 = set(w1, `family/relation/${rs[1]!.id}/from`, "2028-04");
    const rs2 = spouseRelations(w2.request.input.household, sp.id);
    expect(rs2[0]!.to).toEqual({ at: "2028-03" });
    expect(rs2[1]!.from).toEqual({ at: "2028-04" });
    expect(() => preview(w2.request)).not.toThrow();
    // 段階を外すと前の段がつながる
    const w3 = action(w2, `family/relation/${rs2[1]!.id}/remove`).run(w2);
    expect(spouseRelations(w3.request.input.household, sp.id).map((r) => [r.marriage, r.to])).toEqual([["deFacto", null]]);
  });

  it("関係の終わりを入れると配偶者はその翌月に世帯を離れ、空にすると戻る。財産分与・養育費の行を足せる", () => {
    const wh = couple();
    const sp = spouseOf(wh);
    const rel = spouseRelations(wh.request.input.household, sp.id)[0]!;
    const w1 = set(wh, `family/relation/${rel.id}/to`, "2030-03");
    expect(spouseOf(w1).leaves).toEqual({ at: "2030-04" });
    expect(() => preview(w1.request)).not.toThrow();
    const w2 = action(w1, `family/relation/${rel.id}/division`).run(w1);
    const div = (w2.request.input.household.incomeFlows ?? []).find((f) => f.kind === "propertyDivision")!;
    expect(div).toMatchObject({ from: { at: "2030-04" }, to: { at: "2030-04" }, counterparty: sp.id });
    const back = set(w1, `family/relation/${rel.id}/to`, null);
    expect(spouseOf(back).leaves ?? null).toBeNull();
  });

  it("関係の終わりを出来事（離婚）にすると、出来事を動かしたとき配偶者の離れる月も動く", () => {
    const wh = couple();
    const sp = spouseOf(wh);
    const rel = spouseRelations(wh.request.input.household, sp.id)[0]!;
    const w1 = set(wh, `family/relation/${rel.id}/to`, "2030-03");
    const f = fieldOf(w1, `family/relation/${rel.id}/to`);
    const w2 = f.time!.setWhen(w1, { event: `new:divorce:${rel.id}` }, "auto");
    const ev = (w2.request.input.household.events ?? []).find((e) => e.kind === "divorce")!;
    expect(ev.at).toEqual({ at: "2030-03" });
    expect(spouseRelations(w2.request.input.household, sp.id)[0]!.to).toEqual({ event: ev.id });
    expect(spouseOf(w2).leaves).toEqual({ event: ev.id, offset: { months: 1 } });
    const w3 = fieldOf(w2, `family/relation/${rel.id}/to`).set(w2, "2031-06");
    expect((w3.request.input.household.events ?? []).find((e) => e.id === ev.id)!.at).toEqual({ at: "2031-06" });
    expect(() => preview(w3.request)).not.toThrow();
  });

  it("関係の欄は当て先を持ち、プランで関係の形を変えるとそのプランの差分になる（現状は変わらない）", () => {
    const req = modelHousehold("singleEarnerTwoKids");
    const self = roles(req).find((r) => r.key === "self")!.member;
    const wh = { ...fromRequest(req), proposals: [{ id: "B", name: "プランB", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] }] };
    const cat = buildCatalog(wh, self.id, null);
    const view = planView(wh, cat, "B");
    const sp = spouseOf(view);
    const rel = spouseRelations(view.request.input.household, sp.id)[0]!;
    for (const k of ["marriage", "from", "to"]) {
      const f = fieldOf(view, `family/relation/${rel.id}/${k}`);
      const a = fieldAddress(f, view)!;
      expect(a).toEqual({ target: { object: rel.id }, item: `relation.${k}`, at: [] });
      expect(readAt(input(view), a)).toEqual(k === "marriage" ? "legal" : null);
    }
    const edited = set(view, `family/relation/${rel.id}/marriage`, "deFacto");
    const w = recordPlanEdit(wh, cat, "B", view, edited);
    expect(spouseRelations(w.request.input.household, sp.id)[0]!.marriage).toBe("legal");
    expect(w.proposals[0]!.diffs.length).toBeGreaterThan(0);
    expect(spouseRelations(planView(w, cat, "B").request.input.household, sp.id)[0]!.marriage).toBe("deFacto");
  });
});

describe("本人と配偶者の入れ替え", () => {
  it("続柄だけを入れ替え、働き方の名義は人に付いたまま", () => {
    const wh = fromRequest(modelHousehold("singleEarnerTwoKids"));
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const w1 = swapSelfSpouse(wh);
    expect(w1.request.input.household.members.find((m) => m.id === self.id)!.kind).toBe("spouse");
    expect((w1.request.input.household.employmentPeriods ?? []).every((p) => p.member === self.id)).toBe(true);
    expect(() => preview(w1.request)).not.toThrow();
  });
});

describe("家族のお金の行", () => {
  it("区画は簡易に出て、養育費・手当の終わりは下の子の18歳の年度末、相手は簡易で選べる", () => {
    const wh = fromRequest(modelHousehold("singleEarnerTwoKids"));
    const st = stage(wh);
    const sec = st.sections.find((s) => s.key === "money/family/in")!;
    expect(sec.level).toBe("simple");
    const w1 = action(wh, "money/family/in/add/childSupport").run(wh);
    const f = (w1.request.input.household.incomeFlows ?? []).at(-1) as IncomeFlow;
    const youngest = w1.request.input.household.members.filter((m) => m.kind === "child").sort((a, b) => b.birth.birthYearMonth.localeCompare(a.birth.birthYearMonth))[0]!;
    expect(f.to).toEqual({ memberAge: { member: youngest.id, years: 18, ageSwitch: "firstMarch31AfterReach" } });
    const party = fieldOf(w1, `in/${f.id}/counterparty`);
    expect(party.level).toBe("simple");
    expect(party.kind === "select" && party.options.some((o) => o.value === youngest.id)).toBe(true);
    expect(() => preview(w1.request)).not.toThrow();
  });

  it("離れて暮らす子への仕送りは子がいるときだけ。相手は子で、行は家族のカードに残る", () => {
    const solo = couple();
    expect(hasAction(solo, "money/family/out/add/allowance")).toBe(false);
    const wh = fromRequest(modelHousehold("singleEarnerTwoKids"));
    const w1 = action(wh, "money/family/out/add/allowance").run(wh);
    const p = (w1.request.input.household.periodicExpenses ?? []).at(-1) as PeriodicExpense;
    expect(p.kind).toBe("allowance");
    expect(w1.request.input.household.members.find((m) => m.id === p.counterparty)!.kind).toBe("child");
    expect(stage(w1).sections.find((s) => s.key === "money/family/out")!.groups.some((g) => g.key === `ev/${p.id}`)).toBe(true);
    expect(buildStage("care", w1).sections.flatMap((s) => s.groups).some((g) => g.key === `ev/${p.id}`)).toBe(false);
  });
});

describe("性別: 標準は本人の1押し。配偶者は本人の逆を推定で入れ、詳細で直す", () => {
  it("本人を直すと、推定のままの配偶者は逆になる。人が選んだ配偶者・同性のご夫婦は変えない", () => {
    let wh = addMember(blankHousehold(BASE, ids()), "spouse", ids());
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const sp = spouseOf(wh);
    expect(sp.sex).toBe("female");
    expect(fieldOf(wh, `family/${self.id}/sex`).level).toBe("simple");
    const spSex = fieldOf(wh, `family/${sp.id}/sex`);
    expect(spSex.level).toBe("detail");
    expect(spSex.get(wh).assumed).toContain("本人と逆の性別");
    // 詳細の欄でも、推定のままなら確かめの一覧に出る
    expect(checkList(wh).find((r) => r.fieldKey === `family/${sp.id}/sex`)).toMatchObject({ kind: "estimated", level: "detail" });
    wh = set(wh, `family/${self.id}/sex`, "female");
    expect(spouseOf(wh).sex).toBe("male");
    expect(fieldOf(wh, `family/${sp.id}/sex`).get(wh).assumed).toContain("本人と逆の性別");
    // 同性のご夫婦: 配偶者を選び直すと確定になり、本人を直しても変わらない
    wh = set(wh, `family/${sp.id}/sex`, "female");
    expect(fieldOf(wh, `family/${sp.id}/sex`).get(wh).assumed).toBeNull();
    wh = set(wh, `family/${self.id}/sex`, "male");
    expect(spouseOf(wh).sex).toBe("female");
    wh = set(wh, `family/${self.id}/sex`, "female");
    expect(spouseOf(wh).sex).toBe("female");
  });

  it("見本の世帯の配偶者の性別（印なし）は本人を直しても変えない。子の性別の欄は出さない（値は持ったまま）", () => {
    let wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const before = spouseOf(wh).sex;
    wh = set(wh, `family/${self.id}/sex`, self.sex === "male" ? "female" : "male");
    expect(spouseOf(wh).sex).toBe(before);
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    expect(() => fieldOf(wh, `family/${child.id}/sex`)).toThrow();
    expect(child.sex).toBe(modelHousehold("salariedCoupleTwoKids").input.household.members.find((m) => m.id === child.id)!.sex);
  });
});

describe("子の呼び方と性別（子の性別は計算に使わないので聞かない）", () => {
  it("子の呼び方は性別によらず生まれた順に第1子・第2子…（これから生まれる子も同じ）。性別の欄は出さない。呼び名を入れればそれを添える", () => {
    let wh = couple();
    wh = action(wh, "family/add/child").run(wh);
    wh = action(wh, "family/add/child").run(wh);
    wh = action(wh, "family/add/expectedChild").run(wh);
    const kids = wh.request.input.household.members.filter((m) => m.kind === "child");
    // 生まれた順をはっきりさせる（2人目を先に生まれたことにする。性別は女の子にしても呼び方は変わらない）
    wh = fieldOf(wh, `family/${kids[0]!.id}/birth`).set(wh, "2020-04");
    wh = fieldOf(wh, `family/${kids[1]!.id}/birth`).set(wh, "2018-04");
    wh = { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: { ...wh.request.input.household, members: wh.request.input.household.members.map((m) => (m.id === kids[1]!.id ? { ...m, sex: "female" as const } : m)) } } } };
    expect(memberLabel(wh, kids[1]!.id)).toBe("第1子");
    expect(memberLabel(wh, kids[0]!.id)).toBe("第2子");
    expect(memberLabel(wh, kids[2]!.id)).toBe("第3子");
    expect(roles(wh.request).filter((r) => r.member.kind === "child").map((r) => r.label)).toEqual(["第1子", "第2子", "第3子"]);
    for (const k of kids) expect(() => fieldOf(wh, `family/${k.id}/sex`)).toThrow();
    // 確かめの一覧にも子の性別は出ない
    expect(checkList(wh).some((r) => kids.some((k) => r.fieldKey === `family/${k.id}/sex`))).toBe(false);
    // 本人・配偶者の性別の欄は今のまま
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    expect(fieldOf(wh, `family/${self.id}/sex`).level).toBe("simple");
    const w2 = fieldOf(wh, `family/${kids[1]!.id}/nickname`).set(wh, "上の子");
    expect(memberLabel(w2, kids[1]!.id)).toBe("第1子（上の子）");
  });
});
