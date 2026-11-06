// 子ども・教育と車の入力項目の手直し（0133）: 進路の型の比べ方・標準の公立私立・専門学校の学費の目安・子の見出しの教育費・学校外の費用の1つの欄・
// 奨学金と教育ローンの見出し・留学の万一・子への援助の出す人・子の行の時期・受け取るお金の1つのボタン・車の手放す時期の既定・名義の候補・ローンの1行など
import { describe, expect, it } from "vitest";
import type { EducationStage, Goal } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { VOCATIONAL_GUIDE } from "../src/workspace/input/educationCost.ts";
import { allFields, resolveTimepoint, type FieldDef, type GroupDef, type SectionDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, newId, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { rowAt } from "../src/workspace/input/rows.ts";
import { addCar, addLeaseCar, loanLine, RELEASE_BASIS, setReplace } from "../src/workspace/input/stages/cars.ts";
import { addChildIncome, addEducationLoan, addScholarship, childAgeGrade, fillVocationalGuide, giftDonorOptions, presetOf, replaceHigher, stageRemainingCost, VOCATIONAL_GUIDE_LABEL } from "../src/workspace/input/stages/education.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { confirmAll, fieldStatus } from "../src/workspace/input/valueState.ts";
import { preview } from "./helpers.ts";

const BASE = "2026-10";
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const edu = (wh: WorkingHousehold) => buildStage("education", wh);
const car = (wh: WorkingHousehold) => buildStage("car", wh);
const fieldIn = (st: { sections: SectionDef[] }, suffix: string): FieldDef => {
  const f = allFields(st as Parameters<typeof allFields>[0]).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const groupsOf = (st: { sections: SectionDef[] }): GroupDef[] => st.sections.flatMap((s) => s.groups);
const goalOf = (wh: WorkingHousehold): Goal => (wh.request.input.household.goals ?? []).find((g) => g.kind === "education")!;
const childOf = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "child")!;
const input = (wh: WorkingHousehold) => wh.request.input as unknown as Record<string, unknown>;

/** 本人40歳・配偶者・子（2016年5月生まれ。計算基準月に小学4年）の新しい世帯 */
function fresh(): WorkingHousehold {
  const id = seq();
  let wh = blankHousehold(BASE, id);
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1986-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse", id));
  wh = withRefreshedEstimates(addChildWithEducation(wh, id));
  return withRefreshedEstimates(mutate(wh, (h) => void (h.members.find((m) => m.kind === "child")!.birth.birthYearMonth = "2016-05")));
}
/** 高校のあとを専門学校にした世帯 */
function vocational(): WorkingHousehold {
  const wh = fresh();
  return mutate(wh, (h) => {
    const g = (h.goals ?? []).find((x) => x.kind === "education")!;
    g.education!.stages = replaceHigher(g.education!.stages, "vocational");
  });
}
const stageIndex = (wh: WorkingHousehold, stage: string) => goalOf(wh).education!.stages.findIndex((s) => s.stage === stage);

describe("進路の型の比べ方（高校のあとが大学でないとき）", () => {
  it("専門学校（私立）なのに「すべて公立」にしない。大学の代わりに専門学校を見て、合わなければ「自分で選ぶ」。型で変わらない段階を欄の下に書く", () => {
    const pub = (stage: string, sector = "public"): EducationStage => ({ stage, sector });
    const k12 = [pub("elementary"), pub("juniorHigh"), pub("highSchool")];
    expect(presetOf([...k12, pub("vocational", "private")])).toBe("univPrivate");
    expect(presetOf([...k12, pub("vocational", "private")])).not.toBe("allPublic");
    expect(presetOf([...k12, pub("juniorCollege", "public")])).toBe("allPublic");
    expect(presetOf([pub("elementary"), pub("juniorHigh", "private"), pub("highSchool", "private"), pub("vocational", "private")])).toBe("juniorPrivate");
    // 高専（国立）は高校の代わり: 高校まで公立の型と同じ側
    expect(presetOf([pub("elementary"), pub("juniorHigh"), pub("kosen", "national"), pub("university", "national")])).toBe("allPublic");
    const wh = vocational();
    const course = fieldIn(edu(wh), `edu/${goalOf(wh).id}/preset`);
    expect(course.get(wh).value).toBe("univPrivate");
    expect(course.get(wh).hint).toBe("専門学校の公立・私立は型では変わりません（その段階で選びます）");
    // 型の名前は欄に収まる長さ
    expect(course.kind === "select" && course.options.map((o) => o.label)).toContain("すべて公立（国公立大）");
    // 型を「すべて公立」にしても専門学校は私立のまま（型で変わらない）→ 高校まで公立・専門学校が私立の「大学だけ私立」と読む
    const all = course.set(wh, "allPublic");
    expect(goalOf(all).education!.stages.find((s) => s.stage === "vocational")!.sector).toBe("private");
    expect(fieldIn(edu(all), `edu/${goalOf(all).id}/preset`).get(all).value).toBe("univPrivate");
    // 「高校から私立」は高校を私立にし、専門学校（私立）とも合う
    const high = course.set(wh, "highPrivate");
    expect(fieldIn(edu(high), `edu/${goalOf(high).id}/preset`).get(high).value).toBe("highPrivate");
    // 専門学校を公立にすると、大学が私立の型には合わない（「すべて公立」に合う）
    const pubVoc = mutate(high, (h) => void ((h.goals ?? []).find((x) => x.kind === "education")!.education!.stages.find((st) => st.stage === "vocational")!.sector = "public"));
    expect(fieldIn(edu(pubVoc), `edu/${goalOf(pubVoc).id}/preset`).get(pubVoc).value).toBe("");
  });
});

describe("標準の公立・私立は2つ", () => {
  it("標準は「公立／私立」。国立・インターナショナルスクールは詳細の欄で選び、選んでいれば標準にも出す", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const uni = stageIndex(wh, "university");
    const simple = fieldIn(edu(wh), `edu/${g.id}/stage/${uni}/sector`);
    expect(simple.level).toBe("simple");
    expect(simple.simpleOnly).toBe(true);
    expect(simple.kind === "select" && simple.options.map((o) => o.value)).toEqual(["public", "private"]);
    const all = fieldIn(edu(wh), `edu/${g.id}/stage/${uni}/sectorAll`);
    expect(all.level).toBe("detail");
    expect(all.kind === "select" && all.options.map((o) => o.value)).toEqual(["public", "national", "private"]);
    const national = all.set(wh, "national");
    const shown = fieldIn(edu(national), `edu/${g.id}/stage/${uni}/sector`);
    expect(shown.kind === "select" && shown.options.map((o) => o.value)).toEqual(["public", "national", "private"]);
  });
});

describe("専門学校の学費の目安", () => {
  it("「学費を目安で入れる」で年額と入学金を推定の印で入れ、計算に入る。入れた後はボタンを出さない。入れた年額・入学金は変えない", () => {
    const wh = vocational();
    const g = goalOf(wh);
    const i = stageIndex(wh, "vocational");
    const btn = groupsOf(edu(wh)).flatMap((x) => x.actions).find((a) => a.key === `edu/${g.id}/stage/${i}/guide`)!;
    expect(btn.label).toBe(VOCATIONAL_GUIDE_LABEL);
    expect(btn.label).toBe("学費を目安で入れる（年113.6万円・入学金18.3万円）");
    expect(btn.level).toBe("simple");
    const before = preview(wh.request).table.filter((c) => c.row === "cf.expense.education.school").reduce((s, c) => s + c.amount, 0);
    const w = btn.run(wh);
    const st = goalOf(w).education!.stages[i]!;
    expect([st.annualOverride, st.entranceOverride]).toEqual([VOCATIONAL_GUIDE.annual, VOCATIONAL_GUIDE.entrance]);
    const annual = fieldIn(edu(w), `edu/${g.id}/stage/${i}/annual`);
    expect(fieldStatus(annual, w).status).toBe("estimated");
    expect(fieldStatus(annual, w).basis).toContain("東京都専修学校各種学校協会");
    expect(fieldStatus(fieldIn(edu(w), `edu/${g.id}/stage/${i}/entrance`), w).status).toBe("estimated");
    const after = preview(w.request).table.filter((c) => c.row === "cf.expense.education.school").reduce((s, c) => s + c.amount, 0);
    // 2年分の年額（教育費の上昇率で伸びる）が足される
    expect(after - before).toBeGreaterThan(VOCATIONAL_GUIDE.annual * 2);
    expect(groupsOf(edu(w)).flatMap((x) => x.actions).some((a) => a.key.endsWith(`/stage/${i}/guide`))).toBe(false);
    // 段階の見出し: 推定で入れた学費は「（推定）」、2年分と入学金の目安
    const vg = groupsOf(edu(w)).find((x) => x.key === `edu/${g.id}/stage/${i}`)!;
    expect(vg.note).toContain("学費 年113.6万円（推定）");
    expect(vg.summary).toBe("2年で約245.5万円");
    // 入れる前（0円）は額を出さない
    expect(groupsOf(edu(wh)).find((x) => x.key === `edu/${g.id}/stage/${i}`)!.summary).toBeUndefined();
    // 入学金だけ入れていた段階は、年額だけ入れる
    const typed = mutate(wh, (h) => void ((h.goals ?? []).find((x) => x.id === g.id)!.education!.stages[i]!.entranceOverride = 100000));
    const filled = fillVocationalGuide(typed, g.id, i);
    expect(goalOf(filled).education!.stages[i]).toMatchObject({ annualOverride: VOCATIONAL_GUIDE.annual, entranceOverride: 100000 });
  });
});

describe("子の見出しの年齢・学年と、これからの教育費", () => {
  it("区画の見出しの横に「10歳・小4・これからの教育費 約…万円」、段階の見出しの横に「6年で約…」。私立にすると増える", () => {
    const wh = fresh();
    const c = childOf(wh);
    expect(childAgeGrade(c, BASE)).toBe("10歳・小4");
    expect(childAgeGrade({ ...c, birth: { ...c.birth, birthYearMonth: "2014-06" } }, BASE)).toBe("12歳・小6");
    expect(childAgeGrade({ ...c, birth: { ...c.birth, birthYearMonth: "2022-06" } }, BASE)).toBe("4歳");
    const sec = edu(wh).sections.find((s) => s.key === `edu/${c.id}`)!;
    expect(sec.title).toBe("第1子");
    expect(sec.summary).toMatch(/^10歳・小4・これからの教育費 約[\d,.]+万円（今の値段・統計の平均）$/);
    const g = goalOf(wh);
    const el = stageIndex(wh, "elementary");
    const uni = stageIndex(wh, "university");
    const elG = groupsOf(edu(wh)).find((x) => x.key === `edu/${g.id}/stage/${el}`)!;
    // 小学4年の10月: 今年度を含めて3年
    expect(elG.summary).toMatch(/^3年で約[\d,.]+万円$/);
    const uniCost = stageRemainingCost(c, g.education!.stages[uni]!, BASE, "")!;
    expect(uniCost.years).toBe(4);
    // 自宅外にすると仕送り（4年）と初期費用が足される
    const away = stageRemainingCost(c, { ...g.education!.stages[uni]!, living: "away" }, BASE, "")!;
    expect(away.total - uniCost.total).toBeGreaterThan(3000000);
    // 終わった段階・保育園は数えない
    expect(stageRemainingCost(c, { stage: "kindergarten", sector: "public" }, BASE, "")).toBeNull();
    // 合計は段階の合計
    const sum = g.education!.stages.reduce((s, st) => s + (stageRemainingCost(c, st, BASE, "")?.total ?? 0), 0);
    const yen = Number(/約([\d,.]+)万円/.exec(sec.summary!)![1]!.replace(/,/g, "")) * 10000;
    expect(Math.abs(yen - sum)).toBeLessThanOrEqual(500);
  });
});

describe("学校外の費用の1つの欄", () => {
  it("統計の平均／入れない／段階ごとに額で／塾・習い事を行で。世帯ファイルは段階の値と入れ方の今の2つのまま", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const f = fieldIn(edu(wh), `edu/${g.id}/outUniform`);
    expect(f.level).toBe("simple");
    expect(f.kind === "select" && f.options.map((o) => o.label)).toEqual(["統計の平均", "入れない", "段階ごとに額で", "塾・習い事を行で"]);
    expect(f.get(wh).value).toBe("statistics");
    // 入れ方の欄は別に出さない
    expect(allFields(edu(wh)).some((x) => x.key.endsWith("/outMode"))).toBe(false);
    // 段階ごとに額で: 額の入っていない段階に統計の平均の月額（推定）
    const custom = f.set(wh, "custom");
    const k12 = goalOf(custom).education!.stages.filter((s) => ["elementary", "juniorHigh", "highSchool"].includes(s.stage));
    expect(k12.every((s) => typeof s.outOfSchool === "object")).toBe(true);
    expect(fieldIn(edu(custom), `edu/${g.id}/outUniform`).get(custom).value).toBe("custom");
    const el = stageIndex(custom, "elementary");
    expect(fieldStatus(fieldIn(edu(custom), `edu/${g.id}/stage/${el}/outOfSchool`), custom).status).toBe("estimated");
    // 塾・習い事を行で: 入れ方が行になり、行（推定）ができる
    const rows = f.set(wh, "rows");
    expect(goalOf(rows).education!.outOfSchoolMode).toBe("rows");
    expect(fieldIn(edu(rows), `edu/${g.id}/outUniform`).get(rows).value).toBe("rows");
    // 統計の平均に戻すと入れ方も統計に（行は残る）
    const back = fieldIn(edu(rows), `edu/${g.id}/outUniform`).set(rows, "statistics");
    expect(goalOf(back).education!.outOfSchoolMode).toBe("statistics");
    expect(goalOf(back).education!.lessons!.length).toBeGreaterThan(0);
    const none = f.set(wh, "none");
    expect(goalOf(none).education!.stages.filter((s) => ["elementary", "juniorHigh", "highSchool"].includes(s.stage)).every((s) => s.outOfSchool === "none")).toBe(true);
  });
});

describe("奨学金・教育ローン・留学・子への援助", () => {
  it("奨学金・教育ローンは入っていれば標準にも見出しの1行（欄は詳細）。見出しの額は万円", () => {
    let wh = fresh();
    const g = goalOf(wh);
    wh = addEducationLoan(addScholarship(wh, g.id, "00000000-0000-4000-8000-0000000000c1"), g.id, "00000000-0000-4000-8000-0000000000c2");
    const gs = groupsOf(edu(wh));
    const sch = gs.find((x) => x.key === `edu/${g.id}/scholar/00000000-0000-4000-8000-0000000000c1`)!;
    const loan = gs.find((x) => x.key === `edu/${g.id}/loan/00000000-0000-4000-8000-0000000000c2`)!;
    expect([sch.level, loan.level]).toEqual(["simple", "simple"]);
    expect(sch.fields.every((f) => f.level === "detail")).toBe(true);
    expect(sch.title).toBe("貸与の奨学金（第二種） 月5万円・子が返す");
    expect(loan.title).toMatch(/^教育ローン [\d,.]+万円$/);
    expect([sch.moreLabel, loan.moreLabel]).toEqual(["月額・利率・返す年数などを入れる", "借りる額・金利・返す年数などを入れる"]);
    // 期間の言葉は「始まり／終わり」
    expect(sch.fields.map((f) => f.label)).toEqual(expect.arrayContaining(["始まり", "終わり"]));
    // 教育ローンの返す年数の推定は国の教育ローンの返済期間の上限（20年。日本政策金融公庫の案内で確かめた）
    expect(goalOf(wh).education!.loans![0]!.termMonths).toBe(240);
  });

  it("子への援助の出す人: 贈与する人がいなければ欄を出さず「出す人: 世帯」。いれば「世帯から出す」「（名前）から出す」", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const add = groupsOf(edu(wh)).flatMap((x) => x.actions).find((a) => a.key === `edu/${g.id}/addGift`)!;
    const w = add.run(wh);
    const gift = groupsOf(edu(w)).find((x) => x.key === `edu/${g.id}/gift/0`)!;
    expect(gift.fields.some((f) => f.key.endsWith("/donor"))).toBe(false);
    expect(gift.note).toMatch(/^出す人: 世帯。/);
    expect(giftDonorOptions(w, undefined)).toEqual([]);
    const withDonor = mutate(w, (h) => void (h.donors = [{ id: "00000000-0000-4000-8000-0000000000d9", kind: "grandparent", of: h.members[0]!.id }]));
    const opts = giftDonorOptions(withDonor, undefined);
    expect(opts.map((o) => o.label)).toEqual(["世帯から出す", "ご本人の祖父母から出す"]);
    const donor = fieldIn(edu(withDonor), `edu/${g.id}/gift/0/donor`);
    expect([donor.label, donor.level]).toEqual(["出す人", "simple"]);
  });

  it("受け取るお金は1つの「＋ 援助・給付型の奨学金を受ける」で種類を選ぶ（給付型の奨学金も標準）", () => {
    const wh = fresh();
    const c = childOf(wh);
    const acts = groupsOf(edu(wh)).flatMap((x) => x.actions).filter((a) => a.key.startsWith(`edu/${c.id}/money/in/`));
    expect(acts.map((a) => a.label)).toEqual(["祖父母などの援助", "給付型の奨学金・学費の助成", "子が払う分"]);
    expect(acts.every((a) => a.level === "simple" && a.choice?.label === "＋ 援助・給付型の奨学金を受ける" && a.choice.key === acts[0]!.choice!.key)).toBe(true);
  });

  it("子の行の時期は子の年齢（大学の入学の学年の4月）で書き、浪人・生年月を直すと動く。始まりの推定の根拠は在学の期間", () => {
    let wh = fresh();
    const c = childOf(wh);
    wh = addChildIncome(wh, c.id, "educationSupport", "00000000-0000-4000-8000-0000000000e1");
    const f = wh.request.input.household.incomeFlows!.find((x) => x.id === "00000000-0000-4000-8000-0000000000e1")!;
    expect(f.from).toEqual({ memberAge: { member: c.id, years: 18, ageSwitch: "schoolYear" } });
    expect(f.to).toEqual({ memberAge: { member: c.id, years: 21, ageSwitch: "schoolYear" } });
    const h = wh.request.input.household;
    expect([resolveTimepoint(h, f.from), resolveTimepoint(h, f.to)]).toEqual(["2035-04", "2038-04"]);
    const row = rowAt(input(wh), { target: { object: f.id! }, item: "incomeFlow.from", at: [] });
    expect(row?.state).toBe("estimated");
    expect(row?.estimate?.basis).toBe("既定の値（大学の4年間。在学の期間に合わせました。時期が違えば直してください）");
    // 生年月を1年後にすると、受け取りも1年うしろ
    const moved = mutate(wh, (hh) => void (hh.members.find((m) => m.id === c.id)!.birth.birthYearMonth = "2017-05"));
    expect(resolveTimepoint(moved.request.input.household, f.from)).toBe("2036-04");
    // 浪人1年なら、足したときの始まりは19歳の4月
    const delayed = mutate(fresh(), (hh) => {
      const st = (hh.goals ?? []).find((x) => x.kind === "education")!.education!.stages.find((s) => s.stage === "university")!;
      st.delayYears = 1;
    });
    const d = addChildIncome(delayed, childOf(delayed).id, "scholarshipGrant", "00000000-0000-4000-8000-0000000000e2");
    expect(d.request.input.household.incomeFlows!.at(-1)!.from).toEqual({ memberAge: { member: childOf(delayed).id, years: 19, ageSwitch: "schoolYear" } });
    expect(() => preview(d.request)).not.toThrow();
  });

  it("留学の万一のときの扱いは詳細（続ける〔既定〕／やめる）", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const w = groupsOf(edu(wh)).flatMap((x) => x.actions).find((a) => a.key.endsWith("/money/out/abroad"))!.run(wh);
    const on = allFields(edu(w)).find((f) => f.key.includes(`edu/${g.id}/abroad/`) && f.key.endsWith("/on"))!;
    expect(on.level).toBe("detail");
    expect(on.kind === "select" && on.options.map((o) => o.label)).toEqual(["続ける（既定）", "やめる"]);
  });

  it("理工農系・部活動の名前と、自宅外の仕送り（月額）は自宅外のときだけ標準", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const uni = stageIndex(wh, "university");
    expect(fieldIn(edu(wh), `edu/${g.id}/stage/${uni}/sciAgri`).label).toBe("修学支援の対象の学部（理工農系）");
    expect(fieldIn(edu(wh), `/stage/${stageIndex(wh, "juniorHigh")}/club`).label).toBe("うち部活動など（年額）");
    expect(allFields(edu(wh)).some((f) => f.key === `edu/${g.id}/stage/${uni}/boarding/monthly`)).toBe(false);
    const away = fieldIn(edu(wh), `edu/${g.id}/stage/${uni}/living`).set(wh, "away");
    expect(fieldIn(edu(away), `edu/${g.id}/stage/${uni}/boarding/monthly`).level).toBe("simple");
    expect(fieldIn(edu(away), `edu/${g.id}/stage/${uni}/boarding/initial`).level).toBe("detail");
    // 段階の外すボタンは「外す」（大学は「大学に行かない」のまま）
    const el = groupsOf(edu(wh)).find((x) => x.key === `edu/${g.id}/stage/${stageIndex(wh, "elementary")}`)!;
    expect(el.actions.find((a) => a.key.endsWith("/remove"))!.label).toBe("外す");
  });
});

describe("車", () => {
  /** 本人・配偶者・子（10歳）の世帯 */
  const family = (): WorkingHousehold => fresh();

  it("足した車の手放す時期は、名義の人の75歳（推定）。名義を変えると推定のまま新しい名義の人へ。「この値にする」で印が外れる", () => {
    const wh = addCar(family(), seq());
    const c = wh.request.input.household.cars![0]!;
    expect(c.until).toEqual({ memberAge: { member: c.owner, years: 75, months: 0 } });
    const until = fieldIn(car(wh), `ev/car/${c.id}/untilAge`);
    expect(until.get(wh).value).toBe(75);
    expect(fieldStatus(until, wh)).toMatchObject({ status: "estimated", basis: RELEASE_BASIS });
    // 75歳で手放すので、最後まで乗るより買い替えが少ない
    const forever = mutate(wh, (h) => void (h.cars![0]!.until = null));
    const buys = (w: WorkingHousehold) => preview(w.request).table.filter((x) => x.object === c.id && x.row === "cf.expense.lumpSum.car").length;
    expect(buys(wh)).toBeLessThan(buys(forever));
    // 名義を配偶者に: 推定のまま配偶者の75歳
    const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const moved = fieldIn(car(wh), `ev/car/${c.id}/owner`).set(wh, spouse.id);
    expect(moved.request.input.household.cars![0]!.until).toEqual({ memberAge: { member: spouse.id, years: 75, months: 0 } });
    // 「この値にする」
    const done = confirmAll(wh, allFields(car(wh)));
    expect(fieldStatus(fieldIn(car(done.wh), `ev/car/${c.id}/untilAge`), done.wh).status).toBe("confirmed");
    // この1台だけにすると、この1台だけの目安（買ってから13年など）に入れ替える
    const one = setReplace(wh, c.id, "none");
    expect(fieldStatus(fieldIn(car(one), `ev/car/${c.id}/untilAge`), one).basis).toContain("今から5年");
    // リースも75歳
    const lease = addLeaseCar(family(), seq());
    expect(lease.request.input.household.cars![0]!.until).toMatchObject({ memberAge: { years: 75 } });
  });

  it("名義は「名義」＋「?」。候補は今の車は今18歳以上、これから買う車は買う月に18歳以上", () => {
    let wh = addCar(family(), seq());
    const c = wh.request.input.household.cars![0]!;
    const owner = fieldIn(car(wh), `ev/car/${c.id}/owner`);
    expect(owner.label).toBe("名義");
    expect(owner.help).toContain("使う人で選びます");
    const child = childOf(wh);
    expect(owner.kind === "select" && owner.options.some((o) => o.value === child.id)).toBe(false);
    // これから買う車: 子が18歳になった後に買うなら候補に出る
    wh = addCar(wh, () => newId(), false);
    const next = wh.request.input.household.cars![1]!;
    const later = mutate(wh, (h) => void (h.cars![1]!.purchase!.first = { at: "2036-04" }));
    const o2 = fieldIn(car(later), `ev/car/${next.id}/owner`);
    expect(o2.kind === "select" && o2.options.some((o) => o.value === child.id)).toBe(true);
    const soon = fieldIn(car(wh), `ev/car/${next.id}/owner`);
    expect(soon.kind === "select" && soon.options.some((o) => o.value === child.id)).toBe(false);
  });

  it("見出しに「今の車」「これから買う車」。ローンを選ぶと借り方の1行。今の車があれば標準に「＋ 今返している自動車ローン」。伸び率の名前", () => {
    let wh = addCar(family(), seq());
    const c = wh.request.input.household.cars![0]!;
    const head = (w: WorkingHousehold) => groupsOf(car(w)).find((g) => g.key === `ev/car/${c.id}`)!;
    expect(head(wh).title).toBe("車 1（ご本人・今の車）");
    expect(fieldIn(car(wh), `ev/car/${c.id}/owned`).label).toBe("今の車（外すと「これから買う車」）");
    const pay = fieldIn(car(wh), `ev/car/${c.id}/pay`);
    expect(pay.get(wh).hint ?? null).toBeNull();
    wh = pay.set(wh, "loan");
    expect(fieldIn(car(wh), `ev/car/${c.id}/pay`).get(wh).hint).toMatch(/^借入: 下取りを引いた額の8割・5年・年[\d.]+%（▸ で変えられます）$/);
    expect(loanLine({ share: "0.75", rate: "0.0214", termMonths: 66 })).toBe("借入: 下取りを引いた額の75%・66か月・年2.14%（▸ で変えられます）");
    const loans = car(wh).sections.find((s) => s.key === "car/loans")!;
    expect(loans.level).toBe("simple");
    expect(loans.actions.map((a) => [a.label, a.level])).toEqual([["＋ 今返している自動車ローン", "simple"]]);
    const future = car(addCar(family(), seq(), false)).sections.find((s) => s.key === "car/loans")!;
    expect(future.actions.map((a) => [a.label, a.level])).toEqual([["＋ 自動車ローン", "detail"]]);
    // 決まった率の伸び方の欄の名前
    wh = fieldIn(car(wh), `ev/car/${c.id}/growth`).set(wh, "rate");
    expect(fieldIn(car(wh), `ev/car/${c.id}/growthRate`).label).toBe("伸び率（年）");
  });

  it("内訳で入れたときの維持費の合計は、万円で小数1桁まで（「年20.4万円」）", () => {
    let wh = addCar(family(), seq());
    const c = wh.request.input.household.cars![0]!;
    wh = fieldIn(car(wh), `ev/car/${c.id}/upkeepMode`).set(wh, "detail");
    wh = mutate(wh, (h) => void (h.cars![0]!.fuel = { annual: 23500 }));
    const sum = fieldIn(car(wh), `ev/car/${c.id}/upkeepSum`);
    expect(String(sum.get(wh).value)).toMatch(/^年\d+(\.\d)?万円$/);
  });
});
