// これから買う車のローンの「書類で確かめる」を推定にする（読むときに使う。0041 の追記 2026-11-01。世帯ファイルの形は変えない）。
// 「書類で確かめる」（値の状態 unknown）は、返済予定表のある今返している自動車ローン（kind car の負債）の欄に出し、車の買い方のローン
// （これから買う車の頭金・年数・金利。値の状態の行 `car.loan/…`）には出さなくした。前の画面で車の買い方のローンに付けた「書類で確かめる」は、
// 値はそのままで推定の印にする（0.44 の変換の段と同じ決まり。計算は代わりの値のままなので結果は変わらない）。
// - 現状: 車（cars[]）の値の状態の行 `car.loan/…` の unknown を推定に
// - プランの差分: 値を変える差分（set。入力項目ID car.loan）の値と前の値、車を足す差分（add。集まり car）の物の中も同じ
// - 推定にした物があれば、開いたときの知らせ carLoanEstimated（数・プランの差分の数）を足す（同じ数なら同じ ID。保存した後は推定なので足さない）
import type { WorkingHousehold } from "./household.ts";
import { migrationId } from "../store/readings.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** 「書類で確かめる」にしたとき、前に入っていた確定の値を代わりにした印（valueState.ts の PREVIOUS_VALUE と同じ） */
const PREVIOUS_VALUE = "前に入っていた値を代わりに使う";
const PREVIOUS_NOTE = "「書類で確かめる」の代わりに使っていた値（前に入っていた値）";

const isCarLoanRow = (k: string) => k.startsWith("car.loan/");

/** 値の状態の行の unknown を推定の行にする（根拠はそのまま。前の値を代わりにした印は代わりの値の文にする） */
function rowToEstimate(row: Obj): void {
  row.state = "estimated";
  if (isObj(row.estimate) && row.estimate.basis === PREVIOUS_VALUE) row.estimate = { ...row.estimate, basis: PREVIOUS_NOTE };
}

/** 車1台の値の状態の行のうち、車の買い方のローンの unknown を推定にする。変えた数を返す */
function carRows(car: unknown): number {
  if (!isObj(car) || !isObj(car.valueStates)) return 0;
  let n = 0;
  for (const [k, row] of Object.entries(car.valueStates))
    if (isCarLoanRow(k) && isObj(row) && row.state === "unknown") {
      rowToEstimate(row);
      n++;
    }
  return n;
}

/**
 * プランの差分の値（値の箱、または箱でない値の状態つきの形）の unknown を推定にする。変えたら true。
 * 代わりの値が自動の推定ならその推定の箱、FP の入れた値ならその値のまま推定の印（0.44 の変換の段の living_unknown_box と同じ）
 */
function diffValue(v: unknown): boolean {
  if (!isObj(v) || v.state !== "unknown") return false;
  const sub = isObj(v.substitute) ? v.substitute : null;
  if (sub === null) {
    rowToEstimate(v);
    return true;
  }
  if (sub.value === undefined || sub.value === null) return false;
  const est = isObj(sub.estimate) ? sub.estimate : {};
  const method = typeof est.method === "string" ? est.method : "standard";
  const basis = typeof est.basis === "string" ? est.basis : "";
  const auto = isObj(sub.origin) && sub.origin.kind === "auto" && basis !== "" && basis !== PREVIOUS_VALUE;
  const next: Obj = auto
    ? { ...structuredClone(sub), state: "estimated" }
    : { value: structuredClone(sub.value), state: "estimated", origin: { kind: "manual" }, estimate: { method, basis: basis === "" || basis === PREVIOUS_VALUE ? PREVIOUS_NOTE : `「書類で確かめる」の代わりに使っていた値（${basis}）` } };
  if (v.approval !== undefined) next.approval = v.approval;
  for (const k of Object.keys(v)) delete v[k];
  Object.assign(v, next);
  return true;
}

/** これから買う車のローンの「書類で確かめる」を推定にした世帯（変える物が無ければ同じ世帯） */
export function withoutFutureCarLoanDocs(wh: WorkingHousehold): WorkingHousehold {
  const has = (v: unknown) => isObj(v) && isObj(v.valueStates) && Object.entries(v.valueStates).some(([k, r]) => isCarLoanRow(k) && isObj(r) && r.state === "unknown");
  const unknownBox = (v: unknown) => isObj(v) && v.state === "unknown";
  const inCars = (wh.request.input.household.cars ?? []).some(has);
  const inPlans = wh.proposals.some((p) => p.diffs.some((d) => (d.op === "set" && d.item === "car.loan" && (unknownBox(d.value) || unknownBox(d.before))) || (d.op === "add" && "collection" in d.target && d.target.collection === "car" && has(d.value))));
  if (!inCars && !inPlans) return wh;
  const request = structuredClone(wh.request);
  let count = 0;
  for (const c of request.input.household.cars ?? []) count += carRows(c);
  let plans = 0;
  const proposals = wh.proposals.map((p) => {
    const diffs = p.diffs.map((d) => {
      if (d.op === "set" && d.item === "car.loan") {
        const x = structuredClone(d);
        const changed = diffValue(x.value);
        diffValue(x.before);
        if (changed) plans++;
        return x;
      }
      if (d.op === "add" && "collection" in d.target && d.target.collection === "car" && has(d.value)) {
        const x = structuredClone(d);
        if (carRows(x.value) > 0) plans++;
        return x;
      }
      return d;
    });
    return diffs.some((d, i) => d !== p.diffs[i]) ? { ...p, diffs } : p;
  });
  const id = migrationId(`notices/carLoanEstimated/${count}/${plans}`);
  const fresh = (count > 0 || plans > 0) && !(wh.notices ?? []).some((x) => x.id === id);
  const notices = fresh ? [...(wh.notices ?? []), { id, kind: "carLoanEstimated", count, plans }] : wh.notices;
  return { ...wh, request, proposals, ...(notices !== undefined ? { notices } : {}) };
}
