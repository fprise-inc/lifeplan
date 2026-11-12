// 夢プラン（0103）の提示の決まり（提案書の「ご家族の夢」の章と、アプリの結果の画面の目標の区画で同じ物を使う）:
// - 夢は出るお金の行の種類 dream。順位（dream.rank）の順に並べ、「計算に入れない」（dream.include が false）の夢は計算から外れている
// - ひとことの要約は、夢を入れた計算と、夢を全部外した計算（1回だけ足す計算）の、資産が尽きる年から作る
// - 計算に入れている夢の「払った後の金融資産」は、その夢の出るお金が表にある年（払う年）の終わりの金融資産（物価の上昇などを見込んだ計算の答え）。
//   何年ごと・毎年の夢は、払う年のうち資金が不足する最初の年、無ければ金融資産がいちばん少ない年（dreamPaid。結果の画面の夢ごとの一言と同じ数字）
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

/** 表の1つの値（計算の答えの表。夢の出るお金は object がその夢の行の ID） */
interface Cell {
  row: string;
  year: number;
  amount: number;
  object?: string;
}

/** 計算に入れている夢の、払う年の金融資産（払った後） */
export interface DreamPaid {
  /** 払う年の数（1回の夢は1） */
  count: number;
  /** 見る年（1回の夢は払う年。何年ごと・毎年の夢は、払う年のうち資金が不足する最初の年、無ければ金融資産がいちばん少ない年〔同じなら早い年〕） */
  year: number;
  /** その年の終わりの金融資産（払った後） */
  after: number;
  /** その年に資金の不足がある（金融資産がマイナスか、資金の不足の行がある） */
  short: boolean;
}

/** 夢の払う年の金融資産（払った後）。id は夢の行の ID、years は表に出す年。払う年が表に無い（計算に入っていない・額が無い）ときは null */
export function dreamPaid(id: string, table: readonly Cell[], years: readonly number[]): DreamPaid | null {
  const shown = new Set(years);
  const paidBy = new Map<number, number>();
  const fin = new Map<number, number>();
  const short = new Map<number, number>();
  for (const c of table) {
    if (c.object === id && (c.row === "cf.expense" || c.row.startsWith("cf.expense."))) paidBy.set(c.year, (paidBy.get(c.year) ?? 0) + c.amount);
    if (c.row === "cf.balance.financial") fin.set(c.year, (fin.get(c.year) ?? 0) + c.amount);
    if (c.row === "cf.balance.shortfall") short.set(c.year, (short.get(c.year) ?? 0) + c.amount);
  }
  const paid = [...paidBy.entries()].filter(([y, v]) => v > 0 && shown.has(y)).map(([y]) => y).sort((a, b) => a - b);
  if (paid.length === 0) return null;
  const isShort = (y: number) => (fin.get(y) ?? 0) < 0 || (short.get(y) ?? 0) > 0;
  const year = paid.find(isShort) ?? paid.reduce((m, y) => ((fin.get(y) ?? 0) < (fin.get(m) ?? 0) ? y : m));
  return { count: paid.length, year, after: fin.get(year) ?? 0, short: isShort(year) };
}
