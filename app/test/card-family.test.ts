// 家族のカード: 関係の形（法律婚・事実婚）と始まり・終わり、関係を期間で持つ、これから生まれる子、本人と配偶者の入れ替え、
// 家族のお金の行（養育費・手当・財産分与・子への仕送り）。書いた形がエンジンでそのまま計算でき、当て先（0036 の2）が付くこと
import { describe, expect, it } from "vitest";
import type { EngineRequest, IncomeFlow, PeriodicExpense } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageDef, type Val } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addMember, addRelationStage, markBorn, relationSummary, removeMember, spouseRelations, swapSelfSpouse } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { fieldAddress } from "../src/workspace/input/valueState.ts";
import { readAt } from "../src/workspace/store/readings.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { roles } from "../src/workspace/roles.ts";
import { memberLabel } from "../src/workspace/input/labels.ts";
import { full, modelHousehold, preview } from "./helpers.ts";

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
    const w3 = fieldOf(w2, `family/${kid.id}/birth`).set(w2, "2027-12");
    expect(w3.request.input.household.members.find((m) => m.id === kid.id)!.birth.birthYearMonth).toBe("2027-12");
    expect(() => preview(w3.request)).not.toThrow();
    const born = markBorn(w3, kid.id);
    expect(born.request.input.household.members.find((m) => m.id === kid.id)).toMatchObject({ expected: false, joins: null });
    expect(fieldOf(born, `family/${kid.id}/birth`).label).toBe("生年月");
  });
});

describe("生まれる予定の欄は子の生年月の欄と同じ見た目・入れ方", () => {
  it("年月の欄（入れ方の選択なし）で、読みは「今から○年後・本人の年齢（和暦）」", () => {
    const wh = couple();
    const w1 = action(wh, "family/add/expectedChild").run(wh);
    const kid = w1.request.input.household.members.find((m) => m.kind === "child")!;
    const f = fieldOf(w1, `family/${kid.id}/birth`);
    const self = w1.request.input.household.members.find((m) => m.kind === "self")!;
    const selfBirth = fieldOf(w1, `family/${self.id}/birth`);
    expect(f.kind).toBe(selfBirth.kind);
    expect(f.kind).toBe("ym");
    expect(f.time).toBeUndefined();
    expect(f.get(w1)).toMatchObject({ value: "2028-10", hint: "今から2年後・ご主人43歳（令和10年10月）" });
    const w2 = f.set(w1, "2027-08");
    expect(fieldOf(w2, `family/${kid.id}/birth`).get(w2).hint).toBe("今から10か月後・ご主人42歳（令和9年8月）");
    // 空は入れられない（今の値のまま）
    expect(fieldOf(w2, `family/${kid.id}/birth`).set(w2, null)).toBe(w2);
    expect(fieldOf(w2, `family/${kid.id}/birth`).set(w2, "")).toBe(w2);
  });

  it("加わる月を年齢の形で持つ古い世帯は、開いただけでは書き換えず、年月を入れ直したら年月で書く", () => {
    const wh = couple();
    const w1 = action(wh, "family/add/expectedChild").run(wh);
    const kid = w1.request.input.household.members.find((m) => m.kind === "child")!;
    const self = w1.request.input.household.members.find((m) => m.kind === "self")!;
    const old = { ...w1, request: structuredClone(w1.request) };
    const k0 = old.request.input.household.members.find((m) => m.id === kid.id)!;
    k0.birth.birthYearMonth = "2028-06";
    k0.joins = { memberAge: { member: self.id, years: 43 } };
    const before = structuredClone(old.request);
    const f = fieldOf(old, `family/${kid.id}/birth`);
    expect(f.get(old)).toMatchObject({ value: "2028-06", hint: "今から1年8か月後・ご主人43歳（令和10年6月）" });
    expect(old.request).toEqual(before);
    // 同じ年月を入れ直しても変えない
    expect(f.set(old, "2028-06")).toBe(old);
    const w2 = f.set(old, "2028-09");
    expect(w2.request.input.household.members.find((m) => m.id === kid.id)).toMatchObject({ birth: { birthYearMonth: "2028-09" }, joins: { at: "2028-09" } });
    expect(() => preview(w2.request)).not.toThrow();
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
  it("区画は簡易に出て、手当の終わりは下の子の18歳の年度末。養育費を受け取る行の相手は世帯の中の下の子で、終わりはその子の20歳", () => {
    const wh = fromRequest(modelHousehold("singleEarnerTwoKids"));
    const st = stage(wh);
    const sec = st.sections.find((s) => s.key === "money/family/in")!;
    expect(sec.level).toBe("simple");
    const youngest = wh.request.input.household.members.filter((m) => m.kind === "child").sort((a, b) => b.birth.birthYearMonth.localeCompare(a.birth.birthYearMonth))[0]!;
    const wb = action(wh, "money/family/in/add/benefit").run(wh);
    expect(((wb.request.input.household.incomeFlows ?? []).at(-1) as IncomeFlow).to).toEqual({ memberAge: { member: youngest.id, years: 18, ageSwitch: "firstMarch31AfterReach" } });
    const w1 = action(wh, "money/family/in/add/childSupport").run(wh);
    const f = (w1.request.input.household.incomeFlows ?? []).at(-1) as IncomeFlow;
    expect(f.counterparty).toBe(youngest.id);
    expect(f.to).toEqual({ memberAge: { member: youngest.id, years: 20 } });
    const party = fieldOf(w1, `in/${f.id}/counterparty`);
    expect(party.level).toBe("simple");
    expect(party.label).toBe("養育費を受ける子");
    // 選べるのは世帯の中の子だけ（配偶者は出さない）
    const spouse = w1.request.input.household.members.find((m) => m.kind === "spouse")!;
    const opts = party.kind === "select" ? party.options.map((o) => o.value) : [];
    expect(opts).toContain(youngest.id);
    expect(opts).not.toContain(spouse.id);
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

describe("養育費の行: 相手は養育を受ける子。払う行は離れて暮らす子で、行の中から足せる", () => {
  const rowAction = (wh: WorkingHousehold, key: string) => {
    const a = stage(wh).sections.flatMap((s) => s.groups.flatMap((g) => g.actions)).find((x) => x.key === key);
    if (a === undefined) throw new Error(`ボタンが無い: ${key}`);
    return a;
  };
  const lastOut = (wh: WorkingHousehold) => (wh.request.input.household.periodicExpenses ?? []).at(-1) as PeriodicExpense;
  const supportPaid = (req: EngineRequest, id: string) => {
    // 見本の世帯は表が短いので、終わりの後まで表を延ばして確かめる
    const cells = full({ ...req, input: { ...req.input, endYear: 2040 } }).table.filter((c) => c.object === id);
    return { years: [...new Set(cells.filter((c) => c.amount !== 0).map((c) => c.year))].sort((a, b) => a - b), total: cells.reduce((a, c) => a + c.amount, 0) };
  };

  it("世帯の外の子がいなければ相手は空で、知らせが出る。「＋ 離れて暮らす子を足す」で足すと相手と終わり（20歳になる月）が入る", () => {
    const wh = fromRequest(modelHousehold("singleEarnerTwoKids"));
    const w1 = action(wh, "money/family/out/add/childSupport").run(wh);
    const p = lastOut(w1);
    expect(p.counterparty).toBeUndefined();
    expect(p.to ?? null).toBeNull();
    const party = fieldOf(w1, `ev/${p.id}/counterparty`);
    expect(party.label).toBe("相手の子（離れて暮らす子）");
    // 世帯の中の配偶者・子は選べない
    expect(party.kind === "select" ? party.options.map((o) => o.value) : []).toEqual([""]);
    expect(fieldOf(w1, `ev/${p.id}/to`).get(w1).warn).toContain("最後まで");
    const w2 = rowAction(w1, `ev/${p.id}/addChild`).run(w1);
    const kid = w2.request.input.household.members.at(-1)!;
    expect(kid).toMatchObject({ kind: "child", outside: { periods: [] } });
    expect((w2.request.input.household.relations ?? []).some((r) => r.type === "parentOf" && r.child === kid.id)).toBe(true);
    const p2 = lastOut(w2);
    expect(p2.counterparty).toBe(kid.id);
    expect(p2.to).toEqual({ memberAge: { member: kid.id, years: 20 } });
    expect(fieldOf(w2, `ev/${p.id}/to`).get(w2).warn ?? null).toBeNull();
    // 行の中で相手の子の生年月を入れる（仮の印つき）。終わりはその子が20歳になる月
    const birth = fieldOf(w2, `family/${kid.id}/birth`);
    expect(birth.level).toBe("simple");
    expect(birth.get(w2).assumed).toBe("仮の値");
    const w3 = birth.set(w2, "2016-05");
    expect(fieldOf(w3, `family/${kid.id}/birth`).get(w3).assumed ?? null).toBeNull();
    expect(fieldOf(w3, `ev/${p.id}/to`).get(w3).value).toBe("2036-05");
    expect(hasAction(w3, `ev/${p.id}/addChild`)).toBe(false);
    // 足した子は介護・親のカードの世帯の外の家族に出る。家族のカードの構成員には出ない
    expect(buildStage("care", w3).sections.flatMap((s) => s.groups).some((g) => g.key === `family/${kid.id}`)).toBe(true);
    expect(stage(w3).sections.find((s) => s.key === "family/members")!.groups.some((g) => g.key === `family/${kid.id}`)).toBe(false);
    // 計算: 2036年5月まで払い、その後は払わない
    const paid = supportPaid(w3.request, p.id);
    expect(paid.years.at(-1)).toBe(2036);
    expect(paid.total).not.toBe(0);
  });

  it("終わりは大学卒業（22歳の年度末）と20歳になる月をボタンで切り替えられる。相手を選び直すと、同じ決まりのまま付け替える", () => {
    const wh = fromRequest(modelHousehold("singleEarnerTwoKids"));
    const w1 = action(wh, "money/family/in/add/childSupport").run(wh);
    const f = (w1.request.input.household.incomeFlows ?? []).at(-1) as IncomeFlow;
    expect(hasAction(w1, `in/${f.id}/end20`)).toBe(false);
    const w2 = rowAction(w1, `in/${f.id}/endUniversity`).run(w1);
    const kid = f.counterparty!;
    expect(((w2.request.input.household.incomeFlows ?? []).at(-1) as IncomeFlow).to).toEqual({ memberAge: { member: kid, years: 22, ageSwitch: "firstMarch31AfterReach" } });
    expect(hasAction(w2, `in/${f.id}/endUniversity`)).toBe(false);
    const other = w2.request.input.household.members.find((m) => m.kind === "child" && m.id !== kid)!;
    const w3 = set(w2, `in/${f.id}/counterparty`, other.id);
    expect(((w3.request.input.household.incomeFlows ?? []).at(-1) as IncomeFlow).to).toEqual({ memberAge: { member: other.id, years: 22, ageSwitch: "firstMarch31AfterReach" } });
    const w4 = rowAction(w3, `in/${f.id}/end20`).run(w3);
    expect(((w4.request.input.household.incomeFlows ?? []).at(-1) as IncomeFlow).to).toEqual({ memberAge: { member: other.id, years: 20 } });
    // 年月で入れた終わりは、相手を選び直しても変えない
    const w5 = set(w4, `in/${f.id}/to`, "2040-03");
    const w6 = set(w5, `in/${f.id}/counterparty`, kid);
    expect(((w6.request.input.household.incomeFlows ?? []).at(-1) as IncomeFlow).to).toEqual({ at: "2040-03" });
    expect(() => preview(w6.request)).not.toThrow();
  });

  it("古い世帯の、前の配偶者を相手にした養育費の行は黙って書き換えず、相手の選択肢にも残す", () => {
    const wh0 = fromRequest(modelHousehold("singleEarnerTwoKids"));
    const sp = spouseOf(wh0);
    const w1 = action(wh0, "money/family/out/add/childSupport").run(wh0);
    const id = lastOut(w1).id;
    const old = {
      ...w1,
      request: { ...w1.request, input: { ...w1.request.input, household: { ...w1.request.input.household, periodicExpenses: (w1.request.input.household.periodicExpenses ?? []).map((x) => (x.id === id ? { ...x, counterparty: sp.id } : x)) } } },
    } as WorkingHousehold;
    const party = fieldOf(old, `ev/${id}/counterparty`);
    expect(party.get(old).value).toBe(sp.id);
    expect(party.kind === "select" && party.options.some((o) => o.value === sp.id)).toBe(true);
    // 開き直しても相手はそのまま（終わりも書き換えない）
    const reopened = fromRequest(old.request);
    expect(lastOut(reopened).counterparty).toBe(sp.id);
    expect(lastOut(reopened).to ?? null).toBeNull();
  });

  it("離婚の後の養育費のボタン: 相手は子（払う: 世帯の外の子、受け取る: 世帯の中の子）、前の配偶者は名前に書く", () => {
    let wh = fromRequest(modelHousehold("singleEarnerTwoKids"));
    const sp = spouseOf(wh);
    const rel = spouseRelations(wh.request.input.household, sp.id)[0]!;
    wh = set(wh, `family/relation/${rel.id}/to`, "2030-03");
    const inside = wh.request.input.household.members.filter((m) => m.kind === "child").sort((a, b) => b.birth.birthYearMonth.localeCompare(a.birth.birthYearMonth))[0]!;
    const w1 = action(wh, `family/relation/${rel.id}/childSupportIn`).run(wh);
    const f = (w1.request.input.household.incomeFlows ?? []).at(-1) as IncomeFlow;
    expect(f).toMatchObject({ label: "養育費（前の配偶者から）", counterparty: inside.id, from: { at: "2030-04" }, to: { memberAge: { member: inside.id, years: 20 } } });
    const w2 = action(wh, `family/relation/${rel.id}/childSupportOut`).run(wh);
    expect(lastOut(w2)).toMatchObject({ label: "養育費（前の配偶者へ）", from: { at: "2030-04" } });
    expect(lastOut(w2).counterparty).toBeUndefined();
    const w3 = rowAction(w2, `ev/${lastOut(w2).id}/addChild`).run(w2);
    const kid = w3.request.input.household.members.at(-1)!;
    expect(lastOut(w3)).toMatchObject({ counterparty: kid.id, to: { memberAge: { member: kid.id, years: 20 } } });
    // 世帯の外の子がいれば、ボタンで最初からその子を相手にする
    const w4 = action(w3, `family/relation/${rel.id}/childSupportOut`).run(w3);
    expect(lastOut(w4).counterparty).toBe(kid.id);
    expect(() => preview(w4.request)).not.toThrow();
    // 相手の子を外すと、行の相手は空になり、終わりはその時の年月のまま残る
    const end = fieldOf(w4, `ev/${lastOut(w4).id}/to`).get(w4).value;
    const w5 = removeMember(w4, kid.id);
    expect(lastOut(w5).counterparty).toBeUndefined();
    expect(lastOut(w5).to).toEqual({ at: end });
    expect(() => preview(w5.request)).not.toThrow();
  });

  it("当て先が付き、プランで直せる（相手の子の生年月は構成員の生年月に当てる）", () => {
    const wh = fromRequest(modelHousehold("singleEarnerTwoKids"));
    const w1 = action(wh, "money/family/out/add/childSupport").run(wh);
    const p = lastOut(w1);
    const w2 = rowAction(w1, `ev/${p.id}/addChild`).run(w1);
    const kid = w2.request.input.household.members.at(-1)!;
    expect(fieldAddress(fieldOf(w2, `ev/${p.id}/counterparty`), w2)).toEqual({ target: { object: p.id }, item: "periodicExpense.counterparty", at: [] });
    expect(fieldAddress(fieldOf(w2, `family/${kid.id}/birth`), w2)).toEqual({ target: { member: kid.id }, item: "member.birth", at: ["birthYearMonth"] });
  });
});

describe("離れて暮らす子を扶養親族に入れる欄（払う養育費の行の中。0044 の追記）", () => {
  const rowAction = (wh: WorkingHousehold, key: string) => {
    const a = stage(wh).sections.flatMap((s) => s.groups.flatMap((g) => g.actions)).find((x) => x.key === key);
    if (a === undefined) throw new Error(`ボタンが無い: ${key}`);
    return a;
  };
  const lastOut = (wh: WorkingHousehold) => (wh.request.input.household.periodicExpenses ?? []).at(-1) as PeriodicExpense;
  const has = (wh: WorkingHousehold, key: string) => allFields(stage(wh)).some((x) => x.key === key);
  const longer = (req: EngineRequest): EngineRequest => ({ ...req, input: { ...req.input, endYear: 2040 } });
  const taxIn = (req: EngineRequest, year: number) => full(longer(req)).table.filter((c) => (c.row === "cf.taxSi.incomeTax" || c.row === "cf.taxSi.residentTax") && c.year === year).reduce((a, c) => a + c.amount, 0);
  /** 見本の世帯に、離れて暮らす子（2012年5月生まれ）への養育費の行を足す */
  const withSupport = () => {
    const wh = fromRequest(modelHousehold("singleEarnerTwoKids"));
    const w1 = action(wh, "money/family/out/add/childSupport").run(wh);
    const p = lastOut(w1);
    // 相手がいない行には出さない
    const w2 = rowAction(w1, `ev/${p.id}/addChild`).run(w1);
    const kid = w2.request.input.household.members.at(-1)!;
    return { before: w1, p, kid, wh: set(w2, `family/${kid.id}/birth`, "2012-05") };
  };

  it("相手に離れて暮らす子が選ばれている行にだけ出る。既定は入れない（世帯ファイルに書かない）", () => {
    const { before, p, kid, wh } = withSupport();
    expect(has(before, `family/${kid.id}/dependent`)).toBe(false);
    const f = fieldOf(wh, `family/${kid.id}/dependent`);
    expect(f.label).toBe("扶養している（税）");
    expect(f.level).toBe("detail");
    expect(f.get(wh)).toMatchObject({ value: false, implicit: true });
    expect(kid.support).toBeUndefined();
    // 終わり（20歳になる月＝2032年5月）の前の年まで。大学卒業に変えると22歳の年まで
    expect(f.help).toContain("効く年の目安: 2028年（16歳）から2031年（19歳）まで");
    expect(f.help).toContain("両方の親");
    const w2 = rowAction(wh, `ev/${p.id}/endUniversity`).run(wh);
    expect(fieldOf(w2, `family/${kid.id}/dependent`).help).toContain("2028年（16歳）から2034年（22歳）まで");
    // 相手を外すと欄は消える（入れた値は残すが、計算は養育費・仕送りの行がある年だけ）
    const w3 = set(wh, `ev/${p.id}/counterparty`, "");
    expect(has(w3, `family/${kid.id}/dependent`)).toBe(false);
    // 介護・親のカードの世帯の外の家族のまとまりには、子の扶養の欄を出さない（同じ値を2か所に置かない）
    expect(allFields(buildStage("care", wh)).some((x) => x.key === `family/${kid.id}/dependent`)).toBe(false);
  });

  it("当て先は構成員の扶養（親・祖父母の欄と同じ値）", () => {
    const { kid, wh } = withSupport();
    expect(fieldAddress(fieldOf(wh, `family/${kid.id}/dependent`), wh)).toEqual({ target: { member: kid.id }, item: "member.support", at: ["dependent"] });
  });

  it("入れると、16歳から養育費の行の終わりの前の年まで所得税・住民税が下がる。入れない間は結果が変わらない", () => {
    const { kid, wh } = withSupport();
    const on = set(wh, `family/${kid.id}/dependent`, true);
    expect(on.request.input.household.members.find((m) => m.id === kid.id)?.support).toEqual({ dependent: true, cohabiting: false });
    // 2027年は15歳（効かない）
    expect(taxIn(on.request, 2027)).toBe(taxIn(wh.request, 2027));
    // 2029年は所得税（2029年分）と住民税（2028年分の所得）の両方が下がる
    expect(taxIn(on.request, 2029)).toBeLessThan(taxIn(wh.request, 2029));
    // 2033年分の所得税・2034年度の住民税（2033年分の所得）は、行が終わった後なので同じ
    expect(taxIn(on.request, 2035)).toBe(taxIn(wh.request, 2035));
    // 入れて戻すと、入れない世帯と同じ結果
    const off = set(on, `family/${kid.id}/dependent`, false);
    expect(taxIn(off.request, 2029)).toBe(taxIn(wh.request, 2029));
  });
});
