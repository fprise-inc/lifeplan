// 欄の値の状態（0035 の3・0041）: どの欄も同じ決まりで「推定・わからない・該当なし・確定・未入力（0円で計算中）」を読み、
// 4つの操作（この値にする・推定に戻す・わからない・該当なし）で変える。呼ぶ側は、状態が値の箱にあるか、値の状態の欄（valueStates）・
// 仮の印（assumed）にあるかを分けない（ここだけが分ける）。
// - 確定は明示の操作だけ: 欄に入って離れる・Tab で通る・同じ文字を書き戻す、では何も変えない（form.ts の field）。推定の値をそのまま
//   使うときは「この値にする」。推定の根拠を残した確定（値の箱・行の estimate）にして、記録の無い確定（打った値・古い世帯の値）と見分ける
// - 未入力は状態を持たない: 値が無い（か「未入力（0円で計算）」の印の0円）のを、画面が決まりで判定する
// - プランを選んでいるときは、同じ操作をそのプランの差分にする（planStateOp。0036 の8）
import type { Catalog } from "../plans/items.ts";
import { applyPlan, setPlanValue } from "../plans/plans.ts";
import { boxAt, writeAt, type DiffBox } from "../plans/diffs.ts";
import { readAt, resolveAssumedKey, resolveKey, type Address } from "../store/readings.ts";
import type { FieldDef, Val } from "./form.ts";
import { mutate, type WorkingHousehold } from "./household.ts";
import { putRow, rowAt, type StateRow } from "./rows.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isBox = (v: unknown): v is Obj & { state: string; origin: Obj } => isObj(v) && typeof v.state === "string" && isObj(v.origin);

export type ValueStatus = "estimated" | "unknown" | "notApplicable" | "confirmed" | "missing";

export interface FieldStatus {
  status: ValueStatus;
  /** 推定・わからない（代わりの値）・明示の確定の根拠 */
  basis: string | null;
  /** FP が「この値にする」で確定した（推定の根拠を残した確定） */
  explicit: boolean;
  /** 外から来た値を承認した記録がある（ヒアリング・取り込み・AI） */
  approved: boolean;
}

export type StateOp = "confirm" | "revert" | "unknown" | "notApplicable";

export const OP_LABELS: Readonly<Record<StateOp, string>> = {
  confirm: "この値にする",
  revert: "推定に戻す",
  unknown: "わからない",
  notApplicable: "該当なし",
};

/**
 * 欄の横（数の欄は欄の中）に出す、推定の値をそのまま欄に入れるボタン（値の状態の操作の確定と同じ。0041 の追記）。
 * 推定の値は欄に灰色で見えているので、「入れる」の1押しで確定にする
 */
export const FILL_LABEL = "この値にする";

/** 入れるボタンの説明（ボタンの title と読み上げの名前に使う） */
export const fillTitle = (s: ValueStatus): string => (s === "unknown" ? "代わりの値をこの欄にそのまま入れます（確定になります）" : "推定の値をこの欄にそのまま入れます（確定になります）");

export const STATUS_LABELS: Readonly<Record<ValueStatus, string>> = {
  estimated: "推定",
  unknown: "わからない",
  notApplicable: "該当なし",
  confirmed: "確定",
  missing: "未入力（0円で計算中）",
};

/** 「まだ額を入れていない」印の0円の推定（年金の見込額・退職金・統計の無い年収など）の根拠の文は「未入力」で始まる */
export const isUnenteredBasis = (basis: string | null | undefined): boolean => typeof basis === "string" && basis.startsWith("未入力");

const input = (wh: WorkingHousehold): Obj => wh.request.input as unknown as Obj;

/** 欄の当て先（0036 の2）。欄の定義が持たなければ、0.16 の欄のキーから読み替え表で引く（欄の定義が当て先を持つまでの橋渡し） */
export function fieldAddress(f: FieldDef, wh: WorkingHousehold): Address | null {
  if (f.address !== undefined) return f.address(wh);
  const r = resolveKey(`field:${f.key}`, input(wh));
  return r !== null && r.kind === "address" ? r.address : null;
}

/** 仮の印の推定の出し方（読み替え表の assumed: の行の method。無ければ標準の値） */
const assumedMethod = (f: FieldDef, wh: WorkingHousehold): string => {
  const r = resolveAssumedKey(f.key, input(wh));
  return r !== null && r.kind === "address" ? (r.method ?? "standard") : "standard";
};

const basisOf = (b: Obj | undefined): string | null => (isObj(b?.estimate) && typeof b.estimate.basis === "string" ? b.estimate.basis : null);

/** 欄の値の状態 */
export function fieldStatus(f: FieldDef, wh: WorkingHousehold): FieldStatus {
  const st = f.get(wh);
  const plainStatus = (s: ValueStatus, basis: string | null = null, explicit = false, approved = false): FieldStatus => ({ status: s, basis, explicit, approved });
  if (f.boxed !== undefined) {
    const b = f.boxed.read(wh);
    if (isBox(b)) {
      const basis = basisOf(b);
      if (b.state === "estimated") return isUnenteredBasis(basis) ? plainStatus("missing", basis) : plainStatus("estimated", basis ?? "推定");
      if (b.state === "unknown") return plainStatus("unknown", basisOf(isObj(b.substitute) ? b.substitute : undefined));
      if (b.state === "notApplicable") return plainStatus("notApplicable");
      return plainStatus("confirmed", basis, basis !== null, b.approval !== undefined);
    }
  } else {
    const assumed = wh.assumed[f.key];
    if (assumed !== undefined) return plainStatus("estimated", assumed === "" ? "仮の値" : assumed);
    const a = fieldAddress(f, wh);
    const row = a === null ? undefined : rowAt(input(wh), a);
    if (row !== undefined) {
      const basis = row.estimate?.basis ?? null;
      if (row.state === "estimated") return isUnenteredBasis(basis) ? plainStatus("missing", basis) : plainStatus("estimated", basis ?? "推定");
      if (row.state === "unknown") return plainStatus("unknown", basis);
      if (row.state === "notApplicable") return plainStatus("notApplicable");
      return plainStatus("confirmed", basis, basis !== null, row.approval !== undefined);
    }
  }
  if (st.estimated != null) return isUnenteredBasis(st.estimated) ? plainStatus("missing", st.estimated) : plainStatus("estimated", st.estimated);
  if (st.assumed != null) return plainStatus("estimated", st.assumed);
  if (st.value === null && f.kind === "yen" && f.optional !== true && f.readOnly === undefined) return plainStatus("missing");
  return plainStatus("confirmed");
}

/** 状態を変えられる数の欄か（選択・オンオフ・名前・年月の欄は「わからない」「該当なし」を持たない） */
const NUMERIC = new Set(["yen", "int", "pct", "decimal"]);

/** 欄で使える操作（その状態で意味のあるものだけ） */
export function availableOps(f: FieldDef, wh: WorkingHousehold, s: FieldStatus = fieldStatus(f, wh)): StateOp[] {
  if (f.readOnly !== undefined) return [];
  const out: StateOp[] = [];
  const a = fieldAddress(f, wh);
  const stateful = f.boxed !== undefined || a !== null;
  if ((s.status === "estimated" && confirmable(f, wh, a)) || (s.status === "unknown" && f.get(wh).value !== null)) out.push("confirm");
  if (f.blankIsEstimate === true && s.status !== "estimated") out.push("revert");
  if (stateful && NUMERIC.has(f.kind) && s.status !== "unknown" && (f.get(wh).value !== null || f.blankIsEstimate === true)) out.push("unknown");
  if (stateful && f.kind === "yen" && f.optional === true && s.status !== "notApplicable") out.push("notApplicable");
  return out;
}

/**
 * 推定の欄を「この値にする」にできるか（applyStateOp の confirm が世帯を変えるか）: 値の箱の欄、仮の印の欄、当て先に値がある欄、
 * 空欄のまま推定で計算する欄で推定の値を書ける欄（blankEstimate）。どれでもない欄（積立をやめる年齢の空欄など、推定が値でなく決まりのもの）は確定にできない
 */
function confirmable(f: FieldDef, wh: WorkingHousehold, a: Address | null): boolean {
  if (f.blankEstimate !== undefined && f.get(wh).value === null) return f.blankEstimate(wh) !== null;
  if (f.boxed !== undefined || wh.assumed[f.key] !== undefined) return true;
  if (a === null) return false;
  // 見せている値が世帯に無い欄（省略のときの既定・ほかの値と同じ値を見せる欄。0070）は、見せている値を書いて確定にできる
  return readAt(input(wh), a) !== undefined || (f.write !== undefined && f.get(wh).value !== null);
}

/** わからないにしたときの代わりの値の根拠（前に入っていた確定の値をそのまま使う） */
const PREVIOUS_VALUE = "前に入っていた値を代わりに使う";

const confirmedBox = (value: unknown, estimate: { method: string; basis: string } | null): Obj => ({ value, state: "confirmed", origin: { kind: "manual" }, ...(estimate !== null ? { estimate } : {}) });
const estimateOf = (b: Obj | undefined): { method: string; basis: string } | null =>
  isObj(b?.estimate) && typeof b.estimate.method === "string" && typeof b.estimate.basis === "string" ? { method: b.estimate.method, basis: b.estimate.basis } : null;

/** 仮の印を外した世帯（状態の置き場所は1か所。行を書くときは仮の印を残さない） */
const withoutAssumed = (wh: WorkingHousehold, key: string): WorkingHousehold => (wh.assumed[key] === undefined ? wh : { ...wh, assumed: Object.fromEntries(Object.entries(wh.assumed).filter(([k]) => k !== key)) });

/** 当て先の行を書いた世帯 */
const withRow = (wh: WorkingHousehold, a: Address, row: StateRow | undefined): WorkingHousehold => mutate(wh, (_h, req) => void putRow(req.input as unknown as Obj, a, row));

/** 推定を入れ直した値（空欄にしたときの推定）。欄が推定を持たなければ null */
function estimateFor(f: FieldDef, wh: WorkingHousehold): { value: Val; basis: string; method: string } | null {
  if (f.blankIsEstimate !== true || f.write === undefined) return null;
  const w = f.write(wh, null);
  const s = fieldStatus(f, w);
  const v = f.get(w).value;
  if (s.status !== "estimated" || v === null) return null;
  const b = f.boxed !== undefined ? f.boxed.read(w) : undefined;
  return { value: v, basis: s.basis ?? "推定", method: estimateOf(isObj(b) ? b : undefined)?.method ?? (f.boxed !== undefined ? "statistic" : assumedMethod(f, wh)) };
}

/**
 * 値の状態の操作（0035 の3・0041）。現状の世帯を直す。使えない操作（availableOps に無い）なら同じ世帯を返す
 * - confirm: 推定（わからないなら代わりの値）を、その値のまま確定にする。根拠は estimate に残す
 * - revert: 空欄にしたときの推定に戻す（行・わからない・該当なしを外す）
 * - unknown: わからない。今の値（無ければ推定）を代わりの値にする
 * - notApplicable: 該当なし（値を省く。値の箱は該当なしの箱）
 */
export function applyStateOp(wh: WorkingHousehold, f: FieldDef, op: StateOp): WorkingHousehold {
  const s = fieldStatus(f, wh);
  if (!availableOps(f, wh, s).includes(op)) return wh;
  const a = fieldAddress(f, wh);
  // 空欄のままエンジンが推定で決める欄: 推定の値を書いて確定にする（当て先があれば根拠を行に残す。0041 の追記）
  if (op === "confirm" && s.status === "estimated" && f.blankEstimate !== undefined && f.get(wh).value === null) {
    const v = f.blankEstimate(wh);
    if (v === null) return wh;
    const next = (f.write ?? f.set)(withoutAssumed(wh, f.key), v);
    if (next === wh || f.get(next).value === null) return wh;
    const at = fieldAddress(f, next);
    return at !== null && readAt(input(next), at) !== undefined ? withRow(next, at, { state: "confirmed", origin: { kind: "manual" }, estimate: { method: "standard", basis: s.basis ?? "推定" } }) : next;
  }
  if (f.boxed !== undefined) {
    const raw = f.boxed.read(wh);
    const b = isBox(raw) ? raw : undefined;
    switch (op) {
      case "confirm": {
        const src = b?.state === "unknown" && isObj(b.substitute) ? b.substitute : b;
        return f.boxed.write(wh, confirmedBox(src?.value, estimateOf(src) ?? { method: "standard", basis: s.basis ?? "推定" }));
      }
      case "revert":
        return f.write !== undefined ? f.write(f.boxed.write(wh, undefined), null) : wh;
      case "unknown": {
        const est = b?.state === "estimated" && !isUnenteredBasis(basisOf(b)) ? { value: b.value, ...(estimateOf(b) ?? { method: "standard", basis: "推定" }) } : null;
        // 確定の値は、その値を代わりの値にする（推定を確定にした値なら、その推定の根拠のまま）
        const sub = b !== undefined && b.value !== undefined && b.state !== "estimated" ? { value: b.value, ...(estimateOf(b) ?? { method: "standard", basis: PREVIOUS_VALUE }) } : (est ?? estimateFor(f, wh));
        if (sub === null || sub.value === undefined || sub.value === null) return wh;
        return f.boxed.write(wh, { state: "unknown", origin: { kind: "manual" }, substitute: { value: sub.value, state: "estimated", origin: { kind: "auto" }, estimate: { method: sub.method, basis: sub.basis } } });
      }
      case "notApplicable":
        return f.boxed.write(wh, { state: "notApplicable", origin: { kind: "manual" } });
    }
  }
  if (a === null) {
    // 当て先の無い欄（画面の側だけの値など）は、確定（仮の印を外す）と推定に戻すだけ
    if (op === "confirm") return withoutAssumed(wh, f.key);
    if (op === "revert" && f.write !== undefined) return f.write(wh, null);
    return wh;
  }
  // 箱でない値: 値は欄のまま、状態は向き先の物の行に書く（該当なしだけ値を省く。値の書き方は差分の当て方と同じ writeAt。0036 の追記）
  const cur = f.get(wh).value;
  const method = rowAt(input(wh), a)?.estimate?.method ?? assumedMethod(f, wh);
  const has = (w: WorkingHousehold) => readAt(input(w), a) !== undefined;
  switch (op) {
    case "confirm": {
      // 見せている値が世帯に無い（省略のときの既定・ほかの値と同じ値を見せる欄。0070）なら、見せている値を書いてから確定にする
      // （書いても省く欄＝既定と同じ値は、行だけを書く）
      const w = !has(wh) && cur !== null && f.write !== undefined ? f.write(wh, cur) : wh;
      return has(w) || cur !== null ? withRow(withoutAssumed(w, f.key), a, { state: "confirmed", origin: { kind: "manual" }, estimate: { method, basis: s.basis ?? "推定" } }) : wh;
    }
    case "revert": {
      const cleared = withRow(withoutAssumed(wh, f.key), a, undefined);
      return f.write !== undefined ? f.write(cleared, null) : cleared;
    }
    case "unknown": {
      let w = wh;
      let sub: { method: string; basis: string } | null;
      if (s.status === "estimated" && cur !== null) sub = { method, basis: s.basis ?? "推定" };
      else if (cur !== null) sub = { method: rowAt(input(wh), a)?.estimate?.method ?? "standard", basis: rowAt(input(wh), a)?.estimate?.basis ?? PREVIOUS_VALUE };
      else {
        const est = estimateFor(f, wh);
        sub = est === null ? null : { method: est.method, basis: est.basis };
        if (est !== null && f.write !== undefined) w = f.write(wh, null);
      }
      if (sub === null || !has(w)) return wh;
      return withRow(withoutAssumed(w, f.key), a, { state: "unknown", origin: { kind: "manual" }, estimate: sub });
    }
    case "notApplicable":
      return mutate(withoutAssumed(wh, f.key), (_h, req) => void writeAt(req.input as unknown as Obj, a, { state: "notApplicable", origin: { kind: "manual" } }));
  }
}

/**
 * 欄に打って入れる（打った・文字を変えて離れたとき。0041 の追記）: 未入力（0円で計算中）の欄に打った値は、今の値と同じ（0円）でも
 * 確定にする（未入力は状態を持たず、そこへ打つのは明示の操作のため）。ほかの状態の欄は欄の書き方（同じ値なら変えない）のまま。
 * 箱でない値で、未入力の印が行にあり値が同じなら、行を外して打った値（確定）にする
 */
export function typeValue(f: FieldDef, wh: WorkingHousehold, v: Val): WorkingHousehold {
  if (v === null || f.write === undefined || fieldStatus(f, wh).status !== "missing") return f.set(wh, v);
  const next = f.write(wh, v);
  if (fieldStatus(f, next).status !== "missing") return next;
  const a = f.boxed === undefined ? fieldAddress(f, next) : null;
  return a !== null && rowAt(input(next), a) !== undefined ? withRow(withoutAssumed(next, f.key), a, undefined) : next;
}

/** まとまり・カード・全部の「推定の値をまとめて使う」: 推定の欄を、それぞれその値で確定にする。確定にした数も返す */
export function confirmAll(wh: WorkingHousehold, fields: readonly FieldDef[]): { wh: WorkingHousehold; count: number } {
  let w = wh;
  let count = 0;
  for (const f of fields) {
    if (fieldStatus(f, w).status !== "estimated") continue;
    const next = applyStateOp(w, f, "confirm");
    if (next !== w) count++;
    w = next;
  }
  return { wh: w, count };
}

/** 当て先の今の値を値の箱で（箱でない値は値と行から。仮の印は推定の箱にする） */
function boxForField(wh: WorkingHousehold, f: FieldDef, a: Address): DiffBox | null {
  const inp = input(wh);
  const assumed = wh.assumed[f.key];
  if (assumed !== undefined && !isBox(readAt(inp, a))) {
    const v = readAt(inp, a);
    if (v === undefined) return null;
    return { value: structuredClone(v), state: "estimated", origin: { kind: "auto" }, estimate: { method: assumedMethod(f, wh), basis: assumed === "" ? "仮の値" : assumed } };
  }
  const box = boxAt(inp, a);
  if (box !== null) return box;
  const row = rowAt(inp, a);
  return row?.state === "notApplicable" ? (structuredClone(row) as DiffBox) : null;
}

/**
 * プランを選んでいるときの値の状態の操作（0036 の8）: プランの中身（作業中の世帯）に同じ操作を当て、できた値の箱を、そのプランの
 * その当て先の自分の差分（値を変える set）にする。土台・現状と同じに戻ったら自分の差分を消す。このプランで足した物の中なら、
 * その足す差分の物を直す。当て先の無い欄は直さない
 */
export function planStateOp(wh: WorkingHousehold, cat: Catalog, planId: string, f: FieldDef, op: StateOp): WorkingHousehold {
  const work: WorkingHousehold = { ...wh, request: applyPlan(wh, planId, cat).request };
  const a = fieldAddress(f, work);
  if (a === null) return wh;
  const after = applyStateOp(work, f, op);
  if (after === work) return wh;
  const box = boxForField(after, f, a);
  if (box === null) return wh;
  return setPlanValue(wh, cat, planId, a, box, (w) => boxForField(w, f, a));
}
