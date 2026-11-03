// 0003 の7・0113 の8: 互換モード（calcConventions.compatibility）の形と検査。計算の中身はまだ作らない（形と検査だけ）。
// - 形: null か {source: {import, rule}, items}。items は既定と違う項目だけ（1つ以上）、項目と値は閉じた一覧
// - 表示の項目（tableAge・tableBalance）は受け付け、計算の結果は null と同じ。計算の項目は E_ARGUMENT（作っていない）
// - 計算部品は互換モードを見ない（ctx.conventions に無い）
import { describe, expect, it } from "vitest";
import { componentConventions, COMPATIBILITY_ITEMS } from "../src/engine/compatibility.ts";
import { runEngine } from "../src/engine/run.ts";
import type { CalcConventions, EngineRequest } from "../src/engine/types.ts";
import { clone, modelHousehold, realPacks } from "./helpers.ts";

const SOURCE = { import: "00000000-0000-4000-8000-0000000000a1", rule: "official.genericReport@1" };

function withCompat(m: string, compatibility: unknown): EngineRequest {
  const r = clone(modelHousehold(m)) as unknown as { input: { calcConventions: Record<string, unknown> } };
  r.input.calcConventions.compatibility = compatibility;
  return r as unknown as EngineRequest;
}

const run = (r: EngineRequest) => runEngine({ ...r, trace: "none" }, realPacks());

describe("互換モード（0113 の8）", () => {
  it("項目の一覧は 0113 の8 の表のとおり（表示だけの2つと計算の3つ）", () => {
    expect(COMPATIBILITY_ITEMS).toEqual({ tableAge: "display", tableBalance: "display", ageTiming: "calc", firstYear: "calc", growthStart: "calc" });
  });

  it("表示の項目だけの互換モードは受け付け、計算の結果は null と同じ（source は見出しに写る）", () => {
    for (const m of ["single25", "housingPurchase", "dualAssetsTwoKids"]) {
      const plain = run(withCompat(m, null));
      const compat = { source: SOURCE, items: { tableAge: "yearStart", tableBalance: "yearStart" } };
      const r = run(withCompat(m, compat));
      expect(r.table).toEqual(plain.table);
      expect(r.annual).toEqual(plain.annual);
      expect(r.flows).toEqual(plain.flows);
      expect((r.header as unknown as { calcConventions: CalcConventions }).calcConventions.compatibility).toEqual(compat);
    }
  });

  it.each([["ageTiming", "yearOfReach"], ["ageTiming", "yearAfterReach"], ["firstYear", "wholeYear"], ["growthStart", "baseYear"]])(
    "計算の項目 %s=%s は計算の中身を作るまで E_ARGUMENT",
    (name, value) => {
      expect(() => run(withCompat("single25", { source: SOURCE, items: { tableAge: "yearStart", [name]: value } }))).toThrow(`E_ARGUMENT: calcConventions.compatibility.items, ${name}`);
    },
  );

  it.each([
    ["既定の値を書く", { source: SOURCE, items: { tableAge: "yearEnd" } }],
    ["既定の値を書く（計算の項目）", { source: SOURCE, items: { ageTiming: "month" } }],
    ["項目が無い", { source: SOURCE, items: {} }],
    ["知らない項目", { source: SOURCE, items: { roundReturn: "floor" } }],
    ["知らない値", { source: SOURCE, items: { tableAge: "midYear" } }],
    ["source が無い", { items: { tableAge: "yearStart" } }],
    ["規則の改訂が無い", { source: { import: SOURCE.import, rule: "official.genericReport" }, items: { tableAge: "yearStart" } }],
    ["規則の ID の形が違う", { source: { import: SOURCE.import, rule: "Official.generic@1" }, items: { tableAge: "yearStart" } }],
    ["取り込みの記録が空", { source: { import: "", rule: SOURCE.rule }, items: { tableAge: "yearStart" } }],
    ["取り込みの記録が ID の形でない", { source: { import: "（氏名）様の帳票", rule: SOURCE.rule }, items: { tableAge: "yearStart" } }],
    ["source に知らない欄", { source: { ...SOURCE, product: "x" }, items: { tableAge: "yearStart" } }],
    ["知らない欄", { source: SOURCE, items: { tableAge: "yearStart" }, note: "x" }],
    ["文字", "yearStart"],
  ])("形の合わない互換モードは E_INPUT_SCHEMA（%s）", (_name, compat) => {
    expect(() => run(withCompat("single25", compat))).toThrow("E_INPUT_SCHEMA");
  });

  it("部品に見せる計算方式の設定は互換モードを持たない", () => {
    const c: CalcConventions = { aggregation: "cash", investmentTiming: "midYear", compatibility: { source: SOURCE, items: { tableAge: "yearStart" } } };
    const seen = componentConventions(c);
    expect(seen).toEqual({ aggregation: "cash", investmentTiming: "midYear" });
    expect("compatibility" in seen).toBe(false);
    expect(Object.isFrozen(seen)).toBe(true);
  });
});
