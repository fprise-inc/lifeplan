// 入力の画面と結果のタブの直し: 標準の値の追いかけ（表の最後の年・子の独立）・給与の種類の推定の入れ替え・定期便の加入月数・
// 改定通知書の欄の説明・入れられない値の知らせ・進路の型・働く最後の年齢の部品・取り崩しを始める年齢の初めの値
import { describe, expect, it } from "vitest";
import type { PensionRecord } from "../src/engine/types.ts";
import { allFields, type FieldDef, type Val } from "../src/workspace/input/form.ts";
import { rejectReason } from "../src/workspace/input/FieldViews.tsx";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { drawdownStartDefault } from "../src/workspace/input/savings/model.ts";
import { presetOf } from "../src/workspace/input/stages/education.ts";
import { addMember, removeMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { pensionNotices } from "../src/workspace/input/stages/pension.ts";
import { readLevers } from "../src/workspace/levers.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues } from "../src/workspace/plans/plans.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";

/** 決まった ID（1つのテストの中で同じ数え方を使う。世帯ごとに作り直さない） */
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const fieldOf = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], suffix: string): FieldDef => {
  const f = allFields(buildStage(stage, wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const set = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], suffix: string, v: Val) => fieldOf(wh, stage, suffix).set(wh, v);
const member = (wh: WorkingHousehold, kind: string) => wh.request.input.household.members.filter((m) => m.kind === kind);
const run = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], keySuffix: string) => {
  for (const s of buildStage(stage, wh).sections)
    for (const a of [...s.actions, ...s.groups.flatMap((g) => g.actions)]) if (a.key.endsWith(keySuffix)) return { label: a.label, wh: a.run(wh) };
  throw new Error(`no action ${keySuffix}`);
};

describe("表の最後の年: 標準のままなら家族の生年月に合わせる", () => {
  it("空の世帯の仮の本人（40歳）の100歳の年のまま残らない", () => {
    const wh0 = blankHousehold(BASE, ids());
    expect(wh0.request.input.endYear).toBe(2086);
    const w1 = set(wh0, "family", "/birth", "1971-06");
    expect(w1.request.input.endYear).toBe(2071);
    // 配偶者を足す（仮の生年月）→ 生年月を入れる: 若い方の100歳の年に合わせる
    const w2 = addMember(w1, "spouse", ids());
    const spouse = member(w2, "spouse")[0]!;
    const w3 = allFields(buildStage("family", w2)).find((f) => f.key === `family/${spouse.id}/birth`)!.set(w2, "1976-03");
    expect(w3.request.input.endYear).toBe(2076);
    // 配偶者を外すと本人の100歳の年に戻る
    expect(removeMember(w3, spouse.id).request.input.endYear).toBe(2071);
    // 欄の説明と値が食い違わない
    expect(fieldOf(w3, "assumptions", "endYear").get(w3).hint).toMatch(/^標準の年/);
  });

  it("人が入れた年は残し、空にすると標準に戻る", () => {
    const wh0 = blankHousehold(BASE, ids());
    const w1 = set(wh0, "assumptions", "endYear", 2090);
    const w2 = set(w1, "family", "/birth", "1971-06");
    expect(w2.request.input.endYear).toBe(2090);
    expect(fieldOf(w2, "assumptions", "endYear").get(w2).hint).toMatch(/^標準は 2071年/);
    expect(set(w2, "assumptions", "endYear", null).request.input.endYear).toBe(2071);
  });
});

describe("子の独立の年月: 新しく足す子は年齢の時点の標準、年月で持つ古い子は標準のままなら生年月に合わせる", () => {
  it("新しく足す子は「22歳になった後の最初の3月末の翌月」を年齢の時点で持ち、生年月・1日生まれで動く。人が入れた年月は残す", () => {
    const w0 = set(blankHousehold(BASE, ids()), "family", "/birth", "1985-06");
    const w1 = addMember(w0, "child", ids());
    const child = member(w1, "child")[0]!;
    expect(child.leaves).toEqual({ memberAge: { member: child.id, years: 22, ageSwitch: "schoolYear" } });
    expect(w1.assumed[`family/${child.id}/leaves`]).toContain("22歳");
    const birth = (w: WorkingHousehold) => allFields(buildStage("family", w)).find((f) => f.key === `family/${child.id}/birth`)!;
    // 子の独立は子ども・教育のカードの詳細の「独立の時期」（0078）
    const leaves = (w: WorkingHousehold) => allFields(buildStage("education", w)).find((f) => f.key === `family/${child.id}/leaves`)!;
    const w2 = birth(w1).set(w1, "2020-04");
    expect(leaves(w2).get(w2)).toMatchObject({ value: "2043-04", hint: "23歳" });
    // 4月1日生まれ: 早生まれと同じ学年（22歳になる年度の終わりが1年早い）
    const first = allFields(buildStage("family", w2)).find((f) => f.key === `family/${child.id}/bornOnFirst`)!;
    expect(leaves(first.set(w2, true)).get(first.set(w2, true)).value).toBe("2042-04");
    // 人が入れた独立の年月は、生年月を直しても変えない。標準に戻すと年齢の時点に戻る
    const w3 = leaves(w2).set(w2, "2045-03");
    const w4 = birth(w3).set(w3, "2019-05");
    expect(leaves(w4).get(w4).value).toBe("2045-03");
    const back = buildStage("education", w4).sections.flatMap((s) => s.groups.flatMap((g) => g.actions)).find((a) => a.key === `family/${child.id}/leavesStandard`)!;
    const w5 = back.run(w4);
    expect(leaves(w5).get(w5).value).toBe("2042-04");
  });

  it("年月で持つ古い世帯の子は、22歳になる月のままなら生年月を直したときに合わせる（PR の仮の直しのまま）", () => {
    const w0 = set(blankHousehold(BASE, ids()), "family", "/birth", "1985-06");
    const w1 = addMember(w0, "child", ids());
    const child = member(w1, "child")[0]!;
    const old = { ...w1, request: structuredClone(w1.request) };
    old.request.input.household.members.find((m) => m.id === child.id)!.leaves = { at: "2042-05" };
    old.request.input.household.members.find((m) => m.id === child.id)!.birth.birthYearMonth = "2020-05";
    const birth = allFields(buildStage("family", old)).find((f) => f.key === `family/${child.id}/birth`)!;
    const w2 = birth.set(old, "2019-05");
    expect(w2.request.input.household.members.find((m) => m.id === child.id)!.leaves).toEqual({ at: "2041-05" });
  });

  it("これから生まれる子は「-2歳」と出さず、独立は22歳の後の最初の4月", () => {
    const w0 = set(blankHousehold(BASE, ids()), "family", "/birth", "1990-06");
    const w1 = addMember(w0, "child", ids());
    const child = member(w1, "child")[0]!;
    const birth = (w: WorkingHousehold) => allFields(buildStage("family", w)).find((f) => f.key === `family/${child.id}/birth`)!;
    const w2 = birth(w1).set(w1, "2028-04");
    expect(birth(w2).get(w2).hint).toBe("今から1年6か月後・ご本人37歳（令和10年4月）");
    const leaves = allFields(buildStage("education", w2)).find((f) => f.key === `family/${child.id}/leaves`)!;
    expect(leaves.get(w2)).toMatchObject({ value: "2051-04", hint: "23歳" });
    expect(() => preview(w2.request)).not.toThrow();
  });
});

describe("働き方: 給与の種類どうしで変えたら推定を入れ替える", () => {
  const start = () => {
    let wh = set(blankHousehold(BASE, ids()), "family", "/birth", "1980-06");
    wh = addMember(wh, "spouse", ids());
    const spouse = member(wh, "spouse")[0]!;
    wh = run(wh, "work", `work/${spouse.id}/start`).wh;
    const f = (suffix: string) => allFields(buildStage("work", wh)).find((x) => x.key.startsWith(`work/${spouse.id}/now`) && x.key.endsWith(suffix))!;
    return { wh, spouse, f };
  };
  const periodOf = (wh: WorkingHousehold, id: string) => (wh.request.input.household.employmentPeriods ?? []).find((p) => p.member === id)!;

  it("正社員→パート: 推定のままの年収・賞与・健康保険・厚生年金はパートの推定・初めの値になる", () => {
    const { wh, spouse, f } = start();
    expect(periodOf(wh, spouse.id).salary?.annual.value).toBe(343400 * 12);
    const w2 = f("/type").set(wh, "partTime");
    const p = periodOf(w2, spouse.id);
    expect(p.type).toBe("partTime");
    expect(p.salary?.annual).toMatchObject({ value: 1418 * 15 * 52, state: "estimated" });
    expect(p.salary?.bonus).toMatchObject({ value: 0, state: "estimated" });
    expect(p.healthInsurance?.kind).toBe("dependent");
    expect(p.pensionCategory).toBe("none");
    expect(p.employer).toEqual({ size: 50, weeklyHours: "20" });
    // 標準報酬月額は書かない（勤め先の保険に入らないパート。入る働き方でも空欄なら給与から毎年決め直す。0047 の追記 2026-10-29 の2）
    expect(p.standardMonthlyRemuneration).toBeUndefined();
    expect(() => preview(w2.request)).not.toThrow();
  });

  it("人が入れた年収・健康保険は残す", () => {
    const { wh, spouse } = start();
    // 年収（賞与を除く）は働き方の期間（詳しく）の欄（標準は年収〔賞与込み〕の1欄。0078）
    let w = allFields(buildStage("work", wh)).find((x) => x.key === `work/period/${periodOf(wh, spouse.id).id}/annual`)!.set(wh, 2400000);
    // 健康保険の種類は詳細（働き方の期間）の欄
    w = allFields(buildStage("work", w)).find((x) => x.key === `work/period/${periodOf(w, spouse.id).id}/hi`)!.set(w, "union");
    const w2 = allFields(buildStage("work", w)).find((x) => x.key.startsWith(`work/${spouse.id}/now`) && x.key.endsWith("/type"))!.set(w, "partTime");
    const p = periodOf(w2, spouse.id);
    expect(p.salary?.annual).toMatchObject({ value: 2400000, state: "confirmed" });
    expect(p.salary?.bonus).toMatchObject({ value: 0, state: "estimated" });
    expect(p.healthInsurance?.kind).toBe("union");
  });
});

describe("年金: 定期便の加入月数が0か月のままを黙って0円にしない", () => {
  const setup = () => {
    let wh = set(blankHousehold(BASE, ids()), "family", "/birth", "1973-01");
    const self = member(wh, "self")[0]!;
    wh = run(wh, "work", `work/${self.id}/start`).wh;
    // 定年後は働かない（再雇用の推定の5年で受給資格期間に届かないように）
    wh = set(wh, "work", "/postType", "");
    // 入れ方の区分「書類から」を選ぶと、年齢（53歳）から書類の種類は定期便（50歳以上）になる（0066）
    wh = fieldOf(wh, "pension", `pension/${self.id}/mode`).set(wh, "document");
    expect(wh.request.input.household.pensionRecords?.[0]?.kind).toBe("statementOver50");
    wh = set(wh, "pension", "/amounts/basic", 780000);
    wh = set(wh, "pension", "/amounts/employee", 1250000);
    return { wh, self };
  };
  const pensionTotal = (wh: WorkingHousehold) => preview(wh.request).table.filter((r) => r.row === "cf.income.pension").reduce((s, r) => s + r.amount, 0);

  it("見込額だけ写したときは、パネル・カード・結果のタブで加入月数が要ることを知らせる", () => {
    const { wh } = setup();
    // 計算は受給資格期間に届かず0円（知らせが要る理由）
    expect(pensionTotal(wh)).toBe(0);
    const stage = buildStage("pension", wh);
    expect(stage.sections[0]!.groups[0]!.note).toContain("加入月数が0か月のままです");
    expect(fieldOf(wh, "pension", "/months/basic").get(wh)).toMatchObject({ value: null, warn: expect.stringContaining("0か月のままです") });
    const card = inputItems(wh).find((i) => i.id === "pension")!;
    expect(card.summary).toEqual({ main: "加入月数", unit: "が未入力" });
    expect(pensionNotices(wh)).toEqual(["ご本人の年金: ねんきん定期便の加入月数が0か月のままです。年金を0円で計算しています。入力の「年金」で加入月数を入れてください"]);
  });

  it("加入月数を入れると知らせが消え、見込額で計算する", () => {
    const { wh } = setup();
    let w = set(wh, "pension", "/months/basic", 400);
    w = set(w, "pension", "/months/employee", 380);
    expect(pensionNotices(w)).toEqual([]);
    expect(fieldOf(w, "pension", "/months/basic").get(w).warn).toBeUndefined();
    expect(buildStage("pension", w).sections[0]!.groups[0]!.note).toBeUndefined();
    expect(inputItems(w).find((i) => i.id === "pension")!.summary?.main).toBe("16.9");
    expect(pensionTotal(w)).toBeGreaterThan(0);
  });

  it("改定通知書（受給中）の欄の説明は改定通知書の額を言う", () => {
    const { wh, self } = setup();
    const w = fieldOf(wh, "pension", `pension/${self.id}/kind`).set(set(wh, "pension", "/amounts/basic", null), "receiving");
    const basic = fieldOf(w, "pension", "/amounts/basic").get(w);
    expect(basic.estimated).toContain("年金額改定通知書");
    expect(basic.estimated).not.toContain("定期便");
    expect(fieldOf(w, "pension", "/amounts/basic").help).toContain("年金額改定通知書");
    // 入れた額はそのまま
    expect(fieldOf(w, "pension", "/amounts/employee").get(w)).toMatchObject({ value: 1250000, estimated: null });
    // 新しく選んだときも
    // 推計に戻すと書類の記録は残し（画面の側）、書類からに戻すと戻る。残した記録の無い人が新しく選んだときも、改定通知書の文になる
    const est = fieldOf(wh, "pension", `pension/${self.id}/mode`).set(wh, "");
    expect(est.request.input.household.pensionRecords).toBeUndefined();
    expect(est.pensionKept?.[self.id]).toHaveLength(1);
    const back = fieldOf(est, "pension", `pension/${self.id}/mode`).set(est, "document");
    expect(back.request.input.household.pensionRecords).toEqual(wh.request.input.household.pensionRecords);
    expect(back.pensionKept).toBeUndefined();
    const { pensionKept: _k, ...clean } = est;
    void _k;
    const doc = fieldOf(clean, "pension", `pension/${self.id}/mode`).set(clean, "document");
    const fresh = fieldOf(doc, "pension", `pension/${self.id}/kind`).set(doc, "receiving");
    expect((fresh.request.input.household.pensionRecords as PensionRecord[])[0]!.amounts?.basic).toMatchObject({ estimate: { basis: "未入力（0円で計算。年金額改定通知書の年金額（年額）を入れてください）" } });
  });
});

describe("入れられない値は、欄の近くに理由を言葉で出す", () => {
  const yen = { key: "k", item: null, label: "額", level: "simple", kind: "yen", basis: "once", get: () => ({ value: null }), set: (w: WorkingHousehold) => w } as FieldDef;
  const age = { key: "a", item: null, label: "年齢", level: "simple", kind: "int", suffix: "歳まで", min: 60, max: 70, get: () => ({ value: null }), set: (w: WorkingHousehold) => w } as FieldDef;
  it("マイナスの額・数字でない文字・範囲の外", () => {
    expect(rejectReason(yen, "-50")).toBe("マイナスの額は入れられません。0 以上の額を入れてください");
    expect(rejectReason(yen, "－５０")).toContain("マイナス");
    expect(rejectReason(yen, "ごじゅう")).toContain("数字で入れてください");
    expect(rejectReason(yen, "50")).toBeNull();
    expect(rejectReason(age, "55")).toBe("60歳〜70歳の範囲で入れてください");
    expect(rejectReason(age, "65")).toBeNull();
    expect(rejectReason({ ...yen, kind: "ym" } as FieldDef, "36歳")).toContain("西暦");
  });

  it("0〜100% の割合の欄（貯金に回る割合・不動産の評価の割合・亡くなる人の分）は、外の値を入れられない（入れると計算が止まっていた）", () => {
    const wh = fromRequest(modelHousehold("dualAssetsTwoKids"));
    const fields = [fieldOf(wh, "living", "living/surplus/ratio"), fieldOf(wh, "inheritance", "inherit/tax/realEstateRatio"), fieldOf(wh, "inheritance", "inherit/tax/unassignedShare")];
    for (const f of fields) {
      expect(rejectReason(f, "120"), f.key).toBe("0%〜100%の範囲で入れてください");
      expect(rejectReason(f, "-5"), f.key).toBe("0%〜100%の範囲で入れてください");
      expect(rejectReason(f, "100"), f.key).toBeNull();
      expect(rejectReason(f, "0"), f.key).toBeNull();
      expect(rejectReason(f, "37.5"), f.key).toBeNull();
      // 範囲の端なら計算できる
      for (const v of ["0", "1"]) expect(() => preview(f.set(wh, v).request), `${f.key}=${v}`).not.toThrow();
    }
    // 範囲の無い割合の欄（物価上昇率など）は今までどおりマイナスも入れられる
    expect(rejectReason(fieldOf(wh, "assumptions", "assume/inflation"), "-1")).toBeNull();
  });
});

describe("教育: 進路を入れるボタンの名前と入る型が同じ", () => {
  it("「大学だけ私立」で入り、ボタンもそう言う", () => {
    let wh = set(blankHousehold(BASE, ids()), "family", "/birth", "1985-06");
    wh = addMember(wh, "child", ids());
    const child = member(wh, "child")[0]!;
    wh = allFields(buildStage("family", wh)).find((f) => f.key === `family/${child.id}/birth`)!.set(wh, "2016-05");
    const { label, wh: w2 } = run(wh, "education", `edu/${child.id}/add`);
    const goal = (w2.request.input.household.goals ?? []).find((g) => g.owner === child.id)!;
    expect(presetOf(goal.education!.stages)).toBe("univPrivate");
    expect(label).toBe("推定の進路で埋める（大学だけ私立〔文系・自宅〕）");
  });
});

describe("結果のタブ: 働く最後の年齢", () => {
  const open = () => fromRequest(modelHousehold("salariedCoupleTwoKids"));
  it("本人の「働く最後の年齢（現状の予定）」の欄は、対策のつまみと2つ並べない（配偶者の欄は出す）", () => {
    const wh = open();
    const h = wh.request.input.household;
    const self = member(wh, "self")[0]!;
    const spouse = h.members.find((m) => m.kind === "spouse")!;
    const cat = buildCatalog(wh, self.id, null);
    expect(cat.byKey.has(`field:work/${self.id}/retireAge`)).toBe(false);
    expect(cat.byKey.has(`field:work/${spouse.id}/retireAge`)).toBe(true);
    expect(cat.byKey.has("lever:retireAge")).toBe(true);
  });
  it("つまみで目盛りの外（55歳）も選べ、計算に効く", () => {
    const wh = open();
    const self = member(wh, "self")[0]!;
    const cat = buildCatalog(wh, self.id, null);
    const c = cat.byKey.get("lever:retireAge")!.control;
    expect(c.kind).toBe("age");
    if (c.kind !== "age") return;
    expect(c.min).toBeLessThanOrEqual(55);
    expect(c.max).toBeGreaterThanOrEqual(75);
    const req = applyValues(wh, { "lever:retireAge": 55 }, cat);
    expect(readLevers(req, self.id).retireAge).toBe(55);
  });
});

describe("取り崩しを始める年齢の初めの値は、過ぎた年齢にしない", () => {
  it("年金を受け取っている76歳の世帯は77歳から。45歳の世帯は65歳、70歳まで働く世帯は70歳から", () => {
    expect(drawdownStartDefault(modelHousehold("pensionCouple"))).toBe(77);
    expect(drawdownStartDefault(modelHousehold("salariedCoupleTwoKids"))).toBe(65);
    expect(drawdownStartDefault(modelHousehold("sampleSeniorCouple"))).toBe(70);
  });
});
