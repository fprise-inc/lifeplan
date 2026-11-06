// 入力の欄の部品: 円・万円の読み取り（末尾の単位を見て換算する）、欄を離れたときに決めること、生年月に年齢、
// 入力例と空欄の意味、時点の欄の読み（西暦を主に・期間の端の「まで」「から」・年齢の例・人を絞る）、欄の外の額と率の書き方、選ぶ欄の見出し
import { h, options, type VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { allFields, plain, timepointField, whenContext, type FieldDef, type Option } from "../src/workspace/input/form.ts";
import { Field, optionNodes, readField, rejectReason } from "../src/workspace/input/FieldViews.tsx";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { blankLineFor } from "../src/workspace/input/placeholder.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { amountText, amountWarning, eraYear, parseYen, rateText, readYen, ymWithEra, type YenUnit } from "../src/workspace/input/units.ts";
import { ageExample, birthFromAge, edgeOf, readWhen, readYearMonth } from "../src/workspace/input/when.ts";
import { modelHousehold } from "./helpers.ts";

const open = (id: string) => fromRequest(modelHousehold(id));

/** 読んだ額（読めなければ "読めない"） */
const yen = (text: string, unit: YenUnit) => {
  const r = readYen(text, unit);
  return r.ok ? r.yen : "読めない";
};

describe("円・万円の欄の読み取り: 末尾の単位を見て換算する", () => {
  // [打った文字, 円の欄で読む額, 万円の欄で読む額]
  const TABLE: readonly (readonly [string, number | "読めない", number | "読めない"])[] = [
    ["15万", 150_000, 150_000],
    ["15万円", 150_000, 150_000],
    ["4500円", 4_500, 4_500],
    ["4,500円", 4_500, 4_500],
    ["478,200円", 478_200, 478_200],
    ["1,200", 1_200, 12_000_000],
    ["150000", 150_000, 1_500_000_000],
    ["12.5", "読めない", 125_000],
    ["0.5", "読めない", 5_000],
    ["15.5万", 155_000, 155_000],
    ["1.5億", 150_000_000, 150_000_000],
    ["1億2000万", 120_000_000, 120_000_000],
    ["1億2000万円", 120_000_000, 120_000_000],
    ["1万5000", 15_000, 15_000],
    ["1万5000円", 15_000, 15_000],
    ["5千円", 5_000, 5_000],
    ["¥150,000", 150_000, 150_000],
    ["１５万", 150_000, 150_000],
    ["１５０，０００円", 150_000, 150_000],
    ["15 万", 150_000, 150_000],
    ["12.34567", "読めない", 123_457],
    ["-3", -3, -30_000],
    ["万", "読めない", "読めない"],
    ["円", "読めない", "読めない"],
    ["abc", "読めない", "読めない"],
    ["十五万", "読めない", "読めない"],
    ["月15万", "読めない", "読めない"],
    ["1億2000", "読めない", "読めない"],
    ["0.5円", "読めない", "読めない"],
  ];
  it.each(TABLE)("「%s」: 円の欄 %s・万円の欄 %s", (text, inYen, inMan) => {
    expect(yen(text, "yen")).toBe(inYen);
    expect(yen(text, "man")).toBe(inMan);
    expect(parseYen(text, "yen")).toBe(inYen === "読めない" ? null : inYen);
    expect(parseYen(text, "man")).toBe(inMan === "読めない" ? null : inMan);
  });
  it("円の欄に「15万」と打っても15円にならない（前は末尾の「万」を消すだけで15円になっていた）", () => {
    expect(parseYen("15万", "yen")).toBe(150_000);
    expect(parseYen("4500円", "man")).toBe(4_500);
  });
  it("欄の単位と違う形で打ったら、読んだ額を1回知らせる。欄の単位のままなら知らせない", () => {
    const note = (t: string, u: YenUnit) => {
      const r = readYen(t, u);
      return r.ok ? r.note : r.reason;
    };
    expect(note("15万", "yen")).toBe("15万円（150,000円）として入れました");
    expect(note("4500円", "man")).toBe("4,500円（0.45万円）として入れました");
    expect(note("1.5億", "man")).toBe("1億5,000万円として入れました");
    expect(note("1万5000", "man")).toBe("15,000円（1.5万円）として入れました");
    for (const [t, u] of [["15", "man"], ["15万", "man"], ["15万円", "man"], ["150000", "yen"], ["150,000円", "yen"]] as const) expect(note(t, u), t).toBeNull();
  });
  it("読めない文字は理由を言う（欄の下に出す）", () => {
    const why = (t: string, u: YenUnit) => {
      const r = readYen(t, u);
      return r.ok ? "" : r.reason;
    };
    expect(why("1億2000", "man")).toBe("「1億2000万」のように、万まで書いてください");
    expect(why("0.5", "yen")).toContain("1円未満の端数は入れられません");
    expect(why("十五万", "man")).toContain("0〜9");
    expect(why("月15万", "man")).toContain("月額・年額は欄の横のボタン");
    expect(why("abc", "yen")).toContain("例: 150000・15万・150,000円");
  });
  it("書いた額を読み直すと同じ額（万円・円の往復は1円もずれない）", () => {
    for (const v of [0, 1, 4_500, 9_999, 10_000, 123_456, 150_000, 4_200_000, 120_000_000, 1_234_567_890]) {
      for (const u of ["man", "yen"] as const) {
        const shown = u === "man" ? String(v / 10_000).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : String(v);
        expect(parseYen(shown, u), `${u} ${shown}`).toBe(v);
      }
    }
  });
});

describe("桁が明らかにおかしい額の知らせ", () => {
  const warn = (t: string, u: YenUnit, basis: "monthly" | "annual" | "once", typicalMax?: number) => {
    const r = readYen(t, u);
    if (!r.ok) throw new Error(r.reason);
    return amountWarning(r, u, { basis, stored: r.yen, typicalMax, text: t });
  };
  it("万円の欄に円の額を単位なしで写した（「478200」→47億8,200万円）", () => {
    expect(warn("478200", "man", "annual")).toBe("47億8,200万円として入れました。書類に円で書いてある額なら「478,200円」のように「円」を付けて打ってください");
  });
  it("円の欄に万円のつもりで数字だけ（「15」→15円）", () => {
    expect(warn("15", "yen", "monthly")).toBe("15円として入れました。万円のつもりなら「15万」と打ってください");
  });
  it("月額で1,000万円・年額で1億円を超える額、欄ごとの目安の上限を超える額は「桁を確かめてください」", () => {
    expect(warn("1500万", "yen", "monthly")).toBe("月1,500万円として入れました。桁を確かめてください");
    expect(warn("2億", "man", "annual")).toBe("年2億円として入れました。桁を確かめてください");
    expect(warn("600", "man", "annual", 5_000_000)).toBe("年600万円として入れました。桁を確かめてください");
  });
  it("ふつうの額では知らせない", () => {
    expect(warn("15万", "yen", "monthly")).toBeNull();
    expect(warn("30", "man", "monthly")).toBeNull();
    expect(warn("2800", "man", "once")).toBeNull();
    expect(warn("4500円", "man", "monthly")).toBeNull();
  });
});

describe("欄の外の額と率の書き方", () => {
  it("1万円以上は万円で小数1桁まで、1万円未満は円。「月」「年」は前。マイナスは▲", () => {
    expect([0, 4_500, 9_999, 10_000, 45_000, 82_605, 99_950, 12_340_000].map((v) => amountText(v))).toEqual(["0円", "4,500円", "9,999円", "1万円", "4.5万円", "8.3万円", "10万円", "1,234万円"]);
    expect(amountText(50_000, "month")).toBe("月5万円");
    expect(amountText(4_500, "month")).toBe("月4,500円");
    expect(amountText(1_200_000, "year")).toBe("年120万円");
    expect(amountText(-45_000)).toBe("▲4.5万円");
  });
  it("率は百分率で小数2桁まで", () => {
    expect(["0.0124703", "0.01", "0.005", "0.00125", "0", "-0.0125"].map(rateText)).toEqual(["1.25%", "1%", "0.5%", "0.13%", "0%", "-1.25%"]);
  });
});

describe("年月の読みは西暦を主に、和暦の年を添える", () => {
  it("年月だけの欄", () => {
    expect(ymWithEra("2036-11")).toBe("2036年11月・令和18年");
    expect(eraYear("2019-04")).toBe("平成31年");
    expect(eraYear("2019-05")).toBe("令和元年");
    expect(readYearMonth("2036-11", "2026-11")).toBe("今から10年後（2036年11月・令和18年）");
    expect(readYearMonth("2020-04", "2026-11")).toBe("2020年4月・令和2年");
  });
});

/** 時点の欄の読みの文脈（ご本人は1986年6月生まれ。第1子・母も） */
function whenCtx(o: Record<string, unknown> = {}) {
  const wh = blankHousehold("2026-11", (() => {
    let i = 0;
    return () => `id-${++i}`;
  })());
  const self = wh.request.input.household.members[0]!;
  self.birth.birthYearMonth = "1986-06";
  wh.request.input.household.members.push(
    { id: "kid", kind: "child", birth: { birthYearMonth: "2016-04", bornOnFirst: false }, sex: "female", joins: null, leaves: null, expected: false },
    { id: "mom", kind: "parent", birth: { birthYearMonth: "1958-01", bornOnFirst: false }, sex: "female", joins: null, leaves: null, expected: false },
  );
  return { wh, self, ctx: { ...whenContext(wh, { defaultMode: "age", modes: ["age", "ym"], ageMeans: "reach", ...o }, { person: self.id }) } };
}

describe("時点の欄の読み: 期間の端の「まで」「から」（同じ「60歳」でも違う月を指すことが分かるように）", () => {
  it("終わりの欄は「○歳になる前の月（…）まで」、始まりの欄は「○歳になる月（…）から」", () => {
    const { self, ctx } = whenCtx();
    const until = { ...ctx, ageMeans: "before" as const };
    expect(readWhen({ memberAge: { member: self.id, years: 59, months: 11 } }, until)).toBe("ご本人が60歳になる前の月（2046年5月・令和28年）まで");
    const from = { ...ctx, edge: "from" as const };
    expect(readWhen({ memberAge: { member: self.id, years: 60 } }, from)).toBe("ご本人が60歳になる月（2046年6月・令和28年）から");
    // 年月で入れても、言える月は「○歳になる月から」
    expect(readWhen({ at: "2046-06" }, from)).toBe("今から19年7か月後・ご本人が60歳になる月（2046年6月・令和28年）から");
    expect(readWhen({ at: "2046-05" }, until)).toBe("今から19年6か月後・ご本人が60歳になる前の月（2046年5月・令和28年）まで");
  });
  it("端は欄の決まりから: 始まりのある欄と ageMeans before は「まで」、after は「から」、ほかは付けない", () => {
    expect(edgeOf({ ageMeans: "before" })).toBe("until");
    expect(edgeOf({ ageMeans: "reach", start: null })).toBe("until");
    expect(edgeOf({ ageMeans: "after" })).toBe("from");
    expect(edgeOf({ ageMeans: "reach" })).toBeNull();
    expect(edgeOf({ ageMeans: "reach", edge: "from" })).toBe("from");
  });
  it("働き方の期間の始まりの欄は「から」、終わりの欄は「まで」で読む（見本）", () => {
    const wh = open("salariedCoupleTwoKids");
    const fields = buildStages(wh).flatMap((s) => allFields(s));
    const from = fields.find((f) => /^work\/period\/.+\/from$/.test(f.key));
    const to = fields.find((f) => /^work\/period\/.+\/to$/.test(f.key) && f.time !== undefined && f.time.state(wh).raw !== null);
    expect(from?.time?.state(wh).read).toMatch(/）から$/);
    if (to !== undefined) expect(to.time?.state(wh).read).toMatch(/）まで(。始まりから.+間)?$/);
  });
});

describe("時点の欄の年齢の入力例は物差しの人で変える", () => {
  it("子は22歳、親は85歳、大人は65歳", () => {
    const { self, ctx } = whenCtx();
    expect(ageExample({ h: ctx.h, person: "kid" })).toBe("例: 22歳");
    expect(ageExample({ h: ctx.h, person: "mom" })).toBe("例: 85歳");
    expect(ageExample({ h: ctx.h, person: self.id })).toBe("例: 65歳");
    expect(ageExample({ h: ctx.h, person: null })).toBe("例: 65歳");
  });
});

describe("時点の欄で年齢を選べる人を絞る", () => {
  it("fixed はその欄の人だけ（人の選択を出さない）。関数は候補を絞り、今入っている人は残す", () => {
    const { wh, self } = whenCtx();
    const fixed = whenContext(wh, { defaultMode: "age", modes: ["age"], ageMeans: "before", who: "fixed" }, { person: self.id });
    expect(fixed.people.map((p) => p.id)).toEqual([self.id]);
    expect(fixed.personFixed).toBe(true);
    const adults = whenContext(wh, { defaultMode: "age", modes: ["age"], ageMeans: "reach", who: (m) => m.kind !== "child" }, { person: self.id });
    expect(adults.people.map((p) => p.id).sort()).toEqual([self.id, "mom"].sort());
    const keep = whenContext(wh, { defaultMode: "age", modes: ["age"], ageMeans: "reach", who: (m) => m.kind !== "child" }, { person: self.id, current: { memberAge: { member: "kid", years: 20 } } });
    expect(keep.people.map((p) => p.id)).toContain("kid");
    expect(whenContext(wh, { defaultMode: "age", modes: ["age"], ageMeans: "reach" }, { person: self.id }).people).toHaveLength(3);
  });
});

/** 生年月の欄（年齢でも入れられる）と、円の欄・万円の欄（テスト用。ご本人の構成員の中に書く） */
function testFields() {
  const find = (hh: { members: unknown[] }) => hh.members[0] as Record<string, unknown>;
  const birth = plain({ key: "t/birth", item: null, label: "生年月", level: "simple", kind: "ym", find, path: ["birth", "birthYearMonth"], ageInput: true });
  const pension = plain({ key: "t/yen", item: null, label: "年金月額", level: "simple", kind: "yen", basis: "monthly", unit: "yen", find, path: ["testYen"], optional: true });
  const loan = plain({ key: "t/man", item: null, label: "残高", level: "simple", kind: "yen", basis: "once", find, path: ["testMan"], optional: true, blankMeans: "今の残高から計算した額（借入の年月と金利から）" });
  return { birth, pension, loan };
}

describe("生年月の欄に年齢（「38歳」）", () => {
  it("年齢から生まれた年月を推定する（今の月に、その年齢の幅のまん中）", () => {
    expect(birthFromAge("38歳", "2026-11")).toEqual({ age: 38, ym: "1988-05" });
    expect(birthFromAge("３８", "2026-11")).toEqual({ age: 38, ym: "1988-05" });
    expect(birthFromAge("38才", "2026-11")?.ym).toBe("1988-05");
    expect(birthFromAge("121歳", "2026-11")).toBeNull();
    expect(birthFromAge("1988-05", "2026-11")).toBeNull();
  });
  it("年齢で入れると仮の値にして知らせる。年月は今までどおり", () => {
    const { birth } = testFields();
    const o = { unit: "man" as const, period: "monthly" as const, baseMonth: "2026-11" };
    expect(readField(birth, "38歳", o)).toEqual({ v: "1988-05", note: "38歳（1988年5月生まれとして入れました。月が分かれば直してください）", warn: null, assume: "仮の値（38歳から推定した生年月）" });
    expect(readField(birth, "1988-05", o)).toEqual({ v: "1988-05", note: null, warn: null, assume: null });
    expect(rejectReason(birth, "わからない")).toContain("年齢しか分からなければ「38歳」");
    // 年齢を受け付けない年月の欄は今までどおり読めない
    const plainYm = { ...birth, kind: "ym" as const, ageInput: false } as FieldDef;
    expect(readField(plainYm, "38歳", o)).toBeUndefined();
    expect(rejectReason(plainYm, "38歳")).toBe("年月は「2020-04」「令和2年4月」のように、西暦か和暦の年と月で入れてください");
  });
});

describe("円の欄の値の読み（見せている単位と期間で読み、保存の期間の額にする）", () => {
  it("円の欄の「15万」は150,000円、年額で見せているときの「180万」は月15万円", () => {
    const { pension } = testFields();
    expect(readField(pension, "15万", { unit: "yen", period: "monthly", baseMonth: "2026-11" })).toMatchObject({ v: 150_000, note: "15万円（150,000円）として入れました", warn: null });
    expect(readField(pension, "180万", { unit: "yen", period: "annual", baseMonth: "2026-11" })).toMatchObject({ v: 150_000 });
    expect(readField(pension, "15", { unit: "yen", period: "monthly", baseMonth: "2026-11" })).toMatchObject({ v: 15, warn: "15円として入れました。万円のつもりなら「15万」と打ってください" });
    expect(readField(pension, "1億2000", { unit: "yen", period: "monthly", baseMonth: "2026-11" })).toBeUndefined();
    expect(rejectReason(pension, "1億2000", "yen")).toBe("「1億2000万」のように、万まで書いてください");
    expect(readField(pension, "", { unit: "yen", period: "monthly", baseMonth: "2026-11" })).toEqual({ v: null, note: null, warn: null, assume: null });
  });
});

/** 欄を描いて、input の操作（onInput・onBlur）を取り出す（画面を描かずに、欄の部品の操作を確かめる） */
function renderField(f: FieldDef, wh: WorkingHousehold, onEdit: (w: WorkingHousehold) => void) {
  const inputs: VNode<Record<string, unknown>>[] = [];
  const prev = options.vnode;
  options.vnode = (v) => {
    if (v.type === "input") inputs.push(v as VNode<Record<string, unknown>>);
    prev?.(v);
  };
  try {
    const html = renderToString(h(Field, { f, wh, onEdit }));
    return { html, input: inputs[0]! };
  } finally {
    options.vnode = prev;
  }
}
const ev = (value: string) => ({ currentTarget: { value } });

describe("欄は、離れたとき（Enter）に決める（打っている途中の文字で世帯を変えない）", () => {
  it("打っている間は世帯を変えず、離れたときに読んで入れる（円の欄の「15万」は150,000円）", () => {
    const wh = blankHousehold("2026-11");
    const { pension } = testFields();
    const edits: WorkingHousehold[] = [];
    const { input } = renderField(pension, wh, (w) => edits.push(w));
    const onInput = input.props.onInput as (e: unknown) => void;
    const onBlur = input.props.onBlur as (e: unknown) => void;
    // 途中の「1」「15」「15万」、空、読めない文字では書かない（前は打つたびに 1円・15円…と書いていた）
    for (const t of ["1", "15", "15万", "", "15万x"]) onInput(ev(t));
    expect(edits).toHaveLength(0);
    onBlur(ev("15万"));
    expect(edits).toHaveLength(1);
    expect((edits[0]!.request.input.household.members[0] as unknown as { testYen: number }).testYen).toBe(150_000);
  });
  it("読めない文字のまま離れても書かない", () => {
    const wh = blankHousehold("2026-11");
    const { pension } = testFields();
    const edits: WorkingHousehold[] = [];
    const { input } = renderField(pension, wh, (w) => edits.push(w));
    (input.props.onBlur as (e: unknown) => void)(ev("十五万"));
    expect(edits).toHaveLength(0);
  });
  it("生年月に「38歳」と打って離れると、推定した年月と仮の印が入る", () => {
    const wh = blankHousehold("2026-11");
    const { birth } = testFields();
    const edits: WorkingHousehold[] = [];
    const { input } = renderField(birth, wh, (w) => edits.push(w));
    (input.props.onInput as (e: unknown) => void)(ev("38歳"));
    expect(edits).toHaveLength(0);
    (input.props.onBlur as (e: unknown) => void)(ev("38歳"));
    expect(edits[0]!.request.input.household.members[0]!.birth.birthYearMonth).toBe("1988-05");
    expect(edits[0]!.assumed["t/birth"]).toBe("仮の値（38歳から推定した生年月）");
  });
});

describe("入力例と空欄の意味", () => {
  it("年月の欄の共通の例は過去の年月、生年月の欄は生年月の例", () => {
    const wh = blankHousehold("2026-11");
    const { birth } = testFields();
    const plainYm = plain({ key: "t/at", item: null, label: "残高の時点", level: "simple", kind: "ym", find: (hh) => hh.members[0] as unknown as Record<string, unknown>, path: ["testAt"], optional: true });
    expect(renderField(plainYm, wh, () => undefined).input.props.placeholder).toBe("例: 2020-04");
    const noBirth = structuredClone(wh);
    (noBirth.request.input.household.members[0]!.birth as { birthYearMonth?: string }).birthYearMonth = undefined;
    expect(renderField(birth, noBirth, () => undefined).input.props.placeholder).toBe("例: 1988-05");
    const withExample = { ...plainYm, example: "例: 2025-03" } as FieldDef;
    expect(renderField(withExample, wh, () => undefined).input.props.placeholder).toBe("例: 2025-03");
  });
  it("空欄の意味は欄の中に「空欄＝○○」、収まらなければ欄の下に「空欄なら: ○○」", () => {
    expect(blankLineFor("num", "推定")).toBeNull();
    expect(blankLineFor("num", "今の残高から計算した額（借入の年月と金利から）")).toBe("空欄なら: 今の残高から計算した額（借入の年月と金利から）");
    const wh = blankHousehold("2026-11");
    const { loan } = testFields();
    const r = renderField(loan, wh, () => undefined);
    expect(r.input.props.placeholder).toBe("");
    expect(r.html).toContain("空欄なら: 今の残高から計算した額（借入の年月と金利から）");
    const short = { ...loan, blankMeans: "0円" } as FieldDef;
    expect(renderField(short, wh, () => undefined).input.props.placeholder).toBe("空欄＝0円");
  });
  it("時点の欄の例は欄で持てる", () => {
    const wh = blankHousehold("2026-11");
    const f = timepointField({ key: "t/when", item: "employment.to", label: "いつ", level: "simple", find: (hh) => hh.members[0] as unknown as Record<string, unknown>, path: ["testWhen"], optional: true, ageOf: (hh) => hh.members[0], example: "例: 70歳" });
    expect(renderField(f, wh, () => undefined).input.props.placeholder).toBe("例: 70歳");
    const g = timepointField({ key: "t/when2", item: "employment.to", label: "いつ", level: "simple", find: (hh) => hh.members[0] as unknown as Record<string, unknown>, path: ["testWhen"], optional: true, ageOf: (hh) => hh.members[0] });
    expect(renderField(g, wh, () => undefined).input.props.placeholder).toBe("例: 65歳");
  });
});

describe("選ぶ欄の見出し（optgroup）", () => {
  it("同じ見出しが続く選択肢を1つの見出しの下にまとめ、見出しの無い選択肢は外に出す", () => {
    const opts: Option[] = [
      { value: "a", label: "よく使うA", group: "よく使う" },
      { value: "b", label: "よく使うB", group: "よく使う" },
      { value: "c", label: "死亡の保障C", group: "死亡の保障" },
      { value: "z", label: "そのほか" },
    ];
    const html = renderToString(h("select", {}, optionNodes(opts)));
    expect(html).toBe('<select><optgroup label="よく使う"><option value="a">よく使うA</option><option value="b">よく使うB</option></optgroup><optgroup label="死亡の保障"><option value="c">死亡の保障C</option></optgroup><option value="z">そのほか</option></select>');
  });
});
