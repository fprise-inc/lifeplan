// 住宅ローンの入れ方の名前・これから借りるローン・ローンの名義・金利の段階で入れる・全期間固定の当初の金利の引き下げ（0052 の追記 2026-11-02）
import { describe, expect, it } from "vitest";
import type { Debt, PreviewResult } from "../src/engine/types.ts";
import { allFields, type FieldDef, type GroupDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { fromBalance, withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { entryOf, rateCutOf, rateRow } from "../src/workspace/input/stages/housingLoans.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { preview } from "./helpers.ts";

const BASE = "2026-10";

const stage = (wh: WorkingHousehold) => buildStage("housing", wh);
const groups = (wh: WorkingHousehold): GroupDef[] => stage(wh).sections.flatMap((s) => s.groups);
function action(wh: WorkingHousehold, key: string): WorkingHousehold {
  const s = stage(wh);
  const a = s.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return withProvisionalHousing(a.run(wh));
}
const actionOf = (wh: WorkingHousehold, suffix: string) => groups(wh).flatMap((g) => g.actions).find((a) => a.key.endsWith(suffix));
const findField = (wh: WorkingHousehold, suffix: string): FieldDef | undefined => allFields(stage(wh)).find((x) => x.key.endsWith(suffix));
function fieldOf(wh: WorkingHousehold, suffix: string): FieldDef {
  const f = findField(wh, suffix);
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1]): WorkingHousehold => withProvisionalHousing(fieldOf(wh, suffix).set(wh, v));
const options = (f: FieldDef): string[] => (f.kind === "select" ? f.options.map((o) => o.label) : []);
const loan = (wh: WorkingHousehold): Debt => (wh.request.input.household.debts ?? []).find((d) => d.kind === "mortgage")!;
const sum = (r: PreviewResult, row: string, year: number) => r.table.filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year).reduce((s, c) => s + c.amount, 0);

/** 会社員の本人（年収600万円）の空の世帯 */
function salaried(): WorkingHousehold {
  let wh = blankHousehold(BASE);
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!;
  return annual.set(wh, 6000000);
}
function couple(): WorkingHousehold {
  const wh = salaried();
  const add = buildStage("family", wh)
    .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
    .find((a) => a.key === "family/add/spouse")!;
  return add.run(wh);
}
/** 住宅購入の予定と、それにつながる住宅ローン（これから借りる。変動金利） */
const buying = (wh = salaried()) => action(action(wh, "housing/addPurchase"), "housing/addMortgage");
/** 今住んでいる持ち家と、今の残高から入れた住宅ローン */
const owning = () => action(action(salaried(), "housing/addOwn"), "housing/addMortgage");

describe("入れ方の区分の名前", () => {
  it("住宅ローンは3つ、ほかのローンは毎月の返済額からを除く2つ", () => {
    const wh = owning();
    expect(options(fieldOf(wh, `${loan(wh).id}/entry`))).toEqual(["借入額から（契約書・購入の予定）", "毎月の返済額から（借入額を逆算）", "今の残高から（返済中のローン）"]);
    const card = action(salaried(), "housing/add/cardLoan");
    const other = card.request.input.household.debts![0]!;
    expect(options(fieldOf(card, `${other.id}/entry`))).toEqual(["借入額から（契約書・購入の予定）", "今の残高から（返済中のローン）"]);
  });
});

describe("これから借りるローン", () => {
  it("今の残高・残高の時点の欄と「今の残高から」を出さない。借入の年月を今より前に直すとまた出る", () => {
    let wh = buying();
    const id = loan(wh).id;
    expect(findField(wh, `${id}/balance`)).toBeUndefined();
    expect(findField(wh, `${id}/balanceAsOf`)).toBeUndefined();
    expect(options(fieldOf(wh, `${id}/entry`))).not.toContain("今の残高から（返済中のローン）");
    expect(fieldOf(wh, `${id}/entry`).get(wh).warn).toBeNull();
    wh = set(wh, `${id}/start`, "2020-04");
    expect(findField(wh, `${id}/balance`)).toBeDefined();
    expect(findField(wh, `${id}/balanceAsOf`)).toBeDefined();
    expect(options(fieldOf(wh, `${id}/entry`))).toContain("今の残高から（返済中のローン）");
  });

  it("「今の残高から」で入れていたローンの借入を今より後にすると、値は消さずに「借入額から」として読み、知らせる。戻すと「今の残高から」", () => {
    let wh = owning();
    const id = loan(wh).id;
    expect(entryOf(wh, id)).toBe("balance");
    const balance = loan(wh).balance;
    expect(balance).toBeDefined();
    wh = set(wh, `${id}/start`, "2028-04");
    // 区分と残高は残す
    expect(wh.loanEntry?.[id]).toBe("balance");
    expect(loan(wh).balance).toEqual(balance);
    // 読み方は「借入額から」（逆算・控除の扱いも同じ）
    expect(entryOf(wh, id)).toBe("principal");
    expect(fromBalance(wh, id)).toBe(false);
    expect(fieldOf(wh, `${id}/entry`).get(wh).value).toBe("principal");
    expect(findField(wh, `${id}/balance`)).toBeUndefined();
    expect(findField(wh, `${id}/principal`)?.level).toBe("simple");
    const st = fieldOf(wh, `${id}/entry`).get(wh);
    expect(st.warn).toContain("「借入額から」として読んでいます");
    expect(st.warn).toContain("今の残高");
    expect(st.warnFix?.label).toBe("今の残高を外す");
    expect(() => preview(wh.request)).not.toThrow();
    // 借入の年月を今より前に戻すと、また「今の残高から」
    const back = set(wh, `${id}/start`, "2020-04");
    expect(entryOf(back, id)).toBe("balance");
    expect(findField(back, `${id}/balance`)?.level).toBe("simple");
    // 外すボタン（押したときだけ）で、今の残高を外す
    const cleared = st.warnFix!.run(wh);
    expect(loan(cleared).balance).toBeUndefined();
    expect(loan(cleared).balanceAsOf).toBeUndefined();
    expect(fieldOf(cleared, `${id}/entry`).get(cleared).warnFix ?? null).toBeNull();
  });
});

describe("ローンの名義", () => {
  it("住宅ローン・ほかのローンの debt.debtors の欄は「ローンの名義」。住宅ローンの選択肢は今のまま", () => {
    const wh = buying(couple());
    const f = fieldOf(wh, `${loan(wh).id}/debtors`);
    expect(f.label).toBe("ローンの名義");
    expect(f.help).toContain("家の名義");
    expect(options(f)).toEqual(["ご本人", "配偶者", "夫婦で連帯債務（1本を2人で）", "収入合算（配偶者が連帯保証人）"]);
    const card = action(couple(), "housing/add/cardLoan");
    const other = card.request.input.household.debts![0]!;
    expect(fieldOf(card, `${other.id}/debtors`).label).toBe("ローンの名義");
    expect(allFields(stage(wh)).some((x) => x.label === "借りる人")).toBe(false);
  });
});

describe("金利の段階で入れる（変動金利）", () => {
  it("選ぶと標準のままで金利の段階の欄と「＋ 金利の段階」が出る。計算は今の金利のままと同じ", () => {
    const wh = buying();
    const id = loan(wh).id;
    const f = fieldOf(wh, `${id}/rateOutlook`);
    expect(options(f)).toContain("金利の段階で入れる");
    expect(f.get(wh).value).toBe("flat");
    expect(actionOf(wh, `${id}/addRate`)?.level).toBe("detail");
    const w = f.set(wh, "custom");
    expect(f.get(w).value).toBe("custom");
    const steps = loan(w).rateSchedule;
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ type: "variable", rate: steps[0]!.rate, from: { at: "2033-10" } });
    const g = groups(w).find((x) => x.key === `housing/debt/${id}/rate/1`)!;
    expect(g.level).toBe("simple");
    expect(g.fields.map((x) => [x.label, x.level])).toEqual([
      ["この金利になる年月", "simple"],
      ["金利（年）", "simple"],
      ["金利の種類", "simple"],
    ]);
    expect(actionOf(w, `${id}/addRate`)?.level).toBe("simple");
    const a = preview(wh.request);
    const b = preview(w.request);
    for (const y of [2029, 2034, 2040]) expect(sum(b, "cf.expense.housing.loan", y)).toBe(sum(a, "cf.expense.housing.loan", y));
  });

  it("型どおりの段（10年で上がる）から選んでも段は残し、1段足して「金利の段階で入れる」になる。見本の型どおりでない段は今までどおりこの選択", () => {
    const wh = buying();
    const id = loan(wh).id;
    const f = fieldOf(wh, `${id}/rateOutlook`);
    const up = f.set(wh, "up1");
    const w = f.set(up, "custom");
    expect(f.get(w).value).toBe("custom");
    expect(loan(w).rateSchedule.slice(0, 3)).toEqual(loan(up).rateSchedule);
    expect(loan(w).rateSchedule[3]).toMatchObject({ rate: loan(up).rateSchedule[2]!.rate });
  });
});

describe("全期間固定: 当初の金利の引き下げ", () => {
  const fixed = () => {
    const wh = buying();
    return set(wh, `${loan(wh).id}/rateType`, "fixed");
  };

  it("金利の見込み・段の欄・「＋ 金利の段階」を出さず、詳細に引き下げの欄（期間・幅）を出す", () => {
    const wh = fixed();
    const id = loan(wh).id;
    expect(findField(wh, `${id}/rateOutlook`)).toBeUndefined();
    expect(actionOf(wh, `${id}/addRate`)).toBeUndefined();
    expect(fieldOf(wh, `${id}/rateCutPeriod`).level).toBe("detail");
    expect(options(fieldOf(wh, `${id}/rateCutPeriod`))).toEqual(["なし", "5年", "10年"]);
    expect(fieldOf(wh, `${id}/rateCutPeriod`).get(wh).value).toBe("0");
    expect(findField(wh, `${id}/rateCut`)).toBeUndefined();
  });

  it("期間と幅を入れると段に直して計算に効く（期間の間は金利−幅、その後は元の金利）。金利の欄は引き下げ前の金利で、推定のまま", () => {
    let wh = fixed();
    const id = loan(wh).id;
    const base = loan(wh).rateSchedule[0]!.rate;
    expect(fieldStatus(fieldOf(wh, `${id}/rate`), wh).status).toBe("estimated");
    const none = preview(wh.request);
    wh = set(wh, `${id}/rateCutPeriod`, "120");
    wh = set(wh, `${id}/rateCut`, "0.005");
    const d = loan(wh);
    const start = d.start.at as string;
    expect(d.rateSchedule.map((s) => [s.type, s.rate])).toEqual([
      ["fixed", String(Math.round((Number(base) - 0.005) * 1e6) / 1e6)],
      ["fixed", base],
    ]);
    expect(d.rateSchedule[1]!.from).toEqual({ at: `${Number(start.slice(0, 4)) + 10}${start.slice(4)}` });
    expect(rateCutOf(wh.request.input.household, d)).toEqual({ months: 120, cut: "0.005", base });
    const rate = fieldOf(wh, `${id}/rate`);
    expect(rate.label).toBe("金利（引き下げ前・年）");
    expect(rate.get(wh).value).toBe(base);
    expect(fieldStatus(rate, wh).status).toBe("estimated");
    expect(rateRow(wh, d)?.state).toBe("estimated");
    const cut = preview(wh.request);
    const y1 = Number(start.slice(0, 4)) + 1;
    expect(sum(cut, "cf.expense.housing.loan", y1)).toBeLessThan(sum(none, "cf.expense.housing.loan", y1));
    // 金利（引き下げ前）を直すと、引き下げの間の金利も同じ幅のまま動く
    wh = set(wh, `${id}/rate`, "0.02");
    expect(loan(wh).rateSchedule.map((s) => s.rate)).toEqual(["0.015", "0.02"]);
    // 借入の年月を直すと、引き下げの終わりも動く
    wh = set(wh, `${id}/start`, "2029-04");
    expect(loan(wh).rateSchedule[1]!.from).toEqual({ at: "2039-04" });
    expect(rateCutOf(wh.request.input.household, loan(wh))?.months).toBe(120);
    // 期間を「なし」にすると1つの段（元の金利）に戻る
    const back = set(wh, `${id}/rateCutPeriod`, "0");
    expect(loan(back).rateSchedule.map((s) => s.rate)).toEqual(["0.02"]);
    // ほかの種類にすると引き下げを外し、引き下げ前の金利にする
    const variable = set(wh, `${id}/rateType`, "variable");
    expect(loan(variable).rateSchedule.map((s) => [s.type, s.rate])).toEqual([["variable", "0.02"]]);
  });

  it("既にある段: 引き下げの形に読める段は引き下げとして読む。読めない段は消さずに残し「金利の段階で入れている」と見せ、詳細の段で直せる", () => {
    const wh = fixed();
    const id = loan(wh).id;
    const start = loan(wh).start.at as string;
    const at5 = `${Number(start.slice(0, 4)) + 5}${start.slice(4)}`;
    const readable = mutate(wh, (h) => {
      const d = h.debts!.find((x) => x.id === id)!;
      d.rateSchedule = [d.rateSchedule[0]!, { from: { at: at5 }, type: "fixed", rate: "0.03" }];
      d.rateSchedule[0]!.rate = "0.0275";
    });
    expect(fieldOf(readable, `${id}/rateCutPeriod`).get(readable).value).toBe("60");
    expect(fieldOf(readable, `${id}/rateCut`).get(readable).value).toBe("0.0025");
    expect(groups(readable).some((g) => g.key === `housing/debt/${id}/rate/1`)).toBe(false);
    // 読めない段（7年後に上がる・3つの段）
    const odd = mutate(wh, (h) => {
      const d = h.debts!.find((x) => x.id === id)!;
      d.rateSchedule = [d.rateSchedule[0]!, { from: { at: "2035-04" }, type: "fixed", rate: "0.03" }, { from: { at: "2040-04" }, type: "fixed", rate: "0.035" }];
    });
    expect(rateCutOf(odd.request.input.household, loan(odd))).toBeNull();
    expect(loan(odd).rateSchedule).toHaveLength(3);
    expect(fieldOf(odd, `${id}/rateSteps`).get(odd).value).toBe("金利の段階で入れている（「詳細」で直す）");
    expect(findField(odd, `${id}/rateCutPeriod`)).toBeUndefined();
    const step = groups(odd).find((g) => g.key === `housing/debt/${id}/rate/1`);
    expect(step?.level).toBe("detail");
    expect(actionOf(odd, `${id}/addRate`)?.level).toBe("detail");
  });

  it("返済中のローンで引き下げの期間を過ぎていれば、毎月の返済額の目安と逆算は元の金利で見る", () => {
    let wh = owning();
    const id = loan(wh).id;
    wh = set(wh, `${id}/start`, "2012-04");
    wh = set(wh, `${id}/rateType`, "fixed");
    const pay = fieldOf(wh, `${id}/payment`).get(wh).value;
    wh = set(wh, `${id}/rateCutPeriod`, "120");
    wh = set(wh, `${id}/rateCut`, "0.005");
    expect(loan(wh).rateSchedule).toHaveLength(2);
    expect(fieldOf(wh, `${id}/payment`).get(wh).value).toBe(pay);
    // 返済額を入れて金利を逆算すると、元の金利の段に書き、最初の段は幅の分だけ下げる
    wh = set(wh, `${id}/payment`, 120000);
    const [s0, s1] = loan(wh).rateSchedule;
    expect(Number(s1!.rate) - Number(s0!.rate)).toBeCloseTo(0.005, 9);
    expect(fieldOf(wh, `${id}/payment`).get(wh).value).toBe(120000);
  });

  it("固定期間選択型は今のまま段で入れる（引き下げの欄は出さない）", () => {
    const wh = buying();
    const w = set(wh, `${loan(wh).id}/rateType`, "fixedPeriod");
    const id = loan(w).id;
    expect(findField(w, `${id}/rateCutPeriod`)).toBeUndefined();
    expect(actionOf(w, `${id}/addRate`)?.level).toBe("detail");
  });
});
