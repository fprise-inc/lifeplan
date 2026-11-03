// 0003 の7・0113 の8: 互換モード（移行元の数え方に寄せた照合用の計算）を読む、エンジンの中のただ1か所。
// 計算部品は互換モードを見ない（ctx.conventions から外す。部品のフォルダでは lint の financia/no-compatibility が止める）。
// 項目は閉じた一覧（足すだけ）。形と値の検査は engine.input.json（既定の値は書かない）で、ここでは計算の中身を作った項目かを確かめる。
// 表示の項目（tableAge・tableBalance）は計算を変えないので受け付け、計算の項目（ageTiming・firstYear・growthStart）は
// 計算の中身を作るまで E_ARGUMENT で断る（0113 の実装の段取りの5 で、照合の差の大きいものから作る）。
// source（取り込みの記録と規則）は計算に使わず、見出しの calcConventions のまま根拠の記録に写る
import { EngineError } from "../errors.ts";
import type { CalcConventions, CompatibilityItems, ComponentConventions } from "./types.ts";

/** 互換モードの項目が、表示だけか計算を変えるか（0113 の8 の表） */
export const COMPATIBILITY_ITEMS: Readonly<Record<keyof CompatibilityItems, "display" | "calc">> = Object.freeze({
  tableAge: "display",
  tableBalance: "display",
  ageTiming: "calc",
  firstYear: "calc",
  growthStart: "calc",
});

/** 計算の中身を作った計算の項目（まだ無い。作ったら足す） */
const BUILT: ReadonlySet<string> = new Set<string>();

/** 互換モードを確かめ、部品に見せる計算方式の設定（互換モードを除いた写し）を返す */
export function componentConventions(c: CalcConventions): ComponentConventions {
  const compat = c.compatibility;
  if (compat !== null) {
    for (const name of Object.keys(compat.items) as (keyof CompatibilityItems)[]) {
      const kind = COMPATIBILITY_ITEMS[name];
      if (kind === "calc" && !BUILT.has(name)) throw new EngineError("E_ARGUMENT", ["calcConventions.compatibility.items", name]);
    }
  }
  return Object.freeze({ aggregation: c.aggregation, investmentTiming: c.investmentTiming });
}
