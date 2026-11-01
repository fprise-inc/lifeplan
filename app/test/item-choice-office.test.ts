// 入力項目を選ぶから事務所の既定にする（0091）: 世帯の選び方をそのまま事務所の既定（新しい世帯で出す入力項目と開いたときの入れ方）にする・
// 取り消す・世帯を事務所の既定にそろえる・事務所の既定値の区画の「標準に戻す」
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { blankHousehold, fromRequest } from "../src/workspace/input/household.ts";
import { sameChoice, setItemChoice } from "../src/workspace/input/itemChoice.ts";
import { ItemChooser } from "../src/workspace/input/ItemChooser.tsx";
import { InputView } from "../src/workspace/input/InputView.tsx";
import { inputItems } from "../src/workspace/input/items.ts";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { applyOfficeDefaults, DEFAULT_OFFICE_SETTINGS, readOfficeSettings, withOfficeItems, type OfficeSettings } from "../src/workspace/office/settings.ts";
import { modelHousehold } from "./helpers.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const noop = () => undefined;
const save = async () => undefined;

describe("選び方を比べる・事務所の既定だけを置き換える", () => {
  it("同じ選び方か: 並び・重なり・標準の入れ方・知らない ID は比べる前にそろえる", () => {
    expect(sameChoice(undefined, {})).toBe(true);
    expect(sameChoice({ hidden: ["car", "rental"] }, { hidden: ["rental", "car", "car"] })).toBe(true);
    expect(sameChoice({ levels: { insurance: "simple" } }, {})).toBe(true);
    expect(sameChoice({ hidden: ["car"] }, { hidden: ["car"], levels: { car: "detail" } })).toBe(false);
  });

  it("事務所の既定にする: 入力項目の選び方だけを置き換え、ほかの既定と最後に変えた日は変えない", () => {
    const s: OfficeSettings = { ...DEFAULT_OFFICE_SETTINGS, assumptions: { inflation: "0.02" }, changedOn: "2026-09-01", items: { hidden: ["car"] } };
    const next = withOfficeItems(s, { hidden: ["rental", "nope" as never], levels: { insurance: "detail" } });
    expect(next.items).toEqual({ hidden: ["rental"], levels: { insurance: "detail" } });
    expect(next.assumptions).toEqual({ inflation: "0.02" });
    expect(next.changedOn).toBe("2026-09-01");
    // 保存して読み戻しても同じ（事務所データの形は変えていない）
    expect(readOfficeSettings(JSON.parse(JSON.stringify(next)))).toEqual(next);
    // 新しい世帯はその選び方で始まる
    expect(applyOfficeDefaults(blankHousehold("2026-10", seq()), next).itemChoice).toEqual({ hidden: ["rental"], levels: { insurance: "detail" } });
    // 取り消し（前の既定で置き換える）
    expect(withOfficeItems(next, s.items).items).toEqual({ hidden: ["car"] });
  });
});

describe("入力項目を選ぶの下の、事務所の既定の操作", () => {
  const wh = setItemChoice(fromRequest(modelHousehold("salariedCoupleTwoKids"), {}), { hidden: ["rental", "car"], levels: { insurance: "detail" } });
  const items = inputItems(wh);

  it("事務所の既定と違えば「この選び方を事務所の既定にする」と「事務所の既定にそろえる」を出す", () => {
    const html = renderToString(h(ItemChooser, { wh, items, onChange: noop, initialOpen: true, office: { items: {}, onSave: save } }));
    expect(html).toContain('data-item-choose-office="differ"');
    expect(html).toContain("事務所の既定と違います");
    expect(html).toContain("data-item-choose-to-office");
    expect(html).toContain("この選び方を事務所の既定にする");
    expect(html).toContain("data-item-choose-from-office");
    expect(html).toContain("事務所の既定にそろえる");
  });

  it("同じなら、同じと知らせるだけ（操作を出さない）", () => {
    const html = renderToString(h(ItemChooser, { wh, items, onChange: noop, initialOpen: true, office: { items: { hidden: ["car", "rental"], levels: { insurance: "detail" } }, onSave: save } }));
    expect(html).toContain('data-item-choose-office="same"');
    expect(html).toContain("事務所の既定と同じです");
    expect(html).not.toContain("data-item-choose-to-office");
    expect(html).not.toContain("data-item-choose-from-office");
  });

  it("事務所の既定が無い画面（本体の無い画面の確かめ）では出さない。入力のホームから渡す", () => {
    expect(renderToString(h(ItemChooser, { wh, items, onChange: noop, initialOpen: true }))).not.toContain("data-item-choose-office");
    const home = renderToString(h(InputView, { wh, onSave: noop, level: "simple", chooseOpen: true, officeItems: { items: {}, onSave: save } }));
    expect(home).toContain("data-item-choose-to-office");
  });

  it("事務所の既定値の区画に「標準に戻す」（全部出す・全部標準で開く）", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: { ...DEFAULT_OFFICE_SETTINGS, items: { hidden: ["car"] } }, onSave: save, shared: false, onClose: noop }));
    expect(html).toContain("data-office-items-reset");
    expect(html).toContain("既定に戻す（全部出す・全部「標準」で開く）");
  });
});
