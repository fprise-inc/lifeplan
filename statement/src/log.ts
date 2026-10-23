// 世帯ファイルに持つ明細の取り込みの記録（本文の区画 statements。世帯ファイルの形式 0.14。0034 の6）。
// - 元のファイルは持たない。持つのは、元のファイルの指紋と大きさ、使った読み手と列の対応付け、取り込んだ行（番号を消した後）、
//   FP が決めたこと（行ごとの項目・区分・割合・持ち主）、世帯の決まり（「この世帯の通信は事業60%」など）、候補を取り込んだ記録
// - 自動の仕分け（辞書・年1回の検出・カードの引き落とし）の結果は持たない。毎回、行と FP の決めたことから作り直す
//   （辞書が良くなれば、まだ決めていない行の仕分けも良くなる）
import { merchantKey } from "./merchant.ts";
import type { ReadOutcome } from "./readers.ts";
import { COLUMN_ROLES, type ColumnMapping, type ReadRow, type SourceKind } from "./table.ts";
import { isCategory, type StatementCategory } from "./classify/categories.ts";
import type { Bucket, WorkStyle } from "./classify/work.ts";
import type { PaymentPlan } from "./text/values.ts";

export const STATEMENT_LOG_VERSION = 1;
/** 1つの世帯に持つ行の上限（すべての取り込みの合計） */
export const MAX_ROWS_PER_HOUSEHOLD = 50000;

/** 明細の持ち主の口座・カード（FP が付けた呼び名。カード番号・口座番号は書かない） */
export interface StatementAccount {
  readonly id: string;
  readonly kind: SourceKind;
  /** 例: ご主人のカード（Aカード）・奥様の給与口座 */
  readonly label: string;
  /** 持ち主の構成員。共用・分からないときは null（世帯の家計として扱う） */
  readonly owner: string | null;
  /** カードのとき、どのカード会社か（CARD_ISSUERS の id）。銀行の明細の引き落としと結びつけ、二重に数えないために使う */
  readonly issuer?: string;
}

/** 取り込んだ1行（番号を消した後）と、FP が決めたこと */
export interface StatementRow extends ReadRow {
  /** 取り込みの中で一意（行の番号から作る） */
  readonly id: string;
  /** 店の鍵（そろえた形） */
  readonly key: string;
  /** 行の持ち主（家族カードの行を配偶者にする、など。無ければ明細の持ち主） */
  readonly owner?: string;
  /** FP が決めた項目 */
  readonly category?: StatementCategory;
  /** FP が決めた区分 */
  readonly bucket?: Bucket;
  /** 事業の経費の割合（区分が事業のとき。"0.6" など） */
  readonly share?: string;
  /** FP が決めた日時 */
  readonly decidedAt?: string;
}

export interface StatementImport {
  readonly id: string;
  readonly kind: "statement";
  /** 取り込んだ日時 */
  readonly at: string;
  readonly account: string;
  /** 元のファイルの指紋と大きさ（元のファイルは持たない） */
  readonly file: { readonly sha256: string; readonly bytes: number };
  readonly reader: { readonly id: string; readonly version: number };
  /** 列の対応付けと見出しの並びの指紋 */
  readonly format: { readonly fingerprint: string; readonly mapping: ColumnMapping; readonly source: "fp" | "learned" | "guessed" | "reader" };
  /** 明細の期間（使った日の最初と最後。FP が直せる。無ければ行から） */
  readonly period: { readonly from: string; readonly to: string };
  readonly rows: readonly StatementRow[];
  /** 仕分けに使うか（FP が外せる） */
  readonly include: boolean;
}

/** 世帯の決まり（区分・割合）。店の鍵か項目に当てる。持ち主を決めると、その人の行だけに当てる */
export interface HouseholdRule {
  readonly id: string;
  readonly match: { readonly key: string } | { readonly category: StatementCategory };
  readonly owner?: string;
  readonly bucket: Bucket;
  readonly share?: string;
  readonly at: string;
}

/** 候補を取り込んだ記録（値の箱の出どころ origin.ref はこの ID） */
export interface StatementApplication {
  readonly id: string;
  readonly at: string;
  readonly by: "fp";
  /** 使った取り込み */
  readonly imports: readonly string[];
  /** 取り込んだ候補（入力項目IDと対象） */
  readonly items: readonly { readonly candidate: string; readonly item: string; readonly target: unknown }[];
  /** 計算に使った期間（月の数・最初と最後） */
  readonly basis: { readonly from: string; readonly to: string; readonly months: string };
}

export interface StatementLog {
  readonly version: number;
  readonly accounts: readonly StatementAccount[];
  readonly imports: readonly StatementImport[];
  readonly rules: readonly HouseholdRule[];
  /** 構成員ごとに FP が選んだ働き方（無ければ働き方の期間から） */
  readonly styles?: Readonly<Record<string, readonly WorkStyle[]>>;
  readonly applied: readonly StatementApplication[];
}

export const emptyLog = (): StatementLog => ({ version: STATEMENT_LOG_VERSION, accounts: [], imports: [], rules: [], applied: [] });

/** 読んだ結果から取り込みの記録を作る（同じファイルをもう取り込んでいれば null） */
export function createImport(log: StatementLog, out: Extract<ReadOutcome, { ok: true }>, o: { id: string; account: string; at: string; period?: { from: string; to: string } }): StatementImport | null {
  if (log.imports.some((i) => i.file.sha256 === out.file.sha256)) return null;
  const rows: StatementRow[] = out.rows.map((r) => ({ ...r, id: `r${r.line}`, key: merchantKey(r.merchant) }));
  // 同じ行の番号が2つ出たとき（PDF の複数ページなど）は番号を付け直す
  const seen = new Set<string>();
  const fixed = rows.map((r, i) => {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      return r;
    }
    const id = `r${r.line}-${i}`;
    seen.add(id);
    return { ...r, id };
  });
  const dates = fixed.map((r) => r.date).sort();
  const period = o.period ?? { from: dates[0] ?? "", to: dates[dates.length - 1] ?? "" };
  return { id: o.id, kind: "statement", at: o.at, account: o.account, file: out.file, reader: out.reader, format: { fingerprint: out.fingerprint, mapping: out.mapping, source: out.mappingSource }, period, rows: fixed, include: true };
}

// ---- 読み込み（世帯ファイルの本文の区画を信用しない形で読む） ----

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH = /^\d{4}-\d{2}$/u;
const BUCKETS: readonly Bucket[] = ["household", "reimbursable", "business", "company", "oneOff", "excluded"];
const STYLES: readonly WorkStyle[] = ["employee", "selfEmployed", "executive", "none"];

function readPlan(v: unknown): PaymentPlan | undefined {
  if (!isObj(v)) return undefined;
  if (v.kind === "lump" || v.kind === "revolving" || v.kind === "bonus") return { kind: v.kind };
  if (v.kind === "installment" && Number.isInteger(v.count) && (v.count as number) > 1 && (v.count as number) <= 120) {
    return Number.isInteger(v.index) ? { kind: "installment", count: v.count as number, index: v.index as number } : { kind: "installment", count: v.count as number };
  }
  return undefined;
}

function readRow(v: unknown): StatementRow | null {
  if (!isObj(v) || !str(v.id, 40) || !Number.isInteger(v.line) || !str(v.date) || !DATE.test(v.date) || !str(v.merchant, 200) || !Number.isSafeInteger(v.amount)) return null;
  const plan = readPlan(v.plan);
  return {
    id: v.id,
    line: v.line as number,
    date: v.date,
    merchant: v.merchant,
    key: merchantKey(v.merchant),
    amount: v.amount as number,
    ...(v.fromPayment === true ? { fromPayment: true as const } : {}),
    ...(str(v.payMonth) && MONTH.test(v.payMonth) ? { payMonth: v.payMonth } : {}),
    ...(Number.isSafeInteger(v.payAmount) ? { payAmount: v.payAmount as number } : {}),
    ...(plan !== undefined ? { plan } : {}),
    ...(v.cardUser === "self" || v.cardUser === "family" ? { cardUser: v.cardUser } : {}),
    ...(str(v.sourceCategory, 60) ? { sourceCategory: v.sourceCategory } : {}),
    ...(v.transfer === true ? { transfer: true as const } : {}),
    ...(str(v.memo, 200) ? { memo: v.memo } : {}),
    ...(v.yearGuessed === true ? { yearGuessed: true as const } : {}),
    ...(str(v.owner, 64) ? { owner: v.owner } : {}),
    ...(isCategory(v.category) ? { category: v.category } : {}),
    ...((BUCKETS as readonly unknown[]).includes(v.bucket) ? { bucket: v.bucket as Bucket } : {}),
    ...(str(v.share, 8) ? { share: v.share } : {}),
    ...(str(v.decidedAt, 40) ? { decidedAt: v.decidedAt } : {}),
  };
}

function readMapping(v: unknown): ColumnMapping | null {
  if (!isObj(v) || !isObj(v.columns)) return null;
  const columns: Partial<Record<(typeof COLUMN_ROLES)[number], number>> = {};
  for (const r of COLUMN_ROLES) {
    const j = v.columns[r];
    if (Number.isInteger(j) && (j as number) >= 0 && (j as number) < 100) columns[r] = j as number;
  }
  const headerRow = v.headerRow === null ? null : Number.isInteger(v.headerRow) ? (v.headerRow as number) : null;
  return { headerRow, columns, sign: v.sign === "expenseNegative" ? "expenseNegative" : "expensePositive" };
}

/** 本文の区画 statements を読む（形の合わないものは捨てる。読めない区画は空の記録） */
export function readLog(v: unknown): StatementLog {
  if (!isObj(v)) return emptyLog();
  const accounts: StatementAccount[] = (Array.isArray(v.accounts) ? v.accounts : []).flatMap((a): StatementAccount[] =>
    isObj(a) && str(a.id, 64) && (a.kind === "card" || a.kind === "bank" || a.kind === "app") && str(a.label, 60) ? [{ id: a.id, kind: a.kind, label: a.label, owner: str(a.owner, 64) ? a.owner : null, ...(str(a.issuer, 20) ? { issuer: a.issuer } : {}) }] : [],
  );
  let total = 0;
  const imports: StatementImport[] = (Array.isArray(v.imports) ? v.imports : []).flatMap((i): StatementImport[] => {
    if (!isObj(i) || !str(i.id, 64) || !str(i.at, 40) || !str(i.account, 64) || !isObj(i.file) || !str(i.file.sha256, 80) || !Number.isInteger(i.file.bytes)) return [];
    if (!isObj(i.reader) || !str(i.reader.id, 40) || !Number.isInteger(i.reader.version) || !isObj(i.format) || !str(i.format.fingerprint, 80)) return [];
    const mapping = readMapping(i.format.mapping);
    if (mapping === null || !isObj(i.period) || !str(i.period.from) || !str(i.period.to)) return [];
    const rows = (Array.isArray(i.rows) ? i.rows : []).map(readRow).filter((r): r is StatementRow => r !== null);
    total += rows.length;
    if (total > MAX_ROWS_PER_HOUSEHOLD) return [];
    const source = i.format.source === "fp" || i.format.source === "learned" || i.format.source === "reader" ? i.format.source : "guessed";
    return [{ id: i.id, kind: "statement", at: i.at, account: i.account, file: { sha256: i.file.sha256, bytes: i.file.bytes as number }, reader: { id: i.reader.id, version: i.reader.version as number }, format: { fingerprint: i.format.fingerprint, mapping, source }, period: { from: i.period.from, to: i.period.to }, rows, include: i.include !== false }];
  });
  const rules: HouseholdRule[] = (Array.isArray(v.rules) ? v.rules : []).flatMap((r): HouseholdRule[] => {
    if (!isObj(r) || !str(r.id, 64) || !isObj(r.match) || !(BUCKETS as readonly unknown[]).includes(r.bucket) || !str(r.at, 40)) return [];
    const match = str(r.match.key, 64) ? { key: r.match.key } : isCategory(r.match.category) ? { category: r.match.category } : null;
    if (match === null) return [];
    return [{ id: r.id, match, ...(str(r.owner, 64) ? { owner: r.owner } : {}), bucket: r.bucket as Bucket, ...(str(r.share, 8) ? { share: r.share } : {}), at: r.at }];
  });
  const styles: Record<string, WorkStyle[]> = {};
  if (isObj(v.styles)) for (const [k, s] of Object.entries(v.styles)) if (Array.isArray(s)) styles[k] = s.filter((x): x is WorkStyle => (STYLES as readonly unknown[]).includes(x));
  const applied: StatementApplication[] = (Array.isArray(v.applied) ? v.applied : []).flatMap((a): StatementApplication[] =>
    isObj(a) && str(a.id, 64) && str(a.at, 40) && Array.isArray(a.imports) && Array.isArray(a.items) && isObj(a.basis)
      ? [{ id: a.id, at: a.at, by: "fp", imports: a.imports.filter((x): x is string => str(x, 64)), items: a.items.filter(isObj).map((x) => ({ candidate: String(x.candidate), item: String(x.item), target: x.target })), basis: { from: String(a.basis.from), to: String(a.basis.to), months: String(a.basis.months) } }]
      : [],
  );
  return { version: STATEMENT_LOG_VERSION, accounts, imports, rules, ...(Object.keys(styles).length > 0 ? { styles } : {}), applied };
}
