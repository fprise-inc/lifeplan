// 迷う行の一覧と、FP が決めたことの反映・学習（0034 の9・4）。
// - ヒアリングの画面は reviewList の一覧を見せ、FP（とお客さま）が項目・区分・割合・持ち主を決める
// - 決めたことは取り込みの記録の行に書く（applyDecisions）。項目を直したら、店の鍵で覚える辞書の行を作る（learnFromDecisions。事務所データへ）
// - 「この店（項目）はいつも事業60%」のような決まりは世帯の決まり（rules）にする（addRule）。区分・割合は世帯ごとに違うので事務所の辞書には入れない
import { FLAG_LABELS, REVIEW_FLAGS, type ClassifiedRow, type Flag } from "./classify/classify.ts";
import type { StatementCategory } from "./classify/categories.ts";
import { learnEntry, officeIndex, type DictionaryEntry } from "./classify/dictionary.ts";
import { parseShare, type Bucket } from "./classify/work.ts";
import type { HouseholdRule, StatementLog, StatementRow } from "./log.ts";

export interface ReviewItem {
  readonly importId: string;
  readonly rowId: string;
  readonly date: string;
  readonly merchant: string;
  readonly key: string;
  readonly amount: number;
  readonly account: string;
  readonly owner: string | null;
  readonly category: StatementCategory | null;
  readonly bucket: Bucket;
  readonly allowed: readonly Bucket[];
  readonly reasons: readonly Flag[];
  readonly reasonText: string;
}

/** 印の重さ（一覧の並びに使う） */
const PRIORITY: Record<Flag, number> = {
  bucketNotAllowed: 0,
  cardPaymentKept: 1,
  highAmount: 2,
  annualUnsure: 3,
  unknownMerchant: 4,
  bucketUndecided: 5,
  refundUnmatched: 6,
  revolving: 7,
  annual: 9,
  cardPaymentExcluded: 9,
  duplicate: 9,
  refund: 9,
  familyCard: 9,
  engineTax: 9,
};

/** 迷う行の一覧（重い印から、同じ重さなら金額の大きい順） */
export function reviewList(rows: readonly ClassifiedRow[]): ReviewItem[] {
  return rows
    .filter((r) => r.review)
    .map((r): ReviewItem => {
      const reasons = r.flags.filter((f) => REVIEW_FLAGS.includes(f)).sort((a, b) => PRIORITY[a] - PRIORITY[b]);
      return {
        importId: r.importId,
        rowId: r.row.id,
        date: r.row.date,
        merchant: r.row.merchant,
        key: r.row.key,
        amount: r.row.amount,
        account: r.account.id,
        owner: r.owner,
        category: r.category,
        bucket: r.bucket,
        allowed: r.allowed,
        reasons,
        reasonText: reasons.map((f) => FLAG_LABELS[f]).join("・"),
      };
    })
    .sort((a, b) => PRIORITY[a.reasons[0] as Flag] - PRIORITY[b.reasons[0] as Flag] || Math.abs(b.amount) - Math.abs(a.amount));
}

/** 辞書で分からない店を、店の鍵ごとにまとめる（同じ店の行を1回で決められるように） */
export function unknownMerchants(rows: readonly ClassifiedRow[]): { key: string; label: string; count: number; total: number; rows: { importId: string; rowId: string }[] }[] {
  const m = new Map<string, { key: string; label: string; count: number; total: number; rows: { importId: string; rowId: string }[] }>();
  for (const r of rows) {
    if (!r.counted || !r.flags.includes("unknownMerchant") || r.row.decidedAt !== undefined) continue;
    const g = m.get(r.row.key) ?? { key: r.row.key, label: r.row.merchant, count: 0, total: 0, rows: [] };
    g.count++;
    g.total += r.row.amount;
    g.rows.push({ importId: r.importId, rowId: r.row.id });
    m.set(r.row.key, g);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/** FP が決めたこと（1行ぶん。決めない欄は省く。null は「決めたことを取り消す」） */
export interface RowDecision {
  readonly importId: string;
  readonly rowId: string;
  readonly category?: StatementCategory | null;
  readonly bucket?: Bucket | null;
  readonly share?: string | null;
  readonly owner?: string | null;
}

export class DecisionError extends Error {}

/** 決めたことを取り込みの記録の行に書く（区分が事業のときの割合は 0〜1 の10進の文字列。読めなければ止める） */
export function applyDecisions(log: StatementLog, decisions: readonly RowDecision[], at: string): StatementLog {
  const byRow = new Map(decisions.map((d) => [`${d.importId}\u001f${d.rowId}`, d]));
  for (const d of decisions) {
    if (d.share != null && parseShare(d.share) === null) throw new DecisionError("E_STATEMENT_SHARE");
  }
  return {
    ...log,
    imports: log.imports.map((imp) => ({
      ...imp,
      rows: imp.rows.map((r) => {
        const d = byRow.get(`${imp.id}\u001f${r.id}`);
        if (d === undefined) return r;
        const next: Record<string, unknown> = { ...r };
        for (const k of ["category", "bucket", "share", "owner"] as const) {
          if (!(k in d)) continue;
          const v = d[k];
          if (v === null || v === undefined) delete next[k];
          else next[k] = v;
        }
        if (next.bucket !== "business") delete next.share;
        const any = ["category", "bucket", "owner"].some((k) => next[k] !== undefined);
        if (any) next.decidedAt = at;
        else delete next.decidedAt;
        return next as unknown as StatementRow;
      }),
    })),
  };
}

/** 項目を決めた行から、覚える辞書の行を作る（店の鍵ごとに最後の決めたこと。同梱の辞書と同じ答えなら覚えない） */
export function learnFromDecisions(log: StatementLog, decisions: readonly RowDecision[], office: readonly DictionaryEntry[], at: string, by?: string): DictionaryEntry[] {
  const idx = officeIndex(office);
  const keyOf = new Map<string, string>();
  for (const imp of log.imports) for (const r of imp.rows) keyOf.set(`${imp.id}\u001f${r.id}`, r.key);
  const last = new Map<string, StatementCategory>();
  for (const d of decisions) {
    if (d.category === undefined || d.category === null) continue;
    const key = keyOf.get(`${d.importId}\u001f${d.rowId}`);
    if (key !== undefined && key !== "") last.set(key, d.category);
  }
  const out: DictionaryEntry[] = [];
  for (const [key, category] of last) {
    const e = learnEntry(key, category, at, { office: idx, ...(by !== undefined ? { by } : {}), ...(category === "cardFee" ? { annual: true } : {}) });
    if (e !== null) out.push(e);
  }
  return out;
}

/** 世帯の決まりを足す（同じ当て先・同じ持ち主の決まりは置き換える） */
export function addRule(log: StatementLog, rule: HouseholdRule): StatementLog {
  if (rule.bucket === "business" && rule.share !== undefined && parseShare(rule.share) === null) throw new DecisionError("E_STATEMENT_SHARE");
  const same = (r: HouseholdRule) => JSON.stringify(r.match) === JSON.stringify(rule.match) && r.owner === rule.owner;
  return { ...log, rules: [...log.rules.filter((r) => !same(r)), rule] };
}

export function removeRule(log: StatementLog, id: string): StatementLog {
  return { ...log, rules: log.rules.filter((r) => r.id !== id) };
}
