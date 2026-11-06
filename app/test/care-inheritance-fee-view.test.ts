// 介護・親・相続・贈与・FP顧問料・事務所の既定値の見せ方（0143）: ご本人・配偶者の介護を入れないと決めるのは明示の操作だけ・世帯の外の家族の標準の欄・
// 親とのお金の行を標準に・75歳からの扶養と健康保険・親の年金の欄・同居と家計を1つにする・どちらの親かのボタン・介護の見出し・扶養の境目の「?」・
// 相続の相手の親を足す・見込みと「計算に入れる」・相続税の目安の空欄・相続人がいないとき・FP顧問料の言葉と外すボタン・探して開く・事務所の推定の値の一覧
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { PreviewResult } from "../src/engine/types.ts";
import { ADULT_CARE_NONE, deathEstimate, gapsOf } from "../src/workspace/input/fill.ts";
import { allFields, resolveTimepoint, type ActionDef, type FieldDef, type GroupDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { inheritanceView, NO_HEIRS_HINT } from "../src/workspace/input/inheritanceLine.ts";
import { findEntries, findInInput } from "../src/workspace/input/inputSearch.ts";
import { inputItems, saveItem } from "../src/workspace/input/items.ts";
import { addOutside, addParentsOf, careSpan, joinHousehold } from "../src/workspace/input/stages/care.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { INHERIT_AFTER_MONTHS } from "../src/workspace/input/stages/inheritance.ts";
import { donorOptions, memberLabel as memberLabelOf } from "../src/workspace/input/labels.ts";
import { addAdvisoryFee } from "../src/workspace/input/stages/fees.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { addMonths } from "../src/workspace/levers.ts";
import { EstimatesSection } from "../src/workspace/office/EstimatesSection.tsx";
import { EMPTY_ESTIMATES } from "../src/workspace/office/estimates.ts";
import { estimateEntries } from "../src/workspace/office/estimateCatalog.ts";
import { modelHousehold } from "./helpers.ts";

const BASE = "2026-10";
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const open = (id: string) => fromRequest(modelHousehold(id));
const hh = (wh: WorkingHousehold) => wh.request.input.household;
const stage = (id: Parameters<typeof buildStage>[0], wh: WorkingHousehold): StageDef => buildStage(id, wh) as StageDef;
const fieldOf = (id: Parameters<typeof buildStage>[0], wh: WorkingHousehold, key: string): FieldDef | undefined => allFields(stage(id, wh)).find((f) => f.key === key);
const groupsOf = (id: Parameters<typeof buildStage>[0], wh: WorkingHousehold): GroupDef[] => stage(id, wh).sections.flatMap((s) => s.groups);
const actionsOf = (id: Parameters<typeof buildStage>[0], wh: WorkingHousehold): ActionDef[] => stage(id, wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
const actionOf = (id: Parameters<typeof buildStage>[0], wh: WorkingHousehold, key: string): ActionDef => {
  const a = actionsOf(id, wh).find((x) => x.key === key);
  if (a === undefined) throw new Error(`no action ${key}`);
  return a;
};
const parents = (wh: WorkingHousehold) => hh(wh).members.filter((m) => m.kind === "parent");
const couple = () => addMember(blankHousehold(BASE, seq()), "spouse");

describe("ご本人・配偶者の介護を「入れない」と決めるのは、明示の操作だけ（保存では決めない）", () => {
  it("母の介護を足して介護・親の項目を保存しても、ご本人・配偶者の介護の未入力は残る", () => {
    let wh = couple();
    wh = addOutside(wh, "parent", { sex: "female" });
    const mother = parents(wh)[0]!;
    wh = actionOf("care", wh, `family/${mother.id}/care/estimate`).run(wh);
    const saved = saveItem(wh, "care");
    const gaps = gapsOf(saved).filter((g) => g.card === "care");
    expect(gaps.map((g) => g.label)).toEqual(["ご本人の介護の費用", "配偶者の介護の費用"]);
    // 入力のホームの札も、未入力が残る（推定で計算中にしない）
    expect(inputItems(saved).find((i) => i.id === "care")!.missing).toBeGreaterThan(0);
    // 区画の説明にも残る
    expect(stage("care", saved).sections.find((s) => s.key === "care/costs")!.note).toContain("0円で計算しています");
  });

  it("帯の「該当なし（介護の費用を入れない）」・区画の「…の介護は入れない」で決めると消え、もう一度保存しても戻らない", () => {
    const wh = couple();
    const band = gapsOf(wh).find((g) => g.card === "care")!;
    const byBand = band.none!(wh);
    expect(byBand.confirmed).toContain(ADULT_CARE_NONE);
    expect(gapsOf(byBand).filter((g) => g.card === "care")).toEqual([]);
    expect(gapsOf(saveItem(byBand, "care")).filter((g) => g.card === "care")).toEqual([]);
    const bySection = actionOf("care", wh, "care/declineAdults").run(wh);
    expect(gapsOf(bySection).filter((g) => g.card === "care")).toEqual([]);
    // 決めた後は区画の「入れない」は出さない（推定で入れるは残す）
    expect(actionsOf("care", bySection).map((a) => a.key)).not.toContain("care/declineAdults");
    expect(actionsOf("care", bySection).map((a) => a.key)).toContain("care/fillAdults");
  });

  it("前の版で項目を保存しただけの世帯（印が「care」だけ）は、未入力に戻る", () => {
    const wh = { ...couple(), confirmed: ["care"] };
    expect(gapsOf(wh).filter((g) => g.card === "care")).toHaveLength(2);
  });

  it("推定を入れる操作の言葉は「…の介護を推定で入れる」（人の名前を入れる）", () => {
    let wh = couple();
    expect(actionOf("care", wh, "care/fillAdults").label).toBe("ご本人・配偶者の介護を推定で入れる");
    wh = addOutside(wh, "parent", { sex: "male" });
    const father = parents(wh)[0]!;
    expect(actionOf("care", wh, `family/${father.id}/care/estimate`).label).toBe("＋ 父の介護を推定で入れる");
  });
});

describe("世帯の外の家族の欄", () => {
  it("標準は誰の家族か・生年月・同居の3欄、続柄・呼び名は詳細。見出しは「義母（67歳）」の形", () => {
    const w0 = couple();
    const wh = addParentsOf(w0, hh(w0).members.find((m) => m.kind === "spouse")!.id);
    const mother = parents(wh).find((m) => m.sex === "female")!;
    const g = groupsOf("care", wh).find((x) => x.key === `family/${mother.id}`)!;
    expect(g.fields.filter((f) => f.level === "simple").map((f) => f.key.split("/").slice(2).join("/"))).toEqual(["outside/of", "birth", "cohabiting"]);
    expect(g.title).toMatch(/^義母（\d+歳）$/);
    // 呼び名の入力例は続柄と誰の家族かから（父の欄に「ご本人の母」と出さない）
    expect(fieldOf("care", wh, `family/${mother.id}/nickname`)!.example).toBe("例: 義母（遠方）");
    const own = addOutside(couple(), "parent", { sex: "male" });
    expect(fieldOf("care", own, `family/${parents(own)[0]!.id}/nickname`)!.example).toBe("例: 実家の父");
    // 「誰の家族か」は「ご本人の」「配偶者の」
    const of = fieldOf("care", wh, `family/${mother.id}/outside/of`)!;
    expect(of.kind === "select" ? of.options.map((o) => o.label) : []).toEqual(["ご本人の", "配偶者の"]);
  });

  it("生年月を直すと、推定のままの亡くなる見込みを新しい年齢の平均余命で入れ直す（FP が入れた見込みは変えない）", () => {
    let wh = addOutside(couple(), "parent", { sex: "male" });
    const p = parents(wh)[0]!;
    wh = fieldOf("care", wh, `family/${p.id}/birth`)!.set(wh, "1934-04");
    const est = deathEstimate(hh(wh).members.find((m) => m.id === p.id)!, BASE)!;
    expect(hh(wh).members.find((m) => m.id === p.id)!.leaves).toEqual(est.point);
    expect(resolveTimepoint(hh(wh), est.point)! > BASE).toBe(true);
    expect(wh.assumed[`family/${p.id}/leaves`]).toBeDefined();
    // FP が入れた見込みは、生年月を直しても動かさない
    const fixed = fieldOf("care", wh, `family/${p.id}/leaves`)!.time!.setWhen(wh, { memberAge: { member: p.id, years: 99 } }, "auto");
    const moved = fieldOf("care", fixed, `family/${p.id}/birth`)!.set(fixed, "1936-04");
    expect(hh(moved).members.find((m) => m.id === p.id)!.leaves).toEqual({ memberAge: { member: p.id, years: 99 } });
  });

  it("75歳からは健康保険の扶養に入れないので、扶養の印は「扶養している（税）」、勤め先の健康保険の欄は出さない", () => {
    const wh = open("parentCare");
    const p = parents(wh)[0]!;
    expect(fieldOf("care", wh, `family/${p.id}/dependent`)!.label).toBe("扶養している（税）");
    expect(fieldOf("care", wh, `family/${p.id}/outside/employeeInsurance`)).toBeUndefined();
    // 75歳より若い親には出す
    const young = mutate(wh, (x) => void (x.members.find((m) => m.id === p.id)!.birth.birthYearMonth = "1958-04"));
    expect(fieldOf("care", young, `family/${p.id}/dependent`)!.label).toBe("扶養している（税・健康保険）");
    expect(fieldOf("care", young, `family/${p.id}/outside/employeeInsurance`)).toBeDefined();
    // 前に印を付けた人は残す（黙って消さない）
    const marked = mutate(wh, (x) => void (x.members.find((m) => m.id === p.id)!.outside!.employeeInsurance = true));
    expect(fieldOf("care", marked, `family/${p.id}/outside/employeeInsurance`)).toBeDefined();
  });

  it("扶養の境目は欄に短い1行、全文は「?」の中", () => {
    const wh = open("parentCare");
    const p = parents(wh)[0]!;
    const line = fieldOf("care", wh, `ro/care/outside/${p.id}/dependentLimit`)!;
    expect(String(line.get(wh).value).length).toBeLessThan(30);
    expect(line.help).toContain("後期高齢者医療");
  });

  it("この人の年金（年額）は人の詳細の欄（親のお金の区画には出さない）。親のお金を見るのをやめても年金は残る", () => {
    let wh = open("parentCare");
    const p = parents(wh)[0]!;
    const g = groupsOf("care", wh).find((x) => x.key === `family/${p.id}`)!;
    const pension = g.fields.find((f) => f.key === `family/${p.id}/wallet/pension`)!;
    expect(pension.level).toBe("detail");
    expect(pension.label).toBe("この人の年金（年額）");
    wh = pension.set(wh, 1200000);
    // 年金を入れると扶養の境目の1行がその額と比べる
    expect(String(fieldOf("care", wh, `ro/care/outside/${p.id}/dependentLimit`)!.get(wh).value)).toBe("年金 年120万円は、税の扶養の範囲です");
    // 年金だけなら親のお金の区画に年金の欄は無く、外すボタンも無い
    const walletSec = () => stage("care", wh).sections.find((s) => s.key === "care/wallet")!;
    expect(walletSec().groups.flatMap((x) => x.fields).some((f) => f.key.endsWith("/wallet/pension"))).toBe(false);
    expect(walletSec().groups.flatMap((x) => x.actions).some((a) => a.key === `family/${p.id}/wallet/remove`)).toBe(false);
    // 預金を入れてから「見るのをやめる」と、年金だけ残る
    wh = fieldOf("care", wh, `family/${p.id}/wallet/balance`)!.set(wh, 3000000);
    wh = walletSec().groups.flatMap((x) => x.actions).find((a) => a.key === `family/${p.id}/wallet/remove`)!.run(wh);
    expect(hh(wh).members.find((m) => m.id === p.id)!.wallet).toEqual({ pension: expect.objectContaining({ value: 1200000 }) });
  });

  it("同居の印を付けたら欄の下に1行と「＋ 家計を1つにする」。押すと今から最後まで、生活費の人数と収入を世帯に入れる期間ができる", () => {
    const wh = open("parentCare");
    const p = parents(wh)[0]!;
    expect(fieldOf("care", wh, `family/${p.id}/cohabiting`)!.get(wh).hint).toContain("同居でも家計は別として計算します");
    const join = actionOf("care", wh, `family/${p.id}/outside/join`);
    expect(join.level).toBe("simple");
    const joined = join.run(wh);
    expect(hh(joined).members.find((m) => m.id === p.id)!.outside!.periods).toEqual([expect.objectContaining({ from: { at: BASE }, to: null, living: true, income: true })]);
    expect(joinHousehold(joined, p.id)).toBe(joined);
    // 期間ができたら1行もボタンも出さない
    expect(fieldOf("care", joined, `family/${p.id}/cohabiting`)!.get(joined).hint ?? null).toBeNull();
    expect(actionsOf("care", joined).map((a) => a.key)).not.toContain(`family/${p.id}/outside/join`);
  });

  it("親を足すのは「＋ ご本人の親を足す」「＋ 配偶者の親を足す」（配偶者がいなければ「＋ 親を足す」）。押すと「父」「母」「父母」から選ぶ。いる方は出さない", () => {
    const wh = couple();
    const self = hh(wh).members.find((m) => m.kind === "self")!;
    const spouse = hh(wh).members.find((m) => m.kind === "spouse")!;
    const adds = actionsOf("care", wh).filter((a) => a.choice?.key.startsWith("care/add/parents/") === true);
    // 1つの「＋」の選択肢（0040 の追記）。ボタンの名前は choice の label、選択肢はそれぞれの label
    expect([...new Set(adds.map((a) => a.choice!.label))]).toEqual(["＋ ご本人の親を足す", "＋ 配偶者の親を足す"]);
    expect(adds.filter((a) => a.choice!.key === "care/add/parents/self").map((a) => a.label)).toEqual(["父", "母", "父母"]);
    expect(actionsOf("care", wh).map((a) => a.key)).not.toContain("care/add/bothParents");
    // 母だけを1押しで（足してから外す手数が無い）
    const mother = adds.find((a) => a.choice!.key === "care/add/parents/spouse" && a.label === "母")!.run(wh);
    expect(parents(mother).map((m) => [m.sex, m.outside?.of])).toEqual([["female", spouse.id]]);
    expect(memberLabelOf(mother, parents(mother)[0]!.id)).toBe("義母");
    // 母がいれば、選択肢は「父」だけ（「父母」も出さない）。両方いればボタンを出さない
    const withMother = actionOf("care", wh, "family/add/mother").run(wh);
    expect(actionsOf("care", withMother).filter((a) => a.choice?.key === "care/add/parents/self").map((a) => a.label)).toEqual(["父"]);
    const both = actionOf("care", withMother, "family/add/father").run(withMother);
    expect(parents(both).map((m) => [m.sex, m.outside?.of])).toEqual([
      ["female", self.id],
      ["male", self.id],
    ]);
    expect(actionsOf("care", both).some((a) => a.choice?.key === "care/add/parents/self")).toBe(false);
    // 父母は2人まとめて
    expect(parents(actionOf("care", wh, "care/add/selfParents").run(wh))).toHaveLength(2);
    // 配偶者がいなければ「＋ 親を足す」
    expect([...new Set(actionsOf("care", blankHousehold(BASE, seq())).filter((a) => a.choice?.key.startsWith("care/add/parents/") === true).map((a) => a.choice!.label))]).toEqual(["＋ 親を足す"]);
  });

  it("親への仕送り・親からの援助は、世帯の外の家族が1人以上いれば標準（いなければ詳細）", () => {
    const none = couple();
    const level = (wh: WorkingHousehold, key: string) => stage("care", wh).sections.find((s) => s.key === key)?.level;
    expect(level(none, "money/care/out")).toBe("detail");
    const withParent = addOutside(none, "parent", { sex: "female" });
    expect(level(withParent, "money/care/out")).toBe("simple");
    expect(level(withParent, "money/care/in")).toBe("simple");
  });

  it("介護で働き方が変わるの区画は、まだ無くても入れ方を出す。探して開くの「介護休業」は働き方と収入へ", () => {
    const wh = couple();
    const sec = stage("care", wh).sections.find((s) => s.key === "care/leaves")!;
    expect(sec.note).toMatch(/^まだありません。.*働き方と収入/);
    const top = findInInput(findEntries(wh, inputItems(wh)), "介護休業")[0]!;
    expect(top.card).toBe("work");
  });
});

describe("入力のホームの介護・親の要約", () => {
  it("推定で入れた介護（月額が空）は、統計の平均の月額で数える（前は「介護 約0万円」）", () => {
    let wh = addOutside(couple(), "parent", { sex: "female" });
    const mother = parents(wh)[0]!;
    wh = actionOf("care", wh, `family/${mother.id}/care/estimate`).run(wh);
    const card = inputItems(wh).find((i) => i.id === "care")!;
    expect(card.summary?.pre).toBe("介護 約");
    expect(Number((card.summary?.main ?? "0").replace(/,/g, ""))).toBeGreaterThan(100);
  });
});

describe("介護の物の見出し", () => {
  it("見出しは「母の介護（施設）」、下の1行に「2027年4月から60か月・月…」。入れていない月額・期間は「（推定）」", () => {
    const wh = open("parentCare");
    const c = hh(wh).careExpenses![0]!;
    const g = groupsOf("care", wh).find((x) => x.key === `ev/care/${c.id}`)!;
    expect(g.title).toBe("母の介護（施設）");
    expect(g.summary).toBe(careSpan(wh, c));
    expect(g.summary).toMatch(/^2027年4月から60か月/);
    expect(g.summary).not.toContain("（推定）");
    const blank = mutate(wh, (x) => {
      const y = x.careExpenses![0]!;
      delete y.months;
    });
    expect(careSpan(blank, hh(blank).careExpenses![0]!)).toMatch(/（推定）$/);
    expect(careSpan(blank, hh(blank).careExpenses![0]!)).not.toContain("目安");
  });
});

describe("相続・贈与", () => {
  it("親を足すのは1つ（区画「親・祖父母（相続の相手・贈与する人）」の「＋ 親を足す」。介護・親と同じ選び方）。足した親は相続の相手にも援助の贈与する人にも選べる。生年月を入れない贈与する人は詳細", () => {
    const wh = couple();
    const acts = actionsOf("inheritance", wh);
    const simple = acts.filter((a) => a.level === "simple" && (a.choice?.key.startsWith("inherit/add/parents/") === true || a.label.includes("親を足す") || a.label.includes("父を足す")));
    expect([...new Set(simple.map((a) => a.choice?.label ?? a.label))]).toEqual(["＋ ご本人の親を足す", "＋ 配偶者の親を足す"]);
    expect(acts.find((a) => a.key === "family/add/donor-parent")).toMatchObject({ level: "detail", label: "＋ 生年月を入れない贈与する人（親）" });
    expect(acts.some((a) => a.key === "inherit/addFather")).toBe(false);
    const sec = stage("inheritance", wh).sections.find((s) => s.key === "family/donors")!;
    expect(sec.title).toBe("親・祖父母（相続の相手・贈与する人）");
    // 父を足すと、介護・親の世帯の外の家族（亡くなる見込みは推定）。受け取る相続の行の相手にも、援助の贈与する人にも選べる
    const next = acts.find((a) => a.key === "inherit/add/selfFather")!.run(wh);
    const father = parents(next)[0]!;
    expect(father.leaves).not.toBeNull();
    expect(groupsOf("care", next).some((g) => g.key === `family/${father.id}`)).toBe(true);
    const withRow = actionOf("inheritance", next, "money/inherit/in/add/inheritance").run(next);
    const row = (hh(withRow).incomeFlows ?? []).find((f) => f.kind === "inheritance")!;
    const cp = fieldOf("inheritance", withRow, `in/${row.id}/counterparty`)!;
    expect(cp.kind === "select" ? cp.options.map((o) => o.value) : []).toContain(father.id);
    expect(donorOptions(next).map((o) => o.value)).toContain(father.id);
    // 相手に選ぶと、時期は亡くなる見込みの10か月後の推定
    const h0 = hh(withRow);
    expect(row.counterparty).toBe(father.id);
    expect(resolveTimepoint(h0, row.from)).toBe(addMonths(resolveTimepoint(h0, father.leaves!)!, INHERIT_AFTER_MONTHS));
  });

  it("見込みと「計算に入れる」は1つの考え方: 確実ならチェックの欄を出さず計算に入れる。当てにしないときだけ「この行を計算に入れる」、入れた後は「計算から外す」", () => {
    let wh = actionOf("inheritance", couple(), "money/inherit/in/add/inheritance").run(couple());
    const row = () => (hh(wh).incomeFlows ?? []).find((f) => f.kind === "inheritance")!;
    const id = row().id;
    expect(fieldOf("inheritance", wh, `in/${id}/includeInBase`)).toBeUndefined();
    expect(actionsOf("inheritance", wh).map((a) => a.key)).not.toContain(`in/${id}/includeInBase`);
    wh = fieldOf("inheritance", wh, `in/${id}/likelihood`)!.set(wh, "uncertain");
    const g = groupsOf("inheritance", wh).find((x) => x.key === `in/${id}`)!;
    expect(g.note ?? "").not.toContain("「詳細」の「基本の計算に入れる」");
    wh = actionOf("inheritance", wh, `in/${id}/includeInBase`).run(wh);
    expect(row().includeInBase).toBe(true);
    wh = actionOf("inheritance", wh, `in/${id}/excludeFromBase`).run(wh);
    expect(row().includeInBase).toBeUndefined();
  });

  it("相続税の目安の設定の空欄の意味（不動産の評価の割合 80%・葬式の費用 0円）", () => {
    const wh = couple();
    expect(fieldOf("inheritance", wh, "inherit/tax/realEstateRatio")!.blankMeans).toBe("80%");
    expect(fieldOf("inheritance", wh, "inherit/tax/funeral")!.blankMeans).toBe("0円");
  });

  it("相続人がいない時点には、兄弟姉妹を足す案内を内訳に添える", () => {
    const wh = couple();
    const self = hh(wh).members.find((m) => m.kind === "self")!;
    const point = { point: "bothAfter", decedent: self.id, month: "2066-01", valuationYear: 2065, status: "noHeirs", assets: { taxablePrice: 0 }, heirCount: 0, basicDeduction: 0, totalTax: 0, payable: 0, payableHousehold: 0, payableOutside: 0, noTax: true, margin: 0, amount: 0, state: "estimated", cautions: [] };
    const v = inheritanceView(wh, { inheritanceTax: { points: [point], notIncluded: [] } } as unknown as PreviewResult);
    expect(v.points[0]!.details).toEqual([NO_HEIRS_HINT]);
  });
});

describe("FP顧問料", () => {
  it("「税込」にそろえ、1件なら番号を付けない。単発の料金を外すのは料金の所で、契約の見出しには「この契約を外す」だけ", () => {
    const wh = addAdvisoryFee(couple(), seq());
    const sec = stage("assumptions", wh).sections.find((s) => s.key === "ev/fees")!;
    const fee = hh(wh).advisoryFees![0]!;
    const head = sec.groups.find((g) => g.key === `ev/fee/${fee.id}`)!;
    expect(head.title).toBe("FP顧問料");
    expect(head.actions.filter((a) => a.danger === true).map((a) => a.label)).toEqual(["この契約を外す"]);
    const one = sec.groups.find((g) => g.key === `ev/fee/${fee.id}/one/0`)!;
    expect(one.title).toBe("単発の料金");
    expect(one.fields[0]!.label).toBe("単発の料金（税込）");
    expect(one.actions.map((a) => a.label)).toEqual(["外す"]);
    // 2件になれば番号を付ける
    const two = actionsOf("assumptions", wh).find((a) => a.key === `ev/fee/${fee.id}/addOne`)!.run(wh);
    const labels = stage("assumptions", two).sections.find((s) => s.key === "ev/fees")!.groups.map((g) => g.title);
    expect(labels).toEqual(expect.arrayContaining(["単発の料金 1", "単発の料金 2"]));
  });

  it("継続の顧問料の下に「2027年11月から（単発の料金の12か月後）」、「現状にも入れる」の印が無いときの1行", () => {
    const wh = addAdvisoryFee(couple(), seq());
    const fee = hh(wh).advisoryFees![0]!;
    const rec = fieldOf("assumptions", wh, `ev/fee/${fee.id}/rec/monthly`)!;
    expect(rec.get(wh).hint).toBe("2027年11月から（単発の料金の12か月後）");
    const cur = fieldOf("assumptions", wh, `ev/fee/${fee.id}/inCurrent`)!;
    expect(cur.get(wh).hint).toBe("今は、結果の画面の対策で「入れる」にしたプランだけで計算します");
    expect(fieldStatus(cur, wh).status).not.toBe("missing");
    const on = cur.set(wh, true);
    expect(fieldOf("assumptions", on, `ev/fee/${fee.id}/inCurrent`)!.get(on).hint ?? null).toBeNull();
  });
});

describe("探して開くの言い換え", () => {
  it("親の年金・親の扶養・遺言は介護・親／相続・贈与の欄へ", () => {
    const wh = open("parentCare");
    const top = (q: string) => findInInput(findEntries(wh, inputItems(wh)), q)[0]!;
    expect(top("親の年金").card).toBe("care");
    expect(top("親の年金").label).toBe("この人の年金（年額）");
    expect(top("親の扶養").card).toBe("care");
    expect(top("遺言").card).toBe("inheritance");
  });
});

describe("事務所の既定値の推定の値の一覧", () => {
  it("前の分け方の値は既定の一覧に出さず、値ID は「?」の中", () => {
    const legacy = estimateEntries().filter((e) => e.legacy === true);
    expect(legacy.map((e) => e.id)).toEqual(expect.arrayContaining(["living.statistics.byCategory.transport", "living.statistics.byCategory.otherConsumption"].filter((id) => estimateEntries().some((e) => e.id === id))));
    const html = renderToString(h(EstimatesSection, { value: EMPTY_ESTIMATES, onChange: async () => undefined, today: () => "2026-11-07" }));
    expect(html).not.toContain("前の分け方");
    expect(html).not.toMatch(/<small class="os-est-id">/);
    expect(html).toContain("data-office-estimate-id");
  });
});
