// 明細の取り込みとヒアリング（0034）を入力のホームにつなぐ部分（作業の層）。読む・仕分ける・数えるは statement/ の部品が PC の中で行い、
// ここは「世帯の記録（区画 statements）を直す」「仕分けた結果を画面の形にする」「承認した候補を現状に入れる」を受け持つ。
// - 明細のファイルのバイト列は読むときだけ使い、世帯にも事務所データにも残さない（残すのは指紋と取り込んだ行。createImport）
// - 明細の値（店の名前・金額）を外へ送る道は作らない。覚える辞書（事務所データ）に送るのは店の鍵と項目だけ（learnFromDecisions）。
//   確認シート（迷う行を前もってお客さまに印を付けてもらう表計算のファイル）は、FP が警告を見てから本体の平文の書き出しの出口で保存する
// - 明細の取り込みの記録は、元に戻す・やり直すの対象にしない（控えと同じ。keepStatements）。候補の承認で入れた現状の値は対象にする
import {
  addReceipt,
  addRequest,
  addRule,
  applyCandidates,
  applyDecisions,
  bucketsOf,
  buildCandidates,
  CATEGORIES,
  classify,
  createEditedReader,
  createImageReader,
  createImport,
  createMarkSheet,
  createPdfScanReader,
  csvReader,
  imageType,
  parseAmount,
  parseDate,
  pdfTextReader,
  planToText,
  totalCheck,
  emptyLog,
  includedImports,
  learnFromDecisions,
  looseKey,
  maskText,
  MAX_ROWS_PER_HOUSEHOLD,
  memberStyles,
  parseShare,
  planMarkSheet,
  readMarkSheet,
  readStatement,
  removeRule,
  reviewList,
  sheetRequestId,
  summarize,
  unknownMerchants,
  workStyleAt,
  type Bucket,
  type ClassifiedRow,
  type ColumnMapping,
  type DictionaryEntry,
  type EditedRow,
  type OcrFn,
  type OcrPage,
  type RasterizeFn,
  type StatementReader,
  type HouseholdLike,
  type HouseholdRule,
  type LearnedFormat,
  type MarkCandidate,
  type MarkSheetResult,
  type OneOffItem,
  type ReadMarkSheetResult,
  type ReadOutcome,
  type ReviewItem,
  type RowDecision,
  type SheetPlan,
  type SourceKind,
  type StatementAccount,
  type StatementApplication,
  type StatementCandidate,
  type StatementCategory,
  type StatementLog,
  type StatementRequest,
  type StatementSummary,
  type WorkStyle,
} from "../../../../statement/src/index.ts";
import type { Household } from "../../engine/types.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { isAdult, memberLabels } from "../input/labels.ts";

export type ReadOk = Extract<ReadOutcome, { ok: true }>;

export const KIND_LABELS: Record<SourceKind, string> = { card: "クレジットカード", bank: "銀行の口座", app: "家計簿アプリ" };

/** 区分のボタンの言葉（お客さまに見せる短い言葉） */
export const BUCKET_BUTTONS: Record<Bucket, string> = {
  household: "家計",
  reimbursable: "立替（会社に請求）",
  business: "事業の経費",
  company: "会社の経費",
  oneOff: "一時的支出",
  excluded: "除外",
};

/** 事業の経費の割合のボタン（％） */
export const SHARE_CHOICES = [100, 80, 60, 50, 30] as const;

/** 選び直せる働き方（働いていないは「どれも選ばない」） */
export const STYLE_CHOICES: readonly Exclude<WorkStyle, "none">[] = ["employee", "selfEmployed", "executive"];

/** 項目のまとまり（ボタンを並べる順） */
export const CATEGORY_GROUPS: readonly { readonly label: string; readonly ids: readonly StatementCategory[] }[] = [
  { label: "基本生活費", ids: CATEGORIES.filter((c) => c.group === "living").map((c) => c.id) },
  { label: "住居・教育・保険・車・税", ids: ["housing", "education", "insurance", "car", "tax"] },
  { label: "一時的支出", ids: ["lumpSum", "cardFee"] },
  { label: "数えないもの", ids: ["transfer", "income"] },
];

/** 項目の短い言葉（ボタン用。括弧の説明を外す） */
export function categoryShort(id: StatementCategory): string {
  const c = CATEGORIES.find((x) => x.id === id);
  return (c?.label ?? id).replace(/（.*）$/u, "");
}

// ---- 世帯の記録 ----

export function logOf(wh: WorkingHousehold): StatementLog {
  return wh.statements ?? emptyLog();
}

const isEmpty = (l: StatementLog) => l.accounts.length === 0 && l.imports.length === 0 && l.rules.length === 0 && l.applied.length === 0 && (l.styles === undefined || Object.keys(l.styles).length === 0) && (l.requests ?? []).length === 0;

/** 記録を入れた世帯（空なら区画ごと外す） */
export function withLog(wh: WorkingHousehold, log: StatementLog): WorkingHousehold {
  if (isEmpty(log)) {
    if (wh.statements === undefined) return wh;
    const { statements: _s, ...rest } = wh;
    void _s;
    return rest;
  }
  return { ...wh, statements: log };
}

/** 元に戻す・やり直すで、明細の取り込みの記録は今のものを持ち越す（控えの keepSnapshots と同じ考え方） */
export function keepStatements(next: WorkingHousehold, cur: WorkingHousehold): WorkingHousehold {
  if (next.statements === cur.statements) return next;
  if (cur.statements === undefined) {
    const { statements: _s, ...rest } = next;
    void _s;
    return rest;
  }
  return { ...next, statements: cur.statements };
}

// ---- 口座・カード ----

export interface AccountDraft {
  kind: SourceKind;
  label: string;
  owner: string | null;
  issuer?: string;
}

/** 呼び名の問題（空・長すぎる・番号らしき数字）。問題が無ければ null */
export function accountLabelProblem(label: string): string | null {
  const t = label.trim();
  if (t === "") return "呼び名を入れてください（例: ご本人のカード）";
  if (t.length > 60) return "呼び名は60文字までにしてください";
  if (maskText(t).masked || /\d{4,}/u.test(t)) return "カード番号・口座番号は書かないでください（呼び名だけにします）";
  return null;
}

export function addAccount(log: StatementLog, d: AccountDraft, id: string): StatementLog {
  const a: StatementAccount = { id, kind: d.kind, label: d.label.trim(), owner: d.owner, ...(d.kind === "card" && d.issuer !== undefined && d.issuer !== "" ? { issuer: d.issuer } : {}) };
  return { ...log, accounts: [...log.accounts, a] };
}

export function updateAccount(log: StatementLog, id: string, d: AccountDraft): StatementLog {
  return {
    ...log,
    accounts: log.accounts.map((a) => (a.id !== id ? a : { id, kind: a.kind, label: d.label.trim(), owner: d.owner, ...(a.kind === "card" && d.issuer !== undefined && d.issuer !== "" ? { issuer: d.issuer } : {}) })),
  };
}

/** 口座・カードを外す（その明細の取り込みもいっしょに外す） */
export function removeAccount(log: StatementLog, id: string): StatementLog {
  return { ...log, accounts: log.accounts.filter((a) => a.id !== id), imports: log.imports.filter((i) => i.account !== id) };
}

/** 持ち主に選べる構成員（本人・配偶者） */
export function ownerOptions(wh: WorkingHousehold): { value: string; label: string }[] {
  const labels = memberLabels(wh);
  return wh.request.input.household.members.filter(isAdult).map((m) => ({ value: m.id, label: labels.get(m.id) ?? "ご家族" }));
}

// ---- 読む・取り込む ----

/** 明細のファイルを読む（PC の中だけ。番号らしき数字は読んだ時点で消える）。readers を渡すと、写真・スクショ・画像だけの PDF も読む */
export function readFile(bytes: Uint8Array, kind: SourceKind, formats: readonly LearnedFormat[], mapping?: ColumnMapping, year?: number, readers?: readonly StatementReader[]): Promise<ReadOutcome> {
  return readStatement(bytes, { kind, formats, ...(mapping !== undefined ? { mapping } : {}), ...(year !== undefined ? { yearHint: year } : {}), ...(readers !== undefined ? { readers } : {}) });
}

/**
 * 明細の読み手（CSV・文字の入った PDF に、写真・スクショ・画像だけの PDF を足す。0034 の段階3）。文字を読むのは本体の OS の文字認識。
 * 同じ画像・同じ PDF は、パネルを開いている間は1回だけ読む（年・列の対応付けを選び直しても読み直さない）。結果はパネルの外に残さない
 */
export function statementReaders(ocr: OcrFn, rasterize: RasterizeFn): StatementReader[] {
  const pages = new WeakMap<Uint8Array, Promise<OcrPage>>();
  const once: OcrFn = (b) => {
    let p = pages.get(b);
    if (p === undefined) {
      p = ocr(b);
      pages.set(b, p);
      p.catch(() => pages.delete(b));
    }
    return p;
  };
  const drawn = new WeakMap<Uint8Array, ReturnType<RasterizeFn>>();
  const draw: RasterizeFn = (pdf, max) => {
    let p = drawn.get(pdf);
    if (p === undefined) {
      p = rasterize(pdf, max);
      drawn.set(pdf, p);
      p.catch(() => drawn.delete(pdf));
    }
    return p;
  };
  return [pdfTextReader, createPdfScanReader(once, draw), createImageReader(once), csvReader];
}

/** 写真・スクショ・画像だけの PDF から読んだ明細か（画像の横で行を直す） */
export const isImageRead = (out: ReadOk): boolean => out.reader.id === "image" || out.reader.id === "pdfScan";

/** 写真・スクショのファイルか（何枚か選べるのは画像だけ） */
export const isImageFile = (b: Uint8Array): boolean => imageType(b) !== null;

/** 画像の横で直す1行（入力の欄の文字のまま持つ） */
export interface EditRow {
  /** 画面の行の鍵（足した行は新しい番号） */
  readonly key: string;
  /** 元の行の番号（足した行は 100000 から） */
  readonly line: number;
  readonly date: string;
  readonly merchant: string;
  readonly amount: string;
  readonly plan: string;
  /** まだ確かめていない「読み取りが不確か」の行 */
  readonly uncertain: boolean;
  /** 「読み取りが不確か」の理由の短い文（残高と合わない・明細の合計と合わない。画面に出すだけで、世帯ファイルには残さない） */
  readonly why?: string;
}

/** 読んだ行を、直す表の行にする */
export function editRowsOf(out: ReadOk): EditRow[] {
  const why = new Map((out.uncertainReasons ?? []).map((x) => [x.line, x.text]));
  return out.rows.map((r, i) => {
    const w = r.readUncertain === true ? why.get(r.line) : undefined;
    return { key: `r${r.line}-${i}`, line: r.line, date: r.date, merchant: r.merchant, amount: String(r.amount), plan: planToText(r.plan), uncertain: r.readUncertain === true, ...(w !== undefined ? { why: w } : {}) };
  });
}

/** 明細の合計と読んだ行の和が合わないときの、「読み取りが不確か」の理由 */
export const TOTAL_MISMATCH_WHY = "明細の合計と、読んだ行の和が合いません（どの行かは分からないため、全部の行に印を付けています）";

/**
 * 明細の合計と読んだ行の和が合わないとき、その画像（まとめて読んだ何枚かの画像は全部）から読んだ全部の行を「読み取りが不確か」にする。
 * 合計が合う・合計が読めない・銀行の明細（合計は残高なので見ない）は今のまま。何枚かのスクショの重なりは2回足さない（totalCheck）。
 * 読んだときに1回だけ付ける（直している間に付け直さない）。印の外し方は今の不確かな行と同じ（「確かめた」・直す）。
 * only を渡すと、その番号の画像の行だけに付ける（1枚を読み直したとき。ほかの画像の確かめた行はそのまま）
 */
export function markTotalMismatch<T extends { readonly out: ReadOk; readonly rows: readonly EditRow[] | null }>(items: readonly T[], kind: SourceKind, only?: number): { items: T[]; marked: boolean } {
  const images = items.filter((it): it is T & { rows: readonly EditRow[] } => it.rows !== null);
  const check = editTotalCheck(images, kind);
  if (check === null || check.ok) return { items: [...items], marked: false };
  return {
    items: items.map((it, i) => (it.rows === null || (only !== undefined && i !== only) ? it : { ...it, rows: it.rows.map((r) => ({ ...r, uncertain: true, why: r.why ?? TOTAL_MISMATCH_WHY })) })),
    marked: true,
  };
}

/** 足す行 */
export function newEditRow(rows: readonly EditRow[], date: string): EditRow {
  const line = Math.max(99999, ...rows.map((r) => r.line)) + 1;
  return { key: `add-${line}`, line, date, merchant: "", amount: "", plan: "", uncertain: false };
}

/** 直す表の1行の問題（日付・金額が読めない、店の名前が空）。問題が無ければ null */
export function editRowProblem(r: EditRow): string | null {
  if (parseDate(r.date) === null) return "日付を 2026-10-01 の形で入れてください";
  if (r.merchant.trim() === "") return "店の名前を入れてください";
  if (parseAmount(r.amount) === null) return "金額を数で入れてください（返品は -1,234）";
  return null;
}

/** 直した行を、今の取り込みの流れに通す形にする（問題のある行があれば null） */
export function editedRows(rows: readonly EditRow[]): EditedRow[] | null {
  if (rows.some((r) => editRowProblem(r) !== null)) return null;
  return rows.map((r) => ({ line: r.line, date: (parseDate(r.date) as { date: string }).date, merchant: r.merchant.trim(), amount: parseAmount(r.amount) as number, plan: r.plan, ...(r.uncertain ? { uncertain: true } : {}) }));
}

/**
 * 直した行を、もう一度今の取り込みの流れ（readStatement）に通す。番号はそこでもう一度消える。指紋は元の画像（PDF）のもの。
 * 読み手の id・版は読んだときのまま
 */
export function readEdited(bytes: Uint8Array, out: ReadOk, rows: readonly EditedRow[], kind: SourceKind): Promise<ReadOutcome> {
  return readStatement(bytes, { kind, readers: [createEditedReader(out.reader, rows)] });
}

/** 明細の合計と、直した行の和の照らし合わせ（何枚かのスクショは重なりを2回足さない）。合計が書かれていなければ null */
export function editTotalCheck(items: readonly { readonly out: ReadOk; readonly rows: readonly EditRow[] }[], kind: SourceKind): ReturnType<typeof totalCheck> {
  return totalCheck(
    items.map((it) => ({
      totals: it.out.ocr?.totals ?? [],
      rows: it.rows.flatMap((r) => {
        const d = parseDate(r.date);
        const a = parseAmount(r.amount);
        return d === null || a === null ? [] : [{ date: d.date, merchant: r.merchant, amount: a }];
      }),
    })),
    kind,
  );
}

/**
 * 明細を読む（年の書かれていない日付だけの明細は、年を選んでいなければ推定の年で読み直す。選んだ年は yearless.year に入る）。
 * FP は画面で年を選び直せる（yearChoices）
 */
export async function readFileWithYear(bytes: Uint8Array, kind: SourceKind, formats: readonly LearnedFormat[], mapping?: ColumnMapping, year?: number, readers?: readonly StatementReader[]): Promise<ReadOutcome> {
  const out = await readFile(bytes, kind, formats, mapping, year, readers);
  if (!out.ok || out.yearless === undefined || out.yearless.year !== undefined) return out;
  return readFile(bytes, kind, formats, mapping, out.yearless.suggested, readers);
}

/** 年の書かれていない明細で選べる年（推定の年の翌年から10年前まで。新しい順） */
export function yearChoices(suggested: number): { value: number; label: string }[] {
  return Array.from({ length: 12 }, (_, i) => suggested + 1 - i).map((y) => ({ value: y, label: `${y}年${y === suggested ? "（推定）" : ""}` }));
}

/** 覚える形（FP が確かめた・選び直した対応付け。読み手が決めた形・覚えた形のままなら覚えない） */
export function formatToLearn(out: ReadOk, kind: SourceKind, at: string): LearnedFormat | null {
  if (out.mappingSource !== "fp" && out.mappingSource !== "guessed") return null;
  if (out.rows.length === 0) return null;
  return { fingerprint: out.fingerprint, kind, mapping: out.mapping, at };
}

export type AddImportResult = { ok: true; log: StatementLog; rows: number } | { ok: false; reason: "duplicate" | "noRows" | "period" | "tooMany" };

/**
 * 読んだ明細を取り込む（同じファイルは2回取り込まない）。1つの世帯の行の上限（すべての取り込みの合計）を超えるなら取り込まない
 * （開き直したときの読み込みが、上限を超えた分の取り込みを丸ごと捨てるため）
 */
export function addImport(log: StatementLog, out: ReadOk, o: { id: string; account: string; at: string; period?: { from: string; to: string } }): AddImportResult {
  if (out.rows.length === 0) return { ok: false, reason: "noRows" };
  if (o.period !== undefined && periodProblem(o.period, rowsSpan(out)) !== null) return { ok: false, reason: "period" };
  const imp = createImport(log, out, o);
  if (imp === null) return { ok: false, reason: "duplicate" };
  if (log.imports.reduce((n, i) => n + i.rows.length, 0) + imp.rows.length > MAX_ROWS_PER_HOUSEHOLD) return { ok: false, reason: "tooMany" };
  return { ok: true, log: { ...log, imports: [...log.imports, imp] }, rows: imp.rows.length };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * 期間の問題（形・順番、行の使った日を含むか）。問題が無ければ null。
 * 期間は明細の行の使った日の最初と最後を含める（狭くすると、期間の外の行も合計に入ったまま狭い日数で割るので、月平均が多く出る）。
 * 広げるのはよい（12か月分の明細を、明細の初日・末日にする）
 */
export function periodProblem(p: { from: string; to: string }, span?: { from: string; to: string } | null): string | null {
  if (!DATE.test(p.from) || !DATE.test(p.to) || Number.isNaN(Date.parse(p.from)) || Number.isNaN(Date.parse(p.to))) return "日付を入れてください";
  if (p.from > p.to) return "始めの日が終わりの日より後になっています";
  if (span != null && (p.from > span.from || p.to < span.to)) return `期間は、使った日の最初（${span.from.replace(/-/gu, "/")}）から最後（${span.to.replace(/-/gu, "/")}）までを含めてください（狭くすると、月平均が多く出ます）`;
  return null;
}

/** 取り込んだ明細の行の使った日の最初と最後 */
function importSpan(log: StatementLog, importId: string): { from: string; to: string } | null {
  const d = (log.imports.find((i) => i.id === importId)?.rows ?? []).map((r) => r.date).sort();
  return d.length === 0 ? null : { from: d[0] as string, to: d[d.length - 1] as string };
}

/** 取り込んだ明細の期間を直すときの問題（periodProblem と同じ。行の使った日を含むか） */
export function importPeriodProblem(log: StatementLog, importId: string, period: { from: string; to: string }): string | null {
  return periodProblem(period, importSpan(log, importId));
}

export function setPeriod(log: StatementLog, importId: string, period: { from: string; to: string }): StatementLog {
  if (importPeriodProblem(log, importId, period) !== null) return log;
  return { ...log, imports: log.imports.map((i) => (i.id === importId ? { ...i, period: { from: period.from, to: period.to } } : i)) };
}

export function setInclude(log: StatementLog, importId: string, include: boolean): StatementLog {
  return { ...log, imports: log.imports.map((i) => (i.id === importId ? { ...i, include } : i)) };
}

export function removeImport(log: StatementLog, importId: string): StatementLog {
  return { ...log, imports: log.imports.filter((i) => i.id !== importId) };
}

/** 行の使った日の最初と最後（期間を直すときの目安） */
export function rowsSpan(out: ReadOk): { from: string; to: string } | null {
  const d = out.rows.map((r) => r.date).sort();
  return d.length === 0 ? null : { from: d[0] as string, to: d[d.length - 1] as string };
}

// ---- 仕分け・迷う行・数 ----

export interface Analysis {
  rows: ClassifiedRow[];
  review: ReviewItem[];
  unknown: ReturnType<typeof unknownMerchants>;
  summary: StatementSummary;
}

/** 仕分けて、迷う行と数を出す（毎回、行と FP の決めたことと辞書から作り直す） */
export function analyze(wh: WorkingHousehold, office: readonly DictionaryEntry[]): Analysis {
  const log = logOf(wh);
  const rows = classify({ log, household: wh.request.input.household as unknown as HouseholdLike, baseMonth: wh.request.input.baseMonth, office });
  return { rows, review: reviewList(rows), unknown: unknownMerchants(rows), summary: summarize(log, rows) };
}

/** 迷う行のうち、分からない店のまとめ（unknown）で決めるもの以外 */
export function otherReview(review: readonly ReviewItem[]): ReviewItem[] {
  return review.filter((r) => r.reasons.some((f) => f !== "unknownMerchant"));
}

/** FP が決めた行（取り消せるように一覧に出す） */
export function decidedRows(rows: readonly ClassifiedRow[]): ClassifiedRow[] {
  return rows.filter((r) => r.row.decidedAt !== undefined).sort((a, b) => ((b.row.decidedAt ?? "") < (a.row.decidedAt ?? "") ? -1 : 1));
}

export interface DecideResult {
  log: StatementLog;
  /** 覚える辞書の行（本体の statement_learn へ。店の鍵と項目だけ） */
  learn: DictionaryEntry[];
}

/** 決めたことを行に書き、覚える辞書の行を作る */
export function decide(log: StatementLog, decisions: readonly RowDecision[], office: readonly DictionaryEntry[], at: string): DecideResult {
  const next = applyDecisions(log, decisions, at);
  return { log: next, learn: learnFromDecisions(next, decisions, office, at) };
}

/** ％（1〜100）を割合の文字列（"0.6" など）に。読めなければ null */
export function shareOfPercent(p: number): string | null {
  if (!Number.isFinite(p) || p <= 0 || p > 100) return null;
  const s = p === 100 ? "1" : (Math.round(p * 100) / 10000).toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
  return parseShare(s) === null ? null : s;
}

/** 割合の文字列を％の文字に（"0.6" → "60%"） */
export function percentText(share: string | undefined): string {
  if (share === undefined) return "";
  const r = parseShare(share);
  if (r === null) return "";
  return `${Math.round((Number(r.num) / Number(r.den)) * 1000) / 10}%`;
}

/** 世帯の決まりを足す */
export function putRule(log: StatementLog, r: Omit<HouseholdRule, "id" | "at">, id: string, at: string): StatementLog {
  const { share, ...base } = r;
  return addRule(log, { ...base, id, at, ...(r.bucket === "business" && share !== undefined ? { share } : {}) });
}

export { removeRule };

// ---- 働き方 ----

export interface StyleRow {
  member: string;
  label: string;
  /** 今使っている働き方 */
  styles: WorkStyle[];
  /** 働き方の期間から出した働き方 */
  fromPeriods: WorkStyle[];
  /** FP が選び直したか */
  chosen: boolean;
  /** 選べる区分 */
  buckets: Bucket[];
}

export function styleRows(wh: WorkingHousehold): StyleRow[] {
  const log = logOf(wh);
  const h = wh.request.input.household as unknown as HouseholdLike;
  const month = wh.request.input.baseMonth;
  const cur = memberStyles(h, month, log.styles);
  const labels = memberLabels(wh);
  return (wh.request.input.household as Household).members.filter(isAdult).map((m) => {
    const styles = cur.get(m.id) ?? ["none"];
    return { member: m.id, label: labels.get(m.id) ?? "ご家族", styles, fromPeriods: workStyleAt(h, m.id, month), chosen: log.styles?.[m.id] !== undefined, buckets: bucketsOf(styles) };
  });
}

/** 働き方を選び直す（null は働き方の期間に戻す。空の組は「働いていない」） */
export function setStyles(log: StatementLog, member: string, styles: readonly WorkStyle[] | null): StatementLog {
  const all: Record<string, readonly WorkStyle[]> = { ...(log.styles ?? {}) };
  if (styles === null) delete all[member];
  else all[member] = styles.length === 0 ? ["none"] : [...styles];
  const { styles: _old, ...rest } = log;
  void _old;
  return Object.keys(all).length === 0 ? rest : { ...rest, styles: all };
}

// ---- 候補と承認 ----

type BoxLike = { value?: number; origin?: { kind?: string } } | null | undefined;
const sameBox = (a: BoxLike, b: BoxLike) => a?.value === b?.value && a?.origin?.kind === "import" && b?.origin?.kind === "import";

/** 生活費の候補が今の値と同じか（承認した後にもう一度出さない） */
function sameAsNow(c: StatementCandidate): boolean {
  if (c.collection !== "livingExpenses" || c.op !== "set") return false;
  if (c.item === "livingExpense.monthly") return sameBox(c.before as BoxLike, c.value as BoxLike);
  const now = (c.before ?? []) as { category: string; monthly: BoxLike }[];
  const next = c.value as { category: string; monthly: BoxLike }[];
  return now.length === next.length && next.every((x) => now.some((y) => y.category === x.category && (y.monthly?.value === x.monthly?.value)));
}

type PeriodicLike = { id: string; label?: string; everyYears?: number; amount?: BoxLike };

/** 承認して入れた名前を付けた支出（取り込んだ記録 applied の対象のうち、今も世帯にあるもの） */
function approvedPeriodics(wh: WorkingHousehold): PeriodicLike[] {
  const ids = new Set(
    logOf(wh)
      .applied.flatMap((a) => a.items)
      .filter((i) => i.item === "periodicExpense.amount")
      .map((i) => (i.target as { object?: unknown } | null)?.object)
      .filter((x): x is string => typeof x === "string"),
  );
  if (ids.size === 0) return [];
  return ((wh.request.input.household as Household).periodicExpenses ?? []).filter((p) => ids.has(p.id)) as PeriodicLike[];
}

/** 名前を付けた支出の候補が、承認して入れたものと同じか（名前・何年に1回・金額が同じ。承認した後にもう一度出さない） */
function sameAsApproved(c: StatementCandidate, approved: readonly PeriodicLike[]): boolean {
  if (c.collection !== "periodicExpenses" || c.op !== "add" || approved.length === 0) return false;
  const v = c.value as PeriodicLike;
  const key = looseKey(v.label ?? "");
  return approved.some((p) => looseKey(p.label ?? "") === key && p.everyYears === v.everyYears && sameBox(p.amount, v.amount));
}

/** 候補（今の値と同じ生活費の候補と、承認して入れたものと同じ名前を付けた支出の候補は出さない） */
export function candidatesOf(wh: WorkingHousehold, summary: StatementSummary, ref: string, newId: () => string): StatementCandidate[] {
  const approved = approvedPeriodics(wh);
  return buildCandidates(summary, wh.request.input.household as never, { ref, baseMonth: wh.request.input.baseMonth, newId }).filter((c) => !sameAsNow(c) && !sameAsApproved(c, approved));
}

/** 変える候補の今の値の文（「今は 月○円」）。足す候補は null */
export function beforeText(c: StatementCandidate): string | null {
  if (c.op !== "set") return null;
  if (c.item === "livingExpense.monthly") {
    const v = (c.before as BoxLike)?.value;
    return v === undefined ? "今は値がありません" : `今は 月${v.toLocaleString("ja-JP")}円`;
  }
  const now = (c.before ?? []) as { monthly: BoxLike }[];
  const total = now.reduce((n, x) => n + (x.monthly?.value ?? 0), 0);
  return now.length === 0 ? "今は内訳がありません" : `今の内訳の合計は 月${total.toLocaleString("ja-JP")}円`;
}

/** 最初にチェックしておく候補（要確認でないもの） */
export function defaultCandidateSelection(list: readonly StatementCandidate[]): Set<string> {
  return new Set(list.filter((c) => c.status === "pending").map((c) => c.id));
}

/** 承認した候補を現状に入れ、取り込んだ記録（applied）を残す。FP がチェックしたものだけを入れる */
export function approve(wh: WorkingHousehold, list: readonly StatementCandidate[], selected: ReadonlySet<string>, summary: StatementSummary, ref: string, at: string): WorkingHousehold {
  const chosen = list.filter((c) => selected.has(c.id));
  if (chosen.length === 0) return wh;
  const household = applyCandidates(wh.request.input.household as never, chosen, selected, at) as unknown as Household;
  const log = logOf(wh);
  const app: StatementApplication = {
    id: ref,
    at,
    by: "fp",
    imports: includedImports(log).map((i) => i.id),
    items: chosen.map((c) => ({ candidate: c.id, item: c.item, target: c.target })),
    basis: { from: summary.from ?? "", to: summary.to ?? "", months: summary.months },
  };
  const next: WorkingHousehold = { ...wh, request: { ...wh.request, input: { ...wh.request.input, household } } };
  return withLog(next, { ...log, applied: [...log.applied, app] });
}

/** 円の表示（1,234円） */
export const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/**
 * 一時的支出の一覧の1行の説明（年1回か・確かさ・年の額）。家電・家具の買い替えの候補（耐久財の店の3万円以上の買い物）は、
 * 年の額（「年○円」）を出さない: 何年かに1回の買い物を明細の期間の年の額に直しても、買い替えの年の額の目安にならないため
 * （年払いの「家電・家具の買い替え」の候補の額は、候補の側で決める。0034 の追記 2026-11-01）
 */
export function oneOffNote(o: OneOffItem): string {
  const when = o.annual !== undefined ? (o.annual.confidence === "low" ? "年1回かは分からない" : o.annual.everyYears === 2 ? "2年に1回" : "年1回") : `${o.occurrences.length}回`;
  const sure = o.annual !== undefined && o.annual.confidence !== "low" ? `（確かさ ${o.annual.confidence === "high" ? "高" : "中"}）` : "";
  return o.durable === true ? `家電・家具の買い替えの候補・${when}${sure}` : `${when}${sure}・年 ${yen(o.perYear)}`;
}

// ---- 確認シート（前もってお客さまに印を付けてもらう表計算のファイル。0034 の9） ----

export interface SheetExportInput {
  /** 依頼番号の乱数（6バイト。本体・画面の暗号の乱数） */
  random: Uint8Array;
  /** 書き出した日時（ISO 8601） */
  at: string;
  appVersion: string;
  /** 表示用の顧客番号（英数字。無くてよい） */
  customerNo?: string;
}

/** 迷う行から確認シートを作る（保存したら withSheetRequest で依頼の記録を残す） */
export function exportMarkSheet(wh: WorkingHousehold, an: Analysis, o: SheetExportInput): Promise<MarkSheetResult> {
  const log = logOf(wh);
  return createMarkSheet({
    items: an.review,
    accounts: new Map(log.accounts.map((a) => [a.id, a.label])),
    owners: new Map(ownerOptions(wh).map((x) => [x.value, x.label])),
    requestId: sheetRequestId(o.random),
    ...(o.customerNo !== undefined ? { customerNo: o.customerNo } : {}),
    exportedAt: o.at,
    appVersion: o.appVersion,
  });
}

/** 確認シートに載せる行（店単位で答えられる同じ店の行は1行にまとめる。書き出す前の行の数・知らせに使う） */
export function sheetPlan(an: Analysis): SheetPlan {
  return planMarkSheet(an.review);
}

/** 依頼で書き出したシートの行の数（まとめた店の行は1と数える）と明細の行の数 */
export function requestSize(r: StatementRequest): { lines: number; rows: number } {
  return { lines: new Set(r.rows.map((x) => x.no)).size, rows: r.rows.length };
}

/** 書き出した依頼の記録を残す（保存したときだけ） */
export function withSheetRequest(log: StatementLog, request: StatementRequest): StatementLog {
  return addRequest(log, request);
}

/** 返ってきた確認シートを読む（開いている世帯の依頼の記録を正にする。印は決めたことの候補にするだけ） */
export function readSheet(bytes: Uint8Array, wh: WorkingHousehold, an: Analysis): Promise<ReadMarkSheetResult> {
  return readMarkSheet(bytes, { log: logOf(wh), rows: an.rows });
}

export type SheetRead = Extract<ReadMarkSheetResult, { ok: true }>;

/** 最初にチェックしておく候補（要確認でないもの）。番号で持つ */
export function defaultMarkSelection(list: readonly MarkCandidate[]): Set<number> {
  return new Set(list.filter((c) => c.status === "pending").map((c) => c.no));
}

/** 承認した印を仕分けに入れ、取り込んだ記録を依頼に残す。FP がチェックしたものだけを入れる（まとめた店の行は、その店の行すべて）。
 * decided は入れた明細の行の数、lines はシートの行の数 */
export function approveMarks(log: StatementLog, read: SheetRead, selected: ReadonlySet<number>, office: readonly DictionaryEntry[], at: string): DecideResult & { decided: number; lines: number } {
  const chosen = read.candidates.filter((c) => selected.has(c.no));
  const decisions = chosen.flatMap((c) => c.decisions);
  const r = decide(log, decisions, office, at);
  return { log: addReceipt(r.log, read.request.id, { at, file: read.file, decided: decisions.length }), learn: r.learn, decided: decisions.length, lines: chosen.length };
}

/** 印の文（「趣味・娯楽・家計」「事業の経費 60%」） */
export function markText(c: MarkCandidate): string {
  const parts: string[] = [];
  if (c.mark.category !== undefined) parts.push(categoryShort(c.mark.category));
  if (c.mark.bucket !== undefined) parts.push(`${BUCKET_BUTTONS[c.mark.bucket]}${c.mark.bucket === "business" && c.mark.share !== undefined ? ` ${percentText(c.mark.share)}` : ""}`);
  return parts.join("・");
}

const dateText = (d: string) => d.replace(/-/gu, "/");

/** シートの行の使った日の文（まとめた店の行は「2025/10/10〜2026/09/10・12回」） */
export function markDateText(c: Pick<MarkCandidate, "kind" | "date" | "to" | "count">): string {
  if (c.kind === "row") return dateText(c.date);
  return `${c.date === c.to ? dateText(c.date) : `${dateText(c.date)}〜${dateText(c.to)}`}・${c.count}回`;
}
