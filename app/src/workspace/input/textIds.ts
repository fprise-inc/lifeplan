// 説明の一覧（0016 の 2026-11-01 の追記の2）の id のうち、入力の欄の説明の id を欄の定義から作る（画面と、一覧を作るビルドの段で同じ物を使う）
import type { FieldDef } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { fieldAddress } from "./valueState.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 欄の説明の id（`field:<入力項目ID>[/<道>]`。道は当て先の at で、並びの要素の ID は `*`）。物の ID・欄のキーは入れない（世帯ごとに変わるため）。
 * 当て先の無い欄（呼び名など画面の側だけの欄。一覧の `field:ui.…`）は、まだ一覧に載せていないので null
 */
export function fieldTextId(f: FieldDef, wh: WorkingHousehold): string | null {
  const a = fieldAddress(f, wh);
  if (a === null) return null;
  const path = a.at.map((s) => (UUID.test(s) ? "*" : s));
  return `field:${a.item}${path.length > 0 ? `/${path.join("/")}` : ""}`;
}
