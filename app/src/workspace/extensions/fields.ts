// 宣言型の入力欄（拡張の束の fields/<名前>.json・extFields@1.0。0114 の4）を画面の側で扱う部品（作業の層）。
// - 欄の文字の読み方（万円・年月・選ぶ・印）は、ここが宣言から決まった形で行う。束の関数は値を受け取るだけ
// - 値は世帯ファイルの拡張領域 ext["<key>"] に、宣言の path のとおりの対で置く（空欄は欄を持たない。何も無ければキーごと持たない）
// - 読むときは宣言に合わない値（種類・範囲・選択肢の外・宣言に無い場所）を捨てる
// - 定義は extDefinitions["<key>"] に写す（0011 の4。束の無いアプリでも名前つきで見せられ、捨てない）
import type { ExtFieldDecl, ExtFieldsDecl, ExtValue } from "../../../../report/src/index.ts";
import type { BsCustomField, BsCustomViewModel } from "../../presentation/model.ts";

/** 額の上限（1兆円） */
export const EXT_YEN_MAX = 1_000_000_000_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 円 → 欄の文字（万円。端数は小数第2位まで） */
export function yenToManText(v: number | undefined | null): string {
  if (v === undefined || v === null) return "";
  return String(Number((v / 10000).toFixed(2)));
}

/** 欄の文字（万円）→ 円。空は null、読めない・範囲の外は undefined */
export function manTextToYen(text: string, negative = false): number | null | undefined {
  const t = text
    .trim()
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，、]/g, "")
    .replace(/万円?$/, "")
    .replace(/^[▲△−ー－]/, "-");
  if (t === "") return null;
  if (!/^-?\d{1,9}(\.\d{1,4})?$/.test(t)) return undefined;
  const v = Math.round(Number(t) * 10000);
  if (!negative && v < 0) return undefined;
  return Math.abs(v) <= EXT_YEN_MAX ? v : undefined;
}

/** 欄の文字（年月）→ YYYY-MM。空は null、読めない値は undefined */
export function monthText(text: string): string | null | undefined {
  const t = text.trim().replace(/[/年.]/g, "-").replace(/月$/, "");
  if (t === "") return null;
  const m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (m === null || Number(m[2]) < 1 || Number(m[2]) > 12) return undefined;
  return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;
}

function getAt(v: ExtValue, path: readonly string[]): unknown {
  let cur: unknown = v;
  for (const p of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setAt(v: ExtValue, path: readonly string[], x: unknown): void {
  let cur: Record<string, unknown> = v;
  for (const p of path.slice(0, -1)) {
    if (!isObj(cur[p])) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[path[path.length - 1] as string] = x;
}

function deleteAt(v: ExtValue, path: readonly string[]): void {
  const parents: Record<string, unknown>[] = [v];
  let cur: Record<string, unknown> = v;
  for (const p of path.slice(0, -1)) {
    if (!isObj(cur[p])) return;
    cur = cur[p] as Record<string, unknown>;
    parents.push(cur);
  }
  delete cur[path[path.length - 1] as string];
  // 空になった入れ子の対は持たない
  for (let i = parents.length - 1; i > 0; i--) {
    if (Object.keys(parents[i] as object).length === 0) delete (parents[i - 1] as Record<string, unknown>)[path[i - 1] as string];
  }
}

/** 欄1つの値が宣言に合うか（空でない値だけを持つ） */
function valid(f: ExtFieldDecl, x: unknown): boolean {
  switch (f.type) {
    case "yen":
      return typeof x === "number" && Number.isInteger(x) && Math.abs(x) <= EXT_YEN_MAX && (f.negative === true || x >= 0);
    case "month":
      return typeof x === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
    case "choice":
      return typeof x === "string" && (f.options ?? []).some((o) => o.value === x);
    case "check":
      return x === true;
  }
}

/** 世帯ファイルの値を宣言で読む（合わない所は捨てる。何も無ければ null） */
export function readExtValue(decl: ExtFieldsDecl, raw: unknown): ExtValue | null {
  if (!isObj(raw)) return null;
  const out: ExtValue = {};
  for (const f of decl.fields) {
    const x = getAt(raw, f.path);
    if (valid(f, x)) setAt(out, f.path, x);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 欄の今の文字（画面に出す） */
export function fieldText(f: ExtFieldDecl, v: ExtValue | null): string {
  const x = v === null ? undefined : getAt(v, f.path);
  if (!valid(f, x)) return "";
  switch (f.type) {
    case "yen":
      return yenToManText(x as number);
    case "check":
      return "1";
    default:
      return x as string;
  }
}

/**
 * 欄を1つ変えた値（読めない文字は undefined＝変えない。全部空になれば null＝キーごと持たない）。宣言に無い欄の id も undefined
 */
export function withFieldText(decl: ExtFieldsDecl, value: ExtValue | null, id: string, text: string): ExtValue | null | undefined {
  const f = decl.fields.find((x) => x.id === id);
  if (f === undefined) return undefined;
  let x: unknown;
  switch (f.type) {
    case "yen":
      x = manTextToYen(text, f.negative === true);
      break;
    case "month":
      x = monthText(text);
      break;
    case "choice":
      x = (f.options ?? []).some((o) => o.value === text) ? text : null;
      break;
    case "check":
      x = text === "1" ? true : null;
      break;
  }
  if (x === undefined) return undefined;
  const next: ExtValue = structuredClone(value ?? {});
  if (x === null) deleteAt(next, f.path);
  else setAt(next, f.path, x);
  return readExtValue(decl, next);
}

/** 欄1つの見せ方（hints は束の関数が返した差し込みの文） */
export function fieldModel(f: ExtFieldDecl, v: ExtValue | null, hint?: { placeholder?: string; help?: string }): BsCustomField {
  const help = hint?.help ?? f.help;
  const placeholder = hint?.placeholder ?? f.placeholder;
  return {
    id: f.id,
    label: f.label,
    kind: f.type,
    value: fieldText(f, v),
    ...(f.type === "yen" ? { unit: "万円" } : {}),
    ...(f.type === "yen" && f.negative === true ? { negative: true } : {}),
    ...(f.type === "choice" ? { options: [{ value: "", label: "選ばない" }, ...(f.options ?? [])] } : {}),
    ...(help !== undefined ? { help } : {}),
    ...(placeholder !== undefined ? { placeholder } : {}),
  };
}

/** 入力欄のまとまり（宣言の form の並び） */
export function formModel(decl: ExtFieldsDecl, v: ExtValue | null, o: { open: boolean; hints?: Record<string, { placeholder?: string; help?: string }> }): NonNullable<BsCustomViewModel["form"]> {
  const byId = new Map(decl.fields.map((f) => [f.id, f]));
  return {
    title: decl.form.title,
    note: decl.form.note,
    open: o.open,
    groups: decl.form.groups.map((g) => ({
      title: g.title,
      ...(g.note !== undefined ? { note: g.note } : {}),
      fields: g.fields.flatMap((id) => {
        const f = byId.get(id);
        return f === undefined ? [] : [fieldModel(f, v, o.hints?.[id])];
      }),
    })),
  };
}

/** extDefinitions に写す定義（0011 の4） */
export function definitionOf(decl: ExtFieldsDecl, bundleId: string): Record<string, unknown> {
  return {
    type: "object",
    label: decl.label,
    ...(decl.description !== undefined ? { description: decl.description } : {}),
    version: decl.version,
    attachTo: decl.attachTo,
    by: bundleId,
    fields: decl.fields.map((f) => ({ id: f.id, path: f.path, type: f.type, label: f.label })),
  };
}
