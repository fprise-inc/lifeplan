// 「?」は Tab で止まらない・欄にフォーカスがあるときの F1 で説明を開く（0077 の 2026-11-07 の追記）
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { Help, HELP_CLOSED, HELP_TAB_INDEX, helpButtonsFor, helpNext, isHelpKey, typesText } from "../src/presentation/Help.tsx";

/** 試しの要素（helpButtonsFor が使う所だけ: 親・中の「?」・持ち主の囲み・含むか） */
class El {
  parentElement: El | null = null;
  children: El[] = [];
  readonly name: string;
  readonly attrs: Record<string, string>;
  constructor(name: string, attrs: Record<string, string> = {}) {
    this.name = name;
    this.attrs = attrs;
  }
  add(...cs: El[]): this {
    for (const c of cs) {
      c.parentElement = this;
      this.children.push(c);
    }
    return this;
  }
  private all(): El[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  private is(sel: string): boolean {
    return sel.split(",").some((s) => {
      const m = /^\[([\w-]+)\]$/.exec(s.trim());
      return m !== null && m[1]! in this.attrs;
    });
  }
  querySelectorAll(sel: string): El[] {
    return this.all().filter((e) => e.is(sel));
  }
  closest(sel: string): El | null {
    if (this.is(sel)) return this;
    return this.parentElement?.closest(sel) ?? null;
  }
  contains(o: El): boolean {
    return o === this || this.all().includes(o);
  }
}
const q = (name: string) => new El(name, { "data-help-btn": "" });
const forEl = (e: El) => helpButtonsFor(e as unknown as Element).map((b) => (b as unknown as El).name);

describe("「?」は Tab の順に入れない", () => {
  it("「?」のボタンも、印で開く形も tabindex=-1（欄から欄へ Tab で進むときに止まらない）", () => {
    expect(HELP_TAB_INDEX).toBe(-1);
    expect(renderToString(h(Help, { label: "年収" }, "説明"))).toMatch(/<button[^>]*tabindex="-1"[^>]*data-help-btn/);
    expect(renderToString(h(Help, { label: "推定の根拠", mark: "推定" }, "根拠"))).toMatch(/<button[^>]*tabindex="-1"[^>]*data-help-btn/);
  });
});

describe("説明を開くキー", () => {
  const k = (key: string, mod: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, ...mod });
  it("F1 はどこでも。「?」は文字を打つ欄の外だけ。修飾キーと一緒なら開かない", () => {
    expect(isHelpKey(k("F1"), true)).toBe(true);
    expect(isHelpKey(k("F1"), false)).toBe(true);
    expect(isHelpKey(k("?"), false)).toBe(true);
    expect(isHelpKey(k("?"), true)).toBe(false);
    expect(isHelpKey(k("F1", { metaKey: true }), false)).toBe(false);
    expect(isHelpKey(k("a"), false)).toBe(false);
  });
  it("文字を打つ欄: 文字・数の入力と textarea。選ぶ欄・チェック・ボタンは違う", () => {
    const el = (tagName: string, type?: string) => ({ tagName, getAttribute: (n: string) => (n === "type" ? (type ?? null) : null) });
    expect(typesText(el("INPUT"))).toBe(true);
    expect(typesText(el("INPUT", "number"))).toBe(true);
    expect(typesText(el("TEXTAREA"))).toBe(true);
    expect(typesText(el("INPUT", "checkbox"))).toBe(false);
    expect(typesText(el("SELECT"))).toBe(false);
    expect(typesText(el("BUTTON"))).toBe(false);
  });
  it("キーで開くと開いたまま（Esc・外を押すと閉じる）", () => {
    const s = helpNext(HELP_CLOSED, "key");
    expect(s.pinned).toBe(true);
    expect(helpNext(s, "escape")).toEqual(HELP_CLOSED);
  });
});

describe("フォーカスのある物の説明の「?」", () => {
  // 区画 > 見出しの「?」・欄A（名前の「?」・状態の印・入力）・欄B（説明なし）・ボタンと「?」のまとまり・説明の無いボタン
  const headQ = q("見出し");
  const aQ = q("欄Aの説明");
  const aMark = q("欄Aの推定");
  const aIn = new El("欄Aの入力");
  const bIn = new El("欄Bの入力");
  const btn = new El("＋ボタン");
  const btnQ = q("＋ボタンの説明");
  const plain = new El("外す");
  new El("区画").add(
    new El("見出しの行").add(headQ),
    new El("欄A", { "data-field": "a" }).add(new El("名前").add(aQ, aMark), new El("中").add(aIn)),
    new El("欄B", { "data-field": "b" }).add(new El("名前"), new El("中").add(bIn)),
    new El("まとまり", { "data-help-of": "" }).add(btn, btnQ),
    plain,
  );
  it("欄なら、その欄の名前の「?」・状態の印の順（ほかの欄・ボタンの「?」は選ばない）", () => {
    expect(forEl(aIn)).toEqual(["欄Aの説明", "欄Aの推定"]);
  });
  it("説明の無い欄・ボタンなら、囲みの見出しの「?」（ほかの欄・ボタンの「?」は選ばない）", () => {
    expect(forEl(bIn)).toEqual(["見出し"]);
    expect(forEl(plain)).toEqual(["見出し"]);
  });
  it("ボタンなら、ボタンと1つのまとまりの「?」", () => {
    expect(forEl(btn)).toEqual(["＋ボタンの説明"]);
  });
});
