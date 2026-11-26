// 事務所の既定値のパネルの見た目: 左の目次は7つの画面の名前と今の値の要約（0261）。
// チェックボックスの一覧の説明（対策・想定の前提・入力項目）は短く、画面に設計記録の番号（4桁の数字）を出さない
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { PREMISE_KINDS, SCENE_KINDS } from "../src/workspace/contingency/premiseChoice.ts";
import { OFFICE_PAGES, OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { NO_FEATURES } from "../src/workspace/office/featureCodes.ts";
import { DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { LEVER_KINDS } from "../src/workspace/plans/leverChoice.ts";

describe("左の目次（0261）", () => {
  it("7つの画面を、よく変える3つ・線・ほかの4つの順に並べ、画面の名前と今の値の要約を出す", () => {
    expect(OFFICE_PAGES.map((x) => x.name)).toEqual(["前提条件の既定値", "FP顧問料の料金表", "推定の値（統計・目安）", "入力の画面", "結果と万一の画面", "事務所の見た目と機能", "カスタム層"]);
    const html = renderToString(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, shared: false, onSave: async () => undefined, onClose: () => undefined, estimates: {}, onAddCode: async () => NO_FEATURES }));
    const links = [...html.matchAll(/data-office-page-link="([a-z]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(["premises", "fee", "estimates", "input", "results", "look"]);
    // 線は4つ目（入力の画面）の前
    expect(html).toMatch(/<li class="os-nav-sep"><button[^>]*data-office-page-link="input"/);
    expect(html).toContain("物価1%・賃金1%・100歳まで");
    expect(html).toContain("単発30万円・月1万円");
    expect(html).toMatch(/事務所で変えた値 0件／\d+件/);
  });
});

describe("チェックボックスの一覧の説明", () => {
  it("対策・想定の前提・場面の名前と説明に設計記録の番号を出さず、説明は短い", () => {
    const texts = [...LEVER_KINDS, ...PREMISE_KINDS, ...SCENE_KINDS].flatMap((k) => [k.label, "note" in k ? String(k.note) : ""]);
    for (const t of texts) expect(t).not.toMatch(/\d{4}/);
    for (const k of LEVER_KINDS) if ("note" in k) expect(k.note.length).toBeLessThanOrEqual(20);
    expect(LEVER_KINDS.find((k) => k.kind === "loan:outlook")).toMatchObject({ note: "変動金利の住宅ローンごと" });
    expect(LEVER_KINDS.find((k) => k.kind === "edu:course")).toMatchObject({ note: "進路を入れた子ごと" });
  });

  it("パネルの対策の一覧: 入力項目のチェックの欄（四角が左・名前が右）。説明は名前の下の小さな1行", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, shared: false, onSave: async () => undefined, onClose: () => undefined }));
    const item = html.match(/<div class="fld is-check" data-office-lever="edu:course">([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
    expect(item).toMatch(/<span class="fld-check-main"><input type="checkbox" id="os-f-lever\.edu:course"[^>]*data-office-lever-show="edu:course"[^>]*><span class="fld-check-name"><label for="os-f-lever\.edu:course">子の進路の型<\/label><small class="os-note">進路を入れた子ごと<\/small><\/span><\/span>/);
    expect(html).not.toContain("0203");
    expect(html).not.toContain("0211");
  });
});
