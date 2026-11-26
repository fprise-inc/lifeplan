// 前提条件は事務所の既定値で決め、世帯では違う欄だけ「この世帯だけ」と見せる（0214・0260）:
// 事務所データの形（版 2・版 1 も読む）、新しい世帯に写す、欄の印と「事務所の既定値に戻す」、ふつうの欄の形（区画・標準と詳細・例外の年のリンク）、
// 事務所の既定値を変えたときの知らせ、古い世帯の読み方、見本の世帯の計算の結果が変わらないこと、事務所の既定値の画面の3つの区画
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { assumptionRows } from "../src/workspace/input/assumptionList.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { inputItems } from "../src/workspace/input/items.ts";
import { INVESTMENT_RETURN_LABEL, PREMISE_DEFS, premiseCounts, premiseOfId } from "../src/workspace/input/premiseDefaults.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { assumptionsStage, investmentReturnShown, PREMISE_HEAD_NOTE } from "../src/workspace/input/stages/assumptions.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { setOfficeNow, STANDARD_OFFICE_NOW } from "../src/workspace/office/current.ts";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { applyOfficeDefaults, DEFAULT_OFFICE_SETTINGS, officePremise, officePremises, publishOfficeSettings, readOfficeSettings, withOfficePremise, type OfficeSettings } from "../src/workspace/office/settings.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const noop = () => undefined;
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(buildStage("assumptions", wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const premiseOf = (wh: WorkingHousehold, key: string) => fieldStatus(fieldOf(wh, key), wh).premise;
const panel = (wh: WorkingHousehold, extra: Record<string, unknown> = {}) => renderToString(h(InputPanel, { wh, itemId: "assumptions", level: "detail", onLevel: noop, onSave: noop, onClose: noop, ...extra }));
const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

/** 前提条件の全部の区画を事務所で決めた設定 */
const OFFICE: OfficeSettings = {
  ...DEFAULT_OFFICE_SETTINGS,
  assumptions: { inflation: "0.015", educationInflation: "0.02", heldEstateGrowth: "0.005" },
  realEstateValuation: { landGrowth: "0.005", usefulLife: { wood: 30 } },
  assetReturns: { "equity.global": "0.05" },
  changedOn: "2026-11-14",
};

/** 木造の持ち家のある新しい世帯（不動産の評価の区画を出す。見本の持ち家の形を写す） */
function withHome(wh: WorkingHousehold): WorkingHousehold {
  const home = structuredClone(modelHousehold("salariedCoupleTwoKids").input.household.residences![0]!);
  return mutate(wh, (hh) => {
    (hh.residences ??= []).push({ ...home, from: { at: "2016-04" }, ownership: [{ member: hh.members[0]!.id, share: "1" }] } as never);
  });
}

afterEach(() => setOfficeNow(STANDARD_OFFICE_NOW));

describe("事務所データの形（版 2。0214 の2。0215 で版 3、0213 の段C で版 4）", () => {
  it("版 1 の事務所データはそのまま読め、読んだら今の版（足した欄は「決めていない」）", () => {
    const v1 = { version: 1, assumptions: { inflation: "0.015", heldEstateGrowth: "0.01" }, realEstateRatio: "0.7", changedOn: "2026-10-27" };
    const r = readOfficeSettings(v1);
    expect(r.version).toBe(5);
    expect(r.assumptions).toEqual({ inflation: "0.015", heldEstateGrowth: "0.01" });
    expect(r.realEstateValuation).toBeUndefined();
    expect(r.assetReturns).toBeUndefined();
    // 貸していない不動産の値動きは、資産の種類ごとの利回りの不動産（id assetReturns.realEstate）
    expect(officePremises(r)).toEqual({ inflation: "0.015", "assetReturns.realEstate": "0.01" });
  });

  it("版 2 の欄を読み、範囲の外・読めない値・知らない種類は読まない。保存して読み戻せる", () => {
    const r = readOfficeSettings({
      version: 2,
      assumptions: { educationInflation: "0.02", pensionMacroSlideEmployee: "0.5" },
      realEstateValuation: { landGrowth: "0.3", usefulLife: { wood: 30, rc: 0, steel: 34.5, nope: 10 } },
      assetReturns: { "equity.global": "0.05", "bond.global": "abc", realEstate: "0.01", crypto: "0.1" },
    });
    expect(r.assumptions).toEqual({ educationInflation: "0.02" });
    expect(r.realEstateValuation).toEqual({ usefulLife: { wood: 30 } });
    expect(r.assetReturns).toEqual({ "equity.global": "0.05" });
    expect(readOfficeSettings(JSON.parse(JSON.stringify(OFFICE)))).toEqual({ ...OFFICE, version: 5 });
  });

  it("前提条件の id ごとに読み書きでき、決めていない（null）に戻すと欄を外す", () => {
    let s: OfficeSettings = DEFAULT_OFFICE_SETTINGS;
    s = withOfficePremise(s, "realEstateValuation.usefulLife.rc", "50");
    s = withOfficePremise(s, "assetReturns.equity.domestic", "0.04");
    s = withOfficePremise(s, "assetReturns.realEstate", "0.002");
    expect(s.realEstateValuation).toEqual({ usefulLife: { rc: 50 } });
    expect(s.assetReturns).toEqual({ "equity.domestic": "0.04" });
    expect(s.assumptions).toEqual({ heldEstateGrowth: "0.002" });
    expect(officePremise(s, "realEstateValuation.usefulLife.rc")).toBe("50");
    s = withOfficePremise(withOfficePremise(withOfficePremise(s, "realEstateValuation.usefulLife.rc", null), "assetReturns.equity.domestic", null), "assetReturns.realEstate", null);
    expect(s).toEqual(DEFAULT_OFFICE_SETTINGS);
    // 事務所の推定の値で決める物（土地の割合など）は、この形に入れない
    expect(withOfficePremise(DEFAULT_OFFICE_SETTINGS, "realEstateValuation.landShare", "0.4")).toBe(DEFAULT_OFFICE_SETTINGS);
  });

  it("欄の表は経済の前提7・不動産の評価8・資産の種類ごとの利回り12。id と欄のキーは重ならない", () => {
    expect(PREMISE_DEFS.filter((d) => d.section === "economy")).toHaveLength(7);
    expect(PREMISE_DEFS.filter((d) => d.section === "realEstate")).toHaveLength(8);
    expect(PREMISE_DEFS.filter((d) => d.section === "assetReturns")).toHaveLength(14);
    expect(new Set(PREMISE_DEFS.map((d) => d.id)).size).toBe(PREMISE_DEFS.length);
    expect(new Set(PREMISE_DEFS.map((d) => d.key)).size).toBe(PREMISE_DEFS.length);
    expect(PREMISE_DEFS.filter((d) => d.live !== undefined).map((d) => d.id)).toEqual(["realEstateValuation.landShare", "realEstateValuation.residualFloor", "realEstateValuation.saleCostRate"]);
  });
});

describe("新しい世帯に写す・欄の印", () => {
  it("事務所で決めた欄を世帯に書き、「事務所の既定値（年月）」の印。どれも決まった値の「事務所の既定値」で、計算に効く", () => {
    publishOfficeSettings(OFFICE);
    const wh = withHome(applyOfficeDefaults(blankHousehold("2026-11", ids()), OFFICE));
    const a = wh.request.input.assumptions!;
    expect(a.educationInflation).toEqual({ default: "0.02" });
    expect(a.realEstateValuation?.landGrowth).toEqual({ default: "0.005" });
    expect(a.realEstateValuation?.usefulLife).toEqual({ wood: 30 });
    expect(a.assetReturns?.["equity.global"]).toEqual({ default: "0.05" });
    for (const key of ["assume/inflation", "assume/educationInflation", "assume/realEstate/landGrowth", "assume/realEstate/life/wood", "assume/assetReturns/equity.global/default", "assume/assetReturns/realEstate/default"]) {
      expect(wh.assumed[key], key).toBe("事務所の既定値（2026-11）");
      expect(fieldStatus(fieldOf(wh, key), wh), key).toMatchObject({ status: "confirmed", basis: null, premise: { state: "office", decided: true } });
    }
    expect(premiseCounts(wh)).toEqual({ own: 0, changed: 0 });
    expect(inputItems(wh).find((i) => i.id === "assumptions")?.status).toBe("std");
    // 耐用年数 30年は計算に効く（22年と違う）
    const base = withHome(blankHousehold("2026-11", ids()));
    expect(JSON.stringify(preview(wh.request).table)).not.toBe(JSON.stringify(preview(base.request).table));
  });

  it("事務所の既定値どおりの欄に印を出さない。値を変えると「この世帯だけ」と「事務所の既定値に戻す」。戻すと元の形（0260）", () => {
    const wh = withHome(blankHousehold("2026-11", ids()));
    let html = panel(wh, { focusKey: "assume/realEstate/life/wood" });
    expect(html).not.toContain('data-premise="office"');
    expect(html).not.toContain(">事務所の既定値<");
    // 耐用年数の欄には「この値にする」が無い（推定でない）
    const at = html.indexOf('data-field="assume/realEstate/life/wood"');
    expect(html.slice(at, html.indexOf("data-field=", at + 10))).not.toContain("data-fill-estimate");
    const f = fieldOf(wh, "assume/realEstate/life/wood");
    const own = f.set(wh, 25);
    expect(own.request.input.assumptions?.realEstateValuation?.usefulLife).toEqual({ wood: 25 });
    expect(premiseOf(own, "assume/realEstate/life/wood")).toMatchObject({ state: "household", wasText: "25年", officeText: "22年" });
    html = panel(own, { focusKey: "assume/realEstate/life/wood" });
    expect(html).toContain('data-premise="household"');
    expect(html).toContain(">この世帯だけ<");
    expect(html).toContain("事務所の既定値（22年）に戻す");
    const back = premiseOf(own, "assume/realEstate/life/wood")!.reset(own);
    expect(back.request).toEqual(wh.request);
    expect(back.assumed).toEqual(wh.assumed);
  });

  it("土地の割合など3つ（置き場所は事務所の推定の値）: 値の無い世帯は事務所の値を見せて「事務所の既定値」。違う値は「この世帯だけ」", () => {
    publishOfficeSettings({ ...DEFAULT_OFFICE_SETTINGS, estimates: { values: { "preset.realEstate.landShare": { value: "0.4", changedOn: "2026-11-14", officialRev: 1, officialValue: "0.3" } }, noFill: [] } });
    const wh = withHome(blankHousehold("2026-11", ids()));
    const f = fieldOf(wh, "assume/realEstate/landShare");
    expect(f.get(wh)).toMatchObject({ value: "0.4", premise: { state: "office", officeText: "40%" } });
    const own = f.set(wh, "0.35");
    expect(premiseOf(own, "assume/realEstate/landShare")?.state).toBe("household");
    // 戻すと事務所の今の値を書き、事務所の既定値の印（値を外さない。0218）
    const back = premiseOf(own, "assume/realEstate/landShare")!.reset(own);
    expect(back.request.input.assumptions?.realEstateValuation).toEqual({ landShare: "0.4" });
    expect(back.assumed["assume/realEstate/landShare"]).toMatch(/^事務所の既定値/);
    expect(premiseOf(back, "assume/realEstate/landShare")?.state).toBe("office");
  });
});

describe("ふつうの欄の形（0260。前の「お客さまと確かめる前提」の見出しと、細かい前提をたたむ1行をやめた）", () => {
  const at = (html: string, key: string) => html.indexOf(`data-field="${key}"`);
  const box = (html: string, key: string) => html.slice(at(html, key), html.indexOf("data-field=", at(html, key) + 12));

  it("標準: 計算の期間（表を何歳まで見るか）・経済の前提（物価・給与の上昇率）・FP顧問料・一覧。運用の利回りと細かい前提は出さない。頭に1文", () => {
    const wh = blankHousehold("2026-11", ids());
    const html = panel(wh, { level: "simple" });
    expect(html).toContain(PREMISE_HEAD_NOTE);
    for (const k of ["assume/period", "assume/economy"]) expect(html, k).toContain(`data-section="${k}"`);
    for (const k of ["assume/endYear", "assume/inflation", "assume/wageGrowth"]) expect(at(html, k), k).toBeGreaterThan(0);
    for (const k of ["assume/investmentReturn", "assume/depositReturn", "assume/educationInflation", "assume/pensionMacroSlide"]) expect(at(html, k), k).toBeLessThan(0);
    expect(html).not.toContain("お客さまと確かめる前提");
    expect(html).not.toContain("data-premise-fold");
    expect(html).not.toContain("細かい前提");
    // 標準では「▸ 続きを見る」も「＋ 例外の年」も出さない（詳細に切り替えて見る）
    expect(html).not.toContain('data-group-more="assume/economy/fields"');
    expect(html).not.toContain(">＋ 例外の年<");
    expect(html).not.toContain("/ex/add");
    expect(html).toContain("FP顧問料");
    // 名前はお客さまの前で読める言葉
    for (const name of ["物価の上昇率", "給与の上昇率", "表を何歳まで見るか"]) expect(html).toContain(`>${name}</label>`);
    // 欄の下は「例」の1行（長い言い方は「?」の中）。表を何歳まで見るかは、何年分の表か
    expect(box(html, "assume/inflation")).toContain("例 30年後の100万円は、今の約74万円の値打ち");
    expect(box(html, "assume/wageGrowth")).toContain("例 年収500万円は、20年後に約610万円（物価と同じ）");
    expect(fieldOf(wh, "assume/inflation").get(wh).talkHelp).toBe("物価が年1%上がると、30年後の100万円は、今の約74万円の値打ちになります");
    expect(fieldOf(wh, "assume/endYear").get(wh)).toMatchObject({ hint: expect.stringMatching(/^2027年〜\d{4}年の\d+年分（ご本人\d+歳の年まで）$/), talkHelp: expect.stringContaining("長生きしても") });
    expect(fieldOf(wh, "assume/endYear").get(wh).talk).toBeUndefined();
  });

  it("詳細: たたまずに全部（経済の前提の6つ・資産の種類ごとの利回り・不動産の評価・計算の基準の月と計算の決まり）。例外の年は欄の下の小さなリンク", () => {
    const wh = withHome(blankHousehold("2026-11", ids()));
    const html = panel(wh);
    for (const k of ["assume/period", "assume/economy", "assume/assetReturns", "assume/realEstate", "assume/conv"]) expect(html, k).toContain(`data-section="${k}"`);
    for (const k of ["assume/fine", "assume/exceptions", "assume/main"]) expect(html, k).not.toContain(`data-section="${k}"`);
    for (const k of ["assume/inflation", "assume/wageGrowth", "assume/depositReturn", "assume/educationInflation", "assume/pensionMacroSlide", "assume/pensionMacroSlideEmployee"]) {
      expect(at(html, k), k).toBeGreaterThan(0);
      // 例外の年のボタンの並び（区画）はやめ、欄の下に「＋ 例外の年」
      expect(box(html, k), k).toContain(`data-action="${k}/ex/add"`);
      expect(box(html, k), k).toContain(">＋ 例外の年<");
    }
    // 経済の前提は1つの枠（標準の2つと詳細の4つが同じ並び）
    expect(html.match(/data-group="assume\/economy\/fields"/g)).toHaveLength(1);
    // 耐用年数は不動産の評価の枠の中の小さな見出し
    expect(html).toContain('data-group="assume/realEstate/fields/life"');
    expect(at(html, "assume/investmentReturn")).toBeLessThan(0);
    // 空欄は欄の中に薄く値（推定の見た目にしない）、下に「空欄: …」
    expect(box(html, "assume/educationInflation")).toContain('placeholder="1"');
    expect(box(html, "assume/educationInflation")).toContain("空欄: 物価の上昇率と同じ");
    expect(box(html, "assume/educationInflation")).not.toContain("est-ghost");
    expect(box(html, "assume/assetReturns/equity.domestic/default")).toContain('placeholder="1"');
    expect(box(html, "assume/assetReturns/cash.foreign/default")).toContain("空欄: 預金の利回りと同じ");
    // どの欄にも「事務所の既定値」の印は出ない
    expect(html).not.toContain('data-premise="office"');
  });

  it("違う欄だけ「この世帯だけ」と「事務所の既定値（1%）に戻す」。資産の種類ごとの利回りは「戻す」と「＋ 例外の年」。戻すと元の形", () => {
    const wh = blankHousehold("2026-11", ids());
    const f = fieldOf(wh, "assume/wageGrowth");
    const own = f.set(wh, "0.015");
    expect(f.get(own)).toMatchObject({ premise: { state: "household", officeValue: "1%" }, talk: "例 年収500万円は、20年後に約673万円（物価より0.5ポイント高い）" });
    const html = panel(own, { level: "simple" });
    expect(box(html, "assume/wageGrowth")).toContain(">この世帯だけ<");
    expect(box(html, "assume/wageGrowth")).toContain(">事務所の既定値（1%）に戻す<");
    expect(box(html, "assume/inflation")).not.toContain("data-premise-reset");
    const back = f.get(own).premise!.reset(own);
    expect(back.request).toEqual(wh.request);
    const cls = fieldOf(wh, "assume/assetReturns/equity.global/default");
    const c = cls.set(wh, "0.06");
    const detail = panel(c);
    expect(box(detail, "assume/assetReturns/equity.global/default")).toContain(">戻す<");
    expect(box(detail, "assume/assetReturns/equity.global/default")).toContain('data-action="assume/assetReturns/equity.global/ex/add"');
    // 事務所の既定値どおりの種類には例外の年のリンクを出さない（前のとおり、値を入れた種類だけ）
    expect(box(detail, "assume/assetReturns/equity.domestic/default")).not.toContain("ex/add");
    expect(cls.get(c).premise?.officeValue).toBe("1%");
  });

  it("欄の下の例は値で言い換わる（物価の上昇率と比較。0%・マイナスも）", () => {
    const wh = blankHousehold("2026-11", ids());
    const w = fieldOf(wh, "assume/wageGrowth");
    expect(w.get(w.set(wh, "0.015")).talkHelp).toBe("給与が年1.5%上がると、今の年収500万円は20年後に約673万円になります（物価の上昇率より0.5ポイント高いので、暮らし向きは少しずつ良くなる計算です）");
    const hi = fieldOf(wh, "assume/inflation").set(wh, "0.02");
    expect(w.get(hi).talk).toBe("例 年収500万円は、20年後に約610万円（物価より1ポイント低い）");
    expect(fieldOf(hi, "assume/inflation").get(hi).talk).toBe("例 30年後の100万円は、今の約55万円の値打ち");
    const zero = fieldOf(wh, "assume/inflation").set(wh, "0");
    expect(fieldOf(zero, "assume/inflation").get(zero).talk).toBe("例 30年後の100万円も、今の100万円と同じ値打ち");
    expect(fieldOf(wh, "assume/inflation").get(fieldOf(wh, "assume/inflation").set(wh, "-0.01")).talk).toBe("例 30年後の100万円は、今の約135万円の値打ち");
    expect(w.get(w.set(wh, "0")).talk).toBe("例 年収500万円は、20年後も500万円（物価より1ポイント低い）");
  });

  it("例外の年がある世帯: 欄の下に例外の年の数、区画の欄の並びの下に例外の年のまとまり（詳細）", () => {
    let wh = blankHousehold("2026-11", ids());
    const add = allFields(assumptionsStage(wh)).flatMap((f) => f.links ?? []).find((a) => a.key === "assume/inflation/ex/add")!;
    expect(add).toMatchObject({ level: "detail", linkLabel: "＋ 例外の年" });
    wh = add.run(wh);
    expect(fieldOf(wh, "assume/inflation").get(wh).derived).toContain("例外の年 1年");
    const sec = assumptionsStage(wh).sections.find((s) => s.key === "assume/economy")!;
    expect(sec.groups.map((g) => g.key)).toEqual(["assume/economy/fields", "assume/inflation/ex/0"]);
    const html = panel(wh);
    expect(html).toContain('data-group="assume/inflation/ex/0"');
    expect(html).toContain("例外の年 1年");
    // 例外の年の欄へ来たときも、たたむ物が無いのでそのまま出ている
    expect(panel(wh, { focusKey: "assume/inflation/ex/0/rate" })).toContain('data-field="assume/inflation/ex/0/rate"');
  });

  it("表の最後の年を年で決めた世帯: 年の欄も計算の期間の区画に出し、何年分かはその年で", () => {
    const wh = blankHousehold("2026-11", ids());
    const choice = fieldOf(wh, "assume/endYear");
    const byYear = choice.set(wh, "year");
    const year = fieldOf(byYear, "assume/endYear/year");
    const w = year.set(byYear, 2080);
    const html = panel(w, { level: "simple" });
    expect(at(html, "assume/endYear/year")).toBeGreaterThan(0);
    expect(fieldOf(w, "assume/endYear").get(w).hint).toMatch(/^2027年〜2080年の54年分/);
    expect(fieldOf(w, "assume/endYear").get(w).talkHelp).toBe("2027年から2080年まで、54年分のお金の流れを見ます。長生きしても、暮らしのお金が足りるかを確かめるためです");
  });

  it("運用の利回り: 事務所の既定値どおりなら出さない。この世帯だけ・事務所の既定値が変わった・例外の年のある世帯だけ詳細に1行（計算は変えない）", () => {
    const wh = blankHousehold("2026-11", ids());
    expect(investmentReturnShown(wh)).toBe(false);
    expect(allFields(assumptionsStage(wh)).some((f) => f.key === "assume/investmentReturn")).toBe(false);
    const own = mutate(wh, (_h, req) => void (req.input.assumptions!.investmentReturn = { default: "0.03" }));
    expect(investmentReturnShown(own)).toBe(true);
    const html = panel(own);
    expect(at(html, "assume/investmentReturn")).toBeGreaterThan(html.indexOf('data-section="assume/assetReturns"'));
    expect(box(html, "assume/investmentReturn")).toContain(`>${INVESTMENT_RETURN_LABEL}</label>`);
    expect(box(html, "assume/investmentReturn")).toContain(">この世帯だけ<");
    expect(at(panel(own, { level: "simple" }), "assume/investmentReturn")).toBeLessThan(0);
    // 入力のホームの要約は、下の小さな1行に数える
    expect(inputItems(own).find((i) => i.id === "assumptions")?.summary?.note).toContain("細かい前提: この世帯だけ変えた所 1件");
    // 事務所の既定値を後で変えた世帯（触っていない値）: 知らせから移れるように出す
    publishOfficeSettings({ ...DEFAULT_OFFICE_SETTINGS, assumptions: { investmentReturn: "0.02" }, changedOn: "2026-11-14" });
    expect(investmentReturnShown(wh)).toBe(true);
    expect(checkList(wh).find((r) => r.fieldKey === "assume/investmentReturn")).toMatchObject({ kind: "notice", actions: [expect.objectContaining({ label: "この世帯に反映する" })] });
    setOfficeNow(STANDARD_OFFICE_NOW);
    // 例外の年だけある世帯
    const ex = mutate(wh, (_h, req) => void (req.input.assumptions!.investmentReturn = { default: "0.01", byYear: { "2027": "0.03" } }));
    expect(investmentReturnShown(ex)).toBe(true);
  });
});

describe("表を何歳まで見るかの見せ方をほかの3つにそろえる（0214 の追記 2026-11-16 の2）", () => {
  const END = "assume/endYear";
  const summaryOf = (wh: WorkingHousehold) => {
    const s = inputItems(wh).find((i) => i.id === "assumptions")?.summary;
    return s === null || s === undefined ? "" : `${s.pre ?? ""}${s.main}${s.unit ?? ""}`;
  };

  it("既定の年齢のまま: 「事務所の既定値」。推定の印・「この値にする」を出さず、推定の数・まとめての「この値にする」・提案書の推定のカードに入れない", () => {
    const wh = blankHousehold("2026-11", ids());
    expect(fieldStatus(fieldOf(wh, END), wh)).toMatchObject({ status: "confirmed", basis: null, premise: { state: "office", decided: false } });
    for (const level of ["simple", "detail"] as const) {
      const html = panel(wh, { level });
      const at = html.indexOf(`data-field="${END}"`);
      const field = html.slice(at, html.indexOf("data-field=", at + 20));
      // 事務所の既定値どおりは印を出さない（0260）。推定の印・「この値にする」も出さない
      expect(field, level).not.toContain("data-premise=");
      expect(field, level).not.toContain("data-fill-estimate");
      expect(field, level).not.toContain("data-premise-reset");
      expect(html, level).not.toContain("推定のままの値を「この値にする」");
    }
    // 確かめの一覧: 推定の行にせず、いちばん下の折りたたみ（事務所の既定値どおり）に操作なしで
    const row = checkList(wh).find((r) => r.fieldKey === END);
    expect(row).toMatchObject({ kind: "premise", detail: "事務所の既定値（提供元の既定の値のまま）", actions: [] });
    expect(checkList(wh).some((r) => r.kind === "estimated" && r.card === "assumptions")).toBe(false);
    // 前提と推定の一覧: ほかの前提と同じ状態と出典（事務所の既定値どおりは印なし）
    expect(assumptionRows(wh).find((r) => r.id === `field:${END}`)).toMatchObject({ state: "事務所の既定値", tone: null });
    expect(inputItems(wh).find((i) => i.id === "assumptions")?.status).toBe("std");
    expect(summaryOf(wh)).toBe("物価 1.0%・給与 1.0%・100歳まで");
  });

  it("既存の世帯（既定の年齢のまま保存したもの）を開いても同じ見た目。計算の要求は変えない", () => {
    for (const id of MODELS) {
      const raw = fromRequest(modelHousehold(id), {});
      // 見本は開くときに表の最後の年を既定にそろえる（sampleRequest。保存した世帯と同じ形）
      const choice = fieldOf(raw, END);
      const wh = choice.get(raw).value === "default" ? raw : choice.set(raw, "default");
      const before = JSON.stringify(wh.request);
      expect(fieldStatus(fieldOf(wh, END), wh).premise?.state, id).toBe("office");
      expect(checkList(wh).some((r) => r.fieldKey === END && r.kind === "estimated"), id).toBe(false);
      expect(JSON.stringify(wh.request), id).toBe(before);
    }
  });

  it("人と年齢で選んだ・年で決めた: 「この世帯だけ」と「事務所の既定値に戻す」。戻すと既定の年（決め方を外す）", () => {
    const wh = blankHousehold("2026-11", ids());
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const std = wh.request.input.endYear;
    const byMember = fieldOf(wh, END).set(wh, `m:${self.id}:95`);
    const byYear = fieldOf(fieldOf(wh, END).set(wh, "year"), "assume/endYear/year").set(fieldOf(wh, END).set(wh, "year"), 2080);
    for (const [name, w, was] of [
      ["人と年齢", byMember, `ご本人が95歳まで（${String(byMember.request.input.endYear)}年）`],
      ["年", byYear, "2080年まで"],
    ] as const) {
      const mark = fieldOf(w, END).get(w).premise!;
      expect(mark, name).toMatchObject({ state: "household", wasText: was, officeText: `ご本人・配偶者のうち若い方が100歳になる年（${String(std)}年）` });
      expect(fieldStatus(fieldOf(w, END), w).status, name).toBe("confirmed");
      const html = panel(w, { level: "simple" });
      expect(html, name).toContain('data-premise="household"');
      expect(html, name).toContain("事務所の既定値に戻す");
      expect(inputItems(w).find((i) => i.id === "assumptions")?.status, name).not.toBe("std");
      const back = mark.reset(w);
      expect(back.request.input.endYear, name).toBe(std);
      expect(back.endYearChoice, name).toBeUndefined();
      expect(fieldStatus(fieldOf(back, END), back).premise?.state, name).toBe("office");
      expect(assumptionRows(w).find((r) => r.id === `field:${END}`), name).toMatchObject({ state: "この世帯だけ", tone: "household" });
    }
    // 入力のホームの要約は今までどおり
    expect(summaryOf(byMember)).toBe("物価 1.0%・給与 1.0%・95歳まで（この世帯だけ）");
    expect(summaryOf(byYear)).toBe("物価 1.0%・給与 1.0%・2080年まで（この世帯だけ）");
  });

  it("事務所の既定値の年齢を決めた・後で変えた: 新しい世帯は「事務所の既定値」（決めた値）。前の年齢の年の世帯は「この世帯だけ」で、戻すと今の年齢の年", () => {
    const s95: OfficeSettings = { ...DEFAULT_OFFICE_SETTINGS, endAge: 95, changedOn: "2026-11-14" };
    publishOfficeSettings(s95);
    const fresh = applyOfficeDefaults(blankHousehold("2026-11", ids()), s95);
    expect(premiseOf(fresh, END)).toMatchObject({ state: "office", decided: true });
    expect(summaryOf(fresh)).toBe("物価 1.0%・給与 1.0%・95歳まで");
    expect(checkList(fresh).find((r) => r.fieldKey === END)).toMatchObject({ kind: "premise", detail: "事務所の既定値" });
    // 100歳の年のまま作った世帯（事務所の年齢を後で95歳にした）: 値は変えず、人と年齢（若い方の100歳）で選んだ年と同じに見せる
    setOfficeNow(STANDARD_OFFICE_NOW);
    const old = blankHousehold("2026-11", ids());
    const end100 = old.request.input.endYear;
    publishOfficeSettings(s95);
    expect(old.request.input.endYear).toBe(end100);
    const mark = premiseOf(old, END)!;
    expect(mark.state).toBe("household");
    expect(summaryOf(old)).toBe("物価 1.0%・給与 1.0%・100歳まで（この世帯だけ）");
    expect(mark.reset(old).request.input.endYear).toBe(fresh.request.input.endYear);
    expect(checkList(old).some((r) => r.fieldKey === END && (r.kind === "estimated" || r.kind === "notice"))).toBe(false);
  });

  it("確かめの一覧・検索から表を何歳まで見るかの欄へ来たとき: 計算の期間の区画の欄（たたむ物は無い）", () => {
    const wh = blankHousehold("2026-11", ids());
    const html = panel(wh, { focusKey: END });
    expect(html).not.toContain("data-premise-fold");
    expect(html).toContain(`data-field="${END}"`);
  });
});

describe("事務所の既定値を後で変えたとき（0214 の5）", () => {
  it("写した値は変えず、確かめの一覧に「事務所の既定値が変わりました（前→今）」。1押しで当てる（今回足した欄も）", () => {
    publishOfficeSettings(OFFICE);
    const wh = withHome(applyOfficeDefaults(blankHousehold("2026-11", ids()), OFFICE));
    const before = JSON.stringify(wh.request);
    publishOfficeSettings({ ...OFFICE, realEstateValuation: { landGrowth: "0.005", usefulLife: { wood: 25 } }, assetReturns: { "equity.global": "0.055" }, changedOn: "2026-12-01" });
    const rows = checkList(wh).filter((r) => r.kind === "notice" && r.fieldKey?.startsWith("assume/"));
    const life = rows.find((r) => r.fieldKey === "assume/realEstate/life/wood")!;
    expect(life.detail).toBe("事務所の既定値が変わりました（30年→25年）。この世帯は前の値で計算しています");
    expect(rows.find((r) => r.fieldKey === "assume/assetReturns/equity.global/default")!.detail).toContain("事務所の既定値が変わりました（5%→5.5%）");
    expect(JSON.stringify(wh.request)).toBe(before);
    expect(premiseOf(wh, "assume/realEstate/life/wood")?.state).toBe("officeChanged");
    expect(panel(wh, { focusKey: "assume/realEstate/life/wood" })).toContain("今の既定値にする");
    const next = life.actions.find((a) => a.key === "office")!.run(wh);
    expect(life.actions[0]!.label).toBe("この世帯に反映する");
    expect(next.request.input.assumptions?.realEstateValuation?.usefulLife).toEqual({ wood: 25 });
    expect(next.assumed["assume/realEstate/life/wood"]).toBe("事務所の既定値（2026-12）");
    expect(premiseOf(next, "assume/realEstate/life/wood")?.state).toBe("office");
    expect(checkList(next).some((r) => r.kind === "notice" && r.fieldKey === "assume/realEstate/life/wood")).toBe(false);
  });

  it("古い世帯: 提供元の既定の値のまま触っていない欄は知らせ、FP が決めた値は「この世帯だけ」（知らせなし）", () => {
    // 事務所の既定値の無いころに作った世帯（物価は既定の値で行が無い・賃金は「この値にする」で確定・運用利回りは打った値）
    const req = structuredClone(modelHousehold("salariedCoupleTwoKids"));
    (req.input as unknown as { valueStates?: Record<string, unknown> }).valueStates = { "assumptions.wageGrowth/default": { state: "confirmed", origin: { kind: "manual" }, estimate: { method: "standard", basis: "既定の値（仮の値。事務所で根拠を確かめて直してください）" } } };
    const wh = fromRequest(req, {});
    expect(premiseOf(wh, "assume/inflation")?.state).toBe("office");
    expect(premiseOf(wh, "assume/wageGrowth")?.state).toBe("office");
    publishOfficeSettings({ ...DEFAULT_OFFICE_SETTINGS, assumptions: { inflation: "0.02", wageGrowth: "0.02", investmentReturn: "0.03" }, changedOn: "2026-11-14" });
    expect(premiseOf(wh, "assume/inflation")).toMatchObject({ state: "officeChanged", wasText: "1%", officeText: "2%" });
    expect(premiseOf(wh, "assume/wageGrowth")).toMatchObject({ state: "household" });
    // 見本の運用利回りも既定の値のまま（触っていない）ので知らせる
    expect(premiseOf(wh, "assume/investmentReturn")).toMatchObject({ state: "officeChanged", wasText: "1%", officeText: "3%" });
    // 見本の外国株式の利回りは見本の作り手が入れた値（この世帯だけ）
    expect(premiseOf(wh, "assume/assetReturns/equity.global/default")).toMatchObject({ state: "household" });
    const notices = checkList(wh).filter((r) => r.kind === "notice" && r.fieldKey?.startsWith("assume/"));
    expect(notices.map((r) => r.fieldKey).sort()).toEqual(["assume/inflation", "assume/investmentReturn"]);
    // 前提と推定の一覧の状態と出典
    const rows = assumptionRows(wh);
    expect(rows.find((r) => r.id === "field:assume/inflation")).toMatchObject({ state: "事務所の既定値が変わりました", source: "前の事務所の既定値（今は 2%）" });
    expect(rows.find((r) => r.id === "field:assume/wageGrowth")).toMatchObject({ state: "この世帯だけ", tone: "household" });
  });

  it("資産配分の期待リターンの目安（推定の目安から書いた値）は推定のまま（0214 の4 の例外）", () => {
    const wh = blankHousehold("2026-11", ids());
    const w = { ...wh, assumed: { ...wh.assumed, "assume/assetReturns/equity.global/default": "外国株式の期待リターンの目安 6%" }, request: mutate(wh, (_h, req) => void ((req.input.assumptions!.assetReturns ??= {})["equity.global"] = { default: "0.06" })).request };
    const s = fieldStatus(fieldOf(w, "assume/assetReturns/equity.global/default"), w);
    expect(s).toMatchObject({ status: "estimated", basis: "外国株式の期待リターンの目安 6%" });
    expect(s.premise).toBeUndefined();
  });
});

describe("見本の世帯の計算の結果は変わらない（0214 の6）", () => {
  it.each(MODELS)("%s: 読むだけで計算の要求を変えず、事務所の既定値を変えても計算の結果は同じ", (id) => {
    const wh = fromRequest(modelHousehold(id), {});
    const before = JSON.stringify(wh.request);
    const table = JSON.stringify(preview(wh.request).table);
    publishOfficeSettings(OFFICE);
    panel(wh);
    checkList(wh);
    assumptionRows(wh);
    premiseCounts(wh);
    expect(JSON.stringify(wh.request)).toBe(before);
    expect(JSON.stringify(preview(wh.request).table)).toBe(table);
  });
});

describe("事務所の既定値の画面の前提条件（0214 の1・4）", () => {
  it("経済の前提・不動産の評価・資産の種類ごとの利回りの3つの区画。資産の種類ごとの利回りと耐用年数は4列の小さな欄の並び", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: OFFICE, onSave: async () => undefined, shared: false, onClose: noop }));
    for (const sec of ["economy", "realEstate", "assetReturns"]) expect(html).toContain(`data-office-premises="${sec}"`);
    expect(html.match(/class="os-fields os-cols4"/g)).toHaveLength(2);
    for (const d of PREMISE_DEFS) expect(html, d.id).toContain(`data-office-setting="${d.id}"`);
    // 決めた値は欄に入っている（％・年）
    expect(html).toMatch(/value="30"[^>]*data-office-setting="realEstateValuation.usefulLife.wood"/);
    expect(html).toMatch(/value="5"[^>]*data-office-setting="assetReturns.equity.global"/);
    expect(html).toMatch(/placeholder="物価上昇率と同じ"[^>]*data-office-setting="realEstateValuation.landGrowth"|data-office-setting="realEstateValuation.landGrowth"/);
    expect(premiseOfId("assetReturns.realEstate")?.officeLabel).toBe("不動産（貸していない不動産の値動き）");
  });
});
