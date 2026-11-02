// 事務所の推定の値（0111）: 空欄・「わからない」を補う推定の元になるマスタデータの値を、事務所の値に置き換える。事務所データの defaults.estimates
// （足すだけの欄。事務所の既定値の画面で変える。カスタム層のファイルでは扱わない。0016 の 2026-11-02 の追記の3）。
// - 推定の目安（hearing/src/estimates.ts など。入力の画面とヒアリングシートの取り込み）は、写しに重ねた事務所の値で作る（setOfficeEstimates）
// - 計算エンジンが計算のときに引く値（介護・学校の費用の目安・平均余命など）には、計算の要求の estimateValues で同じ値を渡す
//   （app/src/engine/officeValues.ts。画面の速い計算と本体の計算は同じ要求の文字列を使うので、両方で同じ値になる）
// - 世帯には写さない（統計の値と同じく、推定の元の値。推定で世帯に入った値は世帯ごとに直せる。変えると、推定のままの値は入れ直しで新しい値になる）
// - 公式の値が新しくなったとき（写しの rev が進んだとき）は、事務所の値を使い続け、知らせを出す（このまま／公式に戻す）
import { officialMasterValue, setOfficeEstimates, type BracketStep, type MasterValue, type OfficeOverride } from "../../../../hearing/src/statistics.ts";
import { FILL_TARGETS } from "../../../../hearing/src/estimates.ts";
import { setOfficeEstimateValues } from "../../engine/officeValues.ts";
import type { EstimateValue } from "../../engine/types.ts";
import { changeText, estimateEntry, isLegalValue } from "./estimateCatalog.ts";

export type OfficeValue = MasterValue["value"];

/** 事務所の推定の値の1つ */
export interface OfficeEstimateValue {
  /** 事務所の値（公式の値と同じ形。表は段の数と upTo が同じ。変えていない段は公式の値のまま） */
  value: OfficeValue;
  /** 事務所の根拠の文（変えた年月を除く。書かなければ自動の文「事務所の目安」） */
  text?: string;
  /** 変えた日（YYYY-MM-DD）。根拠の文の後ろの年月 */
  changedOn: string;
  /** 変えたとき（か、公式の値が新しくなって「このまま」を選んだとき）の公式の値の版（写しの rev）と値（知らせの「前の値」） */
  officialRev: number;
  officialValue: OfficeValue;
}

export interface OfficeEstimates {
  /** 値ID → 事務所の値 */
  values: Readonly<Record<string, OfficeEstimateValue>>;
  /** 推定で埋めない入力欄（入力項目ID。hearing の FILL_TARGETS） */
  noFill: readonly string[];
}

export const EMPTY_ESTIMATES: OfficeEstimates = { values: {}, noFill: [] };

/** 根拠の文（事務所の文）の長さの上限 */
export const BASIS_TEXT_MAX = 60;
/** 根拠の文を書かなかったときの自動の文 */
export const AUTO_BASIS = "事務所の目安";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DECIMAL = /^-?\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 根拠の文を整える（前後の空白・改行を外す。長すぎる文は切る）。空なら null（自動の文） */
export function cleanBasisText(t: string | null | undefined): string | null {
  const s = (t ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return s === "" ? null : s.slice(0, BASIS_TEXT_MAX);
}

/** 変えた年月の文（「2026年11月」） */
export const monthText = (on: string): string => `${on.slice(0, 4)}年${String(Number(on.slice(5, 7)))}月`;

/** 推定の根拠の文: 事務所の文（無ければ自動の文）の後ろに、変えた年月をいつも付ける。空にはならない */
export const basisOf = (v: Pick<OfficeEstimateValue, "text" | "changedOn">): string => `${cleanBasisText(v.text) ?? AUTO_BASIS}（${monthText(v.changedOn)}）`;

/**
 * 値が公式の値と同じ形か（計算エンジンの決まりと同じ。regulation/reader.ts の sameShape）: 定数は同じ種類（額・月数は0以上の数〔公式が整数なら整数〕、
 * 率は10進の文字）、段階表は段の数と upTo が同じで、額の表は0以上の整数、率の表は10進の文字（公式に値の無い段は入れても入れなくてもよい）
 */
export function sameShape(official: OfficeValue, v: unknown): v is OfficeValue {
  if (typeof official === "number") return typeof v === "number" && Number.isFinite(v) && v >= 0 && (!Number.isInteger(official) || Number.isInteger(v));
  if (typeof official === "string") return typeof v === "string" && DECIMAL.test(v);
  if (!Array.isArray(v) || v.length !== official.length) return false;
  const kind = official.some((s) => s.amount !== undefined) ? "amount" : official.some((s) => s.rate !== undefined) ? "rate" : null;
  if (kind === null) return false;
  return official.every((s, i) => {
    const x = (v as unknown[])[i];
    if (!isObj(x) || x.upTo !== s.upTo || Object.keys(x).some((k) => k !== "upTo" && k !== kind)) return false;
    const val = x[kind];
    if (val === undefined) return true;
    return kind === "amount" ? typeof val === "number" && Number.isInteger(val) && val >= 0 : typeof val === "string" && DECIMAL.test(val);
  });
}

/** 段の並びを、値の無い欄を落とした形にそろえる（保存の前に） */
const tidy = (v: OfficeValue): OfficeValue => (Array.isArray(v) ? (v as readonly BracketStep[]).map((s) => ({ upTo: s.upTo, ...(s.amount !== undefined ? { amount: s.amount } : {}), ...(s.rate !== undefined ? { rate: s.rate } : {}) })) : v);

/**
 * 事務所データの defaults.estimates を読む（読めない値・知らない値ID・法令の値は捨てる。公式の値の形が変わって合わなくなった値も読んで残す〔使わずに知らせる〕）。
 * 推定で埋めない欄は、知っている入力欄だけ
 */
export function readOfficeEstimates(v: unknown): OfficeEstimates {
  if (!isObj(v)) return EMPTY_ESTIMATES;
  const values: Record<string, OfficeEstimateValue> = {};
  if (isObj(v.values))
    for (const [id, x] of Object.entries(v.values)) {
      if (!isObj(x) || isLegalValue(id)) continue;
      const official = officialMasterValue(id);
      if (official === null || typeof x.changedOn !== "string" || !DATE.test(x.changedOn) || !Number.isInteger(x.officialRev)) continue;
      const kindOk = (y: unknown) => (Array.isArray(official.value) ? Array.isArray(y) : typeof y === typeof official.value);
      if (!kindOk(x.value) || !kindOk(x.officialValue)) continue;
      const text = typeof x.text === "string" ? cleanBasisText(x.text) : null;
      values[id] = { value: x.value as OfficeValue, ...(text !== null ? { text } : {}), changedOn: x.changedOn, officialRev: x.officialRev as number, officialValue: x.officialValue as OfficeValue };
    }
  const known = new Set(FILL_TARGETS.map((t) => t.id));
  const noFill = Array.isArray(v.noFill) ? [...new Set(v.noFill.filter((x): x is string => typeof x === "string" && known.has(x)))].sort() : [];
  return { values, noFill };
}

export const isEmptyEstimates = (e: OfficeEstimates | undefined): boolean => e === undefined || (Object.keys(e.values).length === 0 && e.noFill.length === 0);

/** 使える事務所の値か（公式の値と同じ形。公式の表の段の分け方が変わると使えない） */
export const usable = (id: string, v: OfficeEstimateValue): boolean => {
  const o = officialMasterValue(id);
  return o !== null && sameShape(o.value, v.value);
};

/** 計算の要求の estimateValues（使える値だけ） */
export function engineValuesOf(e: OfficeEstimates): Record<string, EstimateValue> {
  return Object.fromEntries(Object.entries(e.values).filter(([id, v]) => usable(id, v)).map(([id, v]) => [id, v.value as EstimateValue]));
}

/** 推定の目安の写しに重ねる値（使える値だけ） */
export function overridesOf(e: OfficeEstimates): Record<string, OfficeOverride> {
  return Object.fromEntries(Object.entries(e.values).filter(([id, v]) => usable(id, v)).map(([id, v]) => [id, { value: v.value, basis: basisOf(v) }]));
}

/** 今の事務所の推定の値を、推定の目安（hearing の写しに重ねる）と計算の要求（engine/officeValues.ts）に入れる */
export function publishOfficeEstimates(e: OfficeEstimates | undefined): void {
  const x = e ?? EMPTY_ESTIMATES;
  setOfficeEstimates(overridesOf(x), x.noFill);
  setOfficeEstimateValues(engineValuesOf(x));
}

// ---- 変える・戻す ----

/** 値を事務所の値にする（今の公式の版と値を覚える。公式と同じ値なら事務所の値を外す） */
export function withOfficeValue(e: OfficeEstimates, id: string, value: OfficeValue, text: string | null, on: string): OfficeEstimates {
  const official = officialMasterValue(id);
  if (official === null || isLegalValue(id) || !sameShape(official.value, value)) return e;
  const { [id]: _old, ...rest } = e.values;
  void _old;
  const v = tidy(value);
  if (JSON.stringify(v) === JSON.stringify(tidy(official.value))) return { ...e, values: rest };
  const t = cleanBasisText(text);
  return { ...e, values: { ...rest, [id]: { value: v, ...(t !== null ? { text: t } : {}), changedOn: on, officialRev: official.rev, officialValue: official.value } } };
}

/** 公式の値に戻す（事務所の値を外す） */
export function withoutOfficeValue(e: OfficeEstimates, id: string): OfficeEstimates {
  if (e.values[id] === undefined) return e;
  const { [id]: _old, ...rest } = e.values;
  void _old;
  return { ...e, values: rest };
}

/** 公式の値が新しくなった値を「このまま」使う（今の公式の版と値を覚え直す。事務所の値・根拠の文・変えた年月は変えない） */
export function keepOfficeValue(e: OfficeEstimates, id: string): OfficeEstimates {
  const v = e.values[id];
  const official = officialMasterValue(id);
  if (v === undefined || official === null) return e;
  return { ...e, values: { ...e.values, [id]: { ...v, officialRev: official.rev, officialValue: official.value } } };
}

/** 推定で埋めない欄を切り替える */
export function withNoFill(e: OfficeEstimates, target: string, on: boolean): OfficeEstimates {
  const set = new Set(e.noFill);
  if (on) set.add(target);
  else set.delete(target);
  return { ...e, noFill: [...set].sort() };
}

// ---- 公式の値が新しくなった知らせ ----

export interface OfficialUpdate {
  id: string;
  /** 画面の名前 */
  name: string;
  /** 「前の公式の値 → 新しい公式の値」の文 */
  change: string;
  /** 公式の表の段の分け方が変わって、事務所の値を使えなくなった（「公式に戻す」か、値を入れ直す） */
  broken: boolean;
  /** 今の公式の値の版 */
  rev: number;
}

/** 公式の値が新しくなった（写しの rev が、変えたとき・「このまま」を選んだときと違う）事務所の値 */
export function officialUpdates(e: OfficeEstimates | undefined): OfficialUpdate[] {
  const out: OfficialUpdate[] = [];
  for (const [id, v] of Object.entries(e?.values ?? {})) {
    const official = officialMasterValue(id);
    const entry = estimateEntry(id);
    if (official === null || entry === undefined) continue;
    const broken = !usable(id, v);
    if (official.rev === v.officialRev && !broken) continue;
    const change = changeText(entry, v.officialValue, official.value) ?? "値は同じです（出典か、確かめの記録が新しくなりました）";
    out.push({ id, name: entry.name, change, broken, rev: official.rev });
  }
  return out;
}
