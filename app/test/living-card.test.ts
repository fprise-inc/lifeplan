// 基本生活費のカード（0048）と推定の段階（0049）: 生活費の人数の数え方・推定の段階（新しい世帯だけ自動・推定のままの段だけ入れ直す・
// 直した段は確定・外した段は足し直さない）・総額と内訳の切り替え（両方を持つ・差は「その他」）・10費目の内訳と前の分け方（0100）・年払いの暮らしの支出の区画・
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
import { addAnnual, ANNUAL_TEMPLATES } from "../src/workspace/input/stages/living.ts";
import { applyStateOp, availableOps, fieldStatus } from "../src/workspace/input/valueState.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyOf, EMPTY_CARRY, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { readAt } from "../src/workspace/store/readings.ts";
import { buildCandidates } from "../../statement/src/candidates.ts";
import { renderToString } from "preact-render-to-string";
import { h } from "preact";
import { FieldIcon, hasFieldIcon } from "../src/workspace/input/fieldIcons.tsx";
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
/** 年払いの区画の確かめの一覧のまとまり（ひな形のボタンはどれもこの中。0100 の追記） */
const annualCheck = (wh: WorkingHousehold) => stage(wh).sections.find((s) => s.key === "money/living/out")!.groups.find((g) => g.key === "living/annual/check")!;
const annualBtn = (wh: WorkingHousehold, key: string) => annualCheck(wh).actions.find((a) => a.key === `living/annual/add/${key}`)!;
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
    // 3人（表の額 250,811円）→ 子の独立で2人（227,080円）: 0.91、退職で ×0.8、70歳 ×0.75、80歳 ×0.7（比は表の額のままで出す）
    expect(ratios(wh)).toEqual([
      ["childIndependence", "0.91"],
      ["retirement", "0.72"],
      ["age70", "0.68"],
      ["age80", "0.63"],
    ]);
    expect(householdSize(wh.request.input.household, BASE)).toBe(3);
    // 欄に入れる総額の推定は千円単位
    expect(living(wh).monthly!.value).toBe(251000);
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

describe("総額と内訳（0048 の2・0100）", () => {
  it("内訳で入れるに切り替えると、総額を家計調査の割合で10費目と仕送りに分けた推定（仕送りは0円、合計は総額と同じ）。総額は消さない", () => {
    const wh = family();
    const l = living(wh);
    const mode = fieldOf(wh, `living/${l.id}/mode`);
    const w1 = mode.set(wh, "byCategory");
    const l1 = living(w1);
    expect(l1.mode).toBe("byCategory");
    expect(l1.monthly!.value).toBe(251000);
    expect(l1.categories!.map((c) => c.category)).toEqual(["food", "utilities", "communication", "transit", "furniture", "clothing", "health", "recreation", "pocketAndSocial", "other", "allowance"]);
    expect(l1.categories!.reduce((s, c) => s + c.monthly.value!, 0)).toBe(251000);
    expect(l1.categories!.find((c) => c.category === "allowance")!.monthly.value).toBe(0);
    // 3人の世帯の食料 92,240 ÷ 250,810（10費目の合計）× 251,000 を千円単位に丸めた額（欄は万円の小数1桁で見える）
    expect(l1.categories!.find((c) => c.category === "food")!.monthly.value).toBe(Math.round((251000 * 92240) / 250810 / 1000) * 1000);
    // 総額が千円単位なので、端を置く「その他」も含めて千円単位
    for (const c of l1.categories!) expect(c.monthly.value! % 1000, c.category).toBe(0);
    expect(isPureSplit(l1)).toBe(true);
    expect(() => preview(w1.request)).not.toThrow();
  });

  it("内訳を直して総額に戻すと、総額＝内訳の合計。総額を直してまた内訳にすると、差は「その他（まだ分けていない）」に推定で置く", () => {
    let wh = family();
    const id = living(wh).id;
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "byCategory");
    const foodIndex = living(wh).categories!.findIndex((c) => c.category === "food");
    wh = edit(wh, fieldOf(wh, `living/${id}/cat/${foodIndex}`).set(wh, 100000));
    expect(isPureSplit(living(wh))).toBe(false);
    const sum = living(wh).categories!.reduce((s, c) => s + c.monthly.value!, 0);
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "total");
    expect(living(wh).monthly!.value).toBe(sum);
    expect(living(wh).categories).toHaveLength(11);
    wh = edit(wh, fieldOf(wh, `living/${id}/monthly`).set(wh, sum + 20000));
    const otherBefore = living(wh).categories!.find((c) => c.category === "other")!.monthly.value!;
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "byCategory");
    const other = living(wh).categories!.find((c) => c.category === "other")!;
    expect(other.monthly.value).toBe(otherBefore + 20000);
    expect(other.monthly.state).toBe("estimated");
    expect((other.monthly as { estimate?: { basis: string } }).estimate!.basis).toContain("その他（まだ分けていない）");
    const note = stage(wh)
      .sections.flatMap((s) => s.groups)
      .find((g) => g.key === `living/${id}/categories`)!.note!;
    expect(note).toContain("差の2万円");
  });

  it("内訳は束にまとめず、10費目と仕送りを全部、標準で並べる（「詳しく」に畳まない）。「わからない」は出さない", () => {
    let wh = family();
    const id = living(wh).id;
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "byCategory");
    const rows = allFields(stage(wh)).filter((f) => f.item === "livingExpense.categories");
    expect(rows.map((f) => f.label)).toEqual(["食費", "水道・光熱費", "通信費", "交通費", "日用品", "被服・美容", "医療費", "趣味・娯楽", "こづかい・交際費", "その他", "仕送り"]);
    expect(rows.every((f) => f.level === "simple")).toBe(true);
    expect(rows.some((f) => f.key.includes("/group/"))).toBe(false);
    const group = stage(wh)
      .sections.flatMap((s) => s.groups)
      .find((g) => g.key === `living/${id}/categories`)!;
    expect(group.level).toBe("simple");
    for (const f of rows) expect(availableOps(f, wh)).not.toContain("unknown");
    expect(availableOps(fieldOf(wh, `living/${id}/cat/0`), wh)).toContain("confirm");
  });

  it("年払い・数年おきの暮らしの支出（行の種類 livingAnnual）の額にも「わからない」を出さない（ひな形の目安の推定のまま）", () => {
    const wh = edit(family(), addAnnual(family(), ANNUAL_TEMPLATES[0]!));
    const amount = allFields(stage(wh)).filter((f) => f.item === "periodicExpense.amount");
    expect(amount.length).toBeGreaterThan(0);
    for (const f of amount) expect(availableOps(f, wh)).not.toContain("unknown");
  });

  it("交通費の説明に、ガソリン・駐車場などは車の入力項目で入れることと、カーシェア・レンタカーはここに入れること。日用品は家電・家具の買い替えを年払いで", () => {
    let wh = family();
    const id = living(wh).id;
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "byCategory");
    const help = (c: string) => fieldOf(wh, `living/${id}/cat/${living(wh).categories!.findIndex((x) => x.category === c)}`).help ?? "";
    expect(help("transit")).toContain("ガソリン・駐車場・高速代・車の保険などは「車」の入力項目で入れます");
    expect(help("transit")).toContain("カーシェア・レンタカー");
    expect(help("furniture")).toContain("家電・家具の買い替え");
    expect(help("communication")).toContain("スマホ・固定電話・ネット回線");
    expect(help("communication")).not.toContain("趣味・娯楽の中");
    expect(help("recreation")).toContain("ネット回線の料金は「通信費」で入れます");
    expect(help("recreation")).toContain("習い事の月謝");
    expect(help("other")).toContain("掛け捨ての保険料");
    expect(help("other")).toContain("保育の費用");
  });

  it("保健医療の内訳に、窓口負担は自動で変えないことと段階で額を変える説明がある", () => {
    let wh = family();
    const id = living(wh).id;
    wh = fieldOf(wh, `living/${id}/mode`).set(wh, "byCategory");
    const i = living(wh).categories!.findIndex((c) => c.category === "health");
    const f = fieldOf(wh, `living/${id}/cat/${i}`);
    expect(f.level).toBe("simple");
    expect(f.help).toContain("自動で変えない");
  });
});

describe("前の分け方の内訳（0.42 までの世帯。0100）", () => {
  /** 前の分け方の9費目で確定の値を入れた世帯 */
  const oldConfirmed = (): WorkingHousehold => {
    const wh = family();
    return mutate(wh, (h) => {
      const l = h.livingExpenses![0]!;
      l.mode = "byCategory";
      const conf = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });
      l.categories = [
        { id: "00000000-0000-4000-8000-00000000c001", category: "food", monthly: conf(90000) },
        { id: "00000000-0000-4000-8000-00000000c002", category: "transport", monthly: conf(30000) },
        { id: "00000000-0000-4000-8000-00000000c003", category: "otherConsumption", monthly: conf(50000) },
      ] as typeof l.categories;
    });
  };

  it("確定の交通・通信とその他の消費は書き換えず、前の名前で出す（計算もそのまま）", () => {
    const wh = edit(oldConfirmed(), oldConfirmed());
    const l = living(wh);
    expect(l.categories!.map((c) => [c.category, c.monthly.value, c.monthly.state])).toEqual([
      ["food", 90000, "confirmed"],
      ["transport", 30000, "confirmed"],
      ["otherConsumption", 50000, "confirmed"],
    ]);
    const labels = allFields(stage(wh))
      .filter((f) => f.item === "livingExpense.categories")
      .map((f) => f.label);
    expect(labels).toContain("交通・通信費");
    expect(labels).toContain("その他の消費（こづかい・交際費など）");
    expect(labels.indexOf("交通・通信費")).toBe(labels.indexOf("交通費") + 1);
    expect(labels.indexOf("その他の消費（こづかい・交際費など）")).toBe(labels.indexOf("その他") + 1);
    const before = preview(wh.request);
    expect(before).toBeDefined();
  });

  it("「交通と通信に分ける」: 確定の交通・通信を統計の割合で交通費と通信費に分け、推定の印を付ける。合計は変えない", () => {
    const wh = oldConfirmed();
    const id = living(wh).id;
    const act = actionOf(wh, `living/${id}/splitTransport`);
    expect(act.label).toBe("交通と通信に分ける");
    const w1 = edit(wh, act.run(wh));
    const cs = living(w1).categories!;
    expect(cs.some((c) => c.category === "transport")).toBe(false);
    const transit = cs.find((c) => c.category === "transit")!;
    const comm = cs.find((c) => c.category === "communication")!;
    expect(transit.monthly.value! + comm.monthly.value!).toBe(30000);
    // 3人の世帯の交通 6,239・通信 15,392（インターネット接続料を含む）の割合（交通は千円単位）
    expect(transit.monthly.value).toBe(Math.round((30000 * 6239) / (6239 + 15392) / 1000) * 1000);
    expect(transit.monthly.state).toBe("estimated");
    expect(comm.monthly.state).toBe("estimated");
    expect(transit.id).toBe("00000000-0000-4000-8000-00000000c002");
    expect(cs.reduce((s, c) => s + c.monthly.value!, 0)).toBe(170000);
    // 分けた後はボタンを出さない。推定の交通・通信にも出さない
    expect(() => actionOf(w1, `living/${id}/splitTransport`)).toThrow();
  });

  it("前の分け方の按分のまま（推定）の内訳は、入れ直しで今の分け方に分け直す（総額が FP の値なら合計は変えない）", () => {
    const wh = family();
    const old = mutate(wh, (h) => {
      const l = h.livingExpenses![0]!;
      l.mode = "byCategory";
      l.monthly = { value: 300000, state: "confirmed", origin: { kind: "manual" } };
      const est = (value: number) => ({ value, state: "estimated" as const, origin: { kind: "auto" as const }, estimate: { method: "derived", basis: "総額を内訳に分けた目安（前の版）" } });
      const cats = ["food", "utilities", "furniture", "clothing", "health", "transport", "recreation", "otherConsumption", "allowance"];
      l.categories = cats.map((category, i) => ({ id: `00000000-0000-4000-8000-0000000007${String(i).padStart(2, "0")}`, category, monthly: est(category === "allowance" ? 0 : category === "otherConsumption" ? 300000 - 7 * 30000 : 30000) })) as typeof l.categories;
    });
    const w1 = edit(old, old);
    const cs = living(w1).categories!;
    expect(cs.map((c) => c.category)).toEqual(["food", "utilities", "communication", "transit", "furniture", "clothing", "health", "recreation", "pocketAndSocial", "other", "allowance"]);
    expect(cs.reduce((s, c) => s + c.monthly.value!, 0)).toBe(300000);
    expect(isPureSplit(living(w1))).toBe(true);
    expect(cs.find((c) => c.category === "other")!.id).toBe("00000000-0000-4000-8000-000000000707");
  });
});

describe("時期・何年ごとを変えたときの額（0100 の追記）", () => {
  const added = (wh: WorkingHousehold) => wh.request.input.household.periodicExpenses!.at(-1)!;
  const amountOf = (wh: WorkingHousehold) => added(wh).amount as { value: number; state: string; estimate?: { basis: string } };
  it("推定の額（通院・歯の治療 年5万円）は、毎月にすると年あたりが同じ月額（100円の単位）に直し、推定の印のまま。年ごとに戻すと千円の単位で戻る", () => {
    let wh = annualBtn(family(), "medical").run(family());
    const id = added(wh).id;
    wh = fieldOf(wh, `ev/${id}/cadence`).set(wh, "monthly");
    expect(amountOf(wh)).toMatchObject({ value: 4200, state: "estimated" });
    expect(amountOf(wh).estimate!.basis).toContain("時期に合わせて直した額。元は年額");
    expect(fieldStatus(fieldOf(wh, `ev/${id}/amount`), wh).status).toBe("estimated");
    wh = fieldOf(wh, `ev/${id}/cadence`).set(wh, "repeat");
    // 元の時期に戻すと、額も根拠も元のまま
    expect(amountOf(wh)).toMatchObject({ value: 50000, state: "estimated" });
    expect(amountOf(wh).estimate!.basis).not.toContain("時期に合わせて直した額");
    // 1回にすると年あたりが無いので変えない
    const once = fieldOf(wh, `ev/${id}/cadence`).set(wh, "once");
    expect(amountOf(once).value).toBe(50000);
  });

  it("推定の額は、何年ごとを変えても年あたりが同じになるよう直す（家電・家具 8年ごとに40万円 → 10年ごとに50万円）", () => {
    let wh = annualBtn(family(), "appliances").run(family());
    const id = added(wh).id;
    wh = fieldOf(wh, `ev/${id}/every`).set(wh, 10);
    expect(added(wh).everyYears).toBe(10);
    expect(amountOf(wh)).toMatchObject({ value: 500000, state: "estimated" });
  });

  it("FP が入れた額は、時期（毎月 ↔ 年ごと）を変えたときだけ年あたりが同じになるよう直し、欄の下に1行の知らせ。何年ごとだけを変えたときは変えない。打ち直すと知らせは消える", () => {
    let wh = annualBtn(family(), "fees").run(family());
    const id = added(wh).id;
    wh = fieldOf(wh, `ev/${id}/amount`).set(wh, 120000);
    expect(amountOf(wh).state).toBe("confirmed");
    wh = fieldOf(wh, `ev/${id}/cadence`).set(wh, "monthly");
    expect(amountOf(wh)).toMatchObject({ value: 10000, state: "confirmed" });
    const amount = fieldOf(wh, `ev/${id}/amount`);
    expect(amount.get(wh).hint).toContain("年額 12万円を月額に直しました");
    const typed = amount.set(wh, 9000);
    expect(fieldOf(typed, `ev/${id}/amount`).get(typed).hint ?? null).toBeNull();
    // 何年ごとだけ（FP の額）: 1回あたりの額のまま
    let w2 = fieldOf(wh, `ev/${id}/cadence`).set(wh, "repeat");
    expect(amountOf(w2).value).toBe(120000);
    w2 = fieldOf(w2, `ev/${id}/amount`).set(w2, 100000);
    w2 = fieldOf(w2, `ev/${id}/every`).set(w2, 3);
    expect(amountOf(w2)).toMatchObject({ value: 100000, state: "confirmed" });
    expect(() => preview(w2.request)).not.toThrow();
  });
});

describe("毎月の生活費の始まり・終わり（0100 の追記）", () => {
  const keys = (wh: WorkingHousehold) => allFields(stage(wh)).map((f) => f.item);
  it("毎月の生活費が1つなら、始まり・終わりの欄を出さない。2つ以上なら、どれにも出す", () => {
    const wh = family();
    expect(keys(wh)).not.toContain("livingExpense.from");
    expect(keys(wh)).not.toContain("livingExpense.to");
    const two = mutate(wh, (h) => void h.livingExpenses!.push({ ...structuredClone(h.livingExpenses![0]!), id: "00000000-0000-4000-8000-00000000f0f0", from: { at: "2040-04" } }));
    const fs = allFields(stage(two));
    expect(fs.filter((f) => f.item === "livingExpense.from")).toHaveLength(2);
    expect(fs.filter((f) => f.item === "livingExpense.to")).toHaveLength(2);
  });
  it("1つでも、前に値を入れた欄は出す（結果に効く値を隠さない）。「最後まで」（null）は値に数えない", () => {
    const wh = mutate(family(), (h) => {
      h.livingExpenses![0]!.to = { at: "2050-03" };
    });
    expect(keys(wh)).toContain("livingExpense.to");
    expect(keys(wh)).not.toContain("livingExpense.from");
    const open = mutate(family(), (h) => {
      h.livingExpenses![0]!.to = null;
    });
    expect(keys(open)).not.toContain("livingExpense.to");
  });
});

describe("区画（0048 の3〜5）", () => {
  it("年払い・数年おきの暮らしの支出: ひな形で足すと基本生活費のカードの行（表の行は基本生活費に含める）、確かめの一覧で「入れた」になる", () => {
    let wh = family();
    const sec = stage(wh).sections.find((s) => s.key === "money/living/out")!;
    expect(sec.title).toBe("年払い・数年おきの暮らしの支出");
    const add = annualBtn(wh, "homecoming");
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

  it("年払いのひな形のボタンは名前だけ（額を出さない）。足した行の額と何年ごとは推定で、根拠はよくある目安。この値にするで確定", () => {
    let wh = family();
    // どのボタンも確かめの一覧のまとまりの中（標準と詳細で同じ）。区画の下のボタンは無い。旅行はライフイベントの家族旅行で入れるので無い
    const sec = stage(wh).sections.find((s) => s.key === "money/living/out")!;
    expect(sec.actions).toEqual([]);
    const all = ["＋ 通院・歯の治療", "＋ ペットの医療", "＋ 帰省", "＋ 家電・家具の買い替え", "＋ 年会費・サブスクの年払い", "＋ スマホの買い替え", "＋ パソコンの買い替え", "＋ その他の年払い・数年おきの支出"];
    expect(annualCheck(wh).actions.map((a) => a.label)).toEqual(all);
    expect(annualCheck(wh).level).toBe("simple");
    expect(annualCheck(wh).actions.every((a) => a.level === "simple")).toBe(true);
    expect(annualCheck(wh).actions.every((a) => !/[（(]/u.test(a.label))).toBe(true);
    wh = annualBtn(wh, "appliances").run(wh);
    const p = wh.request.input.household.periodicExpenses!.at(-1)!;
    expect(p).toMatchObject({ label: "家電・家具の買い替え", everyYears: 8, amount: { value: 400000, state: "estimated", estimate: { method: "standard" } } });
    const amount = fieldOf(wh, `ev/${p.id}/amount`);
    const every = fieldOf(wh, `ev/${p.id}/every`);
    expect(fieldStatus(amount, wh)).toMatchObject({ status: "estimated", basis: "よくある額の目安（家電・家具の買い替え 8年ごとに40万円。この世帯に合わせて直してください）" });
    expect(fieldStatus(every, wh)).toMatchObject({ status: "estimated", basis: "よくある間隔の目安（家電・家具の買い替え 8年ごと。この世帯に合わせて直してください）" });
    // 足した物のボタンは「入れた」の行になる。冠婚葬祭・お年玉は一覧に置かない（毎月の「こづかい・交際費」と重なりやすい）。ほかの入力項目で入れる物の読むだけの行も無い
    const check = annualCheck(wh);
    expect(check.actions.map((a) => a.label)).toEqual(all.filter((l) => l !== "＋ 家電・家具の買い替え"));
    expect(check.fields.map((f) => f.key)).toEqual(["ro/living/annual/check/appliances"]);
    expect(check.fields.some((f) => /ceremonies|gifts|propertyTax|car|insurance/u.test(f.key))).toBe(false);
    // 保存して開き直しても何年ごとの推定の印が残る（物の値の状態の欄の推定の行）
    const state: BodyState = { wh, workspace: { template: null, band: [], base: CURRENT, selected: CURRENT, shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY };
    const back = fromBody(bodyOf(state)).wh;
    expect(back.assumed[`ev/${p.id}/every`]).toBe(wh.assumed[`ev/${p.id}/every`]);
    expect(fieldStatus(fieldOf(back, `ev/${p.id}/amount`), back).status).toBe("estimated");
    // 「この値にする」で確定（値はそのまま）
    const w1 = applyStateOp(wh, every, "confirm");
    expect(fieldStatus(fieldOf(w1, `ev/${p.id}/every`), w1).status).toBe("confirmed");
    expect(w1.request.input.household.periodicExpenses!.at(-1)!.everyYears).toBe(8);
    const w2 = applyStateOp(w1, fieldOf(w1, `ev/${p.id}/amount`), "confirm");
    expect(w2.request.input.household.periodicExpenses!.at(-1)!.amount).toMatchObject({ value: 400000, state: "confirmed" });
    // 何年ごとを直すと推定の印が外れる
    const w3 = every.set(wh, 6);
    expect(w3.assumed[`ev/${p.id}/every`]).toBeUndefined();
    expect(fieldStatus(fieldOf(w3, `ev/${p.id}/every`), w3).status).toBe("confirmed");
    // 時期を毎月・1回にすると何年ごとの欄は消えるので、印も外す
    const w4 = fieldOf(wh, `ev/${p.id}/cadence`).set(wh, "monthly");
    expect(w4.assumed[`ev/${p.id}/every`]).toBeUndefined();
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("スマホは1台分（4年ごとに12万円）、パソコンは5年ごとに15万円。家具だけの古い行も家電・家具の買い替えとして「入れた」", () => {
    let wh = family();
    const phone = annualBtn(wh, "smartphone");
    expect(phone.help).toContain("1台分");
    wh = phone.run(wh);
    const p = wh.request.input.household.periodicExpenses!.at(-1)!;
    expect(p).toMatchObject({ label: "スマホの買い替え", everyYears: 4, amount: { value: 120000 } });
    expect(fieldStatus(fieldOf(wh, `ev/${p.id}/amount`), wh).basis).toBe("よくある額の目安（スマホの買い替え 1台 4年ごとに12万円。この世帯に合わせて直してください）");
    wh = annualBtn(wh, "pc").run(wh);
    expect(wh.request.input.household.periodicExpenses!.at(-1)!).toMatchObject({ label: "パソコンの買い替え", everyYears: 5, amount: { value: 150000 } });
    // 前に足した「家具の買い替え」の行だけでも、家電・家具の買い替えは入れた
    let w2 = family();
    w2 = annualBtn(w2, "homecoming").run(w2);
    const id = w2.request.input.household.periodicExpenses!.at(-1)!.id;
    w2 = fieldOf(w2, `ev/${id}/label`).set(w2, "家具の買い替え");
    const check = stage(w2).sections.find((s) => s.key === "money/living/out")!.groups.find((g) => g.key === "living/annual/check")!;
    expect(check.fields.find((f) => f.key === "ro/living/annual/check/appliances")!.get(w2).value).toContain("入れた（家具の買い替え）");
    // 前に入れた「冠婚葬祭」の行は、ふつうの行のまま（確かめの一覧には出さない）
    w2 = fieldOf(w2, `ev/${id}/label`).set(w2, "冠婚葬祭のつきあい");
    const sec2 = stage(w2).sections.find((s) => s.key === "money/living/out")!;
    expect(sec2.groups.some((g) => g.key === `ev/${id}`)).toBe(true);
    expect(sec2.groups.find((g) => g.key === "living/annual/check")!.fields.some((f) => f.get(w2).value === "入れた（冠婚葬祭のつきあい）")).toBe(false);
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("明細の年1回の支払いは、年払いの暮らしの支出の行の候補（車は車の入力項目、住まいの修繕は住まいの入力項目の行）", () => {
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
    // 車の候補は車の入力項目の「車の修理・用品など」の行（種類 car。ライフイベントには出さない）
    const car = out.find((c) => c.title.includes("車検"))!;
    expect(car.value).toMatchObject({ kind: "car", row: "cf.expense.lumpSum.car" });
    expect(car.title).toBe("車の修理・用品など: 架空車検センター");
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

describe("入れ方の言葉と内訳の行のアイコン", () => {
  it("入れ方は「総額で／内訳で」。値は total・byCategory のまま。まとまりの名前は「内訳（月額）」", () => {
    const wh = family();
    const l = living(wh);
    const mode = fieldOf(wh, `living/${l.id}/mode`);
    expect(mode.kind === "select" ? mode.options : []).toEqual([
      { value: "total", label: "総額で" },
      { value: "byCategory", label: "内訳で" },
    ]);
    const w1 = mode.set(wh, "byCategory");
    expect(living(w1).mode).toBe("byCategory");
    const titles = stage(w1).sections.flatMap((x) => x.groups.map((g) => g.title ?? ""));
    expect(titles).toContain("内訳（月額）");
    expect(titles.some((t) => t.includes("費目"))).toBe(false);
    // 新しく作る按分の根拠も「内訳」の言い方
    expect(living(w1).categories!.every((c) => ((c.monthly as { estimate?: { basis?: string } }).estimate?.basis ?? "").startsWith("総額を内訳に分けた目安"))).toBe(true);
  });

  it("内訳の行（10費目と仕送り、前の分け方の2つ）すべてに名前の左のアイコンがある。名前は文字だけ", () => {
    const wh = family();
    const w1 = fieldOf(wh, `living/${living(wh).id}/mode`).set(wh, "byCategory");
    const rows = allFields(stage(w1)).filter((f) => f.item === "livingExpense.categories");
    expect(rows.map((f) => f.icon)).toEqual(["food", "utilities", "communication", "transit", "furniture", "clothing", "health", "recreation", "pocketAndSocial", "other", "allowance"]);
    for (const f of rows) expect(hasFieldIcon(f.icon ?? "")).toBe(true);
    for (const f of rows) expect(f.label).not.toMatch(/[<>]/);
    for (const old of ["transit", "otherConsumption"]) expect(hasFieldIcon(old)).toBe(true);
  });

  it("アイコンは読み上げない（aria-hidden）。大きさは文字に合わせる（em）。知らない名前は何も出さない", () => {
    const html = renderToString(h(FieldIcon, { name: "food" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).toContain('class="fld-icon"');
    expect(html).not.toMatch(/ (width|height)="/);
    expect(renderToString(h(FieldIcon, { name: "nope" }))).toBe("");
  });

  it("前の言い方の按分の推定（総額を費目に分けた目安）も、按分のままと読む（書き換えない）", () => {
    const wh = family();
    const w1 = fieldOf(wh, `living/${living(wh).id}/mode`).set(wh, "byCategory");
    const old = mutate(w1, (hh) => {
      for (const c of hh.livingExpenses![0]!.categories!) {
        const e = (c.monthly as { estimate?: { basis?: string } }).estimate!;
        e.basis = e.basis!.replace("総額を内訳に分けた目安", "総額を費目に分けた目安");
      }
    });
    expect(isPureSplit(living(old))).toBe(true);
    expect(((living(old).categories![0]!.monthly as { estimate?: { basis?: string } }).estimate?.basis ?? "")).toMatch(/^総額を費目に分けた目安/);
  });
});
