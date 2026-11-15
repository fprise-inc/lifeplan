// 事務所の既定値のパネルの見た目: 目次は意味のまとまりの組ごとに分けて縦に並べる（「・」で詰めない）。
// チェックボックスの一覧の説明（対策・想定の前提・入力項目）は短く、画面に設計記録の番号（4桁の数字）を出さない
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { PREMISE_KINDS, SCENE_KINDS } from "../src/workspace/contingency/premiseChoice.ts";
import { OfficeSettingsPanel, tocGroups } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { LEVER_KINDS } from "../src/workspace/plans/leverChoice.ts";

describe("目次の組", () => {
  it("見出しを組に分け、本文の順のまま組ごとに並べる。知らない見出しはすぐ前の見出しの組に入れ、カスタム層の末尾は省く", () => {
    const heads = [
      { id: "os-brand", label: "事務所の見た目" },
      { id: "os-cards", label: "入力のホームの入力項目の並び" },
      { id: "os-living", label: "基本生活費の内訳の並べ方" },
      { id: "os-levers", label: "対策に最初から出す項目" },
      { id: "os-cg", label: "万一のときのタブ" },
      { id: "os-care", label: "ご本人・配偶者の介護の費用" },
      { id: "os-fee", label: "FP顧問料の料金表" },
      { id: "os-new", label: "新しい区画" },
      { id: "os-custom", label: "説明の文（カスタム層）" },
      { id: "os-custom-terms", label: "名前（カスタム層）" },
    ];
    const g = tocGroups(heads);
    expect(g.map((x) => x.title)).toEqual(["見た目と入力の並び", "結果と万一の画面", "計算の前提と金額", "カスタム層"]);
    expect(g[2]?.items.map((x) => x.id)).toEqual(["os-care", "os-fee", "os-new"]);
    expect(g[3]?.items.map((x) => x.label)).toEqual(["説明の文", "名前"]);
    // 組の中の並びは本文の順のまま、見出しはどれも1回だけ
    expect(g.flatMap((x) => x.items.map((i) => i.id))).toEqual(heads.map((x) => x.id));
    // 空の組は出さない
    expect(tocGroups([{ id: "os-levers", label: "対策" }]).map((x) => x.title)).toEqual(["結果と万一の画面"]);
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

  it("パネルの対策の一覧: チェックボックスと名前は同じ label の中、説明はその外（名前の下へ回せる）", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, shared: false, onSave: async () => undefined, onClose: () => undefined }));
    const li = html.match(/<li data-office-lever="edu:course">([\s\S]*?)<\/li>/)?.[1] ?? "";
    expect(li).toMatch(/<label class="os-show"><input[^>]*>\s*<span class="os-name">子の進路の型<\/span><\/label><small class="os-note">進路を入れた子ごと<\/small>/);
    expect(html).not.toContain("0203");
    expect(html).not.toContain("0211");
  });
});
