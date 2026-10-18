// 回答のセルの生の値を、項目の型ごとの値に直す（金額は円の整数。0002）。数は 10進の文字のまま扱い、浮動小数点の誤差を入れない
import type { RawValue } from "./answers.ts";
import { MONTH_LABELS, yearLabel, type SheetDefinition, type SheetItem } from "./definition.ts";

export type Parsed =
  | { readonly ok: true; readonly value: number | string }
  | { readonly ok: false; readonly reason: string };

/** 全角の数字・記号を半角に、桁区切りと空白を除く */
function normalize(text: string): string {
  return text.normalize("NFKC").replace(/[,\s]/g, "").replace(/[−ー―‐]/g, "-");
}

interface Dec {
  readonly neg: boolean;
  readonly int: string;
  readonly frac: string;
}

/** 10進の文字（指数表記も受ける）を符号・整数部・小数部に分ける */
export function parseDecimal(text: string): Dec | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (m === null) return null;
  let int = m[2] ?? "";
  let frac = m[3] ?? "";
  if (int === "" && frac === "") return null;
  const exp = m[4] === undefined ? 0 : Number(m[4]);
  if (Math.abs(exp) > 30) return null;
  if (exp > 0) {
    const f = frac.padEnd(exp, "0");
    int += f.slice(0, exp);
    frac = f.slice(exp);
  } else if (exp < 0) {
    const i = int.padStart(-exp, "0");
    frac = i.slice(i.length + exp) + frac;
    int = i.slice(0, i.length + exp);
  }
  int = int.replace(/^0+(?=\d)/, "");
  return { neg: m[1] === "-", int: int === "" ? "0" : int, frac };
}

/** 10のshift乗を掛けて、四捨五入で整数にする（0002 の円の丸め。端数は表示の単位の小数だけなので、四捨五入でよい） */
export function scaleToInteger(d: Dec, shift: number): number | null {
  const frac = d.frac.padEnd(shift + 1, "0");
  const digits = d.int + frac.slice(0, shift);
  let n = BigInt(digits);
  if (Number(frac[shift]) >= 5) n += 1n;
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const v = Number(n);
  return d.neg && v !== 0 ? -v : v;
}

/** 10進の文字を 10のshift乗で割った 10進の文字（%→率） */
export function shiftDecimal(d: Dec, shift: number): string {
  const int = d.int.padStart(shift + 1, "0");
  const i = int.slice(0, int.length - shift).replace(/^0+(?=\d)/, "");
  const f = (int.slice(int.length - shift) + d.frac).replace(/0+$/, "");
  const s = f === "" ? i : `${i}.${f}`;
  return d.neg && s !== "0" ? `-${s}` : s;
}

/** 10進の文字を正規化（先頭と末尾の余計な0を除く） */
function decText(d: Dec): string {
  const f = d.frac.replace(/0+$/, "");
  const s = f === "" ? d.int : `${d.int}.${f}`;
  return d.neg && s !== "0" ? `-${s}` : s;
}

function rawText(raw: RawValue): string {
  return raw.kind === "bool" ? (raw.value ? "TRUE" : "FALSE") : raw.text;
}

function rangeCheck(item: SheetItem, n: number): string | null {
  if (item.min !== undefined && n < item.min) return `${item.min} 以上で記入してください`;
  if (item.max !== undefined && n > item.max) return `${item.max} 以下で記入してください`;
  return null;
}

/** 年の欄（「1985年（昭和60年）」または 1985） */
export function parseYear(raw: RawValue, def: SheetDefinition): number | null {
  const t = normalize(rawText(raw));
  const m = /^(\d{4})/.exec(t);
  if (m === null) return null;
  const y = Number(m[1]);
  return y >= def.years.from - 100 && y <= def.years.to + 50 ? y : null;
}

/** 月の欄（「4月」または 4） */
export function parseMonth(raw: RawValue): number | null {
  const t = normalize(rawText(raw)).replace(/月$/, "");
  if (!/^\d{1,2}(\.0+)?$/.test(t)) return null;
  const m = Number.parseInt(t, 10);
  return m >= 1 && m <= 12 ? m : null;
}

/**
 * 回答の値を項目の型の値にする。
 * - money: 円の整数（number）
 * - integer: 整数（number）
 * - decimal: 10進の文字（string）
 * - percent: 率の 10進の文字（string。0.625% → "0.00625"）
 * - yearMonth: "YYYY-MM"
 * - choice: 選択肢の value
 * - text: 前後の空白を除いた文字
 */
export function parseValue(def: SheetDefinition, item: SheetItem, raw: RawValue, raw2?: RawValue): Parsed {
  switch (item.type) {
    case "money": {
      let t = normalize(rawText(raw));
      const man = item.unit?.scale === "manYen";
      t = man ? t.replace(/万円?$/, "") : t.replace(/円$/, "");
      const d = parseDecimal(t);
      if (d === null) return { ok: false, reason: "数字で記入してください" };
      const v = scaleToInteger(d, man ? 4 : 0);
      if (v === null) return { ok: false, reason: "大きすぎる値です" };
      const shown = man ? v / 10000 : v;
      const r = rangeCheck(item, shown);
      return r === null ? { ok: true, value: v } : { ok: false, reason: r };
    }
    case "integer": {
      const t = normalize(rawText(raw)).replace(new RegExp(`${item.unitLabel ?? "$^"}$`), "");
      const d = parseDecimal(t);
      if (d === null || d.frac.replace(/0+$/, "") !== "") return { ok: false, reason: "整数で記入してください" };
      const v = scaleToInteger(d, 0);
      if (v === null) return { ok: false, reason: "大きすぎる値です" };
      const r = rangeCheck(item, v);
      return r === null ? { ok: true, value: v } : { ok: false, reason: r };
    }
    case "decimal":
    case "percent": {
      const t = normalize(rawText(raw)).replace(/%$/, "");
      const d = parseDecimal(t);
      if (d === null) return { ok: false, reason: "数字で記入してください" };
      const r = rangeCheck(item, Number(decText(d)));
      if (r !== null) return { ok: false, reason: r };
      return { ok: true, value: item.type === "percent" ? shiftDecimal(d, 2) : decText(d) };
    }
    case "yearMonth": {
      const y = parseYear(raw, def);
      if (y === null) return { ok: false, reason: "年を選んでください" };
      if (raw2 === undefined) return { ok: false, reason: "月を選んでください" };
      const m = parseMonth(raw2);
      if (m === null) return { ok: false, reason: "月を選んでください" };
      return { ok: true, value: `${y}-${String(m).padStart(2, "0")}` };
    }
    case "choice": {
      const t = rawText(raw).normalize("NFKC").trim();
      const choices = item.choices ?? [];
      const hit = choices.find((c) => c.label.normalize("NFKC") === t) ?? choices.find((c) => c.value === t);
      return hit === undefined ? { ok: false, reason: "選択肢から選んでください" } : { ok: true, value: hit.value };
    }
    case "text": {
      const t = rawText(raw).trim();
      if (item.maxLength !== undefined && t.length > item.maxLength) return { ok: true, value: t.slice(0, item.maxLength) };
      return { ok: true, value: t };
    }
  }
}

/** 値をシートのセルの生の値に戻す（書き出し。parseValue の逆） */
export function formatValue(item: SheetItem, value: number | string): { raw: RawValue; raw2?: RawValue } {
  switch (item.type) {
    case "money": {
      const v = value as number;
      if (item.unit?.scale !== "manYen") return { raw: { kind: "number", text: String(v) } };
      const neg = v < 0;
      const a = String(Math.abs(v)).padStart(5, "0");
      const int = a.slice(0, a.length - 4);
      const frac = a.slice(a.length - 4).replace(/0+$/, "");
      return { raw: { kind: "number", text: `${neg ? "-" : ""}${int}${frac === "" ? "" : `.${frac}`}` } };
    }
    case "integer":
      return { raw: { kind: "number", text: String(value) } };
    case "decimal":
      return { raw: { kind: "number", text: String(value) } };
    case "percent": {
      const d = parseDecimal(String(value));
      return { raw: { kind: "number", text: d === null ? String(value) : decText({ ...d, ...shiftUp(d, 2) }) } };
    }
    case "yearMonth": {
      const [y, m] = String(value).split("-").map(Number) as [number, number];
      return { raw: { kind: "text", text: yearLabel(y) }, raw2: { kind: "text", text: MONTH_LABELS[m - 1] as string } };
    }
    case "choice": {
      const c = (item.choices ?? []).find((x) => x.value === value);
      return { raw: { kind: "text", text: c?.label ?? String(value) } };
    }
    case "text":
      return { raw: { kind: "text", text: String(value) } };
  }
}

/** 10のshift乗を掛ける（率→%） */
function shiftUp(d: Dec, shift: number): { int: string; frac: string } {
  const f = d.frac.padEnd(shift, "0");
  const int = (d.int + f.slice(0, shift)).replace(/^0+(?=\d)/, "");
  return { int, frac: f.slice(shift) };
}
