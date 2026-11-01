// 年の目盛りの下の年齢の段（AgeAxis.tsx）: 主画面のグラフ・万一のときのグラフ・資産と負債の推移
// - 夫婦の世帯は年の下に「本人の年齢」「配偶者の年齢」の2段、単身の世帯は1段。各段の頭（グラフの面の左の余白）に呼び方を小さく書く
// - 亡くなったあと（万一のときのグラフ）やまだいない年は、その人の段を空ける
// - 段が増えた分だけグラフの下の余白を広げる（できごとの丸の段・「!」の段・年の目盛りが重ならない）
// - 年を指したとき・固定したときの札には、家族全員の年齢（例: 「2045年 ご本人64歳・配偶者62歳・長女35歳・長男32歳」。年のあとは全角の空白）
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { AGE_FIRST, AGE_ROW, ageExtra, yearHead } from "../src/presentation/AgeAxis.tsx";
import { BsTrend, trendRange } from "../src/presentation/BsTrend.tsx";
import { ContingencyChart } from "../src/presentation/ContingencyView.tsx";
import { EVENT_R } from "../src/presentation/EventDot.tsx";
import { MainChart, type MainChartModel } from "../src/presentation/MainChart.tsx";
import { SHORT_R } from "../src/presentation/ShortMark.tsx";
import { bsPlan } from "../src/workspace/balanceTab.ts";
import { scenarioModel } from "../src/workspace/contingency/present.ts";
import { baseRequest, scenarioRequest, scenarios } from "../src/workspace/contingency/requests.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { ageAxis, cashflowTable, displayYears, familyText, personLabel, toPresentation } from "../src/workspace/present.ts";
import { ageInYear, roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;
const num = (s: string | undefined) => Number(s);

function modelOf(id: string): MainChartModel {
  const req = modelHousehold(id);
  const res = preview(req);
  return toPresentation({ base: req, proposal: req, current: res, proposed: res, targetAge: 95, selectedYear: null, provisional: false });
}
const couple = modelOf("salariedCoupleTwoKids");
const single = modelOf("sampleSingle40s");

const draw = (model: MainChartModel, extra: Record<string, unknown> = {}) => renderToString(h(MainChart, { model, mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop, ...extra }));
/** 年齢の段の数字（段 → 年齢の文字） */
const ageTexts = (html: string, row: number) => [...html.matchAll(new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)" class="axis-label sub" text-anchor="middle" data-age-row="${row}">(\\d+)歳`, "g"))].map((x) => ({ x: num(x[1]), y: num(x[2]), age: num(x[3]) }));
const yearTexts = (html: string) => [...html.matchAll(/<text x="([\d.]+)" y="([\d.]+)" class="axis-label" text-anchor="middle">(\d{4})</g)].map((x) => ({ x: num(x[1]), y: num(x[2]), year: num(x[3]) }));
const heads = (html: string) => [...html.matchAll(/<text x="([\d.]+)" y="([\d.]+)" class="axis-who" text-anchor="end" data-age-who="(\d)">([^<]+)</g)].map((x) => ({ x: num(x[1]), y: num(x[2]), row: num(x[3]), label: x[4] as string }));
const evYs = (html: string) => [...html.matchAll(/<g class="ev[^"]*" transform="translate\([\d.]+,([\d.]+)\)"/g)].map((x) => num(x[1]));
const skYs = (html: string) => [...html.matchAll(/<g class="sk[^"]*" transform="translate\([\d.]+,([\d.]+)\)"/g)].map((x) => num(x[1]));

describe("年齢の段（主画面のグラフ）", () => {
  it("夫婦の世帯: 年の下に本人・配偶者の年齢の2段。各段の頭に呼び方（グラフの面の左の余白）", () => {
    const html = draw(couple);
    expect(couple.chart.axis.map((r) => r.label)).toEqual(["ご本人", "配偶者"]);
    expect(html).toContain('data-age-rows="2"');
    const hs = heads(html);
    expect(hs.map((x) => x.label)).toEqual(["ご本人", "配偶者"]);
    // 頭は面の左の端（64px）より左。年齢の段と同じ高さ
    for (const x of hs) expect(x.x).toBeLessThan(64);
    const r0 = ageTexts(html, 0);
    const r1 = ageTexts(html, 1);
    expect(r0.length).toBeGreaterThan(5);
    expect(r1.length).toBe(r0.length);
    expect(hs[0]!.y).toBe(r0[0]!.y);
    expect(hs[1]!.y).toBe(r1[0]!.y);
    // 年 → 本人 → 配偶者の順に下へ。段の間は重ならない
    const ys = yearTexts(html);
    expect(r0[0]!.y - ys[0]!.y).toBe(AGE_FIRST);
    expect(r1[0]!.y - r0[0]!.y).toBe(AGE_ROW);
    expect(r1[0]!.y).toBeLessThanOrEqual(520);
    // 年齢は本人・配偶者のその年の年齢
    const req = modelHousehold("salariedCoupleTwoKids");
    const [self, spouse] = roles(req);
    for (const [i, y] of ys.entries()) {
      expect(r0[i]!.age).toBe(ageInYear(self!.member, y.year));
      expect(r1[i]!.age).toBe(ageInYear(spouse!.member, y.year));
      expect(r0[i]!.x).toBe(y.x);
    }
    // できごとの丸の段と「!」は年の目盛りより上（重ならない）
    for (const e of evYs(html)) expect(e + EVENT_R).toBeLessThan(ys[0]!.y - 9);
    for (const s of skYs(html)) expect(s + SHORT_R).toBeLessThan(ys[0]!.y - 9);
  });

  it("段が増えた分だけ下の余白を広げる（年の目盛りは下の端から 24 + 14px の位置）", () => {
    const html = draw(couple);
    expect(yearTexts(html)[0]!.y).toBe(520 - 24 - ageExtra(2));
    expect(ageExtra(1)).toBe(0);
    expect(ageExtra(2)).toBe(AGE_ROW);
  });

  it("単身の世帯: 1段のまま、頭に呼び方（ご本人）", () => {
    const html = draw(single);
    expect(single.chart.axis.map((r) => r.label)).toEqual(["ご本人"]);
    expect(html).toContain('data-age-rows="1"');
    expect(heads(html).map((x) => x.label)).toEqual(["ご本人"]);
    expect(ageTexts(html, 1)).toHaveLength(0);
    // 年の目盛りの位置は今まで通り（下の端から 24px）
    expect(yearTexts(html)[0]!.y).toBe(520 - 24);
  });

  it("小窓の中の表示（縮めた表示）も同じ2段", () => {
    const html = draw(couple, { height: 300 });
    expect(html).toContain('data-age-rows="2"');
    expect(ageTexts(html, 1).at(-1)!.y).toBeLessThanOrEqual(300);
  });

  it("全部のプランを重ねる・左右に並べる・説明モードも同じ2段", () => {
    const side = draw({ ...couple, names: { selected: "プランB", base: "プランA", same: false } }, { layout: "side" });
    expect(side.match(/data-age-rows="2"/g)).toHaveLength(2);
    const ex = { model: { title: "説明", years: couple.chart.years, ages: couple.chart.ages, steps: [{ key: "assets" as const, title: "資産", sentence: [] }], work: [], pension: [], living: [], education: [], housing: [], financial: couple.chart.proposal }, step: 0 };
    expect(draw(couple, { explain: ex })).toContain('data-age-rows="2"');
    const plans = [{ key: "A", name: "プランA", title: "", base: true, selected: true, colorIndex: 0, financial: couple.chart.proposal, net: couple.flows.net }];
    expect(draw({ ...couple, plans }, { layout: "all" })).toContain('data-age-rows="2"');
  });

  it("年を固定したときの札: 家族全員の年齢（世帯にいる人だけ）", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const rs = roles(req);
    const y = 2032;
    const html = draw(couple, { pinnedYear: y });
    const text = familyText(rs, y);
    expect(text.split("・")).toHaveLength(4);
    expect(text).toMatch(/^ご本人\d+歳・配偶者\d+歳・第1子\d+歳・第2子\d+歳$/);
    expect(html).toContain(`<div class="yt-h">${y}年\u3000${text}`);
    expect(couple.chart.family[couple.chart.years.indexOf(y)]).toBe(text);
    // 子が独立したあとの年は夫婦だけ
    expect(couple.chart.family.at(-1)).toMatch(/^ご本人\d+歳・配偶者\d+歳$/);
    expect(yearHead(2045, "")).toBe("2045年");
  });
});

describe("グラフの札の家族の呼び方", () => {
  // グラフの年の札は世帯の外の家族（親など）を「ご家族」と呼び、結果の表の年齢の行（「お母さま」）と呼び方が違っていた
  it("世帯の外の家族は、結果の表と同じ呼び方（お母さま・ご本人のお母さま など）", () => {
    const req = modelHousehold("parentMoney");
    const res = preview(req);
    const m = toPresentation({ base: req, proposal: req, current: res, proposed: res, targetAge: 95, selectedYear: null, provisional: false });
    const years = displayYears(req);
    const table = cashflowTable(req, res.table, years, "表");
    const ageRow = table.rows.find((x) => x.key === "age:other1");
    expect(ageRow?.label).toBe("お母さま");
    const y = years[0]!;
    expect(m.chart.family[0]).toContain("お母さま");
    expect(m.chart.family[0]).not.toContain("ご家族");
    expect(m.yearDetail!.members).not.toContain("ご家族");
    const parent = req.input.household.members.find((x) => x.kind === "parent")!;
    expect(m.chart.family[0]).toContain(`お母さま${ageInYear(parent, y)}歳`);
    // 同じ呼び方の人が2人なら、表と同じく誰の家族かを前に付ける
    const two = modelHousehold("parentMoney");
    const self = two.input.household.members.find((x) => x.kind === "self")!;
    const spouse = two.input.household.members.find((x) => x.kind === "spouse");
    const p0 = two.input.household.members.find((x) => x.kind === "parent")!;
    two.input.household.members.push({ ...p0, id: "00000000-0000-4000-8000-0000000000c1", outside: { of: spouse?.id ?? self.id, periods: [] } });
    const text = familyText(roles(two), years[0]!, undefined, (r) => personLabel(two, r));
    expect(text).toContain(`${roles(two).find((r) => r.key === "self")!.label}のお母さま`);
  });
});

describe("年齢の段（万一のときのグラフ）", () => {
  const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
  const req = wh.request;
  const rs = roles(req);
  const years = displayYears(req);

  it("亡くなった人の段は、亡くなった年の翌年から空ける。札の家族の年齢からも外す", () => {
    const sc = scenarios(wh).find((s) => s.key === "death:self")!;
    const year = 2030;
    const m = scenarioModel({ req, scenario: sc, year, result: preview(scenarioRequest(wh, sc, year)), none: preview(baseRequest(req)), targetAge: 95, choice: undefined });
    const [selfRow, spouseRow] = m.chart.axis;
    expect(selfRow!.label).toBe("ご本人");
    expect(selfRow!.ages[years.indexOf(year)]).not.toBeNull();
    expect(selfRow!.ages.slice(years.indexOf(year) + 1).every((a) => a === null)).toBe(true);
    expect(spouseRow!.ages.every((a) => a !== null)).toBe(true);
    expect(m.chart.family[years.indexOf(year + 1)]).not.toContain("ご本人");
    expect(m.chart.family[years.indexOf(year)]).toContain("ご本人");
    // グラフ: ご本人の段は亡くなった年の翌年からの目盛りに年齢を出さない。配偶者の段は最後まで
    const html = renderToString(h(ContingencyChart, { spec: { kind: "assets", model: m.chart, who: m.who, eventYear: year, pinnedYear: year + 5, onSelectYear: noop } }));
    expect(html).toContain('data-age-rows="2"');
    const ys = yearTexts(html);
    const after = ys.filter((y) => y.year > year).length;
    expect(ageTexts(html, 0)).toHaveLength(ys.length - after);
    expect(ageTexts(html, 1)).toHaveLength(ys.length);
    expect(heads(html).map((x) => x.label)).toEqual(["ご本人", "配偶者"]);
    expect(html).toContain(`<div class="yt-h">${year + 5}年\u3000${familyText(rs, year + 5, { key: "self", year })}`);
    // 年の目盛りは下の端から 28 + 14px
    expect(ys[0]!.y).toBe(520 - 28 - ageExtra(2));
  });

  it("ageAxis: 夫婦は本人・配偶者（子は入れない）、亡くなった人は翌年から null", () => {
    const ax = ageAxis(rs, years, { key: "spouse", year: 2040 });
    expect(ax.map((r) => r.label)).toEqual(["ご本人", "配偶者"]);
    expect(ax[1]!.ages[years.indexOf(2040)]).not.toBeNull();
    expect(ax[1]!.ages[years.indexOf(2041)]).toBeNull();
    expect(ax[0]!.ages.every((a) => a !== null)).toBe(true);
  });
});

describe("年齢の段（資産と負債のタブの推移）", () => {
  it("夫婦は2段・単身は1段。頭に呼び方。段が増えた分だけ下の余白を広げる", () => {
    const at = (id: string) => {
      const req = modelHousehold(id);
      const plan = bsPlan({ key: "A", letter: "A", name: "プランA", title: "現状", base: true, req, table: preview(req).table });
      return { plan, html: renderToString(h(BsTrend, { plan, base: null, range: trendRange([plan]), marks: [0], onPick: noop, height: 330 })) };
    };
    const c = at("salariedCoupleTwoKids");
    expect(c.plan.axis.map((r) => r.label)).toEqual(["ご本人", "配偶者"]);
    expect(c.html).toMatch(/data-age-who="0">ご本人</);
    expect(c.html).toMatch(/data-age-who="1">配偶者</);
    const r0 = [...c.html.matchAll(/y="([\d.]+)"[^>]*data-age-row="0">(\d+)歳/g)];
    const r1 = [...c.html.matchAll(/y="([\d.]+)"[^>]*data-age-row="1">(\d+)歳/g)];
    expect(r0.length).toBeGreaterThan(3);
    expect(r1).toHaveLength(r0.length);
    expect(num(r1[0]![1]) - num(r0[0]![1])).toBeGreaterThan(12);
    expect(num(r1[0]![1])).toBeLessThanOrEqual(330);
    const s = at("sampleSingle40s");
    expect(s.plan.axis.map((r) => r.label)).toEqual(["ご本人"]);
    expect(s.html).not.toContain('data-age-row="1"');
  });
});
