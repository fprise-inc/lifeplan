// 時点の部品（0038）: 打った文字の読み取り（年月・和暦・人の年齢・出来事から・今から・「10年間」のような期間）、見せ方と読み直し、
// 年齢の切り替えの規則がエンジンと同じこと、欄の読み書き（出来事が正本・まだ出来事でない物を出来事にする・人を外したとき）、
// 時点の形を年齢・出来事に直しても計算の結果が変わらないこと
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgeSwitch, type AgeSwitch } from "../../engine/src/time/ageSwitch.ts";
import { formatYm } from "../../engine/src/time/month.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import type { EngineRequest, Household, Member, Timepoint } from "../src/engine/types.ts";
import { readLevers } from "../src/workspace/levers.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { eventChoices } from "../src/workspace/input/namedEvents.ts";
import { removeMember } from "../src/workspace/input/stages/family.ts";
import { buildStage, buildStages } from "../src/workspace/input/stages/index.ts";
import { parseWareki, parseYearMonth } from "../src/workspace/input/units.ts";
import { convertWhen, DEFAULT_WHEN_MODES, durationEnd, modeOf, parseWhen, readWhen, readYearMonth, sameWhen, showWhen, WHEN_MODES, type AgeMeans, type WhenCtx, type WhenMode } from "../src/workspace/input/when.ts";
import { ageSwitchMonth, resolveTimepoint } from "../src/workspace/timepoint.ts";
import { modelHousehold, preview } from "./helpers.ts";

const SELF = "11111111-1111-4111-8111-111111111111";
const SPOUSE = "22222222-2222-4222-8222-222222222222";
const SON = "33333333-3333-4333-8333-333333333333";
const DAUGHTER = "44444444-4444-4444-8444-444444444444";
const MOVE_IN = "55555555-5555-4555-8555-555555555555";

const member = (id: string, kind: string, birth: string, sex: "male" | "female", bornOnFirst = false): Member => ({ id, kind, birth: { birthYearMonth: birth, bornOnFirst }, sex, joins: null, leaves: null });
const H: Pick<Household, "members" | "events"> = {
  members: [member(SELF, "self", "1986-05", "male"), member(SPOUSE, "spouse", "1988-09", "female"), member(SON, "child", "2016-07", "male"), member(DAUGHTER, "child", "2019-04", "female", true)],
  events: [{ id: MOVE_IN, kind: "moveIn", at: { at: "2028-04" } }],
};

function ctx(o: Partial<WhenCtx> = {}): WhenCtx {
  return {
    h: H,
    baseMonth: "2026-10",
    people: [
      { id: SELF, label: "ご本人", names: ["本人", "夫", "ご本人"] },
      { id: SPOUSE, label: "配偶者", names: ["妻", "配偶者"] },
      { id: SON, label: "長男", names: ["長男", "上の子"] },
      { id: DAUGHTER, label: "長女", names: ["長女", "下の子", "末子"] },
    ],
    person: SELF,
    events: [{ id: MOVE_IN, label: "入居", names: ["入居", "住宅の入居"], ym: "2028-04" }],
    modes: WHEN_MODES,
    defaultMode: "age",
    ageMeans: "reach",
    optional: true,
    ...o,
  };
}

/** 読んだ時点（読めなければ理由の文字） */
function tp(text: string, o: Partial<WhenCtx> = {}): Timepoint | null | string {
  const r = parseWhen(text, ctx(o));
  return r.ok ? r.tp : r.reason;
}
/** 読んで年月に解いた月 */
const ym = (text: string, o: Partial<WhenCtx> = {}) => {
  const t = tp(text, o);
  return typeof t === "string" ? t : resolveTimepoint(H, t);
};


/** 欄の外の年月の形（西暦の年月・和暦の年） */
const ERA_YM = /\d{4}年\d{1,2}月・(令和|平成|昭和|大正|明治)(元|\d+)年/;
const ERA_YM_ALL = new RegExp(ERA_YM.source, "g");
describe("年月と和暦の読み取り", () => {
  it.each([
    ["2041-06", "2041-06"],
    ["2041/6", "2041-06"],
    ["2041.6", "2041-06"],
    ["２０４１年６月", "2041-06"],
    ["2041年6月から", "2041-06"],
    ["204106", "2041-06"],
    ["2041－6", "2041-06"],
    ["令和23年6月", "2041-06"],
    ["R23.6", "2041-06"],
    ["r23/6", "2041-06"],
    ["Ｒ２３．６", "2041-06"],
    ["令和元年5月", "2019-05"],
    ["平成31年4月", "2019-04"],
    ["H31.4", "2019-04"],
    ["平成元年1月", "1989-01"],
    ["昭和64年1月", "1989-01"],
    ["S56.7", "1981-07"],
    ["昭和元年12月", "1926-12"],
    ["大正15年12月", "1926-12"],
    ["明治45年7月", "1912-07"],
  ])("%s → %s", (text, want) => {
    expect(tp(text)).toEqual({ at: want });
  });

  it("年だけ・月の外れた年月は、欄の下に出す理由を返す", () => {
    expect(tp("2041")).toContain("月も入れてください");
    expect(tp("2041年")).toContain("月も入れてください");
    expect(tp("令和23年")).toContain("月も入れてください");
    expect(tp("2041-13")).toContain("1〜12");
    expect(tp("あした")).toContain("読めませんでした");
  });

  it("年月の欄（kind ym）も和暦を読む", () => {
    expect(parseYearMonth("令和23年6月")).toBe("2041-06");
    expect(parseYearMonth("H31.4")).toBe("2019-04");
    expect(parseWareki("2041-06")).toBeNull();
    expect(parseYearMonth("2041-06")).toBe("2041-06");
  });
});

describe("人の年齢の読み取り", () => {
  it("既定の人の年齢（「60歳」「60」）は、その年齢になる月", () => {
    expect(tp("60歳")).toEqual({ memberAge: { member: SELF, years: 60 } });
    expect(tp("60")).toEqual({ memberAge: { member: SELF, years: 60 } });
    expect(ym("60歳")).toBe("2046-05");
    expect(tp("６０歳")).toEqual({ memberAge: { member: SELF, years: 60 } });
  });
  it("か月まで（ヶ月・カ月も）", () => {
    expect(tp("60歳3か月")).toEqual({ memberAge: { member: SELF, years: 60, months: 3 } });
    expect(tp("60歳3ヶ月")).toEqual(tp("60歳3か月"));
    expect(tp("60歳3カ月")).toEqual(tp("60歳3か月"));
    expect(ym("60歳11か月")).toBe("2047-04");
  });
  it("人を書くと、その人の年齢（妻65歳・妻が65歳・下の子22歳）", () => {
    expect(tp("妻65歳")).toEqual({ memberAge: { member: SPOUSE, years: 65 } });
    expect(tp("妻が65歳")).toEqual({ memberAge: { member: SPOUSE, years: 65 } });
    expect(tp("下の子22歳")).toEqual({ memberAge: { member: DAUGHTER, years: 22 } });
    expect(tp("長男の18歳")).toEqual({ memberAge: { member: SON, years: 18 } });
  });
  it("1日生まれは、年齢に達する月が1か月早い（境目の年齢）", () => {
    // 長女は 2019年4月1日生まれ: 6歳に達する日は 2025年3月31日
    expect(ym("長女6歳")).toBe("2025-03");
    expect(ym("長男6歳")).toBe("2022-07");
    // 学年の始まり: 4月1日生まれは前の学年（6歳の4月 = 2025年4月）、7月生まれは翌年の4月
    expect(ym("長女6歳の4月")).toBe("2025-04");
    expect(ym("長男6歳の4月")).toBe("2023-04");
    // 年度末: 達する日以後の最初の3月
    expect(ym("長男22歳の年度末")).toBe("2039-03");
    expect(ym("長女22歳の年度末")).toBe("2041-03");
  });
  it("前月・翌月・誕生月", () => {
    expect(tp("60歳の前月")).toEqual({ memberAge: { member: SELF, years: 59, months: 11 } });
    expect(ym("60歳の前月")).toBe("2046-04");
    expect(tp("60歳の翌月")).toEqual({ memberAge: { member: SELF, years: 60, ageSwitch: "monthAfterReach" } });
    expect(ym("60歳の翌月")).toBe("2046-06");
    expect(ym("長女3歳の誕生月の翌月")).toBe("2022-05");
  });
  it("欄の決まり: 「○歳まで」の欄は前の月、受け取り開始の欄は翌月", () => {
    expect(tp("65歳", { ageMeans: "before" })).toEqual({ memberAge: { member: SELF, years: 64, months: 11 } });
    expect(ym("65歳まで", { ageMeans: "before" })).toBe("2051-04");
    expect(tp("65歳", { ageMeans: "after" })).toEqual({ memberAge: { member: SELF, years: 65, ageSwitch: "monthAfterReach" } });
    expect(tp("66歳3か月", { ageMeans: "after" })).toEqual({ memberAge: { member: SELF, years: 66, months: 3, ageSwitch: "monthAfterReach" } });
    expect(ym("66歳3か月", { ageMeans: "after" })).toBe("2052-09");
    // 書いた言葉が欄の決まりより先
    expect(tp("65歳になる月", { ageMeans: "before" })).toEqual({ memberAge: { member: SELF, years: 65 } });
  });
  it("読めない年齢の理由", () => {
    expect(tp("131歳")).toContain("130歳");
    expect(tp("60歳12か月")).toContain("0〜11");
    expect(tp("母65歳")).toContain("「母」が誰か分かりません");
    expect(tp("0歳の前月")).toContain("0歳より前");
    expect(tp("60歳", { person: null })).toContain("誰の年齢か");
    expect(tp("60歳", { people: [], person: null })).toContain("生年月");
  });
});

describe("今から・出来事から・「10年間」のような期間", () => {
  it("今から（計算の基準の月から）", () => {
    expect(tp("5年後")).toEqual({ at: "2031-10" });
    expect(tp("今から3か月後")).toEqual({ at: "2027-01" });
    expect(tp("1年6か月後")).toEqual({ at: "2028-04" });
    expect(tp("今月")).toEqual({ at: "2026-10" });
    expect(tp("来月")).toEqual({ at: "2026-11" });
    expect(tp("来年4月")).toEqual({ at: "2027-04" });
    expect(tp("再来年4月")).toEqual({ at: "2028-04" });
    // 今からの形を見せているときの数だけは年数
    expect(tp("5", { mode: "now" })).toEqual({ at: "2031-10" });
  });
  it("出来事から（名前・翌月・何年後・何年前）", () => {
    expect(tp("入居")).toEqual({ event: MOVE_IN });
    expect(tp("入居の翌月")).toEqual({ event: MOVE_IN, offset: { months: 1 } });
    expect(tp("入居から10年後")).toEqual({ event: MOVE_IN, offset: { years: 10 } });
    expect(tp("入居の10年後")).toEqual({ event: MOVE_IN, offset: { years: 10 } });
    expect(tp("住宅の入居から1年6か月後")).toEqual({ event: MOVE_IN, offset: { years: 1, months: 6 } });
    expect(tp("入居の2年前")).toEqual({ event: MOVE_IN, offset: { years: -2 } });
    expect(ym("入居から10年後")).toBe("2038-04");
    expect(tp("入居の年の4月")).toContain("まだ入れられません");
    // 出来事の形を見せているときの「10年後」は、その出来事から
    expect(tp("10年後", { mode: "event", current: { event: MOVE_IN } })).toEqual({ event: MOVE_IN, offset: { years: 10 } });
    expect(tp("翌月", { mode: "event", current: { event: MOVE_IN } })).toEqual({ event: MOVE_IN, offset: { months: 1 } });
    expect(tp("今から10年後", { mode: "event", current: { event: MOVE_IN } })).toEqual({ at: "2036-10" });
  });
  it("終わりの欄の「10年間」のような入れ方は、始まりと同じ形で最後の月を持つ", () => {
    expect(tp("10年間", { start: { at: "2030-04" } })).toEqual({ at: "2040-03" });
    expect(tp("5年間", { start: { memberAge: { member: SELF, years: 60 } } })).toEqual({ memberAge: { member: SELF, years: 64, months: 11 } });
    expect(tp("3年間", { start: { event: MOVE_IN } })).toEqual({ event: MOVE_IN, offset: { years: 2, months: 11 } });
    expect(tp("6か月間", { start: { at: "2030-04" } })).toEqual({ at: "2030-09" });
    expect(tp("10年間")).toContain("終わりの欄");
    expect(tp("10年間", { start: null })).toContain("始まりが決まっていない");
    expect(durationEnd({ h: H }, { memberAge: { member: SON, years: 6, ageSwitch: "schoolYear" } }, 72)).toEqual({ at: "2029-03" });
  });
  it("空欄と「最後まで」", () => {
    expect(tp("")).toBeNull();
    expect(tp("最後まで")).toBeNull();
    expect(tp("", { optional: false })).toContain("空にはできません");
  });
  it("欄で使えない入れ方は、使える入れ方を知らせる", () => {
    expect(tp("60歳", { modes: ["ym"] })).toContain("年月");
    expect(tp("入居", { modes: ["age", "ym"] })).toContain("出来事から");
    expect(tp("2041年6月", { modes: ["age", "event"] })).toContain("年齢");
  });
});

describe("見せ方と読み直し", () => {
  const cases: [Timepoint, AgeMeans, WhenMode, string][] = [
    [{ at: "2041-06" }, "reach", "ym", "2041-06"],
    [{ memberAge: { member: SELF, years: 60 } }, "reach", "age", "60歳"],
    [{ memberAge: { member: SPOUSE, years: 65 } }, "reach", "age", "妻65歳"],
    [{ memberAge: { member: SELF, years: 60, months: 3 } }, "reach", "age", "60歳3か月"],
    [{ memberAge: { member: SELF, years: 64, months: 11 } }, "before", "age", "65歳"],
    [{ memberAge: { member: SELF, years: 65, ageSwitch: "monthAfterReach" } }, "after", "age", "65歳"],
    [{ memberAge: { member: SELF, years: 66, months: 3, ageSwitch: "monthAfterReach" } }, "after", "age", "66歳3か月"],
    [{ memberAge: { member: SON, years: 22, ageSwitch: "firstMarch31AfterReach" } }, "reach", "age", "長男22歳の年度末"],
    [{ memberAge: { member: DAUGHTER, years: 6, ageSwitch: "schoolYear" } }, "reach", "age", "長女6歳の4月"],
    [{ memberAge: { member: SELF, years: 60 } }, "before", "age", "60歳になる月"],
    [{ event: MOVE_IN }, "reach", "event", "入居"],
    [{ event: MOVE_IN, offset: { months: 1 } }, "reach", "event", "入居の翌月"],
    [{ event: MOVE_IN, offset: { years: 10 } }, "reach", "event", "入居から10年後"],
    [{ event: MOVE_IN, offset: { years: -2 } }, "reach", "event", "入居の2年前"],
  ];
  it.each(cases)("%j（%s）→ 「%s」を読み直すと同じ時点", (t, means, mode, text) => {
    const c = ctx({ ageMeans: means });
    expect(modeOf(t, c)).toBe(mode);
    expect(showWhen(t, c)).toBe(text);
    const back = parseWhen(text, { ...c, mode, current: t });
    expect(back.ok && sameWhen(back.tp, t)).toBe(true);
  });
  it("年月の形は、欄の既定の入れ方に合えば年齢・今からで見せる（形は変えない）", () => {
    expect(showWhen({ at: "2046-05" }, ctx())).toBe("60歳");
    expect(showWhen({ at: "2046-06" }, ctx())).toBe("2046-06");
    expect(showWhen({ at: "2051-04" }, ctx({ ageMeans: "before" }))).toBe("65歳");
    expect(showWhen({ at: "2051-06" }, ctx({ ageMeans: "after" }))).toBe("65歳");
    expect(showWhen({ at: "2029-10" }, ctx({ defaultMode: "now" }))).toBe("3年後");
    expect(showWhen({ at: "2026-10" }, ctx({ defaultMode: "now" }))).toBe("今月");
    expect(showWhen({ at: "2020-10" }, ctx({ defaultMode: "now" }))).toBe("2020-10");
  });
  it("欄の下の読み替えた形", () => {
    expect(readWhen({ memberAge: { member: SELF, years: 60 } }, ctx())).toBe("ご本人が60歳になる月（2046年5月・令和28年）");
    expect(readWhen({ memberAge: { member: SELF, years: 64, months: 11 } }, ctx({ ageMeans: "before" }))).toBe("ご本人が65歳になる前の月（2051年4月・令和33年）まで");
    expect(readWhen({ memberAge: { member: SELF, years: 65, ageSwitch: "monthAfterReach" } }, ctx({ ageMeans: "after" }))).toBe("ご本人が65歳になった翌月（2051年6月・令和33年）から");
    expect(readWhen({ event: MOVE_IN, offset: { years: 10 } }, ctx())).toBe("入居から10年後（2038年4月・令和20年。入居は2028年4月）");
    expect(readWhen({ at: "2041-06" }, ctx())).toBe("今から14年8か月後・ご本人55歳（2041年6月・令和23年）");
    expect(readWhen(null, ctx(), "最後まで")).toBe("最後まで");
    expect(readWhen({ at: "2040-03" }, ctx({ start: { at: "2030-04" } }))).toContain("始まりから10年間");
  });
  it("入れ方を変えても同じ月（年齢 ⇄ 年月 ⇄ 出来事から）", () => {
    const c = ctx();
    const at: Timepoint = { at: "2046-05" };
    expect(convertWhen(at, "age", c)).toEqual({ memberAge: { member: SELF, years: 60 } });
    expect(convertWhen(at, "age", c, { person: SPOUSE })).toEqual({ memberAge: { member: SPOUSE, years: 57, months: 8 } });
    expect(convertWhen({ memberAge: { member: SELF, years: 60 } }, "ym", c)).toEqual(at);
    expect(convertWhen(at, "event", c, { event: MOVE_IN })).toEqual({ event: MOVE_IN, offset: { years: 18, months: 1 } });
    expect(convertWhen(at, "age", ctx({ ageMeans: "after" }))).toEqual({ memberAge: { member: SELF, years: 59, months: 11, ageSwitch: "monthAfterReach" } });
    expect(convertWhen({ at: "1980-01" }, "age", c)).toBeNull();
  });
});

describe("年齢の切り替えの規則は、エンジンと同じ月に解く", () => {
  const rules: AgeSwitch[] = ["reachMonth", "monthAfterReach", "birthdayMonth", "monthAfterBirthday", "firstMarch31AfterReach", "schoolYear"];
  it("生まれ月12通り×1日生まれか×年齢×規則", () => {
    for (let mo = 1; mo <= 12; mo++)
      for (const first of [false, true])
        for (const years of [0, 3, 6, 18, 22, 60, 65, 75])
          for (const months of [0, 5, 11])
            for (const rule of rules) {
              const birth = { birthYearMonth: `2000-${String(mo).padStart(2, "0")}`, bornOnFirst: first };
              expect(ageSwitchMonth({ birth }, years, months, rule), `${birth.birthYearMonth} ${first} ${years}/${months} ${rule}`).toBe(formatYm(resolveAgeSwitch(birth, { years, months }, rule)));
            }
  });
});

// ---- 欄の読み書き ----

const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const open = (id: string) => fromRequest(modelHousehold(id));
const timeFields = (wh: WorkingHousehold): FieldDef[] => buildStages(wh).flatMap((s) => allFields(s)).filter((f) => f.time !== undefined);
const byKey = (wh: WorkingHousehold, key: string) => buildStages(wh).flatMap((s) => allFields(s)).find((f) => f.key === key) as FieldDef;
const tableOf = (req: EngineRequest) => JSON.stringify(preview(req).table);

describe("時点の欄の読み書き", () => {
  it("加わる時期は生年月の欄と同じ表記（2048-04）と読み（○歳（和暦））。入れ方の選択は残し、年齢・出来事の形は書き換えない（子の独立の欄は出さない。0062 の追記 2026-10-30）", () => {
    const wh = open("salariedCoupleTwoKids");
    const h = wh.request.input.household;
    const son = h.members.find((m) => m.kind === "child")!;
    const sp = h.members.find((m) => m.kind === "spouse")!;
    expect(byKey(wh, `family/${son.id}/leaves`)).toBeUndefined();
    // 加わる時期（詳細）: 年月で入れると「○歳（和暦）」。年齢の形で持つ世帯は開いても変えない
    const j = byKey(wh, `family/${sp.id}/joins`);
    expect(j.time!.when.modes).toEqual(DEFAULT_WHEN_MODES);
    const w2 = j.set(wh, "2027-04");
    const age = Math.floor((2027 * 12 + 3 - (Number(sp.birth.birthYearMonth.slice(0, 4)) * 12 + Number(sp.birth.birthYearMonth.slice(5, 7)) - 1)) / 12);
    expect(j.get(w2).when!.read).toBe(`${age}歳（2027年4月・令和9年）`);
    const old = structuredClone(wh.request);
    old.input.household.members.find((m) => m.id === sp.id)!.joins = { memberAge: { member: sp.id, years: 60 } };
    const wo = fromRequest(old);
    const before = JSON.stringify(wo.request);
    expect(byKey(wo, `family/${sp.id}/joins`).get(wo).when!.raw).toEqual({ memberAge: { member: sp.id, years: 60 } });
    expect(JSON.stringify(wo.request)).toBe(before);
  });

  it("年齢で入れた時点は年齢のまま持ち、欄の値は年月に解いて見せる（同じ時点の入れ直しは世帯を変えない）", () => {
    const wh = open("salariedCoupleTwoKids");
    const h = wh.request.input.household;
    const sp = h.members.find((m) => m.kind === "spouse")!;
    const f = byKey(wh, `family/${sp.id}/joins`);
    const w1 = f.time!.setWhen(wh, { memberAge: { member: sp.id, years: 60 } }, "auto");
    const joins = w1.request.input.household.members.find((m) => m.id === sp.id)!.joins;
    expect(joins).toEqual({ memberAge: { member: sp.id, years: 60 } });
    expect(f.get(w1).value).toBe(resolveTimepoint(w1.request.input.household, joins!));
    expect(f.time!.setWhen(w1, structuredClone(joins) as Timepoint, "auto")).toBe(w1);
    expect(f.set(w1, f.get(w1).value)).toBe(w1);
    expect(() => preview(w1.request)).not.toThrow();
  });

  it("出来事が正本: 出来事を指す欄（持ち家の住み始め＝入居）に年月を入れると、出来事が動き、指している物が全部動く", () => {
    const wh = open("salariedCoupleTwoKids");
    const h = wh.request.input.household;
    const ev = h.events![0]!;
    const res = h.residences![0]!;
    const f = byKey(wh, `housing/res/${res.id}/from`);
    const st = f.get(wh).when!;
    expect(st.linked).toMatchObject({ event: ev.id, label: "入居" });
    const w1 = f.time!.setWhen(wh, { at: "2017-04" }, "auto");
    const h1 = w1.request.input.household;
    expect(h1.residences![0]!.from).toEqual({ event: ev.id });
    expect(h1.events![0]!.at).toEqual({ at: "2017-04" });
    // 入れ方を選び直したとき（この欄だけ）は、出来事から切り離す
    const w2 = f.time!.setWhen(wh, { at: "2017-04" }, "this");
    expect(w2.request.input.household.residences![0]!.from).toEqual({ at: "2017-04" });
    expect(w2.request.input.household.events![0]!.at).toEqual({ at: "2016-04" });
  });

  it("まだ出来事でない物（下の子の独立）を選ぶと出来事にし、元の物もその出来事を指す。独立を動かすと生活費の節目も動く", () => {
    const wh = open("salariedCoupleTwoKids");
    const h = wh.request.input.household;
    const daughter = h.members.filter((m) => m.kind === "child").at(-1)!;
    const living = h.livingExpenses![0]!;
    const stageKey = buildStages(wh)
      .flatMap((s) => allFields(s))
      .find((f) => f.key.startsWith(`living/${living.id}/stage/`) && f.key.endsWith("/at"))!.key;
    const f = byKey(wh, stageKey);
    const cand = eventChoices(wh).find((e) => e.candidate === true && e.names.includes("下の子の独立"))!;
    expect(cand).toBeDefined();
    const w1 = f.time!.setWhen(wh, { event: cand.id }, "auto");
    const h1 = w1.request.input.household;
    const ev = h1.events!.find((e) => e.kind === "independence")!;
    expect(ev).toMatchObject({ member: daughter.id, at: { at: "2038-04" } });
    expect(h1.members.find((m) => m.id === daughter.id)!.leaves).toEqual({ event: ev.id });
    expect(h1.livingExpenses![0]!.stages![0]!.at).toEqual({ event: ev.id });
    // 出来事にしても結果は同じ
    expect(tableOf(w1.request)).toBe(tableOf(wh.request));
    // 独立の出来事（正本）を「23歳」にすると、生活費の節目も動く（子の独立の欄は出さないので、出来事を直に動かす。0062 の追記 2026-10-30）
    const w2 = mutate(w1, (hh) => void (hh.events!.find((e) => e.id === ev.id)!.at = { memberAge: { member: daughter.id, years: 23 } }));
    const h2 = w2.request.input.household;
    expect(h2.events!.find((e) => e.id === ev.id)!.at).toEqual({ memberAge: { member: daughter.id, years: 23 } });
    expect(resolveTimepoint(h2, h2.livingExpenses![0]!.stages![0]!.at)).toBe("2038-08");
    expect(() => preview(w2.request)).not.toThrow();
    // その子を外すと、その子の年齢・出来事で決めた時点は年月に直る（解けない時点を残さない）
    const w3 = removeMember(w2, daughter.id);
    const h3 = w3.request.input.household;
    expect(h3.events!.some((e) => e.id === ev.id)).toBe(false);
    expect(h3.livingExpenses![0]!.stages![0]!.at).toEqual({ at: "2038-08" });
    expect(() => preview(w3.request)).not.toThrow();
  });

  it("年金の受け取り開始: 月まで（66歳3か月）入れられ、整数の年齢の欄・打ち手は年齢で読む。範囲の外は理由を出す", () => {
    const wh = open("salariedCoupleTwoKids");
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const rec = wh.request.input.household.pensionRecords!.find((r) => r.member === self.id)!;
    const f = byKey(wh, `pension/${rec.id}/claim`);
    expect(f.kind).toBe("int");
    expect(f.time!.state(wh).read).toBe("65歳から（標準）: ご本人が65歳になった翌月（2046年8月・令和28年）から");
    const tp66: Timepoint = { memberAge: { member: self.id, years: 66, months: 3, ageSwitch: "monthAfterReach" } };
    const w1 = f.time!.setWhen(wh, tp66, "auto");
    const r1 = w1.request.input.household.pensionRecords!.find((r) => r.member === self.id)!;
    expect(r1.claim).toEqual({ basic: tp66, employee: tp66 });
    expect(f.get(w1).value).toBe(66);
    expect(readLevers(w1.request, self.id).pensionAge).toBe(66);
    expect(() => preview(w1.request)).not.toThrow();
    // 65歳ちょうど（標準）は省く
    const w2 = f.time!.setWhen(w1, { memberAge: { member: self.id, years: 65, ageSwitch: "monthAfterReach" } }, "auto");
    expect(w2.request.input.household.pensionRecords!.find((r) => r.member === self.id)!.claim).toBeUndefined();
    expect(f.time!.when.check!(wh, { memberAge: { member: self.id, years: 59, ageSwitch: "monthAfterReach" } })).toContain("60歳になった翌月");
    expect(f.time!.when.check!(wh, { memberAge: { member: self.id, years: 75, ageSwitch: "monthAfterReach" } })).toBeNull();
  });

  it("働く最後: 年齢なら打ち手と同じ、年度末のような年月でも入れられる（退職の段階の生活費は翌月から）", () => {
    const wh = open("salariedCoupleTwoKids");
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const f = byKey(wh, `work/${self.id}/retireAge`);
    expect(f.kind).toBe("int");
    const w1 = f.time!.setWhen(wh, { memberAge: { member: self.id, years: 64, months: 11 } }, "auto");
    expect(readLevers(w1.request, self.id).retireAge).toBe(65);
    expect(w1.request).toEqual(f.set(wh, 65).request);
    const march: Timepoint = { memberAge: { member: self.id, years: 60, ageSwitch: "firstMarch31AfterReach" } };
    const w2 = f.time!.setWhen(wh, march, "auto");
    const h2 = w2.request.input.household;
    const last = h2.employmentPeriods!.filter((p) => p.member === self.id).map((p) => resolveTimepoint(h2, p.to)).sort().at(-1);
    expect(last).toBe("2042-03");
    expect(resolveTimepoint(h2, h2.livingExpenses![0]!.stages!.find((s) => s.label === "retirement")!.at)).toBe("2042-04");
    expect(() => preview(w2.request)).not.toThrow();
  });

  it("定年は「○歳になる前の月まで」だけ（年齢の途中の年月は理由を出す）", () => {
    const wh = open("salariedCoupleTwoKids");
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const f = buildStage("work", wh).sections.flatMap((s) => s.groups.flatMap((g) => g.fields)).find((x) => x.key === `work/${self.id}/mainEnd`);
    if (f === undefined) return; // 定年後の予定の無い世帯
    expect(f.time!.when.check!(wh, { at: "2041-06" })).toBeNull();
    expect(f.time!.when.check!(wh, { at: "2041-09" })).toContain("○歳になる前の月まで");
  });

  it("働き方の期間は年月で持つ（年齢で入れても年月にする）", () => {
    const wh = open("salariedCoupleTwoKids");
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const p = wh.request.input.household.employmentPeriods!.find((x) => x.member === self.id)!;
    const f = byKey(wh, `work/period/${p.id}/to`);
    const w1 = f.time!.setWhen(wh, { memberAge: { member: self.id, years: 64, months: 11 } }, "auto");
    expect(w1.request.input.household.employmentPeriods!.find((x) => x.id === p.id)!.to).toEqual({ at: "2046-06" });
  });
});

describe("時点の形を年齢・出来事に直しても、計算の結果は変わらない（モデル世帯すべて）", () => {
  it.each(MODELS)("%s", (id) => {
    const wh = open(id);
    const before = tableOf(wh.request);
    let w = wh;
    let changed = 0;
    for (const f of timeFields(wh)) {
      const cur = buildStages(w).flatMap((s) => allFields(s)).find((x) => x.key === f.key);
      // 2つの値をそろえる欄（基礎と厚生が別の受け取り開始をまとめて直す欄など）は、形を変えるだけにならないので除く
      if (cur?.time === undefined || cur.readOnly !== undefined || cur.get(w).derived != null || cur.get(w).warn != null) continue;
      const st = cur.time.state(w);
      if (st.raw === null || st.raw.event !== undefined) continue;
      const to: WhenMode = st.ctx.person !== null && st.ctx.modes.includes("age") ? "age" : st.ctx.events.some((e) => e.candidate !== true) && st.ctx.modes.includes("event") ? "event" : "ym";
      const ev = st.ctx.events.find((e) => e.candidate !== true);
      const next = convertWhen(st.raw, to, st.ctx, ev !== undefined ? { event: ev.id } : {});
      if (next === null || sameWhen(next, st.raw)) continue;
      const w2 = cur.time.setWhen(w, next, "this");
      if (w2 !== w) changed++;
      w = w2;
    }
    if (changed > 0) expect(tableOf(w.request), id).toBe(before);
  });
});

describe("年月の表記はどの欄も同じ（欄に「2041-06」、横に今の読みと「2041年6月・令和23年」）", () => {
  it("時点の部品の年月の形: 欄は「2041-06」、読みは「今から○年後・人の年齢（西暦の年月・和暦の年）」", () => {
    for (const c of [ctx(), ctx({ defaultMode: "ym" }), ctx({ ageMeans: "before", defaultMode: "ym" }), ctx({ person: null, defaultMode: "ym" })]) {
      expect(showWhen({ at: "2041-06" }, { ...c, mode: "ym" })).toBe("2041-06");
    }
    expect(readWhen({ at: "2041-06" }, ctx({ person: null }))).toBe("今から14年8か月後（2041年6月・令和23年）");
    expect(readWhen({ at: "2051-04" }, ctx({ ageMeans: "before" }))).toBe("今から24年6か月後・ご本人が65歳になる前の月（2051年4月・令和33年）まで");
    expect(readWhen({ at: "2020-10" }, ctx({ person: null }))).toBe("2020年10月・令和2年");
    // 打つときの例も同じ形。「2041年6月」「令和23年6月」と打っても読める
    expect(parseWhen("それ", ctx({ modes: ["ym"], defaultMode: "ym" }))).toMatchObject({ ok: false, reason: expect.stringContaining("2041-06") });
    for (const text of ["2041-06", "2041年6月", "令和23年6月", "2041/6"]) expect(parseWhen(text, ctx({ modes: ["ym"], defaultMode: "ym" }))).toEqual({ ok: true, tp: { at: "2041-06" }, via: "ym" });
  });
  it("年月だけの欄の読み: 今より後は「今から○年後（2031年4月・令和13年）」、今月までは「2025年12月・令和7年」", () => {
    expect(readYearMonth("2031-04", "2026-10")).toBe("今から4年6か月後（2031年4月・令和13年）");
    expect(readYearMonth("2026-10", "2026-10")).toBe("2026年10月・令和8年");
    expect(readYearMonth("2025-12", "2026-10")).toBe("2025年12月・令和7年");
  });
  it.each(MODELS)("見本 %s: どの時点の欄も年月の形は「YYYY-MM」で見せ、欄の下の読みの年月は「2041年6月・令和23年」の形（和暦の年を添える）", (id) => {
    const wh = open(id);
    const fields = buildStages(wh).flatMap((s) => allFields(s));
    for (const f of fields.filter((x) => x.time !== undefined)) {
      const st = f.time!.state(wh);
      const raw = st.linked?.at ?? st.raw;
      if (raw?.at === undefined || modeOf(raw, st.ctx) !== "ym") continue;
      expect(showWhen(raw, st.ctx), f.key).toMatch(/^\d{4}-\d{2}$/);
      // 読みの年月は西暦を主に、和暦の年を添える（「2041年6月・令和23年」）。和暦だけ・西暦だけの年月を出さない
      expect(st.read, f.key).toMatch(ERA_YM);
      expect(st.read.replace(ERA_YM_ALL, ""), f.key).not.toMatch(/\d{4}年\d{1,2}月|(令和|平成|昭和|大正|明治)(元|\d+)年\d{1,2}月/);
    }
    for (const f of fields.filter((x) => x.kind === "ym")) {
      const hint = f.get(wh).hint;
      // 欄ごとの読み（生年月の「○歳（和暦）」など）は欄の持ち主の決まり。西暦の年月を出すなら和暦の年を添える
      if (typeof hint === "string") expect(hint.replace(ERA_YM_ALL, ""), f.key).not.toMatch(/\d{4}年\d{1,2}月/);
    }
  });
});
