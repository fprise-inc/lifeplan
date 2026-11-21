// 上の帯の FP のメニュー（0077 の追記）: 中身の並び・見出しの名前と見た目・事務所の設定の文・ホームから外した行・新しい世帯のときだけの「取り込む」・開いた中身の出し方
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { FpMenu, fpMenuGroups, officeShareText, storageText } from "../src/workspace/header/FpMenu.tsx";
import { blankHousehold, fromRequest } from "../src/workspace/input/household.ts";
import { InputView } from "../src/workspace/input/InputView.tsx";
import { inputItems, nothingEnteredYet } from "../src/workspace/input/items.ts";
import { SnapshotTools } from "../src/workspace/snapshots/SnapshotTools.tsx";
import { FpTools } from "../src/workspace/tools/FpTools.tsx";
import { APP_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const sample = () => fromRequest(modelHousehold("salariedCoupleTwoKids"));
const noop = () => undefined;

describe("FP のメニューの中身", () => {
  it("控え・面談の準備・情報を集める・事務所の設定の順。本体につながっていないときは情報を集めると事務所の設定を出さない", () => {
    const full = fpMenuGroups({ snapshots: 2, review: { last: "2026年10月", next: "2027年10月" }, imports: { ai: true }, office: { storage: "このPCの中", share: "オフ（既定）" } });
    expect(full.map((g) => g.id)).toEqual(["snapshots", "tools", "imports", "office", "feedback"]);
    // 見出しは「面談の準備」（前の名前は「FPの道具」。識別子の tools はそのまま）
    expect(full.map((g) => g.label)).toEqual(["控え", "面談の準備", "情報を集める", "事務所の設定", "ファイナンシアへ"]);
    expect(full[0]!.items.map((i) => i.label)).toEqual(["この時点を残す", "控えの一覧（2件）"]);
    expect(full[1]!.items.map((i) => i.action)).toEqual(["contents", "year", "review"]);
    // 前の名前は「見直し」（何を見直すのか分からないため改めた。識別子の review はそのまま。0074 の追記）
    expect(full[1]!.items.map((i) => i.label)).toEqual(["世帯の中身の一覧", "次の1年に起きること", "前回から変わったこと"]);
    expect(full[1]!.items[2]!.note).toContain("2027年10月");
    expect(full[2]!.items.map((i) => i.action)).toEqual(["hearing", "ai"]);
    // ヒアリングは聞く（URL）と取り込むの入口。Web のヒアリングの届いた知らせを右に添える（0192）。Excel のシートは画面から外した（2026-11-18）
    expect(full[2]!.items[0]!.label).toBe("事前ヒアリング（URL生成・取り込み）");
    expect(full[2]!.items[0]!.note).toBeUndefined();
    expect(fpMenuGroups({ snapshots: 0, review: null, imports: { ai: true, hearing: "回答が届いています 1件" }, office: null })[2]!.items[0]!.note).toBe("回答が届いています 1件");
    expect(full[3]!.items.map((i) => [i.action, i.note])).toEqual([
      ["storage", "このPCの中"],
      ["office", "オフ（既定）"],
      ["officeDefaults", "新しい世帯に写す値・ホームの並び"],
    ]);
    const bare = fpMenuGroups({ snapshots: 0, review: null, imports: null, office: null });
    expect(bare.map((g) => g.id)).toEqual(["snapshots", "tools", "feedback"]);
    expect(bare[1]!.items[2]!.note).toBeUndefined();
    // 保存していない世帯は AI に資料を渡せない
    expect(fpMenuGroups({ snapshots: 0, review: null, imports: { ai: false }, office: null })[2]!.items.map((i) => i.action)).toEqual(["hearing"]);
  });

  it("見出しの名前: 記録・控え・面談の準備・情報を集める・事務所の設定（世帯を開いていないときは「記録」を出さない）", () => {
    const all = fpMenuGroups({ notes: { memo: 0, meetings: 0, last: null }, snapshots: 0, review: null, imports: { ai: true }, office: { storage: "このPCの中", share: "オフ（既定）" } });
    expect(all.map((g) => [g.id, g.label])).toEqual([
      ["notes", "記録"],
      ["snapshots", "控え"],
      ["tools", "面談の準備"],
      ["imports", "情報を集める"],
      ["office", "事務所の設定"],
      ["feedback", "ファイナンシアへ"],
    ]);
    // 見出しを変えても、中の項目の文はそのまま
    expect(all[0]!.items.map((i) => i.label)).toEqual(["メモ", "面談の履歴（0件）"]);
    // 世帯を開いていないとき（notes を省く）・本体と接続していないとき（imports・office が null）
    const none = fpMenuGroups({ snapshots: 0, review: null, imports: null, office: null });
    expect(none.map((g) => g.label)).toEqual(["控え", "面談の準備", "ファイナンシアへ"]);
    // 前の名前は残さない
    const text = JSON.stringify(all);
    for (const old of ["メモ・面談の履歴", "事前ヒアリング・取り込む", "取り込む）"]) expect(text).not.toContain(old);
  });

  it("Excel のシートを出すとき（切り替えを戻したとき）の項目の文", async () => {
    vi.resetModules();
    vi.doMock("../src/workspace/hearing/excelSwitch.ts", () => ({ HEARING_EXCEL_SHOWN: true }));
    try {
      const m = await import("../src/workspace/header/FpMenu.tsx");
      const g = m.fpMenuGroups({ snapshots: 0, review: null, imports: { ai: false }, office: null });
      expect(g[2]!.label).toBe("情報を集める");
      expect(g[2]!.items[0]!.label).toBe("事前ヒアリング（Excel・URL生成・取り込み）");
    } finally {
      vi.doUnmock("../src/workspace/hearing/excelSwitch.ts");
      vi.resetModules();
    }
  });

  it("見た目: 見出しは小さめの灰色で太字にしない。項目は見出しより右に下げる。まとまりの間に区切りの線", () => {
    const css = readFileSync(join(APP_DIR, "src", "styles", "header.css"), "utf8");
    const rule = (sel: string) => new RegExp(`^${sel.replace(/[.+]/g, "\\$&")} \\{([^}]*)\\}`, "m").exec(css)?.[1] ?? "";
    const left = (padding: string) => {
      const v = padding.trim().split(/\s+/).map((x) => Number.parseFloat(x));
      return v.length === 4 ? v[3]! : v.length >= 2 ? v[1]! : v[0]!;
    };
    const head = rule(".fpm-h");
    const item = rule(".fpm-item");
    expect(head).toContain("font-weight: 400");
    expect(head).toContain("color: var(--base-ink)");
    expect(Number.parseFloat(/font-size: ([\d.]+)rem/.exec(head)![1]!)).toBeLessThan(Number.parseFloat(/font-size: ([\d.]+)rem/.exec(item)![1]!));
    expect(left(/padding: ([^;]+);/.exec(item)![1]!)).toBeGreaterThan(left(/padding: ([^;]+);/.exec(head)![1]!));
    expect(rule(".fpm-group + .fpm-group")).toContain("border-top: 1px solid");
    // 項目の文字の太さは前のまま
    expect(rule(".fpm-label")).toContain("font-weight: 700");
  });

  it("今どこから開いているかの文（世帯の選択のメニューと同じ）", () => {
    expect(storageText(undefined, false)).toBe("このPCの中");
    expect(storageText("off", false)).toBe("このPCの中");
    expect(storageText("member", true)).toBe("同期フォルダ（2台のPC）");
    expect(storageText("member", false)).toBe("事務所の共有フォルダ");
    expect(officeShareText("member", false)).toBe("オン");
    expect(officeShareText("pending", false)).toBe("承認待ち");
    expect(officeShareText("member", true)).toBe("オフ（同期フォルダで1人で使っています）");
  });

  it("描画: 線のアイコン1つ（名前は「FP のメニュー」）。開くと帯の下に重ねて出す一覧", () => {
    const groups = fpMenuGroups({ snapshots: 0, review: null, imports: { ai: false }, office: { storage: "このPCの中", share: "オフ（既定）" } });
    const shut = renderToString(h(FpMenu, { groups, onPick: noop }));
    expect(shut).toMatch(/class="fpm-btn"[^>]*aria-label="FP のメニュー"/);
    expect(shut).toContain("<svg");
    expect(shut).not.toContain("data-fp-menu-list");
    const open = renderToString(h(FpMenu, { groups, onPick: noop, initialOpen: true }));
    expect(open).toContain("data-fp-menu-list");
    for (const a of ["snapTake", "snapList", "contents", "year", "review", "hearing", "storage", "office", "officeDefaults"]) expect(open).toContain(`data-fp-menu-item="${a}"`);
  });
});

describe("入力のホームの上部", () => {
  it("控え・面談の準備・取り込むの行を出さない（入力の入った世帯）", () => {
    const html = renderToString(h(InputView, { wh: sample(), onSave: noop, level: "simple", imports: h("span", { "data-hearing": true }, "x") }));
    expect(html).not.toContain("data-imports-open");
    expect(html).not.toContain("data-imports-list");
    expect(html).not.toContain("data-hearing");
    expect(html).not.toContain("data-fp-tools");
    expect(html).not.toContain("snap-tools");
  });

  it("項目がまだ何も入っていない新しい世帯のときだけ、ホームにも「取り込む」を出す", () => {
    const blank = blankHousehold("2026-10");
    expect(nothingEnteredYet(blank, inputItems(blank))).toBe(true);
    expect(nothingEnteredYet(sample(), inputItems(sample()))).toBe(false);
    expect(nothingEnteredYet({ ...blank, confirmed: ["living"] }, inputItems(blank))).toBe(false);
    const html = renderToString(h(InputView, { wh: blank, onSave: noop, level: "simple", imports: h("span", { "data-hearing": true }, "x") }));
    expect(html).toContain("data-imports-open");
  });

  it("メニューから開いた取り込みは、ホームの上部に「閉じる」つきで出す", () => {
    const html = renderToString(h(InputView, { wh: sample(), onSave: noop, level: "simple", importsOpen: true, onImportsOpen: noop, imports: h("span", { "data-hearing": true }, "x") }));
    expect(html).toContain("data-imports-list");
    expect(html).toContain("data-imports-close");
    expect(html).toContain("data-hearing");
  });

  it("控え・面談の準備は、ボタンの並びを描かずに、親が開いた中身だけを出せる", () => {
    const snap = renderToString(h(SnapshotTools, { list: [], stored: false, onTake: async () => undefined, onRemove: noop, bar: false, mode: "list", onMode: noop }));
    expect(snap).not.toContain("data-snapshot-take");
    expect(snap).toContain("data-snapshot-panel");
    expect(renderToString(h(SnapshotTools, { list: [], stored: false, onTake: async () => undefined, onRemove: noop, bar: false, mode: null, onMode: noop }))).toBe("");
    const tools = renderToString(h(FpTools, { wh: sample(), result: null, onOpen: noop, bar: false, tool: "contents", onTool: noop }));
    expect(tools).not.toContain("data-fp-tools");
    expect(tools).toContain("閉じる");
    const review = renderToString(h(FpTools, { wh: sample(), result: null, onOpen: noop, bar: false, tool: "review", onTool: noop }));
    expect(review).toContain("<h2>前回から変わったこと</h2>");
  });

  it("開いた中身の置き場は、どのパネルにも同じ余白を持つ（何も開いていなければ空）", () => {
    const wh = sample();
    const base = { wh, onSave: noop, level: "simple" as const, imports: h("p", null, "取り込みの中身") };
    const closed = renderToString(h(InputView, { ...base, tools: null, importsOpen: false, onImportsOpen: noop }));
    expect(closed).toContain('<div class="ih-opened" data-home-opened="true"></div>');
    const opened = renderToString(h(InputView, { ...base, tools: h(FpTools, { wh, result: null, onOpen: noop, bar: false, tool: "year", onTool: noop }), importsOpen: true, onImportsOpen: noop }));
    const box = opened.slice(opened.indexOf('class="ih-opened"'));
    expect(box.indexOf("data-fp-year")).toBeGreaterThan(0);
    expect(box.indexOf("data-imports-list")).toBeGreaterThan(box.indexOf("data-fp-year"));
  });
});
