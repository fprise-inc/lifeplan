// 上の帯の FP のメニュー（0077 の追記）: 中身の並び・事務所の設定の文・ホームから外した行・新しい世帯のときだけの「取り込む」・開いた中身の出し方
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { FpMenu, fpMenuGroups, officeShareText, storageText } from "../src/workspace/header/FpMenu.tsx";
import { blankHousehold, fromRequest } from "../src/workspace/input/household.ts";
import { InputView } from "../src/workspace/input/InputView.tsx";
import { inputItems, nothingEnteredYet } from "../src/workspace/input/items.ts";
import { SnapshotTools } from "../src/workspace/snapshots/SnapshotTools.tsx";
import { FpTools } from "../src/workspace/tools/FpTools.tsx";
import { modelHousehold } from "./helpers.ts";

const sample = () => fromRequest(modelHousehold("salariedCoupleTwoKids"));
const noop = () => undefined;

describe("FP のメニューの中身", () => {
  it("控え・FP の道具・取り込む・事務所の設定の順。本体につながっていないときは取り込むと事務所の設定を出さない", () => {
    const full = fpMenuGroups({ snapshots: 2, review: { last: "2026年10月", next: "2027年10月" }, imports: { ai: true }, office: { storage: "このPCの中", share: "オフ（既定）" } });
    expect(full.map((g) => g.id)).toEqual(["snapshots", "tools", "imports", "office"]);
    expect(full[0]!.items.map((i) => i.label)).toEqual(["この時点を残す", "控えの一覧（2件）"]);
    expect(full[1]!.items.map((i) => i.action)).toEqual(["contents", "year", "review"]);
    expect(full[1]!.items[2]!.note).toContain("2027年10月");
    expect(full[2]!.items.map((i) => i.action)).toEqual(["hearing", "ai"]);
    expect(full[3]!.items.map((i) => [i.action, i.note])).toEqual([
      ["storage", "このPCの中"],
      ["office", "オフ（既定）"],
      ["officeDefaults", "新しい世帯に写す値・ホームの並び"],
    ]);
    const bare = fpMenuGroups({ snapshots: 0, review: null, imports: null, office: null });
    expect(bare.map((g) => g.id)).toEqual(["snapshots", "tools"]);
    expect(bare[1]!.items[2]!.note).toBeUndefined();
    // 保存していない世帯は AI に資料を渡せない
    expect(fpMenuGroups({ snapshots: 0, review: null, imports: { ai: false }, office: null })[2]!.items.map((i) => i.action)).toEqual(["hearing"]);
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
  it("控え・FP の道具・取り込むの行を出さない（入力の入った世帯）", () => {
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

  it("控え・FP の道具は、ボタンの並びを描かずに、親が開いた中身だけを出せる", () => {
    const snap = renderToString(h(SnapshotTools, { list: [], stored: false, onTake: async () => undefined, onRemove: noop, bar: false, mode: "list", onMode: noop }));
    expect(snap).not.toContain("data-snapshot-take");
    expect(snap).toContain("data-snapshot-panel");
    expect(renderToString(h(SnapshotTools, { list: [], stored: false, onTake: async () => undefined, onRemove: noop, bar: false, mode: null, onMode: noop }))).toBe("");
    const tools = renderToString(h(FpTools, { wh: sample(), result: null, onOpen: noop, bar: false, tool: "contents", onTool: noop }));
    expect(tools).not.toContain("data-fp-tools");
    expect(tools).toContain("閉じる");
  });
});
