// 結果のタブの「足りる境目」（0221）: 選んでいるプランで、運用の利回りを1%刻みで5通りにし、それぞれで「金融資産が最後まで尽きない、いちばん早い
// 働く最後の年齢（ご本人）」を探す。画面の部品を読まない（テストで本物のエンジンと一緒に確かめる）。
// - 判定と動かす項目の意味は、AI接続口の境目探し（find_threshold。0202）にそろえる: 判定は「資産が最後まで尽きない」（主な数字の資産が尽きる年が無い。
//   plans/compare.ts の metricsOf）、動かすのは対策の「働く最後の年齢」（lever:retireAge）と「運用の利回り（預金を除く）」（inv:rate）で、
//   値は画面のプランと同じ関数（plans.ts の applyValues）で当てる（働く最後の年齢なら、生活費の退職の段階・積立の終わり・定年後の働き方も一緒に動く）
// - 探し方も同じ二分探索: 範囲（対策の「働く最後の年齢」のスライダーの範囲）の両端を計算し、若い端で足りれば「○歳でも足ります」、上の端でも足りなければ
//   「○歳まで働いても足りません」、そうでなければ「足りない年齢」と「足りる年齢」を保って半分ずつ狭める。同じ値は2度計算しない
// - 5つの列は一緒に進める（1回ごとに、まだ決まっていない列の真ん中の年齢をまとめて頼む。本体は同時に計算する）
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { rateInRange } from "../input/rateRanges.ts";
import { addMonths, retireOf } from "../levers.ts";
import { metricsOf } from "../plans/compare.ts";
import { addRate, cmpRate, pctText } from "../plans/decimal.ts";
import { ageSliderBounds, earningType, nowPeriodOf, type Catalog } from "../plans/items.ts";
import { valueOf, type Values } from "../plans/plans.ts";
import { roles } from "../roles.ts";

/** 動かす項目のキー（対策の「働く最後の年齢」と「運用の利回り（預金を除く）」。plans/items.ts） */
export const RETIRE_KEY = "lever:retireAge";
export const RATE_KEY = "inv:rate";
/** 列の数と刻み（今のプランの利回りを中心に、1%刻みで5列） */
export const THRESHOLD_COLUMNS = 5;
export const RATE_STEP = "0.01";

export interface ThresholdSetup {
  /** 列の利回り（小さい順。今のプランの利回りを含む） */
  rates: string[];
  /** 今のプランの利回り・働く最後の年齢 */
  rate: string;
  age: number;
  /** 探す範囲（対策の「働く最後の年齢」のスライダーの範囲） */
  min: number;
  max: number;
  /** ご本人の呼び方（「ご本人」か FP が付けた呼び名） */
  self: string;
  /** 配偶者の呼び方（配偶者がいなければ null） */
  spouse: string | null;
}

/**
 * 働く最後の年齢の対策が出せるか: 対策の項目があり、ご本人が今かこれから収入のある働き方（勤め・自営業）をしていて、その働き方がまだ終わっていない
 * （もう退職した・勤めと事業の収入が無い世帯は出さない）。wh は現状の世帯
 */
export function retireMovable(wh: WorkingHousehold, cat: Catalog): boolean {
  const it = cat.byKey.get(RETIRE_KEY);
  if (it === undefined || it.control.kind !== "age") return false;
  const req = wh.request;
  const base = req.input.baseMonth;
  const now = nowPeriodOf(req.input.household, cat.selfId, base);
  if (now === undefined || !earningType(now.type)) return false;
  const r = retireOf(req, cat.selfId);
  return r !== null && addMonths(r.lastEnd, 1) > base;
}

/**
 * 「足りる境目」を出すか・出すときの列と範囲。values は選んでいるプランの値（valuesOf）。出さない世帯は null:
 * 働く最後の年齢の対策が出せない（retireMovable）・運用の利回りの項目が無い（金融資産の口座が無い）・スライダーが動かない
 */
export function thresholdSetup(wh: WorkingHousehold, cat: Catalog, values: Values): ThresholdSetup | null {
  if (!retireMovable(wh, cat)) return null;
  const ri = cat.byKey.get(RETIRE_KEY);
  const yi = cat.byKey.get(RATE_KEY);
  if (ri === undefined || yi === undefined || ri.control.kind !== "age" || yi.control.kind !== "rate") return null;
  const age = valueOf(ri, values, wh);
  const rate = valueOf(yi, values, wh);
  if (typeof age !== "number" || typeof rate !== "string") return null;
  // 範囲は対策のスライダーと同じ（上の端は、今の値が外にあれば広げる。AI接続口の list_plan_items の範囲とも同じ）
  const { min, max } = ageSliderBounds(ri.control, age);
  if (min >= max) return null;
  const rates = rateColumns(rate, yi.control.limit);
  const rs = roles(wh.request);
  return {
    rates,
    rate,
    age,
    min,
    max,
    self: rs.find((r) => r.key === "self")?.label ?? "ご本人",
    spouse: rs.find((r) => r.key === "spouse")?.label ?? null,
  };
}

/**
 * 列の利回り（小さい順）: 今のプランの利回りを中心に1%刻みで5列。0%より下の列は出さず、その分を上に足して5列にする（例: 今が0.1%なら 0.1〜4.1%）。
 * 運用の利回りの範囲（上の端 15%）より上も出さず、その分を下に足す。今のプランの列は、マイナスの利回りでも出す
 */
export function rateColumns(rate: string, limit?: { min: number; max: number }): string[] {
  const ok = (k: number, r: string) => k === 0 || (cmpRate(r, "0") >= 0 && (limit === undefined || rateInRange(r, limit)));
  const half = Math.floor(THRESHOLD_COLUMNS / 2);
  const out = new Map<number, string>();
  for (let k = -half; k <= half; k++) {
    const r = k === 0 ? rate : addRate(rate, stepTimes(k));
    if (ok(k, r)) out.set(k, r);
  }
  // 足りない列は、上（無ければ下）へ1%ずつ足す
  for (let k = half + 1; out.size < THRESHOLD_COLUMNS && k <= half + THRESHOLD_COLUMNS; k++) {
    const r = addRate(rate, stepTimes(k));
    if (!ok(k, r)) break;
    out.set(k, r);
  }
  for (let k = -half - 1; out.size < THRESHOLD_COLUMNS && k >= -half - THRESHOLD_COLUMNS; k--) {
    const r = addRate(rate, stepTimes(k));
    if (!ok(k, r)) break;
    out.set(k, r);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

/** 刻み（1%）の k 倍の率（10進の文字列） */
function stepTimes(k: number): string {
  let out = "0";
  const one = k < 0 ? `-${RATE_STEP}` : RATE_STEP;
  for (let i = 0; i < Math.abs(k); i++) out = addRate(out, one);
  return out;
}

/** 1つのます（利回りと年齢）の値: 選んでいるプランの値に、働く最後の年齢と運用の利回りを重ねる */
export const cellValues = (values: Values, rate: string, age: number): Values => ({ ...values, [RETIRE_KEY]: age, [RATE_KEY]: rate });

/** 判定: 金融資産が最後まで尽きない（AI接続口の noDepletion と同じ。主な数字の資産が尽きる年が無い） */
export function lastsToEnd(req: EngineRequest, result: PreviewResult): boolean {
  return metricsOf(req, result.table, 95).depletion === null;
}

/** 1つの列の答え。found は境目の年齢（1つ若い年齢では足りない）、edge は範囲の若い端でも足りる、none は上の端でも足りない、failed は計算できなかった */
export interface ColumnAnswer {
  rate: string;
  kind: "found" | "edge" | "none" | "failed";
  /** 足りる、いちばん早い働く最後の年齢（none・failed は null） */
  age: number | null;
  /** 計算した回数 */
  computed: number;
}

/** 年齢ごとの判定（true 足りる・false 足りない・null 計算できなかった）をまとめて頼む */
export type Judge = (cells: readonly { rate: string; age: number }[]) => Promise<(boolean | null)[]>;

/**
 * 5つの列の境目を、二分探索で一緒に探す。stop が true を返したら、途中でやめて null（選んでいるプラン・入力が変わったとき）。
 * 判定は年齢について単調（遅く働くほど足りやすい）とみなす（AI接続口の MONOTONE と同じ）
 */
export async function findThresholds(s: Pick<ThresholdSetup, "rates" | "min" | "max">, judge: Judge, stop: () => boolean = () => false): Promise<ColumnAnswer[] | null> {
  interface Col {
    rate: string;
    fail: number;
    ok: number;
    done: ColumnAnswer | null;
    computed: number;
  }
  const cols: Col[] = s.rates.map((rate) => ({ rate, fail: s.min, ok: s.max, done: null, computed: 0 }));
  // 範囲の両端
  const ends = await judge(cols.flatMap((c) => [{ rate: c.rate, age: s.min }, { rate: c.rate, age: s.max }]));
  if (stop()) return null;
  cols.forEach((c, i) => {
    c.computed = 2;
    const lo = ends[i * 2];
    const hi = ends[i * 2 + 1];
    if (lo === null || hi === null) c.done = { rate: c.rate, kind: "failed", age: null, computed: 2 };
    else if (lo) c.done = { rate: c.rate, kind: "edge", age: s.min, computed: 2 };
    else if (!hi) c.done = { rate: c.rate, kind: "none", age: null, computed: 2 };
  });
  // 「足りない年齢」と「足りる年齢」の間を半分ずつ狭める
  for (;;) {
    const open = cols.filter((c) => c.done === null && c.ok - c.fail > 1);
    for (const c of cols) if (c.done === null && c.ok - c.fail <= 1) c.done = { rate: c.rate, kind: "found", age: c.ok, computed: c.computed };
    if (open.length === 0) break;
    const mids = open.map((c) => Math.floor((c.fail + c.ok) / 2));
    const got = await judge(open.map((c, i) => ({ rate: c.rate, age: mids[i] as number })));
    if (stop()) return null;
    open.forEach((c, i) => {
      c.computed++;
      const m = mids[i] as number;
      const g = got[i];
      if (g === null || g === undefined) c.done = { rate: c.rate, kind: "failed", age: null, computed: c.computed };
      else if (g) c.ok = m;
      else c.fail = m;
    });
  }
  return cols.map((c) => c.done as ColumnAnswer);
}

/** 利回りの見せ方（「3%」「3.3%」。小数1桁で、.0 は付けない） */
export const rateLabel = (r: string): string => pctText(r, 1).replace(/\.0%$/, "%");

/** 列の答えの文（2行目のます） */
export function answerText(a: ColumnAnswer | null, s: Pick<ThresholdSetup, "min" | "max">): string {
  if (a === null) return "計算しています…";
  if (a.kind === "found") return `${a.age as number}歳`;
  if (a.kind === "edge") return `${s.min}歳でも足ります`;
  if (a.kind === "none") return `${s.max}歳まで働いても足りません`;
  return "計算できませんでした";
}

/** 表の下の1行: 今のプランの値 */
export const currentText = (s: Pick<ThresholdSetup, "rate" | "age">, plan: string): string => `今のプラン（${plan}）は 利回り${rateLabel(s.rate)}・${s.age}歳まで働く`;

/** 押した後の知らせ */
export const usedText = (rate: string, age: number): string => `対策に入れました: 働く最後の年齢 ${age}歳・運用の利回り 年${rateLabel(rate)}`;
