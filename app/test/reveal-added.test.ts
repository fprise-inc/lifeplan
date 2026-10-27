// 入力のホームの5列・「入力項目」の言葉・「＋」で足した物を見せる部品（0077 の追記）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { pickAdded, REVEAL_ITEMS, REVEAL_MS, scrollDelta } from "../src/presentation/revealAdded.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { InputView } from "../src/workspace/input/InputView.tsx";
import { STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { APP_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const CSS = readFileSync(join(APP_DIR, "src", "styles", "app.css"), "utf8");
const src = (p: string) => readFileSync(join(APP_DIR, "src", p), "utf8");
const noop = () => undefined;

/** DOM の要素の代わり（pickAdded が読む性質だけ） */
class Node0 {
  children: Node0[] = [];
  parent: Node0 | null = null;
  readonly name: string;
  readonly hasField: boolean;
  constructor(name: string, hasField = false) {
    this.name = name;
    this.hasField = hasField;
  }
  add(...c: Node0[]): this {
    for (const x of c) {
      x.parent = this;
      this.children.push(x);
    }
    return this;
  }
  get isConnected(): boolean {
    return true;
  }
  contains(o: Node0 | null): boolean {
    for (let p = o; p !== null; p = p.parent) if (p === this) return true;
    return false;
  }
  querySelector(): unknown {
    const any = (n: Node0): boolean => n.hasField || n.children.some(any);
    return any(this) ? {} : null;
  }
  /** 文書の順の番号（根から深さ優先） */
  order(): number[] {
    return this.parent === null ? [] : [...this.parent.order(), this.parent.children.indexOf(this)];
  }
  compareDocumentPosition(o: Node0): number {
    const a = this.order();
    const b = o.order();
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return (a[i] as number) < (b[i] as number) ? 4 : 2;
    return a.length < b.length ? 4 : 2;
  }
  get previousElementSibling(): Node0 | null {
    return this.parent?.children[this.parent.children.indexOf(this) - 1] ?? null;
  }
  get nextElementSibling(): Node0 | null {
    return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null;
  }
}
const asEl = (xs: Node0[]) => xs as unknown as Element[];

describe("「＋」で足した物を選ぶ（pickAdded）", () => {
  it("新しい要素のうちいちばん外側を、押したボタンのすぐ前から選ぶ。同じ親の下で続けて足された物もいっしょに", () => {
    const root = new Node0("root");
    const old = new Node0("old", true);
    const headG = new Node0("new-head", true);
    const bodyG = new Node0("new-body", true);
    const inner = new Node0("inner", true);
    headG.add(inner);
    const btn = new Node0("btn");
    const far = new Node0("far-new", true);
    root.add(old, headG, bodyG, btn, far);
    const got = pickAdded(asEl([headG, inner, bodyG, far]), btn as unknown as Element);
    expect((got as unknown as Node0[]).map((x) => x.name)).toEqual(["new-head", "new-body"]);
  });

  it("押したボタンの後に足されたとき（並びの先頭に入るなど）は、すぐ後の物。欄のある物を先に選ぶ", () => {
    const root = new Node0("root");
    const btn = new Node0("btn");
    const note = new Node0("note-without-field");
    const row = new Node0("row", true);
    root.add(btn, note, new Node0("old", true), row);
    expect((pickAdded(asEl([note, row]), btn as unknown as Element) as unknown as Node0[]).map((x) => x.name)).toEqual(["row"]);
  });

  it("押したボタンが消えたとき（足すと消える「＋」）は、文書の順で最初の物。新しい物が無ければ何もしない", () => {
    const root = new Node0("root");
    const a = new Node0("a", true);
    const b = new Node0("b", true);
    root.add(new Node0("old"), a, new Node0("old2"), b);
    expect((pickAdded(asEl([a, b]), null) as unknown as Node0[]).map((x) => x.name)).toEqual(["a"]);
    expect(pickAdded([], null)).toEqual([]);
  });
});

describe("見える所に入れるスクロール（scrollDelta）", () => {
  it("見えているときは動かさない（画面が跳ねない）", () => {
    expect(scrollDelta(100, 300, 0, 800)).toBe(0);
  });
  it("下にはみ出すときは下の端に、上にはみ出すときは頭に（余白12px）", () => {
    expect(scrollDelta(700, 900, 0, 800)).toBe(112);
    expect(scrollDelta(-200, 100, 0, 800)).toBe(-212);
  });
  it("見える所より背が高い物は頭（最初の欄）をそろえる", () => {
    expect(scrollDelta(600, 1700, 0, 800)).toBe(588);
  });
});

describe("「＋」で足す所すべてに入れる", () => {
  it("入力のパネルの「＋」（欄の区画・まとまりの操作、貯蓄・運用の口座と積立の期間）・動かす項目・事務所の料金の段階・区分・資産と負債の時点", () => {
    expect(src("workspace/input/FieldViews.tsx")).toMatch(/a\.danger !== true && a\.label\.startsWith\("＋"\)\) revealAdded\(e\.currentTarget\)/);
    const sv = src("workspace/input/savings/SavingsPanel.tsx");
    expect(sv.match(/revealAdded\(e\.currentTarget\)/g)?.length).toBe(3);
    expect(sv).toContain("data-reveal-item");
    expect(src("workspace/plans/ItemControls.tsx")).toContain("revealAdded(e.currentTarget);\n                  onPick(it.key);");
    expect(src("workspace/office/OfficeSettingsPanel.tsx")).toContain("revealAdded(e.currentTarget);\n                setFee(");
    expect(src("workspace/store/HouseholdPanel.tsx")).toContain("revealAdded(e.currentTarget);\n            setRows(");
    expect(src("presentation/BalanceTab.tsx")).toContain("revealAdded(e.currentTarget);\n                add();");
    expect(REVEAL_ITEMS).toBe(".in-section, .in-group, tr, li, [data-reveal-item]");
  });

  it("探す範囲は入力のパネルの中（data-reveal-root）", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"), {});
    const html = renderToString(h(InputPanel, { wh, itemId: "family", level: "detail", onLevel: noop, onSave: noop, onClose: noop }));
    expect(html).toContain('<div class="ip-body" data-reveal-root="true">');
  });

  it("光らせるのは影と背景の色だけ（大きさを変えない）で1.6秒でフェード。動きを減らす設定では光らせるだけ", () => {
    expect(REVEAL_MS).toBe(1600);
    expect(CSS).toContain(".just-added { animation: just-added 1.6s ease-out; }");
    expect(CSS).toMatch(/@keyframes just-added \{ 0%, 35% \{ box-shadow: [^}]*background-color: [^}]*\} 100% \{ box-shadow: [^}]*rgba\(240, 180, 0, 0\)/);
    expect(CSS).toContain(".just-added.still { box-shadow: 0 0 0 4px rgba(240, 180, 0, 0.55); background-color: rgba(255, 236, 170, 0.6); }");
    expect(CSS).toContain("@media (prefers-reduced-motion: reduce) { .just-added, tr.just-added > td, tr.just-added > th { animation: none; } }");
  });
});

/** 「カード」のまま残してよい言葉（お金のカード・明細のカード） */
const CARD_WORDS = /クレジットカード|カードローン|カード番号|カード会社|カード／口座|ご主人のカード|Aカード|カード・銀行の明細|カードに多い|口座・カード|カードの引き落とし|同じカード/g;
/** 画面に出る文（文字と、読み上げ・補足・入力例の属性） */
function visible(html: string): string {
  const attrs = [...html.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g)].map((m) => m[1]).join("\n");
  return `${html.replace(/<[^>]*>/g, "\n")}\n${attrs}`;
}

describe("画面では「カード」と言わず「入力項目」（中の1つずつは「欄」）", () => {
  const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"), {});
  it("入力のホーム・確かめの一覧に「カード」が無い。最初の5項目・14項目中", () => {
    const home = renderToString(h(InputView, { wh, onSave: noop, level: "simple" }));
    const check = renderToString(h(InputView, { wh, onSave: noop, level: "simple", initialOpen: "check" }));
    for (const html of [home, check]) expect(visible(html).replace(CARD_WORDS, "")).not.toContain("カード");
    expect(home).toContain("最初の5項目");
    expect(home).toContain("14項目中");
    expect(home).not.toContain("最初の5枚");
    expect(check).toMatch(/<label>\s*入力項目\s*<select/);
  });

  it.each(STAGE_ORDER.map((s) => s.id))("%s のパネル（詳細）に「カード」が無い", (id) => {
    const html = renderToString(h(InputPanel, { wh, itemId: id, level: "detail", onLevel: noop, onSave: noop, onClose: noop }));
    expect(visible(html).replace(CARD_WORDS, "")).not.toContain("カード");
  });
});
