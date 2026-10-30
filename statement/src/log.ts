// 世帯ファイルに持つ明細の取り込みの記録（本文の区画 statements。世帯ファイルの形式 0.14。0034 の6）。
// - 元のファイルは持たない。持つのは、元のファイルの指紋と大きさ、使った読み手と列の対応付け、取り込んだ行（番号を消した後）、
//   FP が決めたこと（行ごとの項目・区分・割合・持ち主）、世帯の決まり（「この世帯の通信は事業60%」など）、候補を取り込んだ記録
// - 前もってお客さまに印を付けてもらう確認シート（表計算のファイル）の依頼の記録（いつ書き出したか・書き出したファイルの指紋・
//   シートの番号と行の対応・取り込んだか）。シートには世帯の内部ID・取り込みの ID を書かず、番号だけで結ぶ（0034 の9。形式 0.15 から。
//   形式 0.16 から、店ごとにまとめたシートの1行は、同じ番号に複数の行を対応させる）
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
/** 1行に持つ文字の長さの上限（店の名前・メモ・家計簿アプリの分類）。読み込み（readRow）も同じ上限で確かめる */
const MAX_MERCHANT = 200;
const MAX_MEMO = 200;
const MAX_SOURCE_CATEGORY = 60;

/** 文字の数（UTF-16 の長さ）を上限までに切る（サロゲートペアの途中では切らない） */
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** 明細の持ち主の口座・カード（FP が付けた呼び名。カード番号・口座番号は書かない） */
export interface StatementAccount {
  readonly id: string;
  readonly kind: SourceKind;
  /** 例: ご本人のカード（Aカード）・配偶者の給与口座 */
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

/** ファイルの指紋と大きさ（ファイルそのものは持たない） */
export interface FileMark {
  readonly sha256: string;
  readonly bytes: number;
}

/** 確認シートを取り込んだ記録（返ってきたファイルの指紋と、FP が承認して入れた行の数） */
export interface StatementReceipt {
  readonly at: string;
  readonly file: FileMark;
  readonly decided: number;
}

/**
 * 前もってお客さまに印を付けてもらう確認シートの依頼の記録（0034 の9）。シートの行は依頼ごとの番号（1〜）だけを持ち、
 * 番号 → 取り込みの ID と行の ID の対応はここ（暗号化した世帯ファイルの中）にだけ置く
 */
export interface StatementRequest {
  /** 依頼番号（依頼ごとの乱数。M-XXXXXX。シートの管理の値と同じ） */
  readonly id: string;
  /** 書き出した日時 */
  readonly at: string;
  /** 書き出したファイルの指紋と大きさ */
  readonly file: FileMark;
  /**
   * シートの番号 → 取り込みの ID と行の ID。店ごとにまとめたシートの1行は、同じ番号が並ぶ（形式 0.16 から）。
   * 同じ取り込みの同じ行は1回だけ
   */
  readonly rows: readonly { readonly no: number; readonly import: string; readonly row: string }[];
  /** 取り込んだ記録（まだなら空） */
  readonly received: readonly StatementReceipt[];
}

/** 残す依頼の記録の数（古いものから外す） */
export const MAX_REQUESTS = 20;
/** 1つの依頼に載せるシートの行の上限（番号の上限） */
export const MAX_REQUEST_ROWS = 500;
/** 1つの依頼の行の対応（明細の行）の上限（店ごとにまとめた行は、明細の行の数だけ対応を持つ） */
export const MAX_REQUEST_ENTRIES = 5000;

export interface StatementLog {
  readonly version: number;
  readonly accounts: readonly StatementAccount[];
  readonly imports: readonly StatementImport[];
  readonly rules: readonly HouseholdRule[];
  /** 構成員ごとに FP が選んだ働き方（無ければ働き方の期間から） */
  readonly styles?: Readonly<Record<string, readonly WorkStyle[]>>;
  readonly applied: readonly StatementApplication[];
  /** 確認シートの依頼の記録（形式 0.15 から。書き出していなければ無い） */
  readonly requests?: readonly StatementRequest[];
}

/** 依頼の記録を足す（同じ依頼番号は置き換え、古いものから MAX_REQUESTS を超えた分を外す） */
export function addRequest(log: StatementLog, r: StatementRequest): StatementLog {
  const list = [...(log.requests ?? []).filter((x) => x.id !== r.id), r].slice(-MAX_REQUESTS);
  return { ...log, requests: list };
}

/** 取り込んだ記録を依頼に足す（依頼が無ければそのまま） */
export function addReceipt(log: StatementLog, requestId: string, receipt: StatementReceipt): StatementLog {
  if (!(log.requests ?? []).some((r) => r.id === requestId)) return log;
  return { ...log, requests: (log.requests ?? []).map((r) => (r.id === requestId ? { ...r, received: [...r.received, receipt] } : r)) };
}

export const emptyLog = (): StatementLog => ({ version: STATEMENT_LOG_VERSION, accounts: [], imports: [], rules: [], applied: [] });

/** 読んだ結果から取り込みの記録を作る（同じファイルをもう取り込んでいれば null） */
export function createImport(log: StatementLog, out: Extract<ReadOutcome, { ok: true }>, o: { id: string; account: string; at: string; period?: { from: string; to: string } }): StatementImport | null {
  if (log.imports.some((i) => i.file.sha256 === out.file.sha256)) return null;
  // 長い欄は保存の上限で切る（切らずに持つと、開き直したときの読み込みで行ごと・欄ごと捨てられるため）。店の鍵は切った後の名前から作る（読み込みと同じ）
  const rows: StatementRow[] = out.rows.map((r) => {
    const merchant = cut(r.merchant, MAX_MERCHANT);
    return {
      ...r,
      merchant,
      ...(r.memo !== undefined ? { memo: cut(r.memo, MAX_MEMO) } : {}),
      ...(r.sourceCategory !== undefined ? { sourceCategory: cut(r.sourceCategory, MAX_SOURCE_CATEGORY) } : {}),
      id: `r${r.line}`,
      key: merchantKey(merchant),
    };
  });
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
  if (!isObj(v) || !str(v.id, 40) || !Number.isInteger(v.line) || !str(v.date) || !DATE.test(v.date) || !str(v.merchant, MAX_MERCHANT) || !Number.isSafeInteger(v.amount)) return null;
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
    ...(str(v.sourceCategory, MAX_SOURCE_CATEGORY) ? { sourceCategory: v.sourceCategory } : {}),
    ...(v.transfer === true ? { transfer: true as const } : {}),
    ...(str(v.memo, MAX_MEMO) ? { memo: v.memo } : {}),
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
  const requests = (Array.isArray(v.requests) ? v.requests : []).flatMap(readRequest).slice(-MAX_REQUESTS);
  return { version: STATEMENT_LOG_VERSION, accounts, imports, rules, ...(Object.keys(styles).length > 0 ? { styles } : {}), applied, ...(requests.length > 0 ? { requests } : {}) };
}

const SHA = /^sha256:[0-9a-f]{64}$/u;

function readFileMark(v: unknown): FileMark | null {
  return isObj(v) && str(v.sha256, 80) && SHA.test(v.sha256) && Number.isSafeInteger(v.bytes) && (v.bytes as number) >= 0 ? { sha256: v.sha256, bytes: v.bytes as number } : null;
}

function readRequest(v: unknown): StatementRequest[] {
  if (!isObj(v) || !str(v.id, 20) || !/^M-[2-9A-HJ-NP-Z]{6}$/u.test(v.id) || !str(v.at, 40) || !Array.isArray(v.rows) || v.rows.length > MAX_REQUEST_ENTRIES) return [];
  const file = readFileMark(v.file);
  if (file === null) return [];
  // 同じ番号は店ごとにまとめた行（形式 0.16 から）。同じ取り込みの同じ行が2つあれば2つ目を捨てる
  const seen = new Set<string>();
  const rows = v.rows.flatMap((r): StatementRequest["rows"][number][] => {
    if (!isObj(r) || !Number.isInteger(r.no) || (r.no as number) < 1 || (r.no as number) > MAX_REQUEST_ROWS || !str(r.import, 64) || !str(r.row, 40)) return [];
    const k = `${r.import}\u001f${r.row}`;
    if (seen.has(k)) return [];
    seen.add(k);
    return [{ no: r.no as number, import: r.import, row: r.row }];
  });
  const received = (Array.isArray(v.received) ? v.received : []).flatMap((x): StatementReceipt[] => {
    if (!isObj(x) || !str(x.at, 40) || !Number.isInteger(x.decided) || (x.decided as number) < 0) return [];
    const f = readFileMark(x.file);
    return f === null ? [] : [{ at: x.at, file: f, decided: x.decided as number }];
  });
  return [{ id: v.id, at: v.at, file, rows, received }];
}
