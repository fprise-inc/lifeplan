// 推定の元の印（0111 の追記 2026-11-03。世帯ファイルの形式 0.54 から）: 推定の値の箱・値の状態の行の estimate.source に、事務所の推定の値から
// 作った推定かを持つ（無ければ公式の目安から作った推定。前の版の世帯の推定も同じ）。
// - 印は、画面が世帯を直したとき（入力のパネルの1回ごと・現状やプランを置き換えたとき・新しい世帯）に、ここで付ける。推定を作る所
//   （hearing/src/estimates.ts など）は根拠の文だけを書き、印を書かない（作る所を1つずつ直さずに済むように）
// - 直した前と比較して、推定の出し方・根拠の文・値が同じ推定は、前の印のまま（作った後に事務所の値を変えても、前の値から作ったと分かる）。
//   新しい推定・変わった推定は、今の事務所の推定の値の根拠の文とまったく同じなら印を付け、違えば印を外す
// - 開いただけでは世帯を変えない（0041 の骨格）。前の版の世帯の推定は、直すまで公式の目安から作ったと読む
import { changedOfficeValues, isEstimateSource, officeSourceOf, type EstimateSource } from "../../../../hearing/src/statistics.ts";
import type { WorkingHousehold } from "./household.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const METHODS = new Set(["statistic", "derived", "officeDefault", "statementAverage", "statementAnnual", "standard"]);
/** 推定の出し方と根拠の文を持つ estimate か（退職給付の見込みの計算 retirementBenefits[].estimate などの、同じ名前の別の欄は除く） */
const isEstimate = (v: unknown): v is Obj & { method: string; basis: string; source?: unknown } => isObj(v) && typeof v.method === "string" && METHODS.has(v.method) && typeof v.basis === "string";

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** 印を当てた estimate（同じなら同じもの） */
function withSource(e: Obj, s: EstimateSource | null): Obj {
  if (s === null) {
    if (e.source === undefined) return e;
    const { source: _s, ...rest } = e;
    void _s;
    return rest;
  }
  return same(e.source, s) ? e : { ...e, source: s };
}

/** 前の並びから、同じ要素（ID があれば ID で、無ければ同じ位置） */
function counterpart(prev: unknown, x: unknown, i: number): unknown {
  if (!Array.isArray(prev)) return undefined;
  if (isObj(x) && typeof x.id === "string") return prev.find((p) => isObj(p) && p.id === x.id);
  return prev[i];
}

function walk(next: unknown, prev: unknown): unknown {
  if (next === prev) return next;
  if (Array.isArray(next)) {
    let out: unknown[] | null = null;
    next.forEach((x, i) => {
      const y = walk(x, counterpart(prev, x, i));
      if (y !== x) (out ??= [...next])[i] = y;
    });
    return out ?? next;
  }
  if (!isObj(next)) return next;
  const p = isObj(prev) ? prev : undefined;
  let out: Obj | null = null;
  for (const [k, v] of Object.entries(next)) {
    let y: unknown;
    if (k === "estimate" && isEstimate(v)) {
      const was = p?.estimate;
      // 出し方・根拠の文・値が前と同じなら前の印のまま。変わった・新しい推定は今の事務所の推定の値から
      const kept = isEstimate(was) && was.method === v.method && was.basis === v.basis && same(next.value, p?.value);
      const s = kept ? (isEstimateSource(was.source) ? was.source : null) : officeSourceOf(v.basis);
      y = withSource(v, s);
    } else y = walk(v, p?.[k]);
    if (y !== v) (out ??= { ...next })[k] = y;
  }
  return out ?? next;
}

/**
 * 直した世帯（next）の推定に、推定の元の印を付ける（prev は直す前の世帯。新しい世帯は null）。計算の要求とプランの差分を見る。
 * 変わらなければ同じものを返す
 */
export function withOfficeSources(next: WorkingHousehold, prev: WorkingHousehold | null): WorkingHousehold {
  const request = walk(next.request, prev?.request) as WorkingHousehold["request"];
  const proposals = walk(next.proposals, prev?.proposals) as WorkingHousehold["proposals"];
  return request === next.request && proposals === next.proposals ? next : { ...next, request, proposals };
}

/** 推定の元の印の見え方: 事務所の推定の値から作った推定か、作った後にその値を変えたか（印が無ければ null） */
export interface OfficeSourceView {
  /** 使った値ID */
  ids: string[];
  /** 作った後に事務所の値が変わった・外された値ID（空なら今の事務所の値から作った推定） */
  changed: string[];
}

/** 値の箱・値の状態の行の estimate から、推定の元の印の見え方を読む */
export function officeSourceView(estimate: unknown): OfficeSourceView | null {
  if (!isObj(estimate) || !isEstimateSource(estimate.source)) return null;
  return { ids: Object.keys(estimate.source.values), changed: changedOfficeValues(estimate.source) };
}
