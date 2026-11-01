// 入力項目の選び方（0083）: 世帯ごとに出す入力項目と開いたときの入れ方（標準／詳細）、事務所の既定値の写し方、値が入った項目は隠さない、
// 「当てはまらない」とは別の物であること、最初の5枚の考えをなくしたこと
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { APP_DIR } from "../scripts/lib.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { ALWAYS_SHOWN, isEmptyChoice, readItemChoice, setItemChoice, withLevel, withShown } from "../src/workspace/input/itemChoice.ts";
import { ItemChooser, lockedReason } from "../src/workspace/input/ItemChooser.tsx";
import { InputView } from "../src/workspace/input/InputView.tsx";
import { inputItems, progressOf, shownItems, type InputItem } from "../src/workspace/input/items.ts";
import { STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { applyOfficeDefaults, DEFAULT_OFFICE_SETTINGS, isDefaultSettings, readOfficeSettings, type OfficeSettings } from "../src/workspace/office/settings.ts";
import { bodyObject, fromBody, EMPTY_CARRY, type BodyState } from "../src/workspace/store/body.ts";
import { modelHousehold, preview } from "./helpers.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const blank = () => blankHousehold("2026-10", seq());
const open = (id: string) => fromRequest(modelHousehold(id), {});
const byId = (items: InputItem[], id: string) => items.find((i) => i.id === id) as InputItem;
const noop = () => undefined;
const hide = (wh: WorkingHousehold, ...ids: string[]) => setItemChoice(wh, ids.reduce((c, id) => withShown(c, id as never, false), wh.itemChoice ?? {}));
const state = (wh: WorkingHousehold): BodyState => ({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: {}, balance: {} } as unknown as BodyState["display"], carry: EMPTY_CARRY });

describe("選び方の形", () => {
  it("非表示は標準の順で持ち、家族・前提条件は非表示にできない。入れ方は詳細の項目だけ持つ", () => {
    let c = withShown({}, "rental", false);
    c = withShown(c, "car", false);
    c = withShown(c, "family", false);
    expect(c).toEqual({ hidden: ["rental", "car"] });
    expect(ALWAYS_SHOWN).toEqual(["family", "assumptions"]);
    c = withLevel(c, "rental", "detail");
    expect(c.levels).toEqual({ rental: "detail" });
    expect(withLevel(c, "rental", "simple").levels).toBeUndefined();
    expect(isEmptyChoice(withShown(withLevel(c, "rental", "simple"), "rental", true))).toBe(false);
    expect(isEmptyChoice(withShown(withShown(withLevel(c, "rental", "simple"), "rental", true), "car", true))).toBe(true);
    expect(readItemChoice({ hidden: ["nope", 3, "assumptions", "insurance"], levels: { insurance: "detail", work: "x" } })).toEqual({ hidden: ["insurance"], levels: { insurance: "detail" } });
    expect(readItemChoice("x")).toEqual({});
  });

  it("世帯に置く・外す（何も決めていなければ欄を持たない）", () => {
    const wh = blank();
    const a = setItemChoice(wh, { hidden: ["car"] });
    expect(a.itemChoice).toEqual({ hidden: ["car"] });
    expect("itemChoice" in setItemChoice(a, {})).toBe(false);
  });
});

describe("非表示の入力項目", () => {
  it("値の入っていない項目だけ隠す。値が入っている項目は非表示にしてあっても出す。家族・前提条件はいつも出す", () => {
    const wh = hide(blank(), "insurance", "rental", "car");
    const items = inputItems(wh);
    expect(items).toHaveLength(15);
    expect(items.filter((i) => i.hidden).map((i) => i.id)).toEqual(["insurance", "rental", "car"]);
    expect(shownItems(items)).toHaveLength(12);
    expect(progressOf(shownItems(items)).total).toBe(12);
    // 収益不動産を持つ世帯（値が入っている）は、非表示にしてあっても出す
    const owner = hide(open("dualAssetsTwoKids"), "rental");
    const r = byId(inputItems(owner), "rental");
    expect(r.entered).toBe(true);
    expect(r.hidden).toBe(false);
    expect(lockedReason(r)).toBe("値が入っているので出します");
    expect(lockedReason(byId(inputItems(owner), "family"))).toBe("いつも出します");
  });

  it("非表示は見せ方だけ: 計算の要求・保存した項目の印・値の状態は変えない（「当てはまらない」とは別）", () => {
    const wh = open("salariedCoupleTwoKids");
    const hidden = hide(wh, "car", "care", "inheritance");
    expect(hidden.request).toBe(wh.request);
    expect(hidden.confirmed).toEqual(wh.confirmed);
    expect(preview(hidden.request).table).toEqual(preview(wh.request).table);
    // 当てはまらないは状態（進み具合に数える）、非表示は数えない
    const items = shownItems(inputItems(hidden));
    expect(items.some((i) => i.id === "car")).toBe(false);
    expect(items.every((i) => i.status !== undefined)).toBe(true);
  });

  it("見本の世帯は選び方を持たず、どの項目も出す（結果も変わらない）", () => {
    const wh = open("salariedCoupleTwoKids");
    expect(wh.itemChoice).toBeUndefined();
    expect(shownItems(inputItems(wh))).toHaveLength(15);
  });

  it("確かめの一覧: 非表示の項目の「まだ入れていない」の行は出さない", () => {
    const wh = blank();
    const before = checkList(wh).filter((r) => r.card === "insurance");
    expect(before.some((r) => r.kind === "notStarted")).toBe(true);
    expect(checkList(hide(wh, "insurance")).filter((r) => r.card === "insurance")).toEqual([]);
  });

  it("描画: 非表示の項目のカードを出さず、進み具合は出している項目の数。右上に「入力項目を選ぶ（非表示 ○）」", () => {
    const wh = hide(blank(), "insurance", "car");
    const html = renderToString(h(InputView, { wh, onSave: noop, level: "simple" }));
    expect((html.match(/data-card=/g) ?? []).length).toBe(13);
    expect(html).not.toContain('data-card="insurance"');
    expect(html.replace(/<[^>]*>/g, "")).toContain("13項目中");
    expect(html).toContain("data-item-choose-open");
    expect(html.replace(/<[^>]*>/g, "")).toContain("入力項目を選ぶ（非表示 2）");
    // 入口は1行目の右（進み具合の後）
    expect(html.indexOf("data-item-choose-open")).toBeGreaterThan(html.indexOf("data-progress"));
    expect(html.indexOf("data-item-choose-open")).toBeLessThan(html.indexOf("data-card="));
  });
});

describe("入力項目を選ぶ（小さな一覧）", () => {
  it("ホームと同じ並びで、出すか（チェック）と開いたときの入れ方（標準／詳細）を1行ずつ。値の入った項目は外せない", () => {
    const wh = setItemChoice(open("dualAssetsTwoKids"), { hidden: ["rental", "car"], levels: { rental: "detail" } });
    const items = inputItems(wh);
    const html = renderToString(h(ItemChooser, { wh, items, onChange: noop, initialOpen: true }));
    const order = [...html.matchAll(/data-item-choice="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(items.map((i) => i.id));
    expect(order).toHaveLength(15);
    const tag = (id: string) => html.match(new RegExp(`<input[^>]*data-item-show="${id}"[^>]*>`))?.[0] ?? "";
    expect(tag("family")).toContain("disabled");
    const free = items.find((i) => !i.entered && !ALWAYS_SHOWN.includes(i.id as never)) as InputItem;
    expect(tag(free.id)).not.toContain("disabled");
    // 収益不動産は値が入っているので外せず、非表示にしてあることを添える
    expect(html).toContain('data-item-locked="rental"');
    expect(html).toMatch(/class="on" aria-pressed="true" data-item-level="rental:detail"/);
    expect(html).toMatch(/class="on" aria-pressed="true" data-item-level="work:simple"/);
    for (const w of ["該当なし", "見せ方だけ", "事務所の既定値"]) expect(html).toContain(w);
  });

  it("開いたときの入れ方: 世帯の選び方の詳細で開く（パネルの切り替えはその場だけ）", () => {
    const wh = setItemChoice(open("salariedCoupleTwoKids"), { levels: { insurance: "detail" } });
    const det = renderToString(h(InputView, { wh, onSave: noop, level: "simple", initialOpen: "insurance" }));
    expect(det).toMatch(/aria-pressed="true">\s*詳細/);
    const std = renderToString(h(InputView, { wh, onSave: noop, level: "simple", initialOpen: "work" }));
    expect(std).toMatch(/aria-pressed="true">\s*標準/);
  });

  it("保存して読み戻す（世帯ファイルの household.itemChoice。形式 0.34）", () => {
    const wh = setItemChoice(open("salariedCoupleTwoKids"), { hidden: ["car"], levels: { savings: "detail" } });
    const back = fromBody(JSON.stringify(bodyObject(state(wh))));
    expect(back.wh.itemChoice).toEqual({ hidden: ["car"], levels: { savings: "detail" } });
  });
});

describe("事務所の既定値（新しい世帯で出す入力項目と、開いたときの入れ方）", () => {
  const S: OfficeSettings = { ...DEFAULT_OFFICE_SETTINGS, items: { hidden: ["rental", "car"], levels: { insurance: "detail" } } };

  it("読み書きし、空の世帯を作るときだけ写す（写した後は世帯ごとに直す）", () => {
    expect(readOfficeSettings(JSON.parse(JSON.stringify(S)))).toEqual(S);
    expect(readOfficeSettings({ items: { hidden: ["family", "x"] } }).items).toEqual({});
    expect(isDefaultSettings(S)).toBe(false);
    const wh = applyOfficeDefaults(blank(), S);
    expect(wh.itemChoice).toEqual({ hidden: ["rental", "car"], levels: { insurance: "detail" } });
    expect(wh.itemChoice).not.toBe(S.items);
    expect(applyOfficeDefaults(blank(), DEFAULT_OFFICE_SETTINGS).itemChoice).toBeUndefined();
  });

  it("画面: 既定値のパネルに1つの区画（出すか・標準／詳細）。最初の5枚の印は無い", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: S, onSave: async () => undefined, shared: false, onClose: noop }));
    expect(html).toContain("data-office-items");
    expect(html).toContain("新しい世帯で出す入力項目と、開いたときの入れ方");
    expect((html.match(/data-office-item="/g) ?? []).length).toBe(STAGE_ORDER.length);
    expect(html).toMatch(/data-office-show="rental"/);
    expect(html).toMatch(/class="on" aria-pressed="true" data-office-level="insurance:detail"/);
    expect(html).not.toContain("最初の5");
    expect(html).not.toContain("data-office-first");
    expect(html).toContain("既定の並びに戻す");
    expect(html).toContain("data-office-up=");
  });
});

describe("最初の5枚の考えをなくした", () => {
  it("ホームに案内・印が無く、どの項目も同じ決まりで1行の案内を出す", () => {
    const html = renderToString(h(InputView, { wh: blank(), onSave: noop, level: "simple" }));
    expect(html).not.toContain("最初の5");
    expect(html).not.toContain("data-first");
    const items = inputItems(blank());
    // 前は案内を出さなかった項目（働き方と収入・貯蓄・運用など）も、未入力なら何で計算しているかの1行を出す
    expect(byId(items, "savings").hint).not.toBeNull();
  });

  it("画面の文（app/src）に「最初の5枚」「最初の5項目」が残っていない", () => {
    const files = ["workspace/input/InputView.tsx", "workspace/office/OfficeSettingsPanel.tsx", "workspace/input/items.ts"];
    for (const f of files) {
      const text = readFileSync(join(APP_DIR, "src", f), "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
        .join("\n");
      expect(text, f).not.toMatch(/最初の5(枚|項目)/);
    }
  });
});
