// 欄の値の状態（0035 の3・0041）: どの欄も同じ決まりで「推定・書類待ち・該当なし・確定・未入力（0円で計算中）」を読み、
// 4つの操作（この値にする・推定に戻す・書類で確かめる・該当なし）で変える。書類待ちの状態の名前は世帯ファイルでは unknown（前の「わからない」）。呼ぶ側は、状態が値の箱にあるか、値の状態の欄（valueStates）・
// 仮の印（assumed）にあるかを分けない（ここだけが分ける）。
// - 確定は明示の操作だけ: 欄に入って離れる・Tab で通る・同じ文字を書き戻す、では何も変えない（form.ts の field）。推定の値をそのまま
//   使うときは「この値にする」。推定の根拠を残した確定（値の箱・行の estimate）にして、記録の無い確定（打った値・古い世帯の値）と見分ける
// - 未入力は状態を持たない: 値が無い（か「未入力（0円で計算）」の印の0円）のを、画面が決まりで判定する
// - プランを選んでいるときは、同じ操作をそのプランの差分にする（planStateOp。0036 の8）
import type { Catalog } from "../plans/items.ts";
import { applyPlan, setPlanValue } from "../plans/plans.ts";
import { boxAt, isSharedDiff, writeAt, type DiffBox } from "../plans/diffs.ts";
import { findObject, readAt, resolveAssumedKey, resolveKey, type Address } from "../store/readings.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { addMonths } from "../levers.ts";
import type { Timepoint } from "../../engine/types.ts";
import type { FieldDef, Val } from "./form.ts";
import { mutate, type WorkingHousehold } from "./household.ts";
import { putRow, rowAt, type StateRow } from "./rows.ts";
import { officeSourceView, type OfficeSourceView } from "./officeSource.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isBox = (v: unknown): v is Obj & { state: string; origin: Obj } => isObj(v) && typeof v.state === "string" && isObj(v.origin);

export type ValueStatus = "estimated" | "unknown" | "notApplicable" | "confirmed" | "missing";

export interface FieldStatus {
  status: ValueStatus;
  /** 推定・書類待ち（代わりの値）・明示の確定の根拠 */
  basis: string | null;
  /** FP が「この値にする」で確定した（推定の根拠を残した確定） */
  explicit: boolean;
  /** 外から来た値を承認した記録がある（ヒアリング・取り込み・AI） */
  approved: boolean;
  /** 推定（書類待ちは代わりの値）を事務所の推定の値から作った印（0111 の追記 2026-11-03。印が無ければ持たない＝公式の目安から） */
  office?: OfficeSourceView;
  /**
   * 仮の値（生年月など、推定が成り立たない欄に計算のために置いた値）。状態は推定のまま読むが、「この値にする」・まとめての操作の対象にせず、
   * 確かめの一覧では未入力の側に出す（推定と分ける。0041 の追記 2026-11-06）
   */
  provisional?: true;
}

/** 値の状態の操作。unknown は「書類で確かめる」（書類を見るまで今の値か推定を代わりに使う。前の「わからない」。0041 の追記 2026-10-31） */
export type StateOp = "confirm" | "revert" | "unknown" | "notApplicable";

export const OP_LABELS: Readonly<Record<StateOp, string>> = {
  confirm: "この値にする",
  revert: "推定に戻す",
  unknown: "書類で確かめる",
  notApplicable: "該当なし",
};

/** 操作のリンクの説明（title。押すと何が変わるか） */
export const OP_TITLES: Readonly<Record<StateOp, string>> = {
  confirm: "推定の値をこの欄にそのまま入れます（確定になります）",
  revert: "入れた値を消して、推定の値で計算します",
  unknown: "書類で確かめるまで、今の値（無ければ推定の値）を代わりに使って計算します（確かめの一覧の「書類待ち」に出ます）",
  notApplicable: "この額は無いものとして計算します",
};

/** 操作のリンクの説明（欄ごと）。書類で確かめるは、確かめる書類を添える */
export const opTitle = (f: Pick<FieldDef, "docCheck">, op: StateOp): string =>
  op === "unknown" && f.docCheck !== undefined ? `${f.docCheck}で確かめるまで、今の値（無ければ推定の値）を代わりに使って計算します（確かめの一覧の「書類待ち」に出ます）` : OP_TITLES[op];

/** 書類待ちの代わりの値の文（状態の印・確かめの一覧の行）。根拠がもう「代わりの値（…）」で始まる（年金の加入月数など）ときは重ねない */
export const substituteText = (basis: string): string => (basis.startsWith("代わりの値") ? basis : `代わりの値: ${basis}`);

/**
 * 欄の横（数の欄は欄の中）に出す、推定の値をそのまま欄に入れるボタン（値の状態の操作の確定と同じ。0041 の追記）。
 * 推定の値は欄に灰色で見えているので、「入れる」の1押しで確定にする
 */
export const FILL_LABEL = "この値にする";

/** 入れるボタンの説明（ボタンの title と読み上げの名前に使う） */
export const fillTitle = (s: ValueStatus): string => (s === "unknown" ? "代わりの値をこの欄にそのまま入れます（確定になります）" : "推定の値をこの欄にそのまま入れます（確定になります）");

export const STATUS_LABELS: Readonly<Record<ValueStatus, string>> = {
  estimated: "推定",
  unknown: "書類待ち",
  notApplicable: "該当なし",
  confirmed: "確定",
  missing: "未入力（0円で計算中）",
};

/** 仮の値の根拠の文は「仮の値」で始まる（新しい顧客・「＋ 配偶者」「＋ 子」の生年月など。前提条件の「既定の値（仮の値。…）」は前提の推定で、仮の値ではない） */
export const isProvisionalBasis = (basis: string | null | undefined): boolean => typeof basis === "string" && basis.startsWith("仮の値");

/**
 * 仮の値の印の文（印・確かめの一覧）: 生年月なら「仮の値（40歳として計算中）。生年月を入れてください」。
 * 年齢は計算の基準の月の年齢（生年月の欄の値から）。年齢が読めない欄は「仮の値（…として計算中）。…を入れてください」の形の欄の名前だけ
 */
export function provisionalText(f: Pick<FieldDef, "label" | "kind">, wh: WorkingHousehold, value: Val): string {
  const base = wh.request.input.baseMonth;
  if (f.kind === "ym" && typeof value === "string" && /^\d{4}-\d{2}$/.test(value) && /^\d{4}-\d{2}$/.test(base)) {
    const months = (Number(base.slice(0, 4)) - Number(value.slice(0, 4))) * 12 + (Number(base.slice(5, 7)) - Number(value.slice(5, 7)));
    if (months >= 0) return `仮の値（${Math.floor(months / 12)}歳として計算中）。${f.label}を入れてください`;
  }
  return `仮の値で計算中です。${f.label}を入れてください`;
}

/** 「まだ額を入れていない」印の0円の推定（年金の見込額・退職金・統計の無い年収など）の根拠の文は「未入力」で始まる */
export const isUnenteredBasis = (basis: string | null | undefined): boolean => typeof basis === "string" && basis.startsWith("未入力");

const input = (wh: WorkingHousehold): Obj => wh.request.input as unknown as Obj;

/** 欄の当て先（0036 の2）。欄の定義が持たなければ、0.16 の欄のキーから読み替え表で引く（欄の定義が当て先を持つまでの橋渡し） */
export function fieldAddress(f: FieldDef, wh: WorkingHousehold): Address | null {
  if (f.address !== undefined) return f.address(wh);
  const r = resolveKey(`field:${f.key}`, input(wh));
  return r !== null && r.kind === "address" ? r.address : null;
}

/**
 * 欄に値が入っているか（事務所の見せ方で隠す欄でも、値があれば出す。0016 の 2026-11-02 の追記）。
 * 世帯に値の箱・値・仮の印があれば入っている。当て先が分からない欄は、画面に出している値があれば入っているとみなす（迷えば出す）
 */
export function hasFieldValue(f: FieldDef, wh: WorkingHousehold): boolean {
  if (wh.assumed[f.key] !== undefined) return true;
  if (f.boxed !== undefined) return f.boxed.read(wh) !== undefined;
  const a = fieldAddress(f, wh);
  if (a !== null) return readAt(input(wh), a) !== undefined;
  const v = f.get(wh).value;
  return v !== null && v !== undefined && v !== "";
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
  // 事務所の推定の値から作った推定の印（推定・書類待ちの代わりの値だけ）
  const marked = (st: FieldStatus, estimate: unknown): FieldStatus => {
    const o = officeSourceView(estimate);
    return o === null ? st : { ...st, office: o };
  };
  if (f.boxed !== undefined) {
    const b = f.boxed.read(wh);
    if (isBox(b)) {
      const basis = basisOf(b);
      if (b.state === "estimated") return isUnenteredBasis(basis) ? plainStatus("missing", basis) : marked(plainStatus("estimated", basis ?? "推定"), b.estimate);
      if (b.state === "unknown") return marked(plainStatus("unknown", basisOf(isObj(b.substitute) ? b.substitute : undefined)), isObj(b.substitute) ? b.substitute.estimate : undefined);
      if (b.state === "notApplicable") return plainStatus("notApplicable");
      return plainStatus("confirmed", basis, basis !== null, b.approval !== undefined);
    }
  } else {
    const assumed = wh.assumed[f.key];
    if (assumed !== undefined) {
      const basis = assumed === "" ? "仮の値" : assumed;
      return isProvisionalBasis(basis) ? { ...plainStatus("estimated", provisionalText(f, wh, st.value)), provisional: true } : plainStatus("estimated", basis);
    }
    const a = fieldAddress(f, wh);
    const row = a === null ? undefined : rowAt(input(wh), a);
    if (row !== undefined) {
      const basis = row.estimate?.basis ?? null;
      if (row.state === "estimated") return isUnenteredBasis(basis) ? plainStatus("missing", basis) : marked(plainStatus("estimated", basis ?? "推定"), row.estimate);
      if (row.state === "unknown") return marked(plainStatus("unknown", basis), row.estimate);
      if (row.state === "notApplicable") return plainStatus("notApplicable");
      return plainStatus("confirmed", basis, basis !== null, row.approval !== undefined);
    }
  }
  if (st.estimated != null) return isUnenteredBasis(st.estimated) ? plainStatus("missing", st.estimated) : plainStatus("estimated", st.estimated);
  if (st.assumed != null) return isProvisionalBasis(st.assumed) ? { ...plainStatus("estimated", provisionalText(f, wh, st.value)), provisional: true } : plainStatus("estimated", st.assumed);
  if (st.value === null && f.kind === "yen" && f.optional !== true && f.readOnly === undefined) return plainStatus("missing");
  return plainStatus("confirmed");
}

/** 状態を変えられる数の欄か（選択・オンオフ・名前・年月の欄は「書類で確かめる」「該当なし」を持たない） */
const NUMERIC = new Set(["yen", "int", "pct", "decimal"]);

/**
 * 「書類で確かめる」「該当なし」を出さない入力項目（前提条件・表の期間など、FP が決める値。世帯に聞く値ではない。
 * 決まらなければ空欄のまま既定の値で計算する）
 */
const PREMISE_ITEM = /^(assumptions|plan)\./;

/**
 * 「該当なし」を出す入力項目（0041 の 2026-10-29 の追記）: 空欄なら推定の額で計算し、しかもその物そのものが無い人がいる額。
 * 賞与の無い勤め先・住民税のかからない年・退職金の制度の無い勤め先。ここで「該当なし」を押すと、推定の額を使わず無いものとして計算する。
 * ほかの欄は、空欄が「無い」（推定を持たない欄）か、その物があれば必ずある額（基本生活費・年収・車両の価格など）か、0円で同じことが言えるので出さない
 */
const MAY_BE_NONE = new Set(["employment.salary.bonus", "residentTaxAssessment.amount", "retirementBenefit.amount"]);

/** 欄が推定の値を持つか（空欄にすると推定で計算する・今の値が推定）。「書類で確かめる」の代わりの値になる */
const hasEstimate = (f: FieldDef, s: FieldStatus): boolean => f.blankIsEstimate === true || f.blankEstimate !== undefined || s.status === "estimated";

/**
 * 欄で使える操作（その欄・その状態で意味のあるものだけ。0041 の 2026-10-29 の追記）
 * - この値にする: 推定（書類待ちなら代わりの値）を、その値のまま確定にできる
 * - 推定に戻す: 空欄にすると推定で計算する欄で、今は推定でない
 * - 書類で確かめる（前の「わからない」）: 書類から写す数の値の欄（欄の定義の docCheck。住民税・退職金と企業年金の見込み額・年金の加入月数・
 *   今の住宅ローン・手術の額・今の自動車ローン）で、代わりに使う値（今の値か推定）がある欄だけ。ほかの欄（年収・住まい・教育・車の費用・お金の行など）は、
 *   分からなければ推定のままにすればよいので出さない（0041 の追記 2026-10-31。基本生活費は 0100）
 * - 該当なし: 推定の額のある欄のうち、物そのものが無いことがある額（MAY_BE_NONE）
 * 前に入れた「書類待ち」「該当なし」が今は出さない欄にあっても、戻す操作（この値にする・推定に戻す・打ち直す）は今までどおり
 */
export function availableOps(f: FieldDef, wh: WorkingHousehold, s: FieldStatus = fieldStatus(f, wh)): StateOp[] {
  if (f.readOnly !== undefined) return [];
  const out: StateOp[] = [];
  const a = fieldAddress(f, wh);
  const stateful = f.boxed !== undefined || a !== null;
  const value = f.get(wh).value;
  // 仮の値（生年月など）は「この値にする」で確定にしない（推定が成り立たない欄。入れてもらう値。0041 の追記 2026-11-06）
  if ((s.status === "estimated" && s.provisional !== true && confirmable(f, wh, a)) || (s.status === "unknown" && value !== null)) out.push("confirm");
  if (f.blankIsEstimate === true && s.status !== "estimated") out.push("revert");
  const asked = stateful && (f.item === null || !PREMISE_ITEM.test(f.item));
  // 箱でない値は、見せている値が世帯にある（その物の行に書ける）か、空欄の推定を書ける欄だけ（見せるだけの既定の値〔自動車ローンの頭金0の割合など〕は
  // 押しても書く所が無いので出さない。applyStateOp の unknown と同じ決まり）
  const placed = f.boxed !== undefined || (a !== null && (readAt(input(wh), a) !== undefined || (value === null && f.blankIsEstimate === true)));
  if (asked && placed && f.docCheck !== undefined && NUMERIC.has(f.kind) && s.status !== "unknown" && s.status !== "missing" && (value !== null || (f.blankIsEstimate === true && hasEstimate(f, s)))) out.push("unknown");
  if (asked && f.kind === "yen" && f.optional === true && s.status !== "notApplicable" && f.blankIsEstimate === true && f.item !== null && MAY_BE_NONE.has(f.item)) out.push("notApplicable");
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

/** 書類で確かめるにしたときの代わりの値の根拠（前に入っていた確定の値をそのまま使う） */
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
 * - confirm: 推定（書類待ちなら代わりの値）を、その値のまま確定にする。根拠は estimate に残す
 * - revert: 空欄にしたときの推定に戻す（行・書類待ち・該当なしを外す）
 * - unknown: 書類で確かめる（書類待ち）。今の値（無ければ推定）を代わりの値にする
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
    // 数えない推定（学校の種類で決まる統計の平均など。FieldDef の quietEstimate）は、まとめて確定にしない（1つずつ「この値にする」で）
    if (f.quietEstimate !== undefined || fieldStatus(f, w).status !== "estimated") continue;
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
  // どのプランにも共通の項目（表の最後の年）は、プランの差分にせず現状に当てる（0043 の追記 2026-11-05）
  if (isSharedDiff({ target: a.target, item: a.item })) return applyStateOp(wh, f, op);
  const after = applyStateOp(work, f, op);
  if (after === work) return wh;
  const box = boxForField(after, f, a);
  if (box === null) return wh;
  return setPlanValue(wh, cat, planId, a, box, (w) => boxForField(w, f, a));
}

/** 前提条件の標準の値の欄か（前提条件の入力項目の、経済の前提・不動産の評価・表の期間など。FP顧問料の欄は含めない） */
export const isPremiseField = (f: Pick<FieldDef, "key">): boolean => f.key.startsWith("assume/");

/** 働き方の期間の推定を、終わった後どれだけ出し続けるか（辞めた後の失業給付などは終わってからもしばらく効く） */
const ENDED_PERIOD_MONTHS = 24;

/**
 * ずっと前に終わった物か（当て先の物の終わりが計算の基準の月より前。働き方の期間は終わりから2年より前）。
 * その物の推定は結果に効かないので、確かめの一覧に出さず、入力項目の推定の数にも入れない
 */
export function endedLongAgo(wh: WorkingHousehold, holder: string | null | undefined): boolean {
  if (holder == null) return false;
  const h = wh.request.input.household;
  const o = findObject(wh.request.input as unknown as Record<string, unknown>, holder) as { to?: Timepoint | null } | undefined;
  if (o === undefined || o.to == null || typeof o.to !== "object") return false;
  const to = resolveTimepoint(h, o.to);
  if (to === null) return false;
  const period = (h.employmentPeriods ?? []).some((p) => p.id === holder);
  return to < (period ? addMonths(wh.request.input.baseMonth, -ENDED_PERIOD_MONTHS) : wh.request.input.baseMonth);
}

/** 欄の当て先の物・構成員の ID */
export function holderOfField(f: FieldDef, wh: WorkingHousehold): string | null {
  const t = fieldAddress(f, wh)?.target;
  return t === undefined ? null : "object" in t ? t.object : "member" in t ? t.member : null;
}

