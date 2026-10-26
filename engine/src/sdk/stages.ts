// 0040: 段階と例外の年（物の額・率を時期で変える）の共通の部分。部品は元の額の代わりにここで決めた額を使い、元の欄の伸び方をそのまま重ねる。
// - 段（stages）: 時点（0003 の6）を月に解き、月の順に並べる（同じ月は後に書いた段が勝つ）。その月から、段の額（amount）か、
//   元の額×段の割合（ratio）を使う。段より前の月は元の額
// - 少しずつ移す（rampYears）: 段 k に n を書くと、段 k の月から1年たつごとに、段 k の値から次の段の値へ (次−今)÷n ずつ移す
//   （j 年たった月は 段k＋(次の段−段k)×j/n。差に掛けた額を丸める。conv.stage.value）。n 年で次の段の値に届き、次の段の月まではその値のまま。
//   次の段の月が先に来たら、その月から次の段の値。最後の段の rampYears は使わない
// - 年ごとの物（固定資産税・不動産の経費の年額・器の利回り）は、その年の12月の段を使う（＝段の時点の属する年から。移す年数は年の差）
// - 例外の年（exceptions）: その年だけ、段の額の代わりに例外の額（元の額の欄と同じ基準）を使う。同じ年は後に書いたものが勝つ
// - 段階も例外の年も無いときは、部品は元の計算のまま（plain）
import type { AmountExceptionInput, AmountStageInput } from "../engine/types.ts";
import type { Ctx } from "../registry/ctx.ts";
import { yen, type Yen } from "../money/yen.ts";
import { monthIndex, yearOf, type MonthIndex } from "../time/month.ts";
import type { Timepoint } from "../time/timepoint.ts";
import { boxValue } from "./box.ts";

/** 月に解いた段（月の順） */
export interface StageStep<V> {
  readonly m: MonthIndex;
  readonly v: V;
  /** ここから何年かけて次の段へ移すか（無ければ null） */
  readonly ramp: number | null;
}

/** 段の時点を月に解き、月の順に並べる（同じ月は書いた順。後の段が勝つ） */
export function stageSteps<S extends { readonly at: Timepoint; readonly rampYears?: number }, V>(ctx: Ctx, stages: readonly S[] | undefined, value: (s: S) => V): StageStep<V>[] {
  if (stages === undefined || stages.length === 0) return [];
  return stages
    .map((s, i) => ({ m: ctx.time.resolve(s.at), i, s }))
    .sort((a, b) => a.m - b.m || a.i - b.i)
    .map(({ m, s }) => ({ m, v: value(s), ramp: s.rampYears === undefined ? null : s.rampYears }));
}

/**
 * 月 m に当たる段: 段の番号（段より前なら -1）と、少しずつ移す途中なら次の段と進んだ年数（1〜n−1）・年数 n。
 * n 年たって次の段の値に届いた後は、次の段を返す（toward は null）
 */
export function stageAt<V>(steps: readonly StageStep<V>[], m: MonthIndex): { k: number; v: V | null; toward: { v: V; j: number; n: number } | null } {
  let k = -1;
  for (let i = 0; i < steps.length; i++) if ((steps[i] as StageStep<V>).m <= m) k = i;
  if (k < 0) return { k, v: null, toward: null };
  const cur = steps[k] as StageStep<V>;
  const next = steps[k + 1];
  if (cur.ramp === null || next === undefined) return { k, v: cur.v, toward: null };
  const j = Math.floor((m - cur.m) / 12);
  if (j <= 0) return { k, v: cur.v, toward: null };
  if (j >= cur.ramp) return { k, v: next.v, toward: null };
  return { k, v: cur.v, toward: { v: next.v, j, n: cur.ramp } };
}

/** 段階と例外の年を当てた額（元の額の欄と同じ基準。伸び方は部品が重ねる） */
export interface StagedYen {
  /** 段階も例外の年も無い（部品は元の計算のまま） */
  readonly plain: boolean;
  /** 段階か例外の年に0円より大きい額がある（元の額が0円でも計算を続けるか） */
  readonly anyPositive: boolean;
  /** その月の額（段階と少しずつ移す分。例外の年は含まない） */
  stageAt(m: MonthIndex): Yen;
  /** その年の例外の額（無ければ null） */
  exception(year: number): Yen | null;
  /** その月の額（例外の年ならその額、無ければ段階の額） */
  at(m: MonthIndex): Yen;
  /** 年ごとの物のその年の額（例外の年ならその額、無ければその年の12月の段階の額） */
  inYear(year: number): Yen;
}

/**
 * 元の額 amount に段階と例外の年を当てる。割合の段は amount×ratio（roundingId で丸める）。
 * 段も例外も無ければ、いつも amount を返す（plain）
 */
export function stagedYen(
  ctx: Ctx,
  amount: Yen,
  input: { readonly stages?: readonly AmountStageInput[]; readonly exceptions?: readonly AmountExceptionInput[] } | undefined,
  roundingId: string,
): StagedYen {
  const steps = stageSteps(ctx, input?.stages, (s): Yen => {
    if (s.amount !== undefined) return boxValue(s.amount) ?? yen(0);
    if (s.ratio !== undefined) return ctx.money.mulRate(amount, ctx.rate.of(s.ratio), roundingId);
    return amount;
  });
  const exceptions = new Map<number, Yen>();
  for (const e of input?.exceptions ?? []) exceptions.set(e.year, boxValue(e.amount) ?? yen(0));
  const plain = steps.length === 0 && exceptions.size === 0;
  const anyPositive = steps.some((s) => s.v > 0) || [...exceptions.values()].some((v) => v > 0);
  const stage = (m: MonthIndex): Yen => {
    if (steps.length === 0) return amount;
    const hit = stageAt(steps, m);
    if (hit.v === null) return amount;
    if (hit.toward === null) return hit.v;
    const { v, j, n } = hit.toward;
    // 今の段＋(次の段−今の段)×j/n（差に掛けた額を丸める）
    return yen(hit.v + ctx.money.mulRatio(yen(v - hit.v), j, n, "conv.stage.value"));
  };
  const exception = (y: number): Yen | null => exceptions.get(y) ?? null;
  return {
    plain,
    anyPositive,
    stageAt: stage,
    exception,
    at: (m) => exception(yearOf(m)) ?? stage(m),
    inYear: (y) => exception(y) ?? stage(monthIndex(y, 12)),
  };
}
