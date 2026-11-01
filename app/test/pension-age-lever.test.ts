// 対策の「年金の受け取り開始」のつまみ: もう過ぎた年齢を選べない。もう受け取っている人は動かせない
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { ItemRow } from "../src/workspace/plans/ItemControls.tsx";
import { ageSliderBounds, buildCatalog, type Control } from "../src/workspace/plans/items.ts";
import { leverItems } from "../src/workspace/takeaway/build.ts";
import { modelHousehold } from "./helpers.ts";

const self = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "self")!;
const pensionLever = (id: string) => {
  const wh = fromRequest(modelHousehold(id));
  const cat = buildCatalog(wh, self(wh).id, null);
  const it = cat.byKey.get("lever:pensionAge")!;
  const c = it.control as Control & { kind: "age" };
  expect(c.kind).toBe("age");
  return { wh, cat, it, c };
};
const noop = () => undefined;

describe("年金の受け取り開始のつまみ", () => {
  it("まだ受け取っていない人: 今の年齢では受け取り始めの月が過ぎているので、次の年齢から（63歳・65歳から受け取る予定の世帯は64歳から）", () => {
    const { c } = pensionLever("workingSixties");
    expect(c.min).toBe(64);
    expect(c.max).toBe(75);
    expect(c.ticks.every((t) => t >= 64)).toBe(true);
    expect(c.ticks).toContain(65);
  });

  it("まだ受け取っていない人: 66歳・68歳から受け取る予定の世帯は67歳から（60・65歳の目盛りは出さない）", () => {
    const { c } = pensionLever("sampleSeniorCouple");
    expect(c.min).toBe(67);
    expect(c.ticks).toContain(68);
    expect(c.ticks.every((t) => t >= 67)).toBe(true);
  });

  it("もう受け取っている人（76歳・65歳から受け取り中）: つまみは今の値だけで動かせない。わけを添える", () => {
    const { wh, it: item, c } = pensionLever("pensionCouple");
    expect(c.min).toBe(65);
    expect(c.max).toBe(65);
    expect(c.ticks).toEqual([65]);
    expect(ageSliderBounds(c, 65)).toEqual({ min: 65, max: 65 });
    expect(item.note?.(65) ?? "").toContain("もう受け取り始めています");
    // プランの項目のつまみ: 動かせないので押せない形にする
    const row = renderToString(h(ItemRow, { item, value: 65, base: 65, wh, onSlide: noop, onRelease: noop, onRemove: null }));
    expect(row).toMatch(/type="range"[^>]*disabled/);
  });

  it("もう受け取っている人: 持ち帰りのレポートには動かせないつまみを載せない", () => {
    const { wh, cat } = pensionLever("pensionCouple");
    const ctx = { wh, catalog: cat, valuesOf: () => ({}), letterOf: () => ({ letter: "現状", name: "現状" }) };
    const keys = leverItems(ctx, [wh.request], new Set()).map((l) => l.key);
    expect(keys).not.toContain("pensionAge");
  });
});
