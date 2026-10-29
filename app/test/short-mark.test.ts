// 金融資産が足りなくなる所の印（ShortMark.tsx）: 主画面のグラフと万一のときのグラフ
// - 線が0を切る所の△と「○歳まで持つ」「○歳で不足」の文字はグラフに描かない
// - 「!」はできごとの丸の段のすぐ上の専用の段に置く（できごとと同じ年でも上下に分かれて重ならない。いつも同じ高さ）。できごとの丸の段の大きさは変えない
// - 線が0を切る所から「!」まで赤い点線。同じ年の「!」は横にずらす。足りなくならなければ何も出さない
// - 点線の上端と「!」の横の位置は、線が実際に0を切る所（前の年と足りなくなる年の金額を直線で結んで0になる所）。札の文の年・年齢は初めて足りなくなる年
// - 札の文は「○歳（○年）で金融資産が足りなくなります」。説明モード・全部のプランを重ねる表示（プランの色）・左右に並べる表示・万一のときのグラフでも同じ形
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { ContingencyChart } from "../src/presentation/ContingencyView.tsx";
import { EVENT_R } from "../src/presentation/EventDot.tsx";
import { MainChart, shortSources, type MainChartModel } from "../src/presentation/MainChart.tsx";
import type { EventChip, ExplainModel, PlanLineModel } from "../src/presentation/model.ts";
import { colorStyle } from "../src/presentation/planLines.tsx";
import { crossIndex, SHORT_R, SHORT_ROW, ShortTip, shortText, shortXs } from "../src/presentation/ShortMark.tsx";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues, type Values } from "../src/workspace/plans/plans.ts";
import { toPresentation } from "../src/workspace/present.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;

/** 基準のプラン（プランA）が 2061 年に尽き、選んだプラン（プランB）は尽きない見本 */
function base(): MainChartModel {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold("salariedCoupleTwoKids")!;
  const re = demo.reemployment!;
  const wh = fromRequest(req, { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } });
  const cat = buildCatalog(wh, self.id, demo);
  const values: Values = { "lever:retireAge": 65, "lever:livingMonthly": 280000 };
  return toPresentation({ base: wh.request, proposal: applyValues(wh, values, cat), current: preview(wh.request), proposed: preview(applyValues(wh, values, cat)), targetAge: 95, selectedYear: null, provisional: false, names: { selected: "プランB", base: "プランA", same: false } });
}
const m0 = base();
const DEP = m0.chart.depletions.find((d) => d.series === "current")!.year;

/** 選んだプランも尽きる（基準と同じ線にして、尽きる年を depP にする）。できごとを尽きる年に足す */
function bothShort(depP: number, extra: EventChip[] = []): MainChartModel {
  return {
    ...m0,
    chart: { ...m0.chart, proposal: m0.chart.current, depletions: [{ series: "current", year: DEP }, { series: "proposal", year: depP }] },
    events: [...m0.events, ...extra],
  };
}

const draw = (model: MainChartModel, extra: Record<string, unknown> = {}) => renderToString(h(MainChart, { model, mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop, ...extra }));
const num = (s: string | undefined) => Number(s);
/** 「!」の丸（x, y, 年, 鍵） */
const shorts = (html: string) => [...html.matchAll(/<g class="sk[^"]*" transform="translate\(([\d.]+),([\d.]+)\)"[^>]*data-short="(\d+)" data-short-key="([^"]+)"/g)].map((x) => ({ x: num(x[1]), y: num(x[2]), year: num(x[3]), key: x[4] as string }));
/** できごとの丸（x, y, 年） */
const events = (html: string) => [...html.matchAll(/<g class="ev[^"]*" transform="translate\(([\d.]+),([\d.]+)\)"[^>]*data-ev="(\d+)"/g)].map((x) => ({ x: num(x[1]), y: num(x[2]), year: num(x[3]) }));
const lines = (html: string) => [...html.matchAll(/<path d="M([\d.]+) ([\d.]+)V([\d.]+)(?:L([\d.]+) ([\d.]+))?" class="dep-line" data-short-line="(\d+)"/g)].map((x) => ({ x: num(x[1]), top: num(x[2]), row: num(x[3]), ex: x[4] === undefined ? null : num(x[4]), ey: x[5] === undefined ? null : num(x[5]), year: num(x[6]) }));
/** 線の点（「M x y L x y …」）。cls はその線の class */
const pathPts = (html: string, cls: string) => {
  const d = new RegExp(`<path d="([^"]+)" class="${cls}"`).exec(html)?.[1] ?? "";
  return [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((x) => ({ x: num(x[1]), y: num(x[2]) }));
};
/** 線の点 i − 1 と i を直線で結んで、高さ y0 になる x */
const crossX = (pts: { x: number; y: number }[], i: number, y0: number) => {
  const a = pts[i - 1]!;
  const b = pts[i]!;
  return a.x + ((b.x - a.x) * (y0 - a.y)) / (b.y - a.y);
};
const zeroY = (html: string) => num(/<line x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)" y2="[\d.]+" class="axis0"/.exec(html)?.[1]);

describe("金融資産が足りなくなる所の印（主画面のグラフ）", () => {
  it("△と「○歳まで持つ」「○歳で不足」の文字は描かず、「!」と点線を出す（狭い画面かどうかに関わらない）", () => {
    const html = draw(m0);
    expect(html).not.toContain("dep-tri");
    expect(html).not.toContain("dep-txt");
    expect(html).not.toMatch(/まで持つ|歳で不足/);
    const sk = shorts(html);
    expect(sk).toEqual([expect.objectContaining({ year: DEP, key: "current" })]);
    // 基準のプランは白抜き。札の文は「○歳（○年）で金融資産が足りなくなります」（重ねる表示ではプランの名前を添える）
    expect(html).toContain(`class="sk base"`);
    const age = m0.chart.ages[m0.chart.years.indexOf(DEP)];
    expect(html).toContain(`aria-label="プランA ${age}歳（${DEP}年）で金融資産が足りなくなります"`);
    // 点線: 上端は線が0を切る所（前の年と足りなくなる年の金額を直線で結んで0になる所。足りなくなる年の目盛りより左）、下は「!」の丸の上の端まで
    const [ln] = lines(html);
    expect(ln?.top).toBeCloseTo(zeroY(html), 0);
    const i = m0.chart.years.indexOf(DEP);
    const pts = pathPts(html, "line-base");
    expect(ln!.x).toBeCloseTo(crossX(pts, i, zeroY(html)), 0);
    expect(ln!.x).toBeLessThan(pts[i]!.x);
    expect(ln!.x).toBeGreaterThan(pts[i - 1]!.x);
    // 「!」の丸も同じ x（重ならなければずらさない）
    expect(sk[0]!.x).toBeCloseTo(ln!.x, 1);
    expect(ln?.ex).toBeCloseTo(sk[0]!.x, 1);
    expect(ln?.ey).toBeCloseTo(sk[0]!.y - SHORT_R, 1);
    // できごとの丸の段には「!」を置かない
    expect(html).not.toContain('class="ev short');
  });

  it("「!」の段はできごとの丸の段のすぐ上: 同じ年にできごとがあっても上下に分かれて重ならない。できごとの丸の大きさは変えない", () => {
    const html = draw(bothShort(DEP, [{ year: DEP, icon: "退", text: "テストのできごと", short: false }, { year: DEP, icon: "！", text: "資産が尽きる", short: true }]));
    const sk = shorts(html);
    const ev = events(html).filter((e) => e.year === DEP);
    expect(ev).toHaveLength(1);
    expect(html).toContain(`<circle r="${EVENT_R}"></circle>`);
    for (const s of sk) for (const e of events(html)) expect(s.y + SHORT_R).toBeLessThan(e.y - EVENT_R);
    // 同じ年の2つの「!」は横にずらす（丸が重ならない）。高さは同じ
    expect(sk).toHaveLength(2);
    expect(Math.abs(sk[0]!.x - sk[1]!.x)).toBeGreaterThanOrEqual(2 * SHORT_R);
    expect(sk[0]!.y).toBe(sk[1]!.y);
    // 点線はどちらも同じ所（線が0を切る所）から下ろし、段の上の端からそれぞれの丸へ
    const ls = lines(html);
    expect(ls).toHaveLength(2);
    expect(ls[0]!.x).toBe(ls[1]!.x);
    expect(ls.map((l) => l.ex).sort()).toEqual(sk.map((s) => s.x).sort());
  });

  it("「!」はいつも同じ高さ（尽きる年が違っても・できごとが2段になっても、グラフの面の下の端からの位置は同じ）", () => {
    const a = draw(bothShort(DEP - 3));
    const ys = shorts(a).map((s) => s.y);
    expect(new Set(ys).size).toBe(1);
    // できごとの丸が2段になる見本（同じ年にできごとを3つ足す）
    const many: EventChip[] = ["退", "年", "家"].map((icon) => ({ year: DEP - 10, icon: icon as EventChip["icon"], text: "テスト", short: false }));
    const b = draw(bothShort(DEP - 3, many));
    const evRows = new Set(events(b).map((e) => e.y));
    expect(evRows.size).toBe(2);
    const rowOf = (html: string) => lines(html)[0]!.row;
    expect((shorts(b)[0]!.y - rowOf(b)).toFixed(3)).toBe((ys[0]! - rowOf(a)).toFixed(3));
    // できごとの丸の上の段は「!」の段のすぐ下
    expect(Math.min(...evRows) - EVENT_R).toBeGreaterThan(shorts(b)[0]!.y + SHORT_R);
    expect(Math.min(...evRows) - EVENT_R - rowOf(b)).toBeCloseTo(SHORT_ROW + 4, 5);
  });

  it("足りなくならないときは何も出さず、「!」の段も設けない（できごとの丸の位置は今まで通り）", () => {
    const none: MainChartModel = { ...m0, chart: { ...m0.chart, current: m0.chart.proposal, depletions: [] }, names: { ...m0.names, same: true } };
    const html = draw(none);
    expect(html).not.toContain("data-short");
    expect(html).not.toContain("dep-line");
    // できごとの丸は、「!」の段があってもなくても同じ位置（下の余白を段の分だけ広げ、面の高さで吸収する）
    expect(events(html).map((e) => e.y)).toEqual(events(draw(m0)).map((e) => e.y));
  });

  it("収支の推移でも「!」は同じ段に出す（資産の線が無いので点線は引かない）", () => {
    const html = draw(m0, { mode: "flows" });
    expect(shorts(html)).toHaveLength(1);
    expect(lines(html)).toHaveLength(0);
    // 資産の線が無いので、「!」は今まで通り足りなくなる年の位置（資産の推移のときより右）
    expect(shorts(html)[0]!.x).toBeGreaterThan(shorts(draw(m0))[0]!.x);
  });

  it("説明モード（お客さまに見せる画面）も同じ形: 選んだプランの「!」。金融資産の段から点線を引く", () => {
    const ex: ExplainModel = { title: "説明", years: m0.chart.years, ages: m0.chart.ages, steps: [{ key: "income", title: "収入", sentence: [] }, { key: "assets", title: "資産", sentence: [] }], work: [], pension: [], living: [], education: [], housing: [], financial: m0.chart.current };
    const model = bothShort(DEP);
    const first = renderToString(h(MainChart, { model, mode: "assets", explain: { model: ex, step: 0 }, ageMark: null, pinnedYear: null, onSelectYear: noop }));
    expect(shorts(first).map((s) => s.key)).toEqual(["proposal"]);
    expect(first).toContain(`aria-label="${shortText(DEP, m0.chart.ages[m0.chart.years.indexOf(DEP)])}"`);
    expect(lines(first)).toHaveLength(0);
    const last = renderToString(h(MainChart, { model, mode: "assets", explain: { model: ex, step: 1 }, ageMark: null, pinnedYear: null, onSelectYear: noop }));
    expect(lines(last)).toHaveLength(1);
    expect(last).not.toContain("dep-tri");
  });

  it("全部のプランを重ねる表示: 尽きるプランごとに、プランの色で塗った「!」（隠したプランは出さない）", () => {
    const fin = (shortAt: number | null) => m0.chart.years.map((y) => (shortAt !== null && y >= shortAt ? -100 : 100) * 10000);
    const pl = (key: string, colorIndex: number, at: number | null, extra: Partial<PlanLineModel> = {}): PlanLineModel => ({ key, name: `プラン${key}`, title: "", base: false, selected: false, colorIndex, financial: fin(at), net: fin(null), ...extra });
    const plans = [pl("A", 0, DEP, { base: true }), pl("B", 1, DEP, { selected: true }), pl("C", 2, null), pl("D", 3, DEP - 5)];
    const model: MainChartModel = { ...m0, plans };
    const html = draw(model, { layout: "all" });
    const sk = shorts(html);
    expect(sk.map((s) => s.key).sort()).toEqual(["p-A", "p-B", "p-D"]);
    expect(html).toContain(`fill:${colorStyle(1).color}`);
    expect(html).toContain(`aria-label="プランD ${m0.chart.ages[m0.chart.years.indexOf(DEP - 5)]}歳（${DEP - 5}年）で金融資産が足りなくなります"`);
    const same = sk.filter((s) => s.year === DEP);
    expect(Math.abs(same[0]!.x - same[1]!.x)).toBeGreaterThanOrEqual(2 * SHORT_R);
    // 点線の上端は線が0を切る所（この見本は前の年 +100万円・その年 −100万円なので、2つの年の目盛りのちょうど真ん中）。重なる「!」は真ん中を挟んで左右に並ぶ
    const iD = m0.chart.years.indexOf(DEP - 5);
    const lD = lines(html).find((l) => l.year === DEP - 5)!;
    const pD = pathPts(html.split('data-multi-line="D"')[1]!, "multi-line");
    expect(lD.x).toBeCloseTo((pD[iD - 1]!.x + pD[iD]!.x) / 2, 0);
    expect(sk.find((s) => s.key === "p-D")!.x).toBeCloseTo(lD.x, 1);
    const lA = lines(html).find((l) => l.year === DEP)!;
    expect((same[0]!.x + same[1]!.x) / 2).toBeCloseTo(lA.x, 0);
    // 隠したプランの「!」は出さないが、段は残す（隠しても高さが動かない）
    const hidden = draw(model, { layout: "all", multi: { focus: null, hidden: ["D", "A", "B"] } });
    expect(shorts(hidden)).toHaveLength(0);
    expect(events(hidden)[0]!.y).toBe(events(html)[0]!.y);
    expect(shortSources(model, { explain: false, multi: { focus: null, hidden: [] } })).toHaveLength(3);
  });

  it("左右に並べる表示: どちらかが尽きれば両方のグラフに「!」の段を設けて高さをそろえる", () => {
    const html = draw(m0, { layout: "side" });
    expect(html).toContain("data-side-grid");
    const panes = html.split('data-side="').slice(1);
    expect(panes).toHaveLength(2);
    const evY = panes.map((p) => events(p)[0]!.y);
    expect(evY[0]).toBe(evY[1]);
    expect(shorts(panes[0]!)).toHaveLength(1);
    expect(shorts(panes[1]!)).toHaveLength(0);
    // 点線の上端と「!」は、そのグラフの線が0を切る所
    const iB = m0.chart.years.indexOf(DEP);
    const pB = pathPts(panes[0]!, "line-prop");
    const lB = lines(panes[0]!)[0]!;
    expect(lB.x).toBeCloseTo(crossX(pB, iB, zeroY(panes[0]!)), 0);
    expect(shorts(panes[0]!)[0]!.x).toBeCloseTo(lB.x, 1);
    // 左右のグラフでは名前は各グラフの上に出すので、札の文に名前を添えない
    expect(panes[0]).toContain(`aria-label="${shortText(DEP, m0.chart.ages[m0.chart.years.indexOf(DEP)])}"`);
  });

  it("小窓の中の表示（縮めた表示）: できごとの丸と同じく「!」の段は設けず、点線だけを面の下の端まで", () => {
    const html = draw(m0, { height: 300 });
    expect(shorts(html)).toHaveLength(0);
    const [ln] = lines(html);
    expect(ln?.ex).toBeNull();
  });

  it("札の文と、近い「!」のずらし方", () => {
    expect(shortText(2058, 79)).toBe("79歳（2058年）で金融資産が足りなくなります");
    expect(shortText(2058, null, "プランB")).toBe("プランB 2058年で金融資産が足りなくなります");
    // 線が0を切る所: 前の年と足りなくなる年の金額を直線で結んで0になる所。最初の年からマイナス・前の年もマイナスのときはその年
    expect(crossIndex([300, 100, -100, -300], 2)).toBeCloseTo(1.5, 9);
    expect(crossIndex([300, 300, -100], 2)).toBeCloseTo(1.75, 9);
    expect(crossIndex([0, -100], 1)).toBe(0);
    expect(crossIndex([-100, -200], 0)).toBe(0);
    expect(crossIndex([-100, -200], 1)).toBe(1);
    const xs = shortXs([100, 100, 300], 1, 0, 1000);
    expect(xs[1]! - xs[0]!).toBeGreaterThanOrEqual(2 * SHORT_R);
    expect((xs[0]! + xs[1]!) / 2).toBeCloseTo(100, 5);
    expect(xs[2]).toBe(300);
    const tip = renderToString(h(ShortTip, { text: shortText(2058, 79), style: {} }));
    expect(tip).toContain('class="year-tip ev-tip short"');
    expect(tip).toContain('role="tooltip"');
  });
});

describe("金融資産が足りなくなる所の印（万一のときのグラフ）", () => {
  it("△と文字は描かず、「!」の段と点線（万一なしは白抜き）。年の目盛りの位置は変えない", () => {
    const cm = { ...m0.chart, depletions: [{ series: "current" as const, year: DEP }, { series: "proposal" as const, year: DEP - 4 }] };
    const html = renderToString(h(ContingencyChart, { spec: { kind: "assets", model: cm, who: "ご本人", eventYear: m0.chart.years[3]!, pinnedYear: null, onSelectYear: noop } }));
    expect(html).not.toContain("dep-tri");
    expect(html).not.toContain("dep-txt");
    const sk = shorts(html);
    expect(sk.map((s) => s.key)).toEqual(["current", "proposal"]);
    expect(new Set(sk.map((s) => s.y)).size).toBe(1);
    expect(html).toContain('class="sk base"');
    expect(html).toContain(`aria-label="万一の場合 ${m0.chart.ages[m0.chart.years.indexOf(DEP - 4)]}歳（${DEP - 4}年）で金融資産が足りなくなります"`);
    expect(lines(html)).toHaveLength(2);
    // 点線の上端は線が0を切る所（万一なしの線が DEP 年に0を切る）
    const iC = m0.chart.years.indexOf(DEP);
    const lC = lines(html).find((l) => l.year === DEP)!;
    const pC = pathPts(html, "line-base");
    expect(lC.x).toBeCloseTo(crossX(pC, iC, zeroY(html)), 0);
    expect(lC.x).toBeLessThan(pC[iC]!.x);
    // 年の目盛りは下の端から同じ位置（夫婦の世帯は年齢が2段なので 520 − 28 − 14）
    expect(html).toMatch(/<text x="[\d.]+" y="478" class="axis-label" text-anchor="middle">/);
    // 「!」は年の目盛りより上
    expect(sk[0]!.y + SHORT_R).toBeLessThan(478 - 12);
  });
});
