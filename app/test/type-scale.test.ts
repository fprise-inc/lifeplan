// 文字の5段＋印（0261 の追記 2026-11-26）: 入力項目のパネルと事務所の既定値の画面で、文字の大きさを1か所（app.css の :root の --type-*）から使うこと。
// - 値は :root の1か所だけ（前は前提条件の入力項目〔--t1 など〕と事務所の既定値の画面〔--os-1 など〕がそれぞれ持っていた）
// - 入力項目のパネル（全部の入力項目）と事務所の既定値の画面の頭の要素に .type-scale があり、欄の部品（欄の名前・値・説明・印・見出し）の大きさは
//   .type-scale の決まりで段の変数から決まる。前提条件だけの大きさは持たない
// - 欄の高さの計算（チェックの四角の位置・選ぶ欄の行の高さ）も、欄の文字の大きさの変数から計算する（段を変えても並びがずれない）
// - ボタンの文字はボタンの決まり（0236・0240）のまま（.type-scale の決まりはボタンの大きさを書かない）
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { fromRequest } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import type { StageId } from "../src/workspace/input/form.ts";
import { modelHousehold } from "./helpers.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const styles = join(APP, "src", "styles");
const css = readFileSync(join(styles, "app.css"), "utf8");
const others = ["invest.css", "stageTable.css", "store.css", "balance.css", "header.css", "statement.css", "review.css", "rental.css", "wire.css", "ai.css", "hearingWeb.css"].map((f) => readFileSync(join(styles, f), "utf8"));

/** CSS の決まり（セレクタと中身）の一覧（@media の中も平らに読む。コメントは外す） */
function rules(text: string): { selector: string; body: string }[] {
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of plain.matchAll(re)) out.push({ selector: (m[1] as string).trim(), body: (m[2] as string).trim() });
  return out;
}
const all = rules(css);
const fontSize = (body: string) => /(?:^|;)\s*font-size:\s*([^;]+)/.exec(body)?.[1]?.trim();

describe("文字の5段＋印（0261 の追記 2026-11-26）", () => {
  it("段の値は :root の1か所（1.25・1・0.92・0.9・0.8rem と印 0.74rem）。ほかの所は段の値を持たない", () => {
    const root = all.find((r) => r.selector === ":root")!.body;
    const decl = (k: string) => new RegExp(`${k}:\\s*([^;]+);`).exec(root)?.[1]?.trim();
    expect([decl("--type-1"), decl("--type-2"), decl("--type-3"), decl("--type-4"), decl("--type-5"), decl("--type-mark")]).toEqual(["1.25rem", "1rem", "0.92rem", "0.9rem", "0.8rem", "0.74rem"]);
    // 決めているのは :root だけ（前の前提条件の --t1〜・事務所の既定値の画面の --os-1〜 は無い）
    for (const text of [css, ...others]) {
      const defs = rules(text).filter((r) => r.selector !== ":root" && /--type-[\w-]+\s*:/.test(r.body));
      expect(defs.map((r) => r.selector)).toEqual([]);
      expect(text).not.toMatch(/--os-(\d|chip)\b/);
      expect(text).not.toMatch(/var\(--t[1-5m]\)/);
    }
  });

  it("入力項目のパネルの欄の部品は .type-scale の決まりで段の変数を使う（前提条件だけの大きさは無い）", () => {
    const ts = all.filter((r) => r.selector.startsWith(".type-scale"));
    // .type-scale の決まりの文字の大きさは、どれも段の変数
    for (const r of ts) {
      const f = fontSize(r.body);
      if (f !== undefined) expect(f, r.selector).toMatch(/^var\(--type-(1|2|3|4|5|mark)\)$/);
    }
    const sizeOf = (part: string) => ts.find((r) => fontSize(r.body) !== undefined && r.selector.split(/,\s*(?![^()]*\))/).some((s) => s.includes(part)))?.body;
    expect(fontSize(sizeOf(".ip-head h2") ?? "")).toBe("var(--type-1)");
    expect(fontSize(sizeOf(".in-section > h3") ?? "")).toBe("var(--type-2)");
    expect(fontSize(sizeOf(".in-group-h h4") ?? "")).toBe("var(--type-3)");
    expect(fontSize(sizeOf(".fld-l") ?? "")).toBe("var(--type-4)");
    expect(fontSize(sizeOf(".fld-c") ?? "")).toBe("var(--type-4)");
    expect(fontSize(sizeOf(".fld-help") ?? "")).toBe("var(--type-5)");
    expect(fontSize(sizeOf(".fld-hint") ?? "")).toBe("var(--type-5)");
    expect(fontSize(sizeOf(".badge") ?? "")).toBe("var(--type-mark)");
    // ボタンの大きさは書かない（0236・0240 の決まりのまま）
    for (const r of ts) if (fontSize(r.body) !== undefined) expect(r.selector, r.selector).not.toMatch(/\.(btn|add-btn|seg-g|level-switch|fld-fill|unit-btn)\b(?![-\w])/);
    // 前提条件の入力項目・事務所の既定値の画面は、文字の大きさを数で持たない（段の変数か、共通の決まりに任せる）
    for (const r of all.filter((x) => x.selector.includes('[data-item="assumptions"]') || x.selector.startsWith(".os-"))) {
      const f = fontSize(r.body);
      if (f === undefined || !r.selector.includes('[data-item="assumptions"]')) continue;
      expect(f, r.selector).toMatch(/^var\(--type-/);
    }
    expect(all.filter((r) => r.selector.includes('[data-item="assumptions"]') && /\.(fld-l|fld-c|fld-hint|fld-help|badge|fld-premise|add-btn)\b/.test(r.selector) && fontSize(r.body) !== undefined).map((r) => r.selector)).toEqual([]);
  });

  it("欄の高さの計算は欄の文字の大きさの変数から（.type-scale の中は段4）", () => {
    const body = (sel: string) => all.find((r) => r.selector === sel)?.body ?? "";
    expect(body(".fields > .fld.is-check")).toContain("calc(var(--fld-name-size, 0.86rem) * 1.55 + 3px)");
    expect(body(".fld-c:has(> select:first-child), .fld-c:has(> .seg-g.fld-seg)")).toContain("calc(var(--fld-value-size, 1rem) * 1.55 + 13px)");
    expect(body(".fld-c.fld-check")).toContain("calc(var(--fld-value-size, 1rem) * 1.55 + 13px)");
    expect(body('.fld-check-main > input[type="checkbox"]')).toContain("calc((var(--fld-check-size, 0.92rem) * 1.55 - 20px) / 2)");
    const scale = all.find((r) => r.selector === ".type-scale")?.body ?? "";
    for (const k of ["--fld-name-size", "--fld-value-size", "--fld-check-size"]) expect(scale).toContain(`${k}: var(--type-4)`);
  });

  it("全部の入力項目のパネルと事務所の既定値の画面に .type-scale がある（入力項目ごと・標準と詳細）", () => {
    const wh = fromRequest(structuredClone({ trace: "none", input: modelHousehold("sampleDualAssetsInvest").input }) as never);
    const items: StageId[] = ["family", "work", "retirement", "pension", "living", "education", "housing", "insurance", "savings", "rental", "events", "car", "care", "inheritance", "assumptions"];
    const noop = () => undefined;
    for (const itemId of items)
      for (const level of ["simple", "detail"] as const) {
        const html = renderToString(h(InputPanel, { wh, itemId, level, onLevel: noop, onSave: noop, onClose: noop }));
        expect(/<div[^>]*class="ipanel[^"]*\btype-scale\b[^"]*"[^>]*data-item=/.test(html), `${itemId} ${level}`).toBe(true);
      }
    const office = readFileSync(join(APP, "src", "workspace", "office", "OfficeSettingsPanel.tsx"), "utf8");
    expect(office).toMatch(/class="ipanel os-panel type-scale"/);
  });
});
