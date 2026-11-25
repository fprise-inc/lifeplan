// 事務所の既定値の画面を7つの画面に分け、保存を全部の画面まとめて1つにする（0261）:
// 画面の並びと開く画面・保存していない変更と直す所の数え方（空欄・「1」と「1.0」・全角・範囲の外・資産配分の割合の合計）・
// まとめて保存する中身（どの画面で変えた所も1回で入る。推定の値に置く前提条件は変えた物だけ・年月は変えない）・
// 2か所で変えていた値（土地の割合など・資産の種類の信託報酬と期待リターン）は前提条件の既定値の画面だけで変える・
// 事務所の共有のときの文・狭い幅で目次をたたむ形・パネルの形（下の帯・右上の ×・Esc）
// 押して画面を移る・保存・キャンセル・閉じるときの確かめ・狭い幅の見え方は、見えないブラウザの通しのテスト（walkthrough/office-pages.test.ts）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { APP_DIR } from "../scripts/lib.ts";
import { PREMISE_DEFS } from "../src/workspace/input/premiseDefaults.ts";
import { CLASSES } from "../src/workspace/input/savings/model.ts";
import { EstimatesSection } from "../src/workspace/office/EstimatesSection.tsx";
import { EMPTY_ESTIMATES, withNoFill, withOfficeValue } from "../src/workspace/office/estimates.ts";
import { feeKey, mixKey, retKey } from "../src/workspace/office/formText.ts";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { buildDisplayCatalog, OFFICE_PAGE_NAMES } from "../src/connector/displayCatalog.ts";
import { draftOf, FIRST_OFFICE_PAGE, officePageName, forgetOfficePage, OFFICE_PAGES, openingPage, pageChanges, pageProblems, pagesText, pageSummary, premisePageField, rememberOfficePage, settingsToSave, type OfficeDraft, type OfficePageId } from "../src/workspace/office/pages.ts";
import { DEFAULT_OFFICE_SETTINGS, type OfficeSettings } from "../src/workspace/office/settings.ts";
import { renderPressing } from "./pressing.ts";

const ALL: OfficePageId[] = OFFICE_PAGES.map((p) => p.id);
const none = (): Record<OfficePageId, number> => ({ premises: 0, fee: 0, estimates: 0, input: 0, results: 0, look: 0, custom: 0 });
const base = (v: OfficeSettings = DEFAULT_OFFICE_SETTINGS, brand: OfficeDraft["brand"] = {}): OfficeDraft => draftOf(v, brand);
const withText = (d: OfficeDraft, key: string, t: string): OfficeDraft => ({ ...d, texts: { ...d.texts, [key]: t } });
const noop = () => undefined;

afterEach(() => forgetOfficePage());

describe("7つの画面と開く画面", () => {
  it("画面の名前と並び。上の3つ（前提条件・料金・推定の値）の後ろに線", () => {
    expect(OFFICE_PAGES.map((p) => p.id)).toEqual(["premises", "fee", "estimates", "input", "results", "look", "custom"]);
    expect(FIRST_OFFICE_PAGE).toBe("premises");
  });

  it("AI接続口の表示の設定の一覧も、同じ画面の名前で場所を書く", () => {
    for (const [id, name] of Object.entries(OFFICE_PAGE_NAMES)) expect(officePageName(id as OfficePageId), id).toBe(name);
    const where = buildDisplayCatalog().settings.map((x) => x.change.office ?? "").filter((x) => x !== "");
    expect(where.length).toBeGreaterThan(10);
    for (const w of where) expect(w).toMatch(/「事務所の既定値」の「(入力の画面|結果と万一の画面|事務所の見た目と機能)」の画面の区画「/);
  });

  it("開く画面: 呼ぶ側の指定 → 前回の画面 → 初めては前提条件の既定値。出していない画面なら前提条件の既定値", () => {
    expect(openingPage(undefined, ALL)).toBe("premises");
    rememberOfficePage("input");
    expect(openingPage(undefined, ALL)).toBe("input");
    expect(openingPage("results", ALL)).toBe("results");
    // 本体が無くて推定の値の画面を出さないとき
    rememberOfficePage("estimates");
    expect(openingPage(undefined, ALL.filter((p) => p !== "estimates"))).toBe("premises");
  });

  it("パネルは開いた画面だけを見せ、ほかの画面は隠して持つ（移っても変えた途中の値が残る）", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, onSave: async () => undefined, shared: false, onClose: noop, initialPage: "fee" }));
        expect(html).toMatch(/<div class="os-page" role="region" aria-labelledby="os-page-premises" hidden[ >=]/);
    expect(html).not.toMatch(/<div class="os-page" role="region" aria-labelledby="os-page-fee" hidden[ >=]/);
    expect(html).toContain('data-office-page-now="fee"');
    expect(html).toMatch(/aria-current="page" data-office-page-link="fee"/);
  });
});

describe("保存していない変更と直す所の数え方", () => {
  it("開いたまま（変えていない）は0か所。下の帯は「閉じる」と押せない「保存」", () => {
    expect(pageChanges(base(), base())).toEqual(none());
    expect(pageProblems(base())).toEqual(none());
    const html = renderToString(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, onSave: async () => undefined, shared: false, onClose: noop }));
    expect(html).toMatch(/data-office-cancel="true">閉じる<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-office-settings-save/);
    expect(html).not.toContain("data-office-page-unsaved");
  });

  it("空欄のまま・「1」と「1.0」・全角の数は同じ値なので変更に数えない。読めない文字・範囲の外は変更で、直す所", () => {
    const b = base({ ...DEFAULT_OFFICE_SETTINGS, assumptions: { inflation: "0.01" } });
    expect(b.texts.inflation).toBe("1");
    expect(pageChanges(b, withText(b, "inflation", "1.0")).premises).toBe(0);
    expect(pageChanges(b, withText(b, "inflation", "１")).premises).toBe(0);
    expect(pageChanges(b, withText(b, "wageGrowth", "")).premises).toBe(0);
    const bad = withText(b, "inflation", "abc");
    expect(pageChanges(b, bad).premises).toBe(1);
    expect(pageProblems(bad).premises).toBe(1);
    const over = withText(b, "inflation", "11");
    expect(pageProblems(over).premises).toBe(1);
    // 空欄にする（提供元の既定に戻す）のは変更
    expect(pageChanges(b, withText(b, "inflation", "")).premises).toBe(1);
  });

  it("どの画面の変更も、その画面に数える（文字の欄・選んだ値・推定の値・見た目）", () => {
    const b = base();
    let d = withText(b, "inflation", "2");
    d = { ...d, fee: { ...d.fee, oneTime: "25" } };
    d = { ...d, s: { ...d.s, inheritLikelihood: "uncertain", levers: { shown: ["loan:rate"] }, features: { combinedBs: true } } };
    d = { ...d, est: withNoFill(withOfficeValue(d.est, "preset.living.single", 150000, null, "2026-11-25"), "livingExpense.monthly", true) };
    d = { ...d, brand: { name: "テスト事務所" } };
    const c = pageChanges(b, d);
    expect(c).toEqual({ premises: 1, fee: 1, estimates: 2, input: 1, results: 1, look: 2, custom: 0 });
    expect(pagesText(c)).toBe("前提条件の既定値（1か所）・FP顧問料の料金表（1か所）・推定の値（統計・目安）（2か所）・入力の画面（1か所）・結果と万一の画面（1か所）・事務所の見た目と機能（2か所）");
  });

  it("資産配分の割合: 全部空欄は既定（GPIF の基本ポートフォリオ）。合計が100%でなければ直す所", () => {
    const b = base();
    const one = withText(b, mixKey("equity.global"), "50");
    expect(pageProblems(one).premises).toBe(1);
    const full = withText(one, mixKey("bond.global"), "50");
    expect(pageProblems(full).premises).toBe(0);
    expect(pageChanges(b, full).premises).toBe(2);
  });

  it("料金表・必要保障額の年齢・見た目の色の読めない所は、その画面の直す所", () => {
    const b = base();
    expect(pageProblems({ ...b, fee: { ...b.fee, steps: [{ year: "1", amount: "2" }] } }).fee).toBe(1);
    const age = { ...b, s: { ...b.s, protection: { horizon: { kind: "age" as const } } }, texts: { ...b.texts, horizonAge: "40" } };
    expect(pageProblems(age).results).toBe(1);
    expect(pageProblems({ ...b, brand: { color: "#c62828" } }).look).toBe(1);
  });

  it("左の目次の要約は、変えている途中の値で作る", () => {
    const b = base();
    expect(pageSummary("premises", b)).toBe("物価1%・賃金1%・100歳まで");
    const d = { ...withText(b, "inflation", "1.5"), s: { ...b.s, endAge: 95 } };
    expect(pageSummary("premises", d)).toBe("物価1.5%・賃金1%・95歳まで");
    expect(pageSummary("fee", { ...b, fee: { ...b.fee, oneTime: "25" }, s: { ...b.s, fee: { ...b.s.fee, per: "year" } } })).toBe("単発25万円・年1万円");
    expect(pageSummary("estimates", b)).toMatch(/^事務所で変えた値 0件／\d+件$/);
  });
});

describe("全部の画面をまとめて1回で保存する中身", () => {
  it("どの画面で変えた所も1つの事務所の既定値に入る（世帯ファイル・事務所データの形は同じ）", () => {
    const b = base();
    let d = withText(b, "inflation", "2");
    d = withText(d, "realEstateValuation.landShare", "40");
    d = withText(d, feeKey("equity.global"), "0.2");
    d = withText(d, retKey("equity.global"), "6.5");
    d = { ...d, fee: { ...d.fee, oneTime: "25" } };
    d = { ...d, s: { ...d.s, inheritLikelihood: "uncertain", features: { combinedBs: true } } };
    d = { ...d, est: withOfficeValue(d.est, "preset.living.single", 150000, null, "2026-11-25") };
    const next = settingsToSave(d, "2026-11-25");
    expect(next.version).toBe(5);
    expect(next.assumptions).toEqual({ inflation: "0.02" });
    expect(next.fee.oneTime).toBe(250000);
    expect(next.inheritLikelihood).toBe("uncertain");
    expect(next.features.combinedBs).toBe(true);
    expect(next.changedOn).toBe("2026-11-25");
    // 置き場所が推定の値の物は推定の値に（土地の割合・信託報酬・期待リターン）。推定の値の画面で変えた値も同じ所
    expect(Object.keys(next.estimates?.values ?? {}).sort()).toEqual(["preset.invest.equity.global.fee", "preset.invest.equity.global.return", "preset.living.single", "preset.realEstate.landShare"]);
    expect(next.estimates?.values["preset.realEstate.landShare"]?.value).toBe("0.4");
    expect(next.estimates?.values["preset.invest.equity.global.return"]?.value).toBe("0.065");
  });

  it("推定の値に置く前提条件は、変えた物だけ書く（同じ値・空欄のままなら年月を変えない）", () => {
    const saved = settingsToSave(withText(base(), "realEstateValuation.landShare", "40"), "2026-10-01");
    const b = base(saved);
    expect(b.texts["realEstateValuation.landShare"]).toBe("40");
    const again = settingsToSave(withText(b, "inflation", "2"), "2026-11-25");
    expect(again.estimates?.values["preset.realEstate.landShare"]?.changedOn).toBe("2026-10-01");
    // 空欄にすると公式の値に戻す（事務所の値を外す）
    const cleared = settingsToSave(withText(b, "realEstateValuation.landShare", ""), "2026-11-25");
    expect(cleared.estimates?.values["preset.realEstate.landShare"]).toBeUndefined();
  });

  it("読めない欄は今の値のまま（直す所があると、画面では保存できない）", () => {
    const b = base({ ...DEFAULT_OFFICE_SETTINGS, assumptions: { inflation: "0.015" } });
    const next = settingsToSave(withText(b, "inflation", "abc"), "2026-11-25");
    expect(next.assumptions.inflation).toBe("0.015");
  });
});

describe("2か所で変えていた値は、前提条件の既定値の画面だけで変える", () => {
  it("土地の割合・建物の残りの価値の下限・売却の費用と、資産の種類の信託報酬・期待リターンの目安は、前提条件の既定値の画面の欄", () => {
    expect(premisePageField("preset.realEstate.landShare")).toBe("realEstateValuation.landShare");
    expect(premisePageField("preset.realEstate.residualFloor")).toBe("realEstateValuation.residualFloor");
    expect(premisePageField("preset.realEstate.saleCostRate")).toBe("realEstateValuation.saleCostRate");
    for (const c of CLASSES) expect(premisePageField(`preset.invest.${c.key}.fee`), c.key).toBe(feeKey(c.key));
    expect(premisePageField("preset.invest.equity.global.return")).toBe(retKey("equity.global"));
    // 期待リターンの目安の無い外貨預金・値動きの大きさ・ほかの推定の値は、推定の値の画面で変える
    expect(premisePageField("preset.invest.cash.foreign.return")).toBeNull();
    expect(premisePageField("preset.invest.equity.global.volatility")).toBeNull();
    expect(premisePageField("preset.living.single")).toBeNull();
    // 前提条件の既定値の画面には、その欄がある
    const html = renderToString(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, onSave: async () => undefined, shared: false, onClose: noop }));
    for (const d of PREMISE_DEFS.filter((x) => x.live !== undefined)) expect(html).toContain(`data-office-setting="${d.id}"`);
    for (const c of CLASSES) expect(html).toContain(`data-office-setting="${feeKey(c.key)}"`);
    expect(html).toContain(`data-office-setting="${retKey("equity.global")}"`);
    expect(html).not.toContain(`data-office-setting="${retKey("cash.foreign")}"`);
  });

  it("推定の値の画面では、その行は読むだけで「前提条件の既定値で変える」（ほかの行は「変える」）", () => {
    const value = withOfficeValue(withOfficeValue(EMPTY_ESTIMATES, "preset.invest.bond.domestic.fee", "0.002", null, "2026-11-25"), "preset.invest.bond.domestic.volatility", "0.04", null, "2026-11-25");
    // まとまり「前提条件・資産運用」で絞る（値ID の順で、国内債券の行が一覧の頭に出る）
    const html = renderPressing(h(EstimatesSection, { value, onChange: noop, today: () => "2026-11-25", onGoPremise: noop }), "data-office-estimate-group=前提条件・資産運用");
    expect(html).toContain('data-office-estimate-go-premise="preset.invest.bond.domestic.fee"');
    expect(html).not.toContain('data-office-estimate-edit="preset.invest.bond.domestic.fee"');
    expect(html).toContain('data-office-estimate-edit="preset.invest.bond.domestic.volatility"');
    expect(html).toContain("「前提条件の既定値」の画面で変えます（ここには読むだけで出します）");
  });

  it("推定の値の画面で変えた行は、保存するまで「保存していない」の印", () => {
    const value = withOfficeValue(EMPTY_ESTIMATES, "preset.invest.bond.domestic.volatility", "0.04", null, "2026-11-25");
    const html = renderPressing(h(EstimatesSection, { value, saved: EMPTY_ESTIMATES, onChange: noop, today: () => "2026-11-25" }), "data-office-estimate-group=前提条件・資産運用");
    expect(html).toContain('data-office-estimate-unsaved="preset.invest.bond.domestic.volatility"');
  });
});

describe("事務所の共有のとき・パネルの形", () => {
  it("事務所で共有していても、今はこの PC の設定と頭と見た目の「?」に書く（保存の仕方は同じ）", () => {
    const panel = (shared: boolean) => renderToString(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, onSave: async () => undefined, shared, onClose: noop, branding: { value: {}, onPreview: noop, onSave: async (b) => b, onPickLogo: async () => null } }));
    const on = panel(true);
    expect(on).toContain("事務所で共有していても、今はこの PC の設定です。");
    expect(on).toContain("事務所で共有していても、この PC の設定です。");
    const off = panel(false);
    expect(off).not.toContain("事務所で共有していても");
    expect(off).toContain("この PC の設定です。");
    // どちらも同じ下の帯の「保存」1つ（見た目の区画の中に保存のボタンは無い）
    for (const html of [on, off]) {
      expect(html.match(/data-office-settings-save/g)).toHaveLength(1);
      expect(html).not.toContain("data-branding-save");
    }
  });

  it("「この画面を既定に戻す」で、その画面の欄が提供元の既定に戻り、下の帯に保存していない変更が出る", () => {
    const value: OfficeSettings = { ...DEFAULT_OFFICE_SETTINGS, assumptions: { inflation: "0.02" }, endAge: 95 };
    const html = renderPressing(h(OfficeSettingsPanel, { value, onSave: async () => undefined, shared: false, onClose: noop }), "data-office-page-reset=premises");
    expect(html).not.toMatch(/value="2"[^>]*data-office-setting="inflation"/);
    expect(html).toContain("data-office-page-unsaved");
    expect(html).toContain("保存していない変更: 前提条件の既定値（2か所）");
    expect(html).toMatch(/data-office-cancel="true">キャンセル<\/button>/);
  });

  it("狭い幅では左の目次を隠し、上の1行の選ぶ欄で画面を選ぶ（app.css）", () => {
    const css = readFileSync(join(APP_DIR, "src", "styles", "app.css"), "utf8");
    const narrow = css.slice(css.indexOf("@media (max-width: 860px) {\n  .os-wrap"));
    const block = narrow.slice(0, narrow.indexOf("\n}\n"));
    expect(block).toMatch(/\.os-nav \{ display: none; \}/);
    expect(block).toMatch(/\.os-nav-row \{ display: flex;/);
    expect(css).toMatch(/\.os-nav-row \{ display: none; \}/);
    // パネルは約1,080px（文字「大」は少し広く）
    expect(css).toMatch(/\.os-panel \{[^}]*width: min\(1080px, calc\(100vw - 32px\)\);/);
    const html = renderToString(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, onSave: async () => undefined, shared: false, onClose: noop }));
    expect(html).toContain("data-office-page-pick");
    expect(html).toMatch(/<option[^>]*value="premises"[^>]*>前提条件の既定値<\/option>/);
  });
});
