// 自動の仕分け（0034 の4〜7）。取り込みの記録（行と FP の決めたこと）と辞書から、行ごとの項目・区分・印を毎回作り直す。
// - 二重に数えない: 銀行の明細のカード会社への引き落とし（カードの明細を入れているとき）、同じ口座の別の取り込みに出た同じ行
//   （分割の2回目以降の行・期間の重なった明細）、返品・取り消しと元の行の組
// - 年1回の支払い（同じ店で年1回・高額、または辞書の年1回の印）を見つけて「一時的」の候補にする
// - 迷う行に印を付ける（辞書で分からない・区分が決まらない・高額で一時的か迷う・カードの引き落としを除外できない・リボ・元の見つからない返品）
import type { HouseholdRule, StatementAccount, StatementImport, StatementLog, StatementRow } from "../log.ts";
import { categoryInfo, type StatementCategory } from "./categories.ts";
import { lookup, officeIndex, type DictionaryEntry } from "./dictionary.ts";
import { bucketsOf, memberStyles, splitByShare, type Bucket, type HouseholdLike, type WorkStyle } from "./work.ts";

/** 1行の金額がこれ以上なら「高額」（一時的か迷う） */
export const HIGH_AMOUNT = 100_000;
/** 年1回の支払いとみなす金額の下限（辞書の印が無いとき） */
export const ANNUAL_MIN = 30_000;
/**
 * 「1年分ある」とみなす日数（335日＝約11か月）。期間は使った日の最初と最後から出すので、12か月分の明細でも365日より短く出る
 * （月の初めの数日に使っていないなど）。年1回の検出と、12か月に満たないときの注意の両方でこの値を使う
 */
export const YEAR_DAYS = 335;
/** 返品・取り消しの元の行を探す日数 */
export const REFUND_WINDOW_DAYS = 120;

export type Flag =
  | "unknownMerchant"
  | "bucketUndecided"
  | "bucketNotAllowed"
  | "highAmount"
  | "annual"
  | "annualUnsure"
  | "cardPaymentExcluded"
  | "cardPaymentKept"
  | "duplicate"
  | "refund"
  | "refundUnmatched"
  | "revolving"
  | "familyCard"
  | "engineTax";

/** 迷う行の印（ヒアリングの画面で FP が決める） */
export const REVIEW_FLAGS: readonly Flag[] = ["unknownMerchant", "bucketUndecided", "bucketNotAllowed", "highAmount", "annualUnsure", "cardPaymentKept", "revolving", "refundUnmatched"];

export const FLAG_LABELS: Record<Flag, string> = {
  unknownMerchant: "辞書で分からない店",
  bucketUndecided: "区分が決まらない（事業・会社の分か）",
  bucketNotAllowed: "持ち主の働き方では選べない区分",
  highAmount: "高額（一時的か迷う）",
  annual: "年1回の支払いの候補",
  annualUnsure: "高額で1回だけ（年1回かは期間が短くて分からない）",
  cardPaymentExcluded: "カード会社への引き落とし（カードの明細で数えるので除外）",
  cardPaymentKept: "カード会社への引き落とし（カードの明細が無いので除外していません）",
  duplicate: "別の明細と同じ行（二重に数えない）",
  refund: "返品・取り消しと元の行の組（差し引き0）",
  refundUnmatched: "返品・取り消し（元の行が見つからない）",
  revolving: "リボ払い（払う月が決まらない）",
  familyCard: "家族カードの行",
  engineTax: "税・社会保険料（計算で出すので除外）",
};

export interface AnnualInfo {
  readonly confidence: "high" | "medium" | "low";
  readonly everyYears: 1 | 2;
}

export interface ClassifiedRow {
  readonly importId: string;
  readonly row: StatementRow;
  readonly account: StatementAccount;
  /** 行の持ち主（行で選んだ人 → 明細の持ち主） */
  readonly owner: string | null;
  readonly styles: readonly WorkStyle[];
  readonly allowed: readonly Bucket[];
  readonly category: StatementCategory | null;
  readonly categorySource: "fp" | "office" | "sourceCategory" | "builtin" | "transferMark" | null;
  readonly bucket: Bucket;
  readonly bucketSource: "fp" | "rule" | "auto";
  readonly share?: string;
  /** 区分ごとの金額（事業の割合で分けたときは事業と家計の2つ） */
  readonly parts: Readonly<Partial<Record<Bucket, number>>>;
  /** 数えるか（二重・返品の組は数えない） */
  readonly counted: boolean;
  readonly flags: readonly Flag[];
  readonly annual?: AnnualInfo;
  /** 迷う行か（FP がまだ決めていない迷う印がある） */
  readonly review: boolean;
}

export interface ClassifyContext {
  readonly log: StatementLog;
  readonly household: HouseholdLike;
  /** 働き方を決める月（計算基準日の月） */
  readonly baseMonth: string;
  /** 覚えた辞書（事務所データ） */
  readonly office: readonly DictionaryEntry[];
}

const DAY = 86_400_000;
const dayOf = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY;

/** 期間を合わせた日数（重なりは1回だけ。summary の coveredDays と同じ数え方） */
export function countDays(periods: readonly { from: string; to: string }[]): number {
  const iv = periods
    .filter((p) => p.from !== "" && p.to !== "" && p.from <= p.to)
    .map((p) => [dayOf(p.from), dayOf(p.to)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let days = 0;
  let cur: [number, number] | null = null;
  for (const x of iv) {
    if (cur !== null && x[0] <= cur[1] + 1) cur[1] = Math.max(cur[1], x[1]);
    else {
      if (cur !== null) days += cur[1] - cur[0] + 1;
      cur = [x[0], x[1]];
    }
  }
  return cur === null ? days : days + cur[1] - cur[0] + 1;
}

/** 数える取り込み（FP が外したものは使わない） */
export function includedImports(log: StatementLog): StatementImport[] {
  return log.imports.filter((i) => i.include && log.accounts.some((a) => a.id === i.account));
}

function dedupKey(r: StatementRow): string {
  const plan = r.plan?.kind === "installment" ? `i${r.plan.count}` : (r.plan?.kind ?? "");
  const pay = r.fromPayment === true ? `|${r.payMonth ?? ""}|${r.plan?.kind === "installment" ? (r.plan.index ?? "") : ""}` : "";
  return `${r.date}|${r.key}|${r.amount}|${plan}${pay}`;
}

function ruleFor(rules: readonly HouseholdRule[], r: StatementRow, category: StatementCategory | null, owner: string | null, allowed: readonly Bucket[]): HouseholdRule | undefined {
  const fits = (x: HouseholdRule) => (x.owner === undefined || x.owner === owner) && allowed.includes(x.bucket);
  return rules.find((x) => "key" in x.match && x.match.key === r.key && fits(x)) ?? (category !== null ? rules.find((x) => "category" in x.match && x.match.category === category && fits(x)) : undefined);
}

/** 事業・会社の分かを聞くことの多い項目 */
const BUSINESS_PRONE: readonly (StatementCategory | null)[] = ["communication", "transport", "car", "social", "furniture", "recreation", "otherLiving", null];
/** 年1回の自動の検出から外す項目（ふだんの買い物） */
const NOT_ANNUAL: readonly (StatementCategory | null)[] = ["food", "dailyGoods", "utilities", "communication", "transport", "cash", "transfer", "income", "tax"];

/** 仕分ける */
export function classify(ctx: ClassifyContext): ClassifiedRow[] {
  const { log } = ctx;
  const office = officeIndex(ctx.office);
  const styles = memberStyles(ctx.household, ctx.baseMonth, log.styles);
  const imports = includedImports(log).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const accountOf = new Map(log.accounts.map((a) => [a.id, a]));
  const cardImports = imports.filter((i) => accountOf.get(i.account)?.kind === "card");

  // 1. 二重の行（同じ口座の別の取り込みに出た同じ行。同じ取り込みの中の同じ行は別の買い物として数える）
  const dup = new Set<StatementRow>();
  const seenMax = new Map<string, Map<string, number>>();
  for (const imp of imports) {
    const prev = seenMax.get(imp.account) ?? new Map<string, number>();
    const here = new Map<string, number>();
    for (const r of imp.rows) {
      const k = dedupKey(r);
      const n = (here.get(k) ?? 0) + 1;
      here.set(k, n);
      if (n <= (prev.get(k) ?? 0)) dup.add(r);
    }
    for (const [k, n] of here) prev.set(k, Math.max(prev.get(k) ?? 0, n));
    seenMax.set(imp.account, prev);
  }

  // 2. 項目
  interface Work {
    imp: StatementImport;
    acc: StatementAccount;
    r: StatementRow;
    owner: string | null;
    st: WorkStyle[];
    allowed: Bucket[];
    category: StatementCategory | null;
    source: ClassifiedRow["categorySource"];
    flags: Set<Flag>;
    counted: boolean;
    annual?: AnnualInfo;
    annualHint: boolean;
    issuer?: string;
  }
  const work: Work[] = [];
  for (const imp of imports) {
    const acc = accountOf.get(imp.account) as StatementAccount;
    for (const r of imp.rows) {
      const owner = r.owner ?? acc.owner;
      const st = owner !== null ? (styles.get(owner) ?? ["none"]) : ["none" as WorkStyle];
      let category: StatementCategory | null = null;
      let source: ClassifiedRow["categorySource"] = null;
      const flags = new Set<Flag>();
      let annualHint = false;
      let issuer: string | undefined;
      if (r.category !== undefined) {
        category = r.category;
        source = "fp";
      } else if (r.transfer === true) {
        category = "transfer";
        source = "transferMark";
      } else {
        const m = lookup(r.key, { office, ...(r.sourceCategory !== undefined ? { sourceCategory: r.sourceCategory } : {}), bank: acc.kind === "bank" });
        if (m !== null) {
          category = m.category;
          source = m.source;
          if (m.flags.includes("cardPayment") && acc.kind === "bank" && r.amount > 0) {
            flags.add("cardPaymentExcluded");
            issuer = m.issuer;
          }
          if (m.flags.includes("engineTax")) flags.add("engineTax");
          if (m.flags.includes("annual")) annualHint = true;
        }
      }
      if (category === "tax") flags.add("engineTax");
      if (r.cardUser === "family" && r.owner === undefined) flags.add("familyCard");
      if (r.plan?.kind === "revolving") flags.add("revolving");
      const counted = !dup.has(r);
      if (!counted) flags.add("duplicate");
      work.push({ imp, acc, r, owner, st, allowed: bucketsOf(st), category, source, flags, counted, annualHint, ...(issuer !== undefined ? { issuer } : {}) });
    }
  }

  // 3. カード会社への引き落とし: そのカードの明細がその頃を覆っていれば除外、無ければ数えて知らせる。
  //    どのカード会社か分かる引き落としは、同じカード会社のカード（issuer）の明細だけで覆う。カード会社を決めていないカードの明細は、どの引き落としも覆う
  for (const w of work) {
    if (!w.flags.has("cardPaymentExcluded")) continue;
    const d = dayOf(w.r.date);
    const covers = (i: StatementImport) => {
      const iss = accountOf.get(i.account)?.issuer;
      return (w.issuer === undefined || iss === undefined || iss === w.issuer) && dayOf(i.period.to) >= d - 62 && dayOf(i.period.from) <= d;
    };
    const covered = cardImports.some(covers);
    if (!covered) {
      w.flags.delete("cardPaymentExcluded");
      w.flags.add("cardPaymentKept");
    }
  }

  // 4. 返品・取り消し（同じ口座・同じ店・同じ額の正の行を、前の120日から探して組にする）
  const byAccount = new Map<string, Work[]>();
  for (const w of work) if (w.counted) byAccount.set(w.acc.id, [...(byAccount.get(w.acc.id) ?? []), w]);
  for (const list of byAccount.values()) {
    const used = new Set<Work>();
    for (const neg of list) {
      if (neg.r.amount >= 0 || neg.acc.kind === "bank") continue;
      const d = dayOf(neg.r.date);
      const orig = list
        .filter((p) => !used.has(p) && p.r.amount === -neg.r.amount && p.r.key === neg.r.key && dayOf(p.r.date) <= d && d - dayOf(p.r.date) <= REFUND_WINDOW_DAYS)
        .sort((a, b) => dayOf(b.r.date) - dayOf(a.r.date))[0];
      if (orig !== undefined) {
        used.add(orig);
        used.add(neg);
        orig.flags.add("refund");
        neg.flags.add("refund");
        orig.counted = false;
        neg.counted = false;
      } else neg.flags.add("refundUnmatched");
    }
  }

  // 5. 年1回の支払い（店の鍵ごと。数える正の行だけ）
  // 期間は、その店の行が出てくる口座の期間（明細の期間を合わせた日数）の長いほう。短い期間の口座では年1回かを決めない
  const spanOf = new Map<string, number>();
  for (const a of log.accounts) spanOf.set(a.id, countDays(imports.filter((i) => i.account === a.id).map((i) => i.period)));
  const groups = new Map<string, Work[]>();
  for (const w of work) {
    if (!w.counted || w.r.amount <= 0 || w.flags.has("cardPaymentExcluded") || w.flags.has("cardPaymentKept") || w.flags.has("engineTax")) continue;
    if (w.r.bucket !== undefined && w.r.bucket !== "oneOff" && w.r.bucket !== "household") continue;
    groups.set(w.r.key, [...(groups.get(w.r.key) ?? []), w]);
  }
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => dayOf(a.r.date) - dayOf(b.r.date));
    const gaps = sorted.slice(1).map((w, i) => dayOf(w.r.date) - dayOf((sorted[i] as Work).r.date));
    const amounts = sorted.map((w) => w.r.amount);
    const hint = sorted.some((w) => w.annualHint || w.r.bucket === "oneOff");
    const category = sorted[0]?.category ?? null;
    const span = Math.max(...sorted.map((w) => spanOf.get(w.acc.id) ?? 0));
    // 分割の買い物は、年1回の支払いではなく大きな買い物（高額の印で FP に見せる）
    if (!hint && sorted.some((w) => w.r.plan?.kind === "installment")) continue;
    const similar = Math.max(...amounts) <= Math.min(...amounts) * 1.2;
    let info: AnnualInfo | undefined;
    if (sorted.length >= 2 && gaps.every((g) => g >= 330 && g <= 400) && similar) info = { confidence: "high", everyYears: 1 };
    else if (sorted.length >= 2 && gaps.every((g) => g >= 700 && g <= 760) && similar) info = { confidence: "high", everyYears: 2 };
    else if (sorted.length === 1) {
      const a = amounts[0] as number;
      if (hint) info = { confidence: span >= YEAR_DAYS ? "medium" : "low", everyYears: /車検/u.test(sorted[0]?.r.merchant ?? "") ? 2 : 1 };
      else if (!NOT_ANNUAL.includes(category) && a >= ANNUAL_MIN && span >= YEAR_DAYS) info = { confidence: "medium", everyYears: 1 };
      else if (!NOT_ANNUAL.includes(category) && a >= HIGH_AMOUNT && span < YEAR_DAYS) info = { confidence: "low", everyYears: 1 };
    } else if (hint && gaps.every((g) => g >= 300)) info = { confidence: "medium", everyYears: 1 };
    if (info === undefined) continue;
    for (const w of sorted) {
      w.annual = info;
      w.flags.add(info.confidence === "low" ? "annualUnsure" : "annual");
    }
  }

  // 6. 区分と迷う印
  return work.map((w): ClassifiedRow => {
    const r = w.r;
    const flags = w.flags;
    let bucket: Bucket;
    let bucketSource: ClassifiedRow["bucketSource"] = "auto";
    let share: string | undefined;
    const rule = ruleFor(ctx.log.rules, r, w.category, w.owner, w.allowed);
    if (r.bucket !== undefined && w.allowed.includes(r.bucket)) {
      bucket = r.bucket;
      bucketSource = "fp";
      share = r.bucket === "business" ? r.share : undefined;
    } else {
      if (r.bucket !== undefined) flags.add("bucketNotAllowed");
      if (rule !== undefined) {
        bucket = rule.bucket;
        bucketSource = "rule";
        share = rule.bucket === "business" ? rule.share : undefined;
      } else bucket = autoBucket(w.category, flags);
    }
    if (w.category === null && w.source === null) flags.add("unknownMerchant");
    if (bucketSource === "auto" && bucket === "household" && (w.st.includes("selfEmployed") || w.st.includes("executive")) && BUSINESS_PRONE.includes(w.category)) flags.add("bucketUndecided");
    if (r.amount >= HIGH_AMOUNT && bucket === "household" && !flags.has("annual") && !flags.has("annualUnsure") && !flags.has("cardPaymentKept")) {
      const g = w.category === null ? null : categoryInfo(w.category).group;
      if (g === null || g === "living" || g === "oneOff") flags.add("highAmount");
    }
    let parts: Partial<Record<Bucket, number>> = { [bucket]: r.amount };
    if (bucket === "business" && share !== undefined) {
      const s = splitByShare(r.amount, share);
      if (s !== null) parts = { business: s.business, household: s.household };
    }
    const decided = r.decidedAt !== undefined;
    const reviewFlags = [...flags].filter((f) => REVIEW_FLAGS.includes(f) && (f === "bucketNotAllowed" || !decided));
    const counted = w.counted;
    return {
      importId: w.imp.id,
      row: r,
      account: w.acc,
      owner: w.owner,
      styles: w.st,
      allowed: w.allowed,
      category: w.category,
      categorySource: w.source,
      bucket,
      bucketSource,
      ...(share !== undefined ? { share } : {}),
      parts,
      counted,
      flags: [...flags],
      ...(w.annual !== undefined ? { annual: w.annual } : {}),
      review: counted && reviewFlags.length > 0,
    };
  });
}

/** 自動の区分: 振替・収入・計算で出す税は除外、年会費・一時的な支出・年1回の候補は一時的、ほかは家計 */
function autoBucket(category: StatementCategory | null, flags: Set<Flag>): Bucket {
  if (flags.has("cardPaymentKept")) return "household";
  if (flags.has("cardPaymentExcluded") || flags.has("engineTax")) return "excluded";
  if (category === "transfer" || category === "income") return "excluded";
  if (category === "cardFee" || category === "lumpSum" || flags.has("annual")) return "oneOff";
  return "household";
}
