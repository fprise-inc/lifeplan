// 説明の一覧（0016 の 2026-11-01 の追記の2）の id のうち、入力の欄の説明の id を欄の定義から作る（画面と、一覧を作るビルドの段で同じ物を使う）
import type { FieldDef } from "./form.ts";
import { formatYearMonth, formatYen, pctFromRate } from "./units.ts";
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

/**
 * 推定の根拠の文の id（`estimate:<入力項目ID>[/<道>]`。0016 の 2026-11-01 の追記の2）。欄の説明の id と同じ当て先から作る。
 * 公式の文は世帯ごとに違う（統計の版・人数・額が入る）ので、一覧の公式の文は差し込みの印 {basis}（公式の根拠の文）だけで、
 * 事務所の文には {basis} と {value}（推定の値）を差し込める
 */
export function estimateTextId(f: FieldDef, wh: WorkingHousehold): string | null {
  const id = fieldTextId(f, wh);
  return id === null ? null : `estimate:${id.slice("field:".length)}`;
}

/** 推定の根拠の一覧の公式の文（差し込みの印だけ） */
export const ESTIMATE_OFFICIAL = "{basis}";

/** 推定の根拠の文に差し込む、欄の値の短い文字（例: 月28.5万円・1.5%・2030年4月）。値が無ければ空 */
export function estimateValueText(f: FieldDef, wh: WorkingHousehold): string {
  const v = f.get(wh).value;
  if (v === null || v === undefined || v === "") return "";
  if (f.kind === "yen" && typeof v === "number" && Number.isInteger(v)) return `${f.basis === "monthly" ? "月" : f.basis === "annual" ? "年" : ""}${formatYen(v, "man")}万円`;
  if (f.kind === "pct" && typeof v === "string") return `${pctFromRate(v)}%`;
  if (f.kind === "ym" && typeof v === "string") return formatYearMonth(v);
  if ((f.kind === "int" || f.kind === "decimal") && (typeof v === "number" || typeof v === "string")) return `${String(v)}${f.suffix ?? ""}`;
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}
