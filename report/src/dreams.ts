// 夢プラン（やりたいこと。0103）の提示の決まり（提案書の「ご家族の夢」の章と、アプリの結果の画面の目標の区画で同じ物を使う）:
// - 夢は出るお金の行の種類 dream。順位（dream.rank）の順に並べ、「計算に入れない」（dream.include が false）の夢は計算から外れている
// - ひとことの要約は、夢を入れた計算と、夢を全部外した計算（1回だけ足す計算）の、資産が尽きる年から作る
import type { EngineRequest } from "../../engine/src/engine/types.ts";

type Household = EngineRequest["input"]["household"];
type Expense = NonNullable<Household["periodicExpenses"]>[number];

/** 夢プランの1件か */
export const isDreamRow = (p: Pick<Expense, "kind">): boolean => p.kind === "dream";

/** 計算に入れる夢か（「計算に入れない」を選んでいなければ入れる） */
export const dreamIncluded = (p: Pick<Expense, "kind" | "dream">): boolean => isDreamRow(p) && p.dream?.include !== false;

/** 夢の並び（順位の順。順位の無い物・同じ順位は世帯の並びの順） */
export function dreamList<T extends Pick<Expense, "kind" | "dream">>(rows: readonly T[] | undefined): T[] {
  const list = (rows ?? []).map((p, i) => ({ p, i })).filter((x) => isDreamRow(x.p));
  const rank = (p: T) => p.dream?.rank ?? Number.MAX_SAFE_INTEGER;
  return list.sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

export interface DreamSummaryInput {
  /** 夢の数と、そのうち計算に入れた数 */
  total: number;
  included: number;
  /** 夢を入れた計算で資産が尽きる年（尽きなければ null） */
  withYear: number | null;
  /** 夢を全部外した計算で資産が尽きる年（尽きなければ null） */
  withoutYear: number | null;
  /** その年のご本人の年齢の言い方（「82歳」。ご本人がいなければ「2061年」） */
  ageText: (year: number) => string;
  /** 表の最後までの言い方（「100歳まで」「最後まで」） */
  until: string;
}

/**
 * 夢のひとことの要約（夢が無ければ null）:
 * - 「夢をすべて入れても100歳まで足ります」
 * - 「夢をすべて入れると82歳で不足します（入れなければ足ります）」
 * - 「夢をすべて入れると82歳で不足します（入れなくても88歳で不足します）」
 * - 「夢を入れなくても82歳で不足します（夢で不足の時期は変わりません）」
 * 一部の夢を計算に入れていないときは「計算に入れた夢（5件中3件）を入れても…」、どれも入れていなければ「夢はどれも計算に入れていません」
 */
export function dreamSummary(x: DreamSummaryInput): string | null {
  if (x.total === 0) return null;
  if (x.included === 0) return "夢はどれも計算に入れていません";
  const which = x.included === x.total ? "夢をすべて" : `計算に入れた夢（${String(x.total)}件中${String(x.included)}件）を`;
  if (x.withYear === null) return `${which}入れても${x.until}足ります`;
  if (x.withoutYear === null) return `${which}入れると${x.ageText(x.withYear)}で不足します（入れなければ足ります）`;
  if (x.withoutYear > x.withYear) return `${which}入れると${x.ageText(x.withYear)}で不足します（入れなくても${x.ageText(x.withoutYear)}で不足します）`;
  return `夢を入れなくても${x.ageText(x.withoutYear)}で不足します（夢で不足の時期は変わりません）`;
}

/** 夢を全部外した要求（要約の1回の計算。計算に入る夢が無ければ同じ物を返す） */
export function requestWithoutDreams<R extends EngineRequest>(req: R): R {
  const h = req.input.household;
  const rows = h.periodicExpenses ?? [];
  if (!rows.some(dreamIncluded)) return req;
  return { ...req, input: { ...req.input, household: { ...h, periodicExpenses: rows.filter((p) => !isDreamRow(p)) } } };
}
