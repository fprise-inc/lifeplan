// 基本生活費のカード（0048）と推定の段階（0049）: 生活費の人数の数え方・推定の段階（新しい世帯だけ自動・推定のままの段だけ入れ直す・
// 直した段は確定・外した段は足し直さない）・総額と費目の切り替え（両方を持つ・差は「その他の消費」）・束の合計・年払いの暮らしの支出の区画・
// 明細の年1回の支払い・答え合わせ・医療費の説明
import { describe, expect, it } from "vitest";
import type { Household, LivingExpense, Member } from "../src/engine/types.ts";
import { householdSize, isPureSplit, withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { autoActive, autoStages, countAt, isAutoStage } from "../src/workspace/input/livingStages.ts";
import { rowAt } from "../src/workspace/input/rows.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, fieldStatus } from "../src/workspace/input/valueState.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyOf, EMPTY_CARRY, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { readAt } from "../src/workspace/store/readings.ts";
import { buildCandidates } from "../../statement/src/candidates.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const living = (wh: WorkingHousehold): LivingExpense => wh.request.input.household.livingExpenses![0]!;
const stage = (wh: WorkingHousehold): StageDef => buildStage("living", wh);
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
const edit = (wh: WorkingHousehold, next: WorkingHousehold) => withRefreshedEstimates(next);
const ratios = (wh: WorkingHousehold) => (living(wh).stages ?? []).map((s) => [s.label, s.ratio]);

/** 本人40歳・配偶者38歳・子（2016年4月生まれ）の世帯（新しい世帯から作る） */
function family(): WorkingHousehold {
  let wh = blankHousehold(BASE, seq());
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1986-06"));
  wh = edit(wh, addMember(wh, "spouse"));
  wh = edit(wh, addMember(wh, "child"));
  const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
  return edit(
    wh,
    mutate(wh, (h) => {
      const c = h.members.find((m) => m.id === child.id)!;
      c.birth.birthYearMonth = "2016-04";
      c.leaves = { at: "2038-04" };
    }),
  );
}

describe("生活費の人数の数え方（0049 の1）", () => {
  const self: Member = { id: "s", kind: "self", birth: { birthYearMonth: "1986-06", bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false };
  const child = (id: string, birth: string, o: Partial<Member> = {}): Member => ({ id, kind: "child", birth: { birthYearMonth: birth, bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false, ...o });
  it("予定の子・生年月が計算基準月より後の子は今の人数に数えず、生まれた月から数える", () => {
    const h: Household = { members: [self, child("a", "2020-04"), child("b", "2027-03", { expected: true }), child("c", "2027-05")] };
    expect(householdSize(h, BASE)).toBe(2);
    expect(countAt(h, "2027-03")).toBe(3);
    expect(countAt(h, "2027-05")).toBe(4);
  });
  it("離れた子・自宅外の在学中の子・施設の介護の人は数えない。世帯の外の家族は生活費の人数に入れる期間だけ数える", () => {
    const h: Household = {
      members: [
        self,
        child("a", "2008-04", { leaves: { at: "2030-04" } }),
        { id: "p", kind: "parent", birth: { birthYearMonth: "1956-01", bornOnFirst: false }, sex: "female", joins: null, leaves: null, outside: { periods: [{ id: "00000000-0000-4000-8000-0000000000aa", from: { at: "2028-04" }, to: { at: "2035-03" }, living: true }] } },
      ],
      goals: [{ id: "g", kind: "education", owner: "a", education: { stages: [{ stage: "university", living: "away" }] } }],
      careExpenses: [{ id: "c", member: "s", from: { at: "2060-01" }, place: "facility" }],
    };
    expect(householdSize(h, BASE)).toBe(2);
    expect(countAt(h, "2027-04")).toBe(1); // 大学（自宅外）の在学中
    expect(countAt(h, "2028-04")).toBe(2); // 親と家計を1つにする（子はまだ自宅外）
    expect(countAt(h, "2031-04")).toBe(2); // 子は独立、親は同居
    expect(countAt(h, "2035-04")).toBe(1);
    expect(countAt(h, "2060-01")).toBe(0); // 本人が施設に入る
  });
});

describe("推定の段階（0049 の2・3）", () => {
  it("新しい世帯は、退職・70歳・80歳の推定の段から始まる（値の状態は推定。出し方 derived）", () => {
    const wh = blankHousehold(BASE, seq());
    const l = living(wh);
    expect(ratios(wh)).toEqual([
      ["retirement", "0.8"],
      ["age70", "0.75"],
      ["age80", "0.7"],
    ]);
    for (const s of l.stages ?? []) expect(isAutoStage(l, s.id!)).toBe(true);
    const ratio = allFields(stage(wh)).find((f) => f.key.endsWith("/stage/0/ratio"))!;
    expect(fieldStatus(ratio, wh).status).toBe("estimated");
    expect(fieldStatus(ratio, wh).basis).toContain("推定の段階");
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("家族を足すと、子の独立の段が入り、割合は世帯人員別の目安の比×退職・年齢の目安", () => {
    const wh = family();
    // 3人（表の額 264,456円）→ 子の独立で2人（235,225円）: 0.89、退職で ×0.8、70歳 ×0.75、80歳 ×0.7（比は表の額のままで出す）
    expect(ratios(wh)).toEqual([
      ["childIndependence", "0.89"],
      ["retirement", "0.71"],
      ["age70", "0.67"],
      ["age80", "0.62"],
    ]);
    expect(householdSize(wh.request.input.household, BASE)).toBe(3);
    // 欄に入れる総額の推定は千円単位
    expect(living(wh).monthly!.value).toBe(264000);
  });

  it("推定のままの段は入れ直し、FP が直した段は確定のまま残る。外した段は足し直さない", () => {
    let wh = family();
    const l0 = living(wh);
    const ind = l0.stages!.find((s) => s.label === "childIndependence")!;
    const i = l0.stages!.indexOf(ind);
    // 独立の割合を FP が直す → その段だけ確定
    const f = fieldOf(wh, `living/${l0.id}/stage/${i}/ratio`);
    wh = edit(wh, f.set(wh, "0.95"));
    expect(isAutoStage(living(wh), ind.id!)).toBe(false);
    expect(fieldStatus(fieldOf(wh, `living/${l0.id}/stage/${i}/ratio`), wh).status).toBe("confirmed");
    // 子の独立を遅らせても、確定の段はそのまま（推定の段は入れ直す）
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    wh = edit(wh, mutate(wh, (h) => void (h.members.find((m) => m.id === child.id)!.leaves = { at: "2040-04" })));
    expect(living(wh).stages!.find((s) => s.id === ind.id)!.ratio).toBe("0.95");
    // 退職の段を外す → 入れ直しでも戻らない
    const ret = living(wh).stages!.findIndex((s) => s.label === "retirement");
    const remove = actionOf(wh, `living/${l0.id}/stage/${ret}/remove`);
    wh = edit(wh, remove.run(wh));
    expect(living(wh).stages!.some((s) => s.label === "retirement")).toBe(false);
    wh = edit(wh, addMember(wh, "child"));
    expect(living(wh).stages!.some((s) => s.label === "retirement")).toBe(false);
    expect(autoActive(living(wh))).toBe(true);
  });

  it("時点を直すと、その段は確定になる", () => {
    let wh = family();
    const l0 = living(wh);
    const i = l0.stages!.findIndex((s) => s.label === "age80");
    const at = fieldOf(wh, `living/${l0.id}/stage/${i}/at`);
    wh = edit(wh, at.time!.setWhen(wh, { at: "2070-01" }, "this"));
    const s = living(wh).stages!.find((x) => x.label === "age80")!;
    expect(s.at).toEqual({ at: "2070-01" });
    expect(isAutoStage(living(wh), s.id!)).toBe(false);
  });

  it("予定の子は生まれる月に段を作り、自宅外の大学・同居の親・施設の介護も段になる", () => {
    let wh = family();
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    wh = edit(
      wh,
      mutate(wh, (h) => {
        h.members.push({ id: "00000000-0000-4000-8000-00000000e001", kind: "child", birth: { birthYearMonth: "2027-08", bornOnFirst: false }, sex: "female", joins: null, leaves: { at: "2049-04" }, expected: true });
        h.goals = [{ id: "00000000-0000-4000-8000-00000000e002", kind: "education", owner: child.id, education: { stages: [{ stage: "university", sector: "private", field: "humanities", living: "away" }] } }];
        h.careExpenses = [{ id: "00000000-0000-4000-8000-00000000e003", member: self.id, from: { at: "2068-01" }, place: "facility" }];
      }),
    );
    const want = autoStages(wh.request.input.household, BASE, wh.request.input.endYear, living(wh).id);
    const reasons = want.flatMap((s) => s.reasons.map((r) => r.split("/")[0]));
    // 自宅外の在学の終わりは、もう独立した後なので人数が変わらず、段にしない
    expect(reasons).toEqual(expect.arrayContaining(["birth", "awayFrom", "leaves", "care", "retire", "age70", "age80"]));
    expect(reasons).not.toContain("awayTo");
    const birth = want.find((s) => s.reasons.some((r) => r.startsWith("birth/")))!;
    expect(birth.ym).toBe("2027-08");
    expect(Number(birth.ratio)).toBeGreaterThan(1);
    // 画面の見出しは理由から
    const titles = stage(wh)
      .sections.flatMap((s) => s.groups)
      .map((g) => g.title ?? "");
    expect(titles.some((t) => t.includes("の誕生"))).toBe(true);
    expect(titles.some((t) => t.includes("自宅外の在学"))).toBe(true);
    expect(titles.some((t) => t.includes("施設の介護"))).toBe(true);
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("古い世帯を開いても段を入れない（入れ直しもしない）。「推定で入れる」を押したときだけ入れる", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const before = JSON.stringify(living(wh).stages ?? null);
    const again = withRefreshedEstimates(wh);
    expect(JSON.stringify(living(again).stages ?? null)).toBe(before);
    expect(autoActive(living(again))).toBe(false);
    const l = living(wh);
    const key = `living/${l.id}/autoStages`;
    const a = actionOf(wh, key);
    const w2 = a.run(wh);
    expect(autoActive(living(w2))).toBe(true);
    expect((living(w2).stages ?? []).every((s) => isAutoStage(living(w2), s.id!))).toBe(true);
    expect(() => preview(w2.request)).not.toThrow();
  });
});

describe("総額と費目（0048 の2）", () => {
  it("費目で入れるに切り替えると、総額を家計調査の割合で9費目に分けた推定（仕送りは0円、合計は総額と同じ）。総額は消さない", () => {
    const wh = family();
    const l = living(wh);
    const mode = fieldOf(wh, `living/${l.id}/mode`);
    const w1 = mode.set(wh, "byCategory");
    const l1 = living(w1);
    expect(l1.mode).toBe("byCategory");
    expect(l1.monthly!.value).toBe(264000);
    expect(l1.categories).toHaveLength(9);
    expect(l1.categories!.reduce((s, c) => s + c.monthly.value!, 0)).toBe(264000);
    expect(l1.categories!.find((c) => c.category === "allowance")!.monthly.value).toBe(0);
    // 3人の世帯の食料 92,240 ÷ 264,455（8費目の合計）× 264,000 を千円単位に丸めた額（欄は万円の小数1桁で見える）
    expect(l1.categories!.find((c) => c.category === "food")!.monthly.value).toBe(Math.round((264000 * 92240) / 264455 / 1000) * 1000);
    // 総額が千円単位なので、端を置く「その他の消費」も含めて千円単位
    for (const c of l1.categories!) expect(c.monthly.value! % 1000, c.category).toBe(0);
    expect(isPureSplit(l1)).toBe(true);
    expect(() => preview(w1.request)).not.toThrow();
  });

  it("費目を直して総額に戻すと、総額＝費目の合計。総額を直してまた費目にすると、差は「その他の消費（まだ分けていない）」に推定で置く", () => {
    let wh = family();
    const id = living(wh).id;
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "byCategory");
    const foodIndex = living(wh).categories!.findIndex((c) => c.category === "food");
    wh = edit(wh, fieldOf(wh, `living/${id}/cat/${foodIndex}`).set(wh, 100000));
    expect(isPureSplit(living(wh))).toBe(false);
    const sum = living(wh).categories!.reduce((s, c) => s + c.monthly.value!, 0);
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "total");
    expect(living(wh).monthly!.value).toBe(sum);
    expect(living(wh).categories).toHaveLength(9);
    wh = edit(wh, fieldOf(wh, `living/${id}/monthly`).set(wh, sum + 20000));
    const otherBefore = living(wh).categories!.find((c) => c.category === "otherConsumption")!.monthly.value!;
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "byCategory");
    const other = living(wh).categories!.find((c) => c.category === "otherConsumption")!;
    expect(other.monthly.value).toBe(otherBefore + 20000);
    expect(other.monthly.state).toBe("estimated");
    expect((other.monthly as { estimate?: { basis: string } }).estimate!.basis).toContain("その他の消費（まだ分けていない）");
    const note = stage(wh)
      .sections.flatMap((s) => s.groups)
      .find((g) => g.key === `living/${id}/categories`)!.note!;
    expect(note).toContain("差の2万円");
  });

  it("簡易の束の合計を直すと、差は束の代表の費目に置き、比例で配り直さない", () => {
    let wh = family();
    const id = living(wh).id;
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "byCategory");
    const before = Object.fromEntries(living(wh).categories!.map((c) => [c.category, c.monthly.value!]));
    const misc = fieldOf(wh, `living/${id}/group/misc`);
    expect(misc.level).toBe("simple");
    expect(misc.help).toContain("75歳以上は1割");
    const total = before.health! + before.otherConsumption! + before.allowance!;
    wh = misc.set(wh, total + 30000);
    const after = Object.fromEntries(living(wh).categories!.map((c) => [c.category, c.monthly.value!]));
    expect(after.health).toBe(before.health);
    expect(after.otherConsumption).toBe(before.otherConsumption! + 30000);
    expect(misc.get(wh).value).toBe(total + 30000);
    expect(misc.get(wh).estimated).toBeNull();
  });

  it("束の「✓ この値で確定」は、束の中の推定の費目を今の値のまま確定にする（行は書かない）", () => {
    let wh = family();
    const id = living(wh).id;
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "byCategory");
    const misc = fieldOf(wh, `living/${id}/group/misc`);
    expect(fieldStatus(misc, wh).status).toBe("estimated");
    const w1 = applyStateOp(wh, misc, "confirm");
    const cs = living(w1).categories!.filter((c) => ["health", "otherConsumption", "allowance"].includes(c.category));
    expect(cs.every((c) => c.monthly.state === "confirmed")).toBe(true);
    expect(living(w1).categories!.find((c) => c.category === "food")!.monthly.state).toBe("estimated");
    expect(fieldStatus(fieldOf(w1, `living/${id}/group/misc`), w1).status).toBe("confirmed");
    expect((living(w1) as { valueStates?: Record<string, unknown> }).valueStates ?? {}).not.toHaveProperty(`livingExpense.categories/${cs[0]!.id}/monthly`);
  });

  it("保健医療の費目に、窓口負担は自動で変えないことと段階で額を変える説明がある", () => {
    let wh = family();
    const id = living(wh).id;
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "byCategory");
    const i = living(wh).categories!.findIndex((c) => c.category === "health");
    const f = fieldOf(wh, `living/${id}/cat/${i}`);
    expect(f.level).toBe("detail");
    expect(f.help).toContain("自動で変えない");
  });
});

describe("区画（0048 の3〜5）", () => {
  it("年払い・数年おきの暮らしの支出: ひな形で足すと基本生活費のカードの行（表の行は基本生活費に含める）、確かめの一覧で「入れた」になる", () => {
    let wh = family();
    const sec = stage(wh).sections.find((s) => s.key === "money/living/out")!;
    expect(sec.title).toBe("年払い・数年おきの暮らしの支出");
    const add = sec.actions.find((a) => a.key === "money/living/out/template/homecoming")!;
    wh = add.run(wh);
    const p = wh.request.input.household.periodicExpenses!.at(-1)!;
    expect(p).toMatchObject({ label: "帰省", kind: "livingAnnual", row: "cf.expense.living", everyYears: 1 });
    expect(p.amount.state).toBe("estimated");
    const sec2 = stage(wh).sections.find((s) => s.key === "money/living/out")!;
    expect(sec2.groups.some((g) => g.key === `ev/${p.id}`)).toBe(true);
    const check = sec2.groups.find((g) => g.key === "living/annual/check")!;
    expect(check.fields.find((f) => f.key === "ro/living/annual/check/homecoming")!.get(wh).value).toContain("入れた");
    // 通院は「医療・介護」の行。表の行は3つから選べ、医療費の説明がある
    const med = check.actions.find((a) => a.key === "living/annual/add/medical")!;
    wh = med.run(wh);
    const m = wh.request.input.household.periodicExpenses!.at(-1)!;
    expect(m.row).toBe("cf.expense.care.medical");
    const row = allFields(stage(wh)).find((f) => f.key === `ev/${m.id}/row`)!;
    expect((row as { options: { value: string }[] }).options.map((o) => o.value)).toEqual(["cf.expense.care.medical", "cf.expense.living", "cf.expense.other"]);
    expect(row.help).toContain("段階");
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("明細の年1回の支払いは、年払いの暮らしの支出の行の候補（車・住まいの修繕は今までどおり）", () => {
    const summary = {
      days: 400,
      from: "2025-09",
      to: "2026-09",
      months: 13,
      review: 0,
      living: [],
      livingTotal: 0,
      oneOffs: [
        { label: "年会費 架空カード", category: "cardFee", amount: 11000, occurrences: [{ date: "2025-10-05", amount: 11000 }, { date: "2026-10-05", amount: 11000 }], annual: { everyYears: 1, confidence: "high" } },
        { label: "架空車検センター", category: "car", amount: 80000, occurrences: [{ date: "2024-11-01", amount: 80000 }, { date: "2026-11-01", amount: 80000 }], annual: { everyYears: 2, confidence: "high" } },
      ],
      reference: {},
    };
    const out = buildCandidates(summary as never, { livingExpenses: [], periodicExpenses: [] }, { ref: "r", baseMonth: BASE, newId: seq() });
    const fee = out.find((c) => c.title.includes("年会費"))!;
    expect(fee.title).toBe("年払いの暮らしの支出: 年会費 架空カード");
    expect(fee.value).toMatchObject({ kind: "livingAnnual", row: "cf.expense.living" });
    const car = out.find((c) => c.title.includes("車検"))!;
    expect((car.value as { kind?: string }).kind).toBeUndefined();
  });

  it("答え合わせ: 実際の年間の貯蓄額を入れると現状の検算の物ができ、空にすると外れる", () => {
    const wh = family();
    const f = fieldOf(wh, "savings/new/actual");
    expect(f.level).toBe("detail");
    const w1 = f.set(wh, 1200000);
    const c = (w1.request.input.household as { savingsChecks?: { year: number; treatment: string; actualSavings: { value: number } }[] }).savingsChecks!;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ year: 2026, treatment: "keepUnexplained", actualSavings: { value: 1200000 } });
    expect(() => preview(w1.request)).not.toThrow();
    const id = (c[0] as unknown as { id: string }).id;
    expect(allFields(stage(w1)).some((x) => x.key === `savings/${id}/treatment`)).toBe(true);
    const w2 = f.set(w1, null);
    expect((w2.request.input.household as { savingsChecks?: unknown }).savingsChecks).toBeUndefined();
  });

  it("黒字の上限は詳細、黒字の行き先と遺族の生活費は読むだけの1行。欄はどれも当て先を持つ（読むだけの行を除く）", () => {
    const wh = family();
    const fields = allFields(stage(wh));
    expect(fields.find((f) => f.key === "living/surplus/cap")!.level).toBe("detail");
    const dest = fields.find((f) => f.key === "ro/living/surplus/destination")!;
    expect(dest.readOnly).toBeDefined();
    expect(dest.get(wh).value).toContain("収支が入る口座");
    const l = living(wh);
    expect(fields.find((f) => f.key === `ro/living/${l.id}/survivor`)!.get(wh).value).toContain("70%");
    for (const f of fields.filter((x) => x.key.startsWith(`living/${l.id}`) && x.readOnly === undefined)) expect(f.address, f.key).toBeDefined();
  });

  it("推定の段の行は値の状態の検査に合う（値のある場所にだけ、外した段は該当なし）", () => {
    let wh = family();
    const l0 = living(wh);
    const i = l0.stages!.findIndex((s) => s.label === "age80");
    const sid = l0.stages![i]!.id!;
    wh = edit(wh, actionOf(wh, `living/${l0.id}/stage/${i}/remove`).run(wh));
    const input = wh.request.input as unknown as Record<string, unknown>;
    expect(rowAt(input, { target: { object: l0.id }, item: "livingExpense.stages", at: [sid] })!.state).toBe("notApplicable");
    expect(rowAt(input, { target: { object: l0.id }, item: "livingExpense.stages", at: [sid, "ratio"] })).toBeUndefined();
  });

  it("世帯ファイルの本文に書いて読み戻しても、推定の段の印と外した段の印はそのまま。行は値のある場所にだけ（外した段は該当なし）", () => {
    let wh = family();
    const l0 = living(wh);
    const i = l0.stages!.findIndex((s) => s.label === "age70");
    wh = edit(wh, actionOf(wh, `living/${l0.id}/stage/${i}/remove`).run(wh));
    const state: BodyState = { wh, workspace: { template: null, band: [], base: CURRENT, selected: CURRENT, shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY };
    const back = fromBody(bodyOf(state)).wh;
    expect(back.request.input.household.livingExpenses).toEqual(wh.request.input.household.livingExpenses);
    const input = back.request.input as unknown as Record<string, unknown>;
    for (const [k, row] of Object.entries((living(back) as { valueStates?: Record<string, { state: string }> }).valueStates ?? {})) {
      const [item, ...at] = k.split("/");
      const v = readAt(input, { target: { object: l0.id }, item: item!, at });
      if (row.state !== "notApplicable") expect(v, k).toBeDefined();
    }
  });
});
