// 0006 の5: 入出力の検査。検査器はビルドの時にスキーマから作ったもの（実行環境ではコードを作らない）
import { EngineError, type ErrorCode } from "../errors.ts";
import { byKey } from "../generated/validators.js";

export interface ValidateFn {
  (data: unknown): boolean;
  errors?: readonly { instancePath: string; keyword: string }[] | null;
}

const VALIDATORS = byKey as Readonly<Record<string, ValidateFn>>;

export function hasSchema(key: string): boolean {
  return VALIDATORS[key] !== undefined;
}

/** 形が合わなければエラー。エラーには場所（欄の名前）と検査の種類だけを入れ、値は入れない */
export function check(key: string, data: unknown, code: ErrorCode, ids: readonly string[] = []): void {
  const v = VALIDATORS[key];
  if (v === undefined) throw new EngineError("E_ARGUMENT", ["schema", key]);
  if (!v(data)) {
    const e = v.errors?.[0];
    throw new EngineError(code, [...ids, `${e?.instancePath === "" ? "/" : (e?.instancePath ?? "/")}:${e?.keyword ?? "?"}`]);
  }
}

// 0005 の追記（2026-10-10 の速さの見直し）: エンジン全体の出力の検査のうち、お金の動き（flows。1件の計算で2万件ほど）・年ごとの行（annual）・
// 表（table）の検査を速くする。1件の形（common.json の $defs/flow・$defs/annualRow と、engine.output.json の表の行）を、生成した検査器と
// 同じ判定で手早く確かめ（下の flowOk・annualOk・cellOk）、すべて合えば、その3つを空にした写しを生成した検査器で確かめる。
// どちらかが合わなければ、元の出力を生成した検査器で確かめ直す（誤りの形は前と同じ）。flowOk などが真なら、その1件はスキーマに合う
// （「合う」側だけを速くする。偽でも元の検査器に任せる）。形のスキーマが変わったら、ここも合わせて直す（単体テストがスキーマとここの前提を比べる）
const DOTTED = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/u;
const ROW_PREFIX = /^cf\./u;
const YEAR_MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** 確かめて合った文字列（正規表現は g・y の印を持たないので、同じ文字列なら同じ結果） */
const ROWS = new Set<string>();
const DOTTEDS = new Set<string>();
const YEAR_MONTHS = new Set<string>();
const UUIDS = new Set<string>();
const MEMO_LIMIT = 50000;

function matches(seen: Set<string>, s: string, re: RegExp, re2?: RegExp): boolean {
  if (seen.has(s)) return true;
  if (!re.test(s) || (re2 !== undefined && !re2.test(s))) return false;
  if (seen.size < MEMO_LIMIT) seen.add(s);
  return true;
}

/** スキーマの欄（どれも additionalProperties: false）。flow の必須は row・ym・amount・accrualYear・formula、annualRow は row・year・amount・formula、表の行は row・year・amount */
export const FLOW_KEYS: readonly string[] = Object.freeze(["row", "ym", "amount", "accrualYear", "member", "object", "formula"]);
export const ANNUAL_KEYS: readonly string[] = Object.freeze(["row", "year", "amount", "member", "object", "formula"]);
export const CELL_KEYS: readonly string[] = Object.freeze(["row", "year", "amount", "member", "object"]);
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const OBJECT_PROTO = Object.prototype;
const protoOf = Object.getPrototypeOf;
const keysOf = Object.keys;

/** 整数で 1900〜2200（スキーマの year） */
const isYearValue = (x: unknown): boolean => typeof x === "number" && x % 1 === 0 && x >= 1900 && x <= 2200;

/**
 * 欄の確かめ（生成した検査器は for…in で知らない欄を探す）は、内蔵の実行環境では for…in が重いので、「ふつうの物（prototype が
 * Object.prototype）で、自分の欄の数が、値のある欄（必須の欄と、あれば member・object）の数と同じ」で行う
 * （Object.prototype に数え上げられる欄が無いことは checkOutput が確かめる。欄の値が undefined の物は偽にして元の検査器に任せる）。
 * 必須の欄の数 required、member・object（uuid）を確かめ、row（rowId）・amount（yen。整数で ±(2^53−1) の内。NaN・Infinity は % 1 が NaN になって外れる）を確かめる
 */
function commonOk(o: Record<string, unknown>, required: number): boolean {
  const member = o.member;
  const object = o.object;
  if (keysOf(o).length !== required + (member === undefined ? 0 : 1) + (object === undefined ? 0 : 1)) return false;
  // 確かめた文字列の表を先に引く（関数を重ねない）
  const row = o.row;
  if (typeof row !== "string" || !(ROWS.has(row) || matches(ROWS, row, DOTTED, ROW_PREFIX))) return false;
  const amount = o.amount;
  if (typeof amount !== "number" || amount % 1 !== 0 || amount > MAX_SAFE || amount < -MAX_SAFE) return false;
  if (member !== undefined && (typeof member !== "string" || !(UUIDS.has(member) || matches(UUIDS, member, UUID)))) return false;
  if (object !== undefined && (typeof object !== "string" || !(UUIDS.has(object) || matches(UUIDS, object, UUID)))) return false;
  return true;
}

const plainObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && protoOf(x) === OBJECT_PROTO;
const formulaOk = (x: unknown): boolean => typeof x === "string" && (DOTTEDS.has(x) || matches(DOTTEDS, x, DOTTED));

/** お金の動き1件がスキーマ（$defs/flow）に合うか。真なら合う（偽のときは元の検査器で確かめる） */
export function flowOk(f: unknown): boolean {
  if (f === null || typeof f !== "object" || protoOf(f) !== OBJECT_PROTO) return false;
  const o = f as Record<string, unknown>;
  if (!commonOk(o, 5)) return false;
  const ym = o.ym;
  if (typeof ym !== "string" || !(YEAR_MONTHS.has(ym) || matches(YEAR_MONTHS, ym, YEAR_MONTH))) return false;
  const y = o.accrualYear;
  if (typeof y !== "number" || y % 1 !== 0 || y < 1900 || y > 2200) return false;
  const formula = o.formula;
  return typeof formula === "string" && (DOTTEDS.has(formula) || matches(DOTTEDS, formula, DOTTED));
}

/** 年ごとの行1件がスキーマ（$defs/annualRow）に合うか */
export function annualOk(a: unknown): boolean {
  return plainObject(a) && commonOk(a, 4) && isYearValue(a.year) && formulaOk(a.formula);
}

/** 表の行1件がスキーマ（engine.output の result の table の items）に合うか */
export function cellOk(c: unknown): boolean {
  return plainObject(c) && commonOk(c, 3) && isYearValue(c.year);
}

const EMPTY: readonly unknown[] = Object.freeze([]);

/** Object.prototype（と、その先）に数え上げられる欄が無いか（あれば for…in がそれも見るので、速い確かめを使わない） */
function protoClean(): boolean {
  for (const k in OBJECT_PROTO) if (k !== undefined) return false;
  return true;
}

function allOk(list: unknown, ok: (x: unknown) => boolean): boolean {
  if (!Array.isArray(list)) return false;
  for (let i = 0; i < list.length; i++) if (!ok(list[i])) return false;
  return true;
}

/**
 * エンジン全体の出力（engine.output）を確かめる。check("engine.output", output, code) と同じ結果・同じ誤り
 * （お金の動き・年ごとの行・表がすべて合えば、その3つを空にした写しを確かめる。合わなければ元の出力を確かめ直す）
 */
export function checkOutput(output: unknown, code: ErrorCode): void {
  const v = VALIDATORS["engine.output"];
  if (v !== undefined && output !== null && typeof output === "object" && !Array.isArray(output) && protoClean()) {
    const o = output as { flows?: unknown; annual?: unknown; table?: unknown };
    if (allOk(o.flows, flowOk) && allOk(o.annual, annualOk) && allOk(o.table, cellOk) && v({ ...output, flows: EMPTY, annual: EMPTY, table: EMPTY })) return;
  }
  check("engine.output", output, code);
}
