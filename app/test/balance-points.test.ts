// 資産と負債のタブ: 時点を並べる（既定の時点を選べる・見出しからその場で年を変える・2〜4つ・世帯ごとに覚える）、
// 年のつまみを図のすぐ下に置く、先の年の図に点線の枠を使わない、つまみの範囲は計算の期間にそろう
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BalanceTab, nextColumns, PointDefaultsEditor, resolveColumns } from "../src/presentation/BalanceTab.tsx";
import type { BsColumn, BsPlanModel } from "../src/presentation/model.ts";
import { balanceTabModel, BS_POINT_CHOICES, bsPlan, bsYears, DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS, readBsColumns, readBsPoints } from "../src/workspace/balanceTab.ts";
import { displayYears } from "../src/workspace/present.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyOf, fromBody } from "../src/workspace/store/body.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { leaveYear, roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;

function planOf(id: string): BsPlanModel {
  const req = modelHousehold(id);
  return bsPlan({ key: "A", letter: "A", name: "プランA", title: "現状", base: true, req, table: preview(req).table });
}

function modelOf(p: BsPlanModel, columns: BsColumn[] | null = null, pointDefaults = DEFAULT_BS_POINTS) {
  return balanceTabModel({ plans: [p], selected: "A", base: "A", guide: DEFAULT_BS_GUIDE, pointDefaults, columns, prevChoices: [], prev: { status: "idle", model: null }, provisional: false, who: "ご主人" });
}

describe("時点の候補（世帯で意味のある年）", () => {
  const req = modelHousehold("dualAssetsTwoKids");
  const p = planOf("dualAssetsTwoKids");
  const yearOf = (k: string) => p.years[p.points.find((x) => x.key === k)!.index]!.year;

  it("今・5年後・10年後・20年後・子の独立・ローン完済・退職の年・年金の始まり・65〜90歳。範囲の中だけで、並びは選ぶ画面の順", () => {
    const keys = p.points.map((x) => x.key);
    expect(keys).toEqual(BS_POINT_CHOICES.map((c) => c.key).filter((k) => keys.includes(k)));
    for (const k of ["now", "y5", "y10", "y20", "childIndep", "loanEnd", "retire", "age65", "age75", "age90"]) expect(keys).toContain(k);
    expect(yearOf("now")).toBe(2026);
    expect(yearOf("y10")).toBe(2036);
    // 子の独立は一番下の子が世帯から抜ける年
    const kids = roles(req).filter((r) => r.member.kind === "child").map((r) => leaveYear(r.member)!);
    expect(yearOf("childIndep")).toBe(Math.max(...kids));
    // ローン完済はつまみの札と同じ年、退職の年もつまみの札と同じ年
    expect(p.points.find((x) => x.key === "loanEnd")!.index).toBe(p.marks.find((m) => m.kind === "loan")!.index);
    expect(p.points.find((x) => x.key === "retire")!.index).toBe(p.marks.find((m) => m.kind === "retire")!.index);
    expect(p.years[p.points.find((x) => x.key === "age75")!.index]!.age).toBe(75);
    expect(p.points.every((x) => x.index >= 0 && x.index < p.years.length)).toBe(true);
  });

  it("子もローンも無い世帯には「子の独立」「ローン完済」が無い", () => {
    const keys = planOf("pensionCouple").points.map((x) => x.key);
    expect(keys).not.toContain("childIndep");
    expect(keys).not.toContain("loanEnd");
  });
});

describe("並べる時点を解く", () => {
  const p = planOf("dualAssetsTwoKids");

  it("既定（今・退職の年・75歳）。既定の時点は表示の設定で選べる（2〜4つ）", () => {
    expect(resolveColumns(p, null, DEFAULT_BS_POINTS).map((c) => c.label)).toEqual(["今", "退職の年", "75歳"]);
    expect(resolveColumns(p, null, ["now", "childIndep", "loanEnd", "age85"]).map((c) => c.label)).toEqual(["今", "子の独立", "ローン完済", "85歳"]);
    expect(resolveColumns(p, null, ["now", "y20"]).map((c) => c.label)).toEqual(["今", "20年後"]);
  });

  it("この世帯で選んだ時点: 決まった年は範囲に収め、年の順に並べる。見出しのラベルは本人の年齢", () => {
    const r = resolveColumns(p, [{ point: "age75" }, { year: 2042 }, { point: "now" }], DEFAULT_BS_POINTS);
    expect(r.map((c) => p.years[c.index]!.year)).toEqual([2026, 2042, 2053]);
    expect(r.map((c) => c.label)).toEqual(["今", "64歳", "75歳"]);
    // 並べた順の番号（見出しから変えるときに使う）は元の並びのまま
    expect(r.map((c) => c.pos)).toEqual([2, 1, 0]);
    const out = resolveColumns(p, [{ point: "now" }, { year: 2300 }], DEFAULT_BS_POINTS);
    expect(p.years[out[1]!.index]!.year).toBe(p.years.at(-1)!.year);
  });

  it("世帯に無い候補は、代わりの時点（10年後など）で見せて注記を出す", () => {
    // 年金生活の夫婦（ローンが無く、本人は75歳を過ぎている）
    const q = planOf("pensionCouple");
    const r = resolveColumns(q, null, ["now", "loanEnd", "age75"]);
    expect(r.map((c) => c.label)).toEqual(["今", "10年後", "20年後"]);
    expect(r[1]!.note).toContain("ローン完済");
    expect(r[2]!.note).toContain("75歳");
  });

  it("既定と同じ並びに戻したら null（既定のまま）", () => {
    expect(nextColumns([{ point: "now" }, { point: "retire" }, { point: "age75" }], DEFAULT_BS_POINTS)).toBeNull();
    expect(nextColumns([{ point: "now" }, { year: 2040 }, { point: "age75" }], DEFAULT_BS_POINTS)).toEqual([{ point: "now" }, { year: 2040 }, { point: "age75" }]);
  });
});

describe("保存（表示の設定。世帯ごと）", () => {
  it("既定の時点・この世帯で選んだ時点を保存して読み戻す", () => {
    const req = modelHousehold("dualAssetsTwoKids");
    const display = { ...DEFAULT_DISPLAY_SETTINGS, bsPoints: ["now", "y10", "retire", "age80"] as const, bsColumns: [{ point: "now" }, { year: 2045 }] as BsColumn[] };
    const s = { wh: fromRequest(req), workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { ...display, bsPoints: [...display.bsPoints] }, carry: { extDefinitions: {}, ext: {} } };
    const back = fromBody(bodyOf(s));
    expect(back.display.bsPoints).toEqual(["now", "y10", "retire", "age80"]);
    expect(back.display.bsColumns).toEqual([{ point: "now" }, { year: 2045 }]);
  });

  it("無い・形の合わない値は既定（今・退職の年・75歳／既定のまま）", () => {
    expect(readBsPoints(undefined)).toEqual(DEFAULT_BS_POINTS);
    expect(readBsPoints(["now"])).toEqual(DEFAULT_BS_POINTS);
    expect(readBsPoints(["now", "x", "age75"])).toEqual(DEFAULT_BS_POINTS);
    expect(readBsPoints(["now", "now", "age75"])).toEqual(DEFAULT_BS_POINTS);
    expect(readBsPoints(["now", "y5", "y10", "y20", "age90"])).toEqual(DEFAULT_BS_POINTS);
    expect(readBsPoints(["now", "age90"])).toEqual(["now", "age90"]);
    expect(readBsColumns(null)).toBeNull();
    expect(readBsColumns([{ point: "now" }])).toBeNull();
    expect(readBsColumns([{ point: "now" }, { year: "2040" }])).toBeNull();
    expect(readBsColumns([{ point: "now" }, { year: 2040.5 }])).toBeNull();
    expect(readBsColumns([{ point: "now" }, { year: 2040 }, { point: "age70" }, { point: "age90" }])).toEqual([{ point: "now" }, { year: 2040 }, { point: "age70" }, { point: "age90" }]);
    expect(DEFAULT_DISPLAY_SETTINGS.bsPoints).toEqual(["now", "retire", "age75"]);
    expect(DEFAULT_DISPLAY_SETTINGS.bsColumns).toBeNull();
  });
});

describe("タブの画面", () => {
  const p = planOf("dualAssetsTwoKids");

  it("1年ずつ見る: 年のつまみは図のすぐ下（解説・家計の体力の目安・表で見るはその下）", () => {
    const html = renderToString(h(BalanceTab, { model: modelOf(p), band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop }));
    const at = (s: string) => html.indexOf(s);
    expect(at("data-bs-figure")).toBeGreaterThan(0);
    expect(at("data-bs-yearbar")).toBeGreaterThan(at("data-bs-figure"));
    expect(at("data-bs-say")).toBeGreaterThan(at("data-bs-yearbar"));
    expect(at("data-bs-health")).toBeGreaterThan(at("data-bs-yearbar"));
    expect(at("data-bs-table")).toBeGreaterThan(at("data-bs-health"));
    expect(at("data-bs-trend")).toBeGreaterThan(at("data-bs-table"));
    // 図とつまみの間に解説・体力の目安を挟まない
    const between = html.slice(at("data-bs-figure"), at("data-bs-yearbar"));
    expect(between).not.toContain("data-bs-say");
    expect(between).not.toContain("data-bs-health");
    // 凡例は点線に触れない
    expect(html).not.toContain("点線の枠");
    expect(html).toContain("つまみを先に動かした年");
  });

  it("時点を並べる: 既定は3つ。見出しを押すと年を選べる。2〜4つ（足す・外す）", () => {
    const html = renderToString(h(BalanceTab, { model: modelOf(p), band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop, initial: { view: "three" } }));
    expect(html).toContain('data-bs-three="3"');
    expect(html).toContain("3時点を並べる");
    expect((html.match(/data-bs-col="/g) ?? []).length).toBe(3);
    expect(html).toContain("data-bs-col-add");
    expect(html).not.toContain("data-bs-col-reset");
    expect(html).toContain("既定の時点を変える（事務所の設定）");
    // 先の年の図も点線の枠を使わない
    expect(html).not.toContain("stroke-dasharray");
    const four = renderToString(h(BalanceTab, { model: modelOf(p, [{ point: "now" }, { point: "y10" }, { year: 2042 }, { point: "age75" }]), band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop, initial: { view: "three" } }));
    expect(four).toContain('data-bs-three="4"');
    expect(four).toContain("4時点を並べる");
    expect(four).not.toContain("data-bs-col-add");
    expect(four).toContain("この世帯で選んだ時点");
    expect(four).toContain("data-bs-col-reset");
    expect(four).toContain('data-bs-figure="2042"');
  });

  it("既定の時点の選び方: 2〜4つ（4つ選んだら足せない・2つなら外せない）", () => {
    let got: string[] | null = null;
    const html = renderToString(h(PointDefaultsEditor, { choices: BS_POINT_CHOICES, value: ["now", "retire", "age75", "age90"], onChange: (k) => (got = k) }));
    expect((html.match(/data-bs-default="/g) ?? []).length).toBe(BS_POINT_CHOICES.length);
    // 選んでいない候補は押せない（4つ選んでいる）
    expect(html).toMatch(/disabled data-bs-default="y5"/);
    const two = renderToString(h(PointDefaultsEditor, { choices: BS_POINT_CHOICES, value: ["now", "age75"], onChange: noop }));
    expect(two).toMatch(/checked disabled data-bs-default="now"/);
    expect(got).toBeNull();
  });
});

describe("つまみの範囲は計算の期間（表の最後の年）にそろう", () => {
  it("年は計算基準年から表の最後の年まで。結果の画面の表と同じ最後の年", () => {
    for (const id of ["dualAssetsTwoKids", "investmentCouple", "lifetime100Plan"]) {
      const req = modelHousehold(id);
      const p = planOf(id);
      expect(p.years.at(-1)!.year).toBe(req.input.endYear);
      expect(p.years.at(-1)!.year).toBe(displayYears(req).at(-1));
      expect(p.years.map((y) => y.year)).toEqual(bsYears(req));
    }
    // 100年分の見本（表は2125年まで）は、本人129歳までがつまみの範囲（計算の期間そのものが長い）
    const long = planOf("lifetime100Plan");
    expect(long.years.at(-1)!.age).toBe(129);
  });
});
