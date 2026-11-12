// 介護・親のカード（0059）: 世帯の外の家族の欄（続柄・誰の家族か・同居・扶養と扶養の境目・亡くなる見込みの推定）、両家の親、
// 本人・配偶者の介護は自動で入れない（未入力の警告と「目安で入れる」・事務所の設定の既定）、この人の介護の目安・次の段階、
// 親のお金は区画Dで開く、仕送りの額の欄から出るお金の行、欄の当て先
import { describe, expect, it } from "vitest";
import type { Member } from "../src/engine/types.ts";
import { careEstimate, dependentLimits, lifeExpectancy } from "../../hearing/src/estimates.ts";
import { adultsWithoutCare, applyCareDefaults, careTemplate, deathEstimate, gapsOf } from "../src/workspace/input/fill.ts";
import { allFields, resolveTimepoint, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { inputItems, saveItem } from "../src/workspace/input/items.ts";
import { memberLabel } from "../src/workspace/input/labels.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { addBothParents, addNextCareStage, addOutside, dependentLimitText } from "../src/workspace/input/stages/care.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldAddress, fieldStatus } from "../src/workspace/input/valueState.ts";
import { ageAt } from "../src/workspace/levers.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const stage = (wh: WorkingHousehold): StageDef => buildStage("care", wh);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
const actionOf = (wh: WorkingHousehold, key: string) => {
  const a = stage(wh)
    .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
    .find((x) => x.key === key);
  if (a === undefined) throw new Error(`no action ${key}`);
  return a;
};
const parents = (wh: WorkingHousehold): Member[] => wh.request.input.household.members.filter((m) => m.kind === "parent");
const careTotal = (wh: WorkingHousehold) =>
  preview(wh.request)
    .table.filter((c) => c.row.startsWith("cf.expense.care"))
    .reduce((s, c) => s + c.amount, 0);

describe("介護・親のカード: 世帯の外の家族（区画A）", () => {
  it("生年月が今より後の世帯の外の家族は、マイナスの年齢ではなく家族のカードと同じ読み（今から○年後・本人の年齢（和暦））", () => {
    const id = seq();
    const w0 = mutate(blankHousehold(BASE, id), (h) => {
      h.members[0]!.birth.birthYearMonth = "1960-06";
    });
    const wh = addOutside(w0, "grandchild", { id });
    const g = wh.request.input.household.members.find((m) => m.kind === "grandchild")!;
    // 孫（あげる贈与の相手）の欄は相続・贈与のカードに置く（介護・親には読むだけの1行）
    const birthOf = (w: WorkingHousehold) => allFields(buildStage("inheritance", w)).find((x) => x.key === `family/${g.id}/birth`)!;
    expect(allFields(stage(wh)).some((x) => x.key === `family/${g.id}/birth`)).toBe(false);
    const w2 = birthOf(wh).set(wh, "2028-10");
    expect(birthOf(w2).get(w2).hint).toBe("今から2年後・ご本人68歳（令和10年10月）");
    const w3 = birthOf(w2).set(w2, "2020-04");
    expect(birthOf(w3).get(w3).hint).toBe("6歳（令和2年4月）");
  });

  it("「＋ 父を足す」: 世帯の外の家族で、親のお金の欄は作らず、亡くなる見込みは平均余命の推定（年齢の時点・仮の印）", () => {
    const wh = actionOf(blankHousehold(BASE, seq()), "family/add/father").run(blankHousehold(BASE, seq()));
    const [p] = parents(wh);
    expect(p!.outside).toBeDefined();
    expect(p!.wallet).toBeUndefined();
    const est = deathEstimate(p!, BASE)!;
    expect(p!.leaves).toEqual(est.point);
    expect(p!.leaves!.memberAge!.member).toBe(p!.id);
    // 70歳（本人40歳＋30）の平均余命（男）は表の70歳の値
    expect(ageAt(p!, BASE)).toBe(70);
    expect(est.age).toBe(Math.floor(70 + lifeExpectancy(70, "male")!.value));
    expect(fieldStatus(fieldOf(wh, `family/${p!.id}/leaves`), wh).status).toBe("estimated");
    // 標準の欄: 誰の家族か（配偶者がいるとき）・生年月・同居。続柄・呼び名（足すボタンで決まり、見出し「父（70歳）」で分かる）・扶養・亡くなる見込みは詳細
    const simple = stage(wh).sections.find((s) => s.key === "care/outside")!.groups[0]!.fields.filter((f) => f.level === "simple").map((f) => f.key.split("/").slice(2).join("/"));
    expect(simple).toEqual(["birth", "cohabiting"]);
    expect(fieldOf(wh, `family/${p!.id}/kind`).level).toBe("detail");
    expect(fieldOf(wh, `family/${p!.id}/nickname`).level).toBe("detail");
    expect(stage(wh).sections.find((s) => s.key === "care/outside")!.groups[0]!.title).toBe("父（70歳）");
    // 亡くなる見込みを直すと仮の印が外れる
    const f = fieldOf(wh, `family/${p!.id}/leaves`);
    const moved = f.time!.setWhen(wh, { memberAge: { member: p!.id, years: 95 } }, "auto");
    expect(moved.assumed[`family/${p!.id}/leaves`]).toBeUndefined();
    expect(fieldStatus(fieldOf(moved, `family/${p!.id}/leaves`), moved).status).toBe("confirmed");
  });

  it("世帯の外の家族を1人ずつ足しても、性別は推定にしない（初めの値が普通の値。呼び方は値どおり）。生年月の仮の値はそのまま", () => {
    let wh = addMember(blankHousehold(BASE, seq()), "spouse");
    for (const kind of ["parent", "grandparent", "sibling", "child", "grandchild"] as const) wh = addOutside(wh, kind);
    const outside = wh.request.input.household.members.filter((m) => m.outside !== undefined);
    expect(outside).toHaveLength(5);
    for (const m of outside) {
      expect(wh.assumed[`family/${m.id}/sex`]).toBeUndefined();
      expect(wh.assumed[`family/${m.id}/birth`]).toBe("仮の値");
      const sex = allFields(buildStage("care", wh)).find((f) => f.key === `family/${m.id}/sex`);
      if (sex === undefined) continue;
      expect(fieldStatus(sex, wh).status).toBe("confirmed");
      expect(checkList(wh).some((r) => r.fieldKey === sex.key)).toBe(false);
    }
    const p = outside.find((m) => m.kind === "parent")!;
    expect(p.sex).toBe("male");
    expect(memberLabel(wh, p.id)).toBe("父");
    const mother = fieldOf(wh, `family/${p.id}/sex`).set(wh, "female");
    expect(memberLabel(mother, p.id)).toBe("母");
    // 性別の値を持たない世帯の外の家族（贈与者から作った人など）は「親」のまま
    const noSex = mutate(wh, (h) => {
      const x = h.members.find((m) => m.id === p.id)!;
      delete (x as Partial<Member>).sex;
    });
    expect(memberLabel(noSex, p.id)).toBe("親");
  });

  it("「＋ 父を足す」「＋ 母を足す」: 性別が決まり、呼び方は父・母（標準の入れ方でも母を足せる）", () => {
    const base = blankHousehold(BASE, seq());
    const w1 = actionOf(base, "family/add/father").run(base);
    const w2 = actionOf(w1, "family/add/mother").run(w1);
    const [f, m] = parents(w2);
    expect(f!.sex).toBe("male");
    expect(m!.sex).toBe("female");
    expect(memberLabel(w2, f!.id)).toBe("父");
    expect(memberLabel(w2, m!.id)).toBe("母");
  });

  it("「＋ 両家の親を足す」: 本人・配偶者の父・母の4人（誰の家族か・性別が決まり、呼び方は父・母・義父・義母）", () => {
    const w0 = addMember(blankHousehold(BASE, seq()), "spouse");
    const wh = addBothParents(w0);
    const ps = parents(wh);
    expect(ps).toHaveLength(4);
    expect(ps.map((m) => memberLabel(wh, m.id)).sort()).toEqual(["母", "父", "義母", "義父"].sort());
    const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const inLaw = ps.filter((m) => m.outside?.of === spouse.id);
    expect(inLaw).toHaveLength(2);
    expect(inLaw.every((m) => Number(m.birth.birthYearMonth.slice(0, 4)) === Number(spouse.birth.birthYearMonth.slice(0, 4)) - 30)).toBe(true);
    // 性別の仮の印は外れ、生年月は仮のまま
    for (const m of ps) {
      expect(wh.assumed[`family/${m.id}/sex`]).toBeUndefined();
      expect(wh.assumed[`family/${m.id}/birth`]).toBeDefined();
    }
    // 誰の家族か（簡易）は配偶者がいるときだけ
    expect(fieldOf(wh, `family/${inLaw[0]!.id}/outside/of`).level).toBe("simple");
    // 親がいれば「両家の親を足す」は出さない
    expect(() => actionOf(wh, "care/add/bothParents")).toThrow();
  });

  it("兄弟姉妹・離れて暮らす子・孫も世帯の外の家族として足せる（亡くなる見込みは入れない）", () => {
    let wh = blankHousehold(BASE, seq());
    wh = addOutside(wh, "sibling");
    wh = addOutside(wh, "child");
    wh = addOutside(wh, "grandchild");
    const out = wh.request.input.household.members.filter((m) => m.outside !== undefined);
    expect(out.map((m) => m.kind)).toEqual(["sibling", "child", "grandchild"]);
    expect(out.every((m) => m.leaves === null && m.wallet === undefined)).toBe(true);
    // 離れて暮らす子は親子の関係を持つ（相続人に数える）
    const child = out.find((m) => m.kind === "child")!;
    expect(wh.request.input.household.relations).toContainEqual({ type: "parentOf", parent: wh.request.input.household.members[0]!.id, child: child.id });
    expect(memberLabel(wh, out[0]!.id)).toBe("兄弟姉妹");
    // 孫は相続・贈与のカード（あげる贈与）に置き、ここは読むだけの1行。介護・親に「＋ 孫を足す」は置かない
    const groups = stage(wh).sections.find((s) => s.key === "care/outside")!.groups;
    expect(groups.map((g) => g.key).slice(0, 2).sort()).toEqual([`family/${out[0]!.id}`, `family/${out[1]!.id}`].sort());
    expect(groups.map((g) => g.key)).toHaveLength(3);
    expect(groups.at(-1)!.key).toBe("ro/care/grandchildren");
    expect(groups.at(-1)!.fields.map((f) => [f.label, f.get(wh).value])).toEqual([["孫", "あげる贈与の相手"]]);
    expect(() => actionOf(wh, "care/add/grandchild")).toThrow();
  });

  it("呼び名の無い兄弟姉妹・祖父母・親が2人以上なら、孫と同じく足した順に番号（兄弟姉妹1・祖父母1・祖父1…）。呼び名のある人はそのまま、1人なら付けない", () => {
    let wh = blankHousehold(BASE, seq());
    for (const k of ["sibling", "grandparent", "sibling", "grandparent", "sibling"] as const) wh = addOutside(wh, k);
    const of = (k: string) => wh.request.input.household.members.filter((m) => m.kind === k);
    const label = (w: WorkingHousehold, ms: Member[], o?: { nicknames?: boolean }) => ms.map((m) => memberLabel(w, m.id, o));
    expect(label(wh, of("sibling"))).toEqual(["兄弟姉妹1", "兄弟姉妹2", "兄弟姉妹3"]);
    // 足したばかりの祖父母は性別が男性（祖父）なので「祖父1」「祖父2」
    expect(label(wh, of("grandparent"))).toEqual(["祖父1", "祖父2"]);
    // 呼び名のある人は「兄弟姉妹（兄）」のまま。顧客に渡す文（呼び名を入れない）では全員に番号
    const sib = of("sibling");
    const named = { ...wh, labelsByMember: { ...wh.labelsByMember, [sib[0]!.id]: "兄" } };
    expect(label(named, sib)).toEqual(["兄弟姉妹（兄）", "兄弟姉妹1", "兄弟姉妹2"]);
    expect(label(named, sib, { nicknames: false })).toEqual(["兄弟姉妹1", "兄弟姉妹2", "兄弟姉妹3"]);
    // 祖母が1人なら「祖母」のまま。性別が男性・女性でない祖父母・親は「祖父母1」「祖父母2」「親1」「親2」
    const mixed = addOutside(wh, "grandparent", { sex: "female" });
    expect(label(mixed, mixed.request.input.household.members.filter((m) => m.kind === "grandparent"))).toEqual(["祖父1", "祖父2", "祖母"]);
    const noSex = mutate(addOutside(addOutside(wh, "parent"), "parent"), (h) => {
      for (const m of h.members) if (m.kind === "grandparent" || m.kind === "parent") m.sex = "";
    });
    const ofNoSex = (k: string) => noSex.request.input.household.members.filter((m) => m.kind === k);
    expect(label(noSex, ofNoSex("grandparent"))).toEqual(["祖父母1", "祖父母2"]);
    expect(label(noSex, ofNoSex("parent"))).toEqual(["親1", "親2"]);
    // 1人だけなら番号を付けない
    const one = addOutside(blankHousehold(BASE, seq()), "sibling");
    expect(label(one, one.request.input.household.members.filter((m) => m.kind === "sibling"))).toEqual(["兄弟姉妹"]);
  });

  it("扶養の境目の1行: 税は年金だけなら合計所得の上限＋公的年金等控除の最低額まで、健康保険は60歳以上180万円未満、75歳からは入れない", () => {
    const wh = addOutside(blankHousehold(BASE, seq()), "parent");
    const p = parents(wh)[0]!;
    const lim = dependentLimits(70, `${BASE}-01`)!;
    expect(lim.taxIncome).toBe(620000);
    expect(lim.taxPension).toBe(620000 + 1100000);
    expect(lim.health).toBe(1800000);
    expect(dependentLimits(60, `${BASE}-01`)!.taxPension).toBe(620000 + 600000);
    expect(dependentLimits(76, `${BASE}-01`)!.health).toBeNull();
    const line = fieldOf(wh, `ro/care/outside/${p.id}/dependentLimit`);
    expect(line.readOnly).toBeDefined();
    // 欄には短い1行、全文（健康保険の扶養の境目まで）は「?」の中
    expect(String(line.get(wh).value)).toBe("税の扶養は、年金だけなら年172万円まで");
    expect(line.help).toContain("年172万円まで");
    expect(line.help).toContain("180万円未満");
    // 年金の額を入れると、その額と比較する
    const withPension = mutate(wh, (h) => {
      const x = h.members.find((m) => m.id === p.id)!;
      x.wallet = { pension: { value: 2000000, state: "confirmed", origin: { kind: "manual" } } };
    });
    expect(dependentLimitText(withPension, parents(withPension)[0]!)).toContain("範囲を超えます");
    expect(String(fieldOf(withPension, `ro/care/outside/${p.id}/dependentLimit`).get(withPension).value)).toBe("年金 年200万円は、税の扶養の範囲を超えます");
    // 75歳以上は健康保険の扶養に入れない
    const old = mutate(wh, (h) => void (h.members.find((m) => m.id === p.id)!.birth.birthYearMonth = "1948-04"));
    expect(dependentLimitText(old, parents(old)[0]!)).toContain("後期高齢者医療");
  });

  it("扶養している・同居している・仕送りの額のどれか1つだけを入れても、もう片方を既定で埋めて計算できる", () => {
    const wh0 = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const wh = addOutside(wh0, "parent");
    const p = parents(wh)[0]!;
    expect(p.support).toBeUndefined();
    for (const [key, v] of [["dependent", true], ["cohabiting", true], ["allowance", 30000]] as const) {
      const on = fieldOf(wh, `family/${p.id}/${key}`).set(wh, v);
      expect(parents(on)[0]!.support).toMatchObject({ dependent: key === "dependent", cohabiting: key === "cohabiting" });
      expect(() => preview(on.request)).not.toThrow();
    }
    // 外したとき（既定の false）も、もう片方は残る
    const both = fieldOf(wh, `family/${p.id}/cohabiting`).set(fieldOf(wh, `family/${p.id}/dependent`).set(wh, true), true);
    const off = fieldOf(both, `family/${p.id}/dependent`).set(both, false);
    expect(parents(off)[0]!.support).toMatchObject({ dependent: false, cohabiting: true });
    expect(() => preview(off.request)).not.toThrow();
  });

  it("欄はどれも当て先（構成員・入力項目ID・場所）を持つ（読むだけの行を除く）", () => {
    let wh = addOutside(addMember(blankHousehold(BASE, seq()), "spouse"), "parent");
    const p = parents(wh)[0]!;
    wh = actionOf(wh, `family/${p.id}/outside/addPeriod`).run(wh);
    const fields = stage(wh).sections.find((s) => s.key === "care/outside")!.groups[0]!.fields.filter((f) => f.item !== null && f.readOnly === undefined);
    for (const f of fields) expect(fieldAddress(f, wh), f.key).not.toBeNull();
    const period = parents(wh)[0]!.outside!.periods[0]!;
    expect(fieldAddress(fieldOf(wh, `family/${p.id}/outside/income`), wh)).toEqual({ target: { member: p.id }, item: "member.outside", at: ["periods", period.id, "income"] });
    expect(fieldAddress(fieldOf(wh, `family/${p.id}/leaves`), wh)).toEqual({ target: { member: p.id }, item: "member.leaves", at: [] });
    expect(fieldAddress(fieldOf(wh, `family/${p.id}/dependent`), wh)).toEqual({ target: { member: p.id }, item: "member.support", at: ["dependent"] });
  });

  it("仕送りの額（扶養の判定に使う）に値があり行が無ければ「＋ 仕送りを出るお金の行にする」（押したときだけ支出になる）", () => {
    const wh0 = fromRequest(modelHousehold("parentCare"));
    const p = parents(wh0)[0]!;
    const wh = fieldOf(wh0, `family/${p.id}/allowance`).set(wh0, 30000);
    expect(preview(wh.request).table).toEqual(preview(wh0.request).table);
    const made = actionOf(wh, `family/${p.id}/allowanceRow`).run(wh);
    const row = made.request.input.household.periodicExpenses!.find((x) => x.kind === "allowance")!;
    expect(row).toMatchObject({ counterparty: p.id, monthly: true, amount: { value: 30000, state: "estimated" } });
    expect(() => actionOf(made, `family/${p.id}/allowanceRow`)).toThrow();
  });
});

describe("介護・親のカード: 介護の費用（区画B）", () => {
  it("本人・配偶者の介護は自動で入れない: 入っていない物（未入力の警告）に出て、カードは未入力。「目安で入れる」で統計の目安の物を1件ずつ作る", () => {
    const wh = addMember(blankHousehold(BASE, seq()), "spouse");
    expect(wh.request.input.household.careExpenses ?? []).toEqual([]);
    const gaps = gapsOf(wh).filter((g) => g.card === "care");
    expect(gaps.map((g) => g.id)).toHaveLength(2);
    expect(gaps[0]!.fill).toBeDefined();
    // 介護・親にまだ何も入れていない間は「まだ入れていない」（赤い札は出さない。確かめの一覧では「まだ入れていない項目」。0045 の追記）
    expect(inputItems(wh).find((i) => i.id === "care")!.status).toBe("empty");
    expect(checkList(wh).filter((r) => r.card === "care").map((r) => r.kind)).toEqual(["notStarted", "notStarted"]);
    expect(stage(wh).sections.find((s) => s.key === "care/costs")!.note).toContain("0円で計算しています");
    const filled = actionOf(wh, "care/fillAdults").run(wh);
    const cares = filled.request.input.household.careExpenses!;
    expect(cares).toHaveLength(2);
    const est = careEstimate("home")!;
    // 期間・額は空欄（統計の平均の推定。前は期間に統計の月数を入れた値として書いていて、推定の印が付かなかった。0041 の追記 2026-11-10）
    expect(cares.every((c) => c.months === undefined && c.place === "home" && c.otherMonthly === undefined && c.initial === undefined)).toBe(true);
    // 始まりは亡くなる見込み（平均余命）の期間の前。年齢の時点で持つ
    const self = filled.request.input.household.members.find((m) => m.kind === "self")!;
    const c = cares.find((x) => x.member === self.id)!;
    const death = resolveTimepoint(filled.request.input.household, deathEstimate(self, BASE)!.point)!;
    expect(c.from.memberAge?.member).toBe(self.id);
    const start = resolveTimepoint(filled.request.input.household, c.from)!;
    const diff = (Number(death.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + (Number(death.slice(5)) - Number(start.slice(5)));
    expect(diff).toBe(est.months);
    expect(gapsOf(filled).filter((g) => g.card === "care")).toEqual([]);
    expect(careTotal(filled)).toBeGreaterThan(careTotal(wh));
    // 介護・親の項目を保存しただけでは、入れないと決めたことにしない（警告は残る）。「該当なし（介護の費用を入れない）」を押したときだけ消える
    expect(gapsOf(saveItem(wh, "care")).filter((g) => g.card === "care")).toHaveLength(2);
    const declined = gaps[0]!.none!(wh);
    expect(gapsOf(declined).filter((g) => g.card === "care")).toEqual([]);
    // 入れないと決めた印は、もう一度保存しても残る（入力項目の ID でなくても消さない）
    expect(gapsOf(saveItem(declined, "care")).filter((g) => g.card === "care")).toEqual([]);
    // 区画には「…の介護は入れない」のボタンを置かない（帯・確かめの一覧の「該当なし」か、入力項目の「当てはまらない」で決める。0143 の追記 2026-11-12）
    expect(() => actionOf(wh, "care/declineAdults")).toThrow();
  });

  it("事務所の設定の既定: 既定（warn）は何もせず、「最初から入れる」（fill）なら新しい世帯に目安を入れる", () => {
    const wh = blankHousehold(BASE, seq());
    expect(applyCareDefaults(wh)).toBe(wh);
    expect(applyCareDefaults(wh, { selfAndSpouse: "fill" }).request.input.household.careExpenses).toHaveLength(1);
    expect(adultsWithoutCare(applyCareDefaults(wh, { selfAndSpouse: "fill" }).request.input.household)).toEqual([]);
  });

  it("「＋ 介護の目安を入れる（この人）」: 親の亡くなる見込みの期間の前から。今より前になるなら今の翌月から", () => {
    let wh = addOutside(blankHousehold(BASE, seq()), "parent");
    const p = parents(wh)[0]!;
    wh = actionOf(wh, `family/${p.id}/care/estimate`).run(wh);
    const c = wh.request.input.household.careExpenses![0]!;
    expect(c.member).toBe(p.id);
    expect(() => actionOf(wh, `family/${p.id}/care/estimate`)).toThrow();
    // 92歳の親（亡くなる見込みがすぐ）は今の翌月から
    const old = mutate(addOutside(blankHousehold(BASE, seq()), "parent"), (h) => {
      const x = h.members.find((m) => m.kind === "parent")!;
      x.birth.birthYearMonth = "1934-04";
      x.leaves = { at: "2028-01" };
    });
    const t = careTemplate(old.request.input.household, parents(old)[0]!, BASE);
    expect(t.from).toEqual({ at: "2026-11" });
  });

  it("「＋ 次の段階を足す」: 前の段の始まりの形のまま期間だけずらした施設の段", () => {
    let wh = addOutside(blankHousehold(BASE, seq()), "parent");
    const p = parents(wh)[0]!;
    wh = actionOf(wh, `family/${p.id}/care/estimate`).run(wh);
    const first = wh.request.input.household.careExpenses![0]!;
    const next = addNextCareStage(wh, first.id, "00000000-0000-4000-8000-00000000ffff");
    const second = next.request.input.household.careExpenses![1]!;
    expect(second.place).toBe("facility");
    const h = next.request.input.household;
    const a = resolveTimepoint(h, first.from)!;
    const b = resolveTimepoint(h, second.from)!;
    // 前の段の期間は空欄（推定）なので、統計の平均の期間だけずらす
    expect(first.months).toBeUndefined();
    expect((Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5)) - Number(a.slice(5)))).toBe(careEstimate("home")!.months);
    // 見出しは「父の介護」、その下の1行に「在宅・2027年5月から55か月（推定）・月5.2万円（推定）」（左の狭い列で折り返さないように2行に分ける。
    // 在宅か施設かは見出しに入れず要約の頭に。0150。推定の物のすぐ後ろに「（推定）」。0041 の追記 2026-11-10）
    const g0 = stage(next).sections.find((s) => s.key === "care/costs")!.groups[0]!;
    expect(g0.title).toMatch(/^父の介護$/);
    expect(g0.summary).toMatch(/^在宅・\d{4}年\d{1,2}月から55か月（推定）・月5\.2万円（推定）$/);
  });

  it("始まり・期間・月々の費用は詳細（もう始まっている介護だけ月々の費用は標準）、伸び方・万一のときの扱いは詳細の欄（当て先つき）", () => {
    const wh = fromRequest(modelHousehold("parentCare"));
    const c = wh.request.input.household.careExpenses![0]!;
    // これからの介護（2027年4月から。計算の基準の月は2026年10月）
    expect(fieldOf(wh, `ev/care/${c.id}/from`).level).toBe("detail");
    expect(fieldOf(wh, `ev/care/${c.id}/months`).level).toBe("detail");
    expect(fieldOf(wh, `ev/care/${c.id}/other`).level).toBe("detail");
    expect(fieldOf(wh, `ev/care/${c.id}/place`).level).toBe("simple");
    // もう始まっている介護（始まりが計算の基準の月より前）は月々の費用を標準に出す。基準の月に始まる物はこれから
    const at = (ym: string) => mutate(wh, (h) => void (h.careExpenses![0]!.from = { at: ym }));
    expect(fieldOf(at("2025-04"), `ev/care/${c.id}/other`).level).toBe("simple");
    expect(fieldOf(at("2025-04"), `ev/care/${c.id}/from`).level).toBe("detail");
    expect(fieldOf(at(wh.request.input.baseMonth), `ev/care/${c.id}/other`).level).toBe("detail");
    const g = fieldOf(wh, `ev/care/${c.id}/growth`);
    expect(g.level).toBe("detail");
    expect(fieldAddress(g, wh)).toEqual({ target: { object: c.id }, item: "care.growth", at: ["kind"] });
    expect(fieldAddress(fieldOf(wh, `ev/care/${c.id}/on/mode`), wh)).toEqual({ target: { object: c.id }, item: "care.onContingency", at: [] });
  });
});

describe("介護・親のカード: 親のお金（区画D）", () => {
  it("お金を見ていない親は区画の「＋ 〜のお金が持つかを見る」で開き、開くと預金・生活費が未入力になる", () => {
    const wh = addOutside(blankHousehold(BASE, seq()), "parent");
    const p = parents(wh)[0]!;
    const sec = (w: WorkingHousehold) => stage(w).sections.find((s) => s.key === "care/wallet")!;
    expect(sec(wh).groups).toEqual([]);
    const opened = actionOf(wh, `family/${p.id}/wallet/add`).run(wh);
    expect(sec(opened).groups.map((g) => g.key)).toEqual([`care/wallet/${p.id}`]);
    expect(fieldStatus(fieldOf(opened, `family/${p.id}/wallet/balance`), opened).status).toBe("missing");
    const removed = actionOf(opened, `family/${p.id}/wallet/remove`).run(opened);
    expect(parents(removed)[0]!.wallet).toBeUndefined();
  });
});
