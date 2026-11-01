// 仕分けた行から、計算に使う数を出す（0034 の8）。
// - 月平均は「使った日」で数える（払う月ではない）。口座・カードごとに、取り込んだ期間（明細の期間を合わせた日数）で割って月平均にし、足し合わせる
//   （カードAは12か月分・カードBは3か月分のように期間が違っても、それぞれの期間で割るので少なく出ない）
// - 月平均＝合計 × 365.25 ÷ 12 ÷ 日数（整数の計算で、四捨五入。1461 / 48 = 365.25 / 12）
// - 12か月に満たないときも同じ出し方（季節の補正はしない）で、注意を出す: 3か月未満は候補を「要確認」にする、
//   水道・光熱などの季節で変わる項目は偏ると知らせる。年1回の支払いは月平均に入れず、一時的支出（年額・時期）として別に出す
import type { ClassifiedRow } from "./classify/classify.ts";
import { categoryInfo, LIVING_ORDER, UNKNOWN_LIVING, type CurrentLivingCategory, type StatementCategory } from "./classify/categories.ts";
import { issue, type Issue } from "./issues.ts";
import type { StatementLog } from "./log.ts";
import { displayMerchant } from "./merchant.ts";
import { countDays, includedImports, YEAR_DAYS } from "./classify/classify.ts";


/** 3か月（これより短い期間は候補を要確認にする） */
export const MIN_DAYS_FOR_CANDIDATE = 85;
/** 1年分とみなす日数（classify の YEAR_DAYS と同じ。約11か月） */
export const FULL_YEAR_DAYS = YEAR_DAYS;

/** 合計を日数で月平均にする（四捨五入。負も対称） */
export function monthlyAverage(total: number, days: number): number {
  if (days <= 0) return 0;
  const num = BigInt(Math.abs(total)) * 1461n * 2n;
  const den = 48n * BigInt(days);
  const q = (num / den + 1n) / 2n;
  const v = Number(q);
  return total < 0 ? -v : v;
}

/** 日数を月の数（小数1桁の文字列）に */
export function monthsText(days: number): string {
  const tenths = Math.round((days * 48 * 10) / 1461);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** 期間を合わせた日数（重なりは1回だけ数える）と最初・最後の日 */
export function coveredDays(periods: readonly { from: string; to: string }[]): { days: number; from: string | null; to: string | null } {
  const ok = periods.filter((p) => p.from !== "" && p.to !== "" && p.from <= p.to);
  if (ok.length === 0) return { days: 0, from: null, to: null };
  const from = ok.map((p) => p.from).sort()[0] as string;
  const to = ok.map((p) => p.to).sort().at(-1) as string;
  return { days: countDays(ok), from, to };
}

export interface AccountCoverage {
  readonly account: string;
  readonly days: number;
  readonly from: string | null;
  readonly to: string | null;
}

export interface LivingLine {
  /** 基本生活費の内訳（0100 の10費目と仕送り。前の分け方の内訳は出さない） */
  readonly category: CurrentLivingCategory;
  readonly monthly: number;
  /** 内訳（仕分けの項目ごとの月平均） */
  readonly detail: readonly { readonly category: StatementCategory | "unknown"; readonly monthly: number }[];
}

export interface OneOffItem {
  /** 店の鍵 */
  readonly key: string;
  readonly label: string;
  readonly category: StatementCategory | null;
  /** 年1回の支払いか（high・medium は候補にする。low と無しは一覧に出すだけ） */
  readonly annual?: { readonly confidence: "high" | "medium" | "low"; readonly everyYears: 1 | 2 };
  /** 使った日と金額（古い順） */
  readonly occurrences: readonly { readonly date: string; readonly amount: number }[];
  /** 1回の額（最後の回） */
  readonly amount: number;
  /** 年の額（年1回なら1回の額。2年に1回なら半分。年1回でなければ期間の合計を年の額に直したもの） */
  readonly perYear: number;
  /** 家電・家具の買い替えの行（家電・家具の店の3万円以上の買い物。基本生活費の年払いの「家電・家具の買い替え」の候補にまとめる） */
  readonly durable?: true;
}

export interface StatementSummary {
  readonly coverage: readonly AccountCoverage[];
  /** 全体の期間（どれかの口座の期間の最初と最後） */
  readonly from: string | null;
  readonly to: string | null;
  /** 一番長い口座の期間の日数（候補の注意に使う） */
  readonly days: number;
  readonly months: string;
  readonly living: readonly LivingLine[];
  readonly livingTotal: number;
  /** 辞書で分からない店の月平均（基本生活費の「その他」に入れてある） */
  readonly unknownMonthly: number;
  /** 参考（それぞれの入力の欄で入れる）: 住居・教育・保険・車・税（計算で出す税・社会保険料を除く） */
  readonly reference: Readonly<Record<"housing" | "education" | "insurance" | "car" | "tax", number>>;
  /** 家計から外した分の月平均（立替・事業の経費・会社の経費。持ち主ごと） */
  readonly outside: readonly { readonly owner: string | null; readonly bucket: "reimbursable" | "business" | "company"; readonly monthly: number }[];
  readonly oneOffs: readonly OneOffItem[];
  /** 迷う行の数（FP がまだ決めていない） */
  readonly review: number;
  readonly notices: readonly Issue[];
}

/** 仕分けた行から数を出す */
export function summarize(log: StatementLog, rows: readonly ClassifiedRow[]): StatementSummary {
  const imports = includedImports(log);
  const coverage: AccountCoverage[] = log.accounts
    .map((a) => ({ account: a.id, ...coveredDays(imports.filter((i) => i.account === a.id).map((i) => i.period)) }))
    .filter((c) => c.days > 0);
  const daysOf = new Map(coverage.map((c) => [c.account, c.days]));
  const all = coveredDays(imports.map((i) => i.period));
  const days = Math.max(0, ...coverage.map((c) => c.days));

  // 口座ごと・項目ごとの合計
  const totals = new Map<string, Map<string, number>>();
  const outsideTotals = new Map<string, number>();
  const add = (acc: string, key: string, v: number) => {
    const m = totals.get(acc) ?? new Map<string, number>();
    m.set(key, (m.get(key) ?? 0) + v);
    totals.set(acc, m);
  };
  for (const r of rows) {
    if (!r.counted) continue;
    const hh = r.parts.household;
    if (hh !== undefined) add(r.account.id, r.category ?? "unknown", hh);
    for (const b of ["reimbursable", "business", "company"] as const) {
      const v = r.parts[b];
      if (v !== undefined) {
        const k = `${r.account.id}\u001f${r.owner ?? ""}\u001f${b}`;
        outsideTotals.set(k, (outsideTotals.get(k) ?? 0) + v);
      }
    }
  }
  // 口座ごとに月平均にしてから足す
  const monthlyBy = new Map<string, number>();
  for (const [acc, m] of totals) {
    const d = daysOf.get(acc) ?? 0;
    for (const [k, v] of m) monthlyBy.set(k, (monthlyBy.get(k) ?? 0) + monthlyAverage(v, d));
  }
  const living: LivingLine[] = [];
  for (const lc of LIVING_ORDER) {
    const detail: { category: StatementCategory | "unknown"; monthly: number }[] = [];
    for (const [k, v] of monthlyBy) {
      const liv = k === "unknown" ? UNKNOWN_LIVING : categoryInfo(k as StatementCategory).living;
      if (liv === lc && v !== 0) detail.push({ category: k as StatementCategory | "unknown", monthly: v });
    }
    const monthly = detail.reduce((n, x) => n + x.monthly, 0);
    if (detail.length > 0) living.push({ category: lc, monthly: Math.max(0, monthly), detail });
  }
  const reference = { housing: 0, education: 0, insurance: 0, car: 0, tax: 0 };
  for (const [k, v] of monthlyBy) {
    if (k === "unknown") continue;
    const g = categoryInfo(k as StatementCategory).group;
    if (g === "housing" || g === "education" || g === "insurance" || g === "car" || g === "tax") reference[g] += v;
  }
  const outsideMap = new Map<string, number>();
  for (const [k, v] of outsideTotals) {
    const [acc, owner, b] = k.split("\u001f") as [string, string, string];
    const kk = `${owner}\u001f${b}`;
    outsideMap.set(kk, (outsideMap.get(kk) ?? 0) + monthlyAverage(v, daysOf.get(acc) ?? 0));
  }
  const outside = [...outsideMap].map(([k, monthly]) => {
    const [owner, bucket] = k.split("\u001f") as [string, "reimbursable" | "business" | "company"];
    return { owner: owner === "" ? null : owner, bucket, monthly };
  });

  // 一時的支出（区分が一時的の行を店ごとに）
  const groups = new Map<string, ClassifiedRow[]>();
  // 家電・家具の買い替えの行は、同じ店のほかの一時的な支出と分けてまとめる
  const groupKey = (r: ClassifiedRow) => (r.flags.includes("durable") ? `durable\u001f${r.row.key}` : r.row.key);
  for (const r of rows) if (r.counted && r.parts.oneOff !== undefined) groups.set(groupKey(r), [...(groups.get(groupKey(r)) ?? []), r]);
  const oneOffs: OneOffItem[] = [...groups].map(([gk, list]) => {
    const key = list[0]?.row.key ?? gk;
    const durable = list[0]?.flags.includes("durable") === true;
    const sorted = [...list].sort((a, b) => (a.row.date < b.row.date ? -1 : 1));
    const last = sorted[sorted.length - 1] as ClassifiedRow;
    const occurrences = sorted.map((r) => ({ date: r.row.date, amount: r.parts.oneOff as number }));
    const total = occurrences.reduce((n, o) => n + o.amount, 0);
    const annual = last.annual;
    // 家電・家具の買い替えは一部の返品を同じまとまりに入れるので、1回の額は最後の買い物（返品の行ではなく）
    const lastBuy = durable ? ([...sorted].reverse().find((r) => (r.parts.oneOff ?? 0) > 0) ?? last) : last;
    const amount = lastBuy.parts.oneOff as number;
    const perYear = annual !== undefined && annual.confidence !== "low" ? (annual.everyYears === 2 ? Math.floor(amount / 2) : amount) : days > 0 ? monthlyAverage(total, days) * 12 : total;
    return { key, label: displayMerchant(last.row.merchant), category: last.category, ...(annual !== undefined ? { annual } : {}), occurrences, amount, perYear, ...(durable ? { durable: true as const } : {}) };
  });
  oneOffs.sort((a, b) => b.perYear - a.perYear);

  const notices: Issue[] = [];
  if (days === 0) notices.push(issue("error", "S_NO_PERIOD", "仕分けに使う明細がありません"));
  else if (days < MIN_DAYS_FOR_CANDIDATE) notices.push(issue("warning", "S_VERY_SHORT_PERIOD", `取り込んだ期間が ${monthsText(days)} か月しかありません。月平均は参考にとどめ、3か月以上の明細を足してください（候補は要確認にします）`));
  else if (days < FULL_YEAR_DAYS) notices.push(issue("warning", "S_SHORT_PERIOD", `取り込んだ期間が ${monthsText(days)} か月で、12か月に足りません。月平均はこの期間で割った値です（季節の補正はしていません）。年1回の支払いは見つけきれないことがあります`));
  if (days > 0 && days < FULL_YEAR_DAYS && living.some((l) => l.detail.some((d) => d.category !== "unknown" && categoryInfo(d.category).seasonal === true))) {
    notices.push(issue("info", "S_SEASONAL", "水道・光熱は季節で変わるため、12か月に満たない期間の月平均は偏ることがあります"));
  }
  const kept = rows.filter((r) => r.counted && r.flags.includes("cardPaymentKept")).length;
  if (kept > 0) notices.push(issue("warning", "S_CARD_PAYMENT_KEPT", `カード会社への引き落としが ${kept} 件あります。そのカードの明細が入っていないため、二重に数えないよう除外はせず、家計に入れています。カードの明細を足すと自動で除外します`));
  const excluded = rows.filter((r) => r.counted && r.flags.includes("cardPaymentExcluded")).length;
  if (excluded > 0) notices.push(issue("info", "S_CARD_PAYMENT_EXCLUDED", `カード会社への引き落とし ${excluded} 件は、カードの明細で数えるので除外しました`));
  const revolving = rows.filter((r) => r.counted && r.flags.includes("revolving")).length;
  if (revolving > 0) notices.push(issue("info", "S_REVOLVING", `リボ払いの行が ${revolving} 件あります。使った日で月平均に入れています（払う月の分け方は分かりません）`));
  // 家電・家具の買い替えの一部の返品は、買い替えの候補から差し引く（S_DURABLE で知らせる）
  const unmatched = rows.filter((r) => r.counted && r.flags.includes("refundUnmatched") && !r.flags.includes("durable")).length;
  if (unmatched > 0) notices.push(issue("info", "S_REFUND_UNMATCHED", `元の行が見つからない返品・取り消しが ${unmatched} 件あり、その月の項目から差し引いています`));
  const durables = rows.filter((r) => r.counted && r.flags.includes("durable"));
  const durableBuys = durables.filter((r) => r.row.amount > 0).length;
  if (durableBuys > 0) {
    const total = durables.reduce((n, r) => n + (r.parts.oneOff ?? 0), 0);
    const refunds = durables.length - durableBuys;
    notices.push(issue("info", "S_DURABLE", `家電・家具の店の3万円以上の買い物 ${durableBuys} 件（${refunds > 0 ? `返品 ${refunds} 件を差し引いた` : ""}合計 ${total.toLocaleString("ja-JP")}円）は、月平均の日用品から外し、「家電・家具の買い替え」の候補にしました（3万円未満は日用品のまま）`));
  }
  const dups = rows.filter((r) => r.flags.includes("duplicate")).length;
  if (dups > 0) notices.push(issue("info", "S_DUPLICATE_ROWS", `別の明細と同じ行が ${dups} 件あり、二重に数えていません（分割の2回目以降・期間の重なった明細）`));

  const livingTotal = living.reduce((n, l) => n + l.monthly, 0);
  const unknownMonthly = monthlyBy.get("unknown") ?? 0;
  return { coverage, from: all.from, to: all.to, days, months: monthsText(days), living, livingTotal, unknownMonthly, reference, outside, oneOffs, review: rows.filter((r) => r.review).length, notices };
}

/** 払う月ごとの金額（分割は回数で分け、端数は1回目に。リボは払う月が分からないので外し、件数を返す） */
export function paymentSchedule(rows: readonly ClassifiedRow[]): { byMonth: Map<string, number>; unknown: number } {
  const byMonth = new Map<string, number>();
  let unknown = 0;
  const addMonths = (ym: string, n: number) => {
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(5, 7)) - 1 + n;
    // 月の数が負（前の年へさかのぼる）でも 1〜12 にする（% は負の数で負を返すため）
    return `${y + Math.floor(m / 12)}-${String((((m % 12) + 12) % 12) + 1).padStart(2, "0")}`;
  };
  for (const r of rows) {
    if (!r.counted || r.parts.excluded !== undefined) continue;
    const row = r.row;
    const first = row.payMonth ?? addMonths(row.date.slice(0, 7), r.account.kind === "card" ? 1 : 0);
    const put = (ym: string, v: number) => byMonth.set(ym, (byMonth.get(ym) ?? 0) + v);
    if (row.plan?.kind === "revolving") {
      unknown++;
      continue;
    }
    if (row.plan?.kind === "installment" && row.fromPayment !== true) {
      const n = row.plan.count;
      const base = Math.trunc(row.amount / n);
      const rest = row.amount - base * n;
      const startIndex = row.plan.index ?? 1;
      for (let k = 0; k < n; k++) put(addMonths(first, k - (startIndex - 1)), base + (k === 0 ? rest : 0));
      continue;
    }
    put(first, row.amount);
  }
  return { byMonth, unknown };
}
