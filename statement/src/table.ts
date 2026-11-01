// 読み手が作る「欄の表」と、列の対応付け（0034 の3）。
// - CSV の読み手も PDF の読み手も、まず欄の表（番号らしき数字を消した後）を作り、同じ列の対応付けで明細の行にする。
//   写真の文字認識（段階3）も、欄の表を作る読み手として足す
// - 列の対応付け（日付・店の名前・金額・支払い回数…がどの列か）は、見出しの並びの指紋で覚える（初回に FP が選んだものを次から使う）
// - 見出しの言葉から対応付けを推し量る。カード会社ごとの決まった形（プリセット）は、公開された説明が見つかったものだけを足す
import { issue, type Issue } from "./issues.ts";
import { MASK, NUMBER_HEADER } from "./text/mask.ts";
import { looseKey, nfkc } from "./text/normalize.ts";
import { parseAmount, parseDate, parsePlan, parseUser, parseYearMonth, truthy, type PaymentPlan } from "./text/values.ts";

/** 明細の種類: カード・銀行・家計簿アプリ */
export type SourceKind = "card" | "bank" | "app";

/** 欄の表（すべての欄は番号らしき数字を消した後） */
export interface Table {
  readonly cells: readonly (readonly string[])[];
  /** 各行の元のファイルの行（1始まり） */
  readonly lines: readonly number[];
  /** 番号らしき数字を消した欄の数 */
  readonly masked: number;
}

export type ColumnRole =
  | "date"
  | "merchant"
  | "amount"
  | "withdrawal"
  | "deposit"
  | "payAmount"
  | "payMonth"
  | "plan"
  | "installmentCount"
  | "installmentIndex"
  | "user"
  | "category"
  | "subCategory"
  | "memo"
  | "transfer";

export const COLUMN_ROLES: readonly ColumnRole[] = ["date", "merchant", "amount", "withdrawal", "deposit", "payAmount", "payMonth", "plan", "installmentCount", "installmentIndex", "user", "category", "subCategory", "memo", "transfer"];

export const ROLE_LABELS: Record<ColumnRole, string> = {
  date: "使った日",
  merchant: "店の名前（内容・摘要）",
  amount: "金額（使った額）",
  withdrawal: "出金",
  deposit: "入金",
  payAmount: "その月に払う額",
  payMonth: "払う月",
  plan: "支払い方法・回数",
  installmentCount: "分割の回数",
  installmentIndex: "何回目",
  user: "利用者（本人・家族）",
  category: "分類・大項目（家計簿アプリ）",
  subCategory: "中項目（家計簿アプリ）",
  memo: "メモ",
  transfer: "振替の印",
};

/** 列の対応付け */
export interface ColumnMapping {
  /** 見出しの行（表の何行目か。0始まり）。見出しが無い表は null */
  readonly headerRow: number | null;
  readonly columns: Readonly<Partial<Record<ColumnRole, number>>>;
  /** 金額の向き: 支出が正（カード）か負（家計簿アプリに多い） */
  readonly sign: "expensePositive" | "expenseNegative";
}

/** 覚えた形（事務所データに暗号化して持つ。0034 の5） */
export interface LearnedFormat {
  /** 見出しの並びの指紋（sha256:…） */
  readonly fingerprint: string;
  readonly kind: SourceKind;
  readonly mapping: ColumnMapping;
  /** FP が付けた形の呼び名（例: Aカードの CSV）。カード番号などは書かない */
  readonly label?: string;
  readonly at: string;
}

/** 見出しの言葉（NFKC・記号を取った形で比べる）。先に書いたものほど強い */
const HEADER_WORDS: Record<ColumnRole, { readonly exact: readonly string[]; readonly contains: readonly string[] }> = {
  date: { exact: ["利用日", "ご利用日", "利用年月日", "ご利用年月日", "取引日", "お取引日", "日付", "年月日", "購入日", "売上日", "取扱日", "入出金日", "取引年月日", "計上日", "発生日", "DATE"], contains: ["利用日", "取引日", "年月日", "日付"] },
  merchant: { exact: ["利用店名", "ご利用店名", "利用先", "ご利用先", "店名", "加盟店名", "利用店舗", "利用店名商品名", "ご利用店名及び商品名", "内容", "摘要", "お取引内容", "取引内容", "ご利用内容", "利用内容", "支払先", "店舗名", "品名", "DESCRIPTION", "MERCHANT"], contains: ["店名", "利用先", "摘要", "内容", "加盟店"] },
  amount: { exact: ["利用金額", "ご利用金額", "金額", "利用額", "ご利用額", "購入金額", "金額円", "支出", "支出金額", "AMOUNT"], contains: ["利用金額", "利用額", "金額"] },
  withdrawal: { exact: ["出金", "出金金額", "出金額", "お引出し", "お引出", "引出額", "お支払金額", "支払金額", "支払い金額"], contains: ["出金", "引出"] },
  deposit: { exact: ["入金", "入金金額", "入金額", "お預入れ", "お預入", "預入額", "預入金額", "預り金額"], contains: ["入金", "預入"] },
  payAmount: { exact: ["支払金額", "今回支払金額", "お支払金額", "今回お支払金額", "当月支払金額", "支払額", "今回支払額", "当月お支払金額", "請求金額", "今回請求額"], contains: ["支払金額", "支払額", "請求金額", "請求額"] },
  payMonth: { exact: ["支払月", "お支払月", "支払予定月", "請求月", "引落月", "引落日", "支払日", "お支払日", "支払予定日"], contains: ["支払月", "請求月", "引落"] },
  plan: { exact: ["支払区分", "支払方法", "お支払方法", "支払回数", "支払い回数", "回数", "払い方", "支払種別", "お支払区分"], contains: ["支払区分", "支払方法", "支払回数"] },
  installmentCount: { exact: ["分割回数", "分割払回数"], contains: ["分割回数"] },
  installmentIndex: { exact: ["何回目", "支払回", "回目", "今回回数"], contains: ["回目"] },
  user: { exact: ["利用者", "ご利用者", "利用者区分", "本人家族", "カード利用者", "使用者", "ご利用者区分"], contains: ["利用者", "本人家族"] },
  category: { exact: ["大項目", "分類", "カテゴリ", "カテゴリー", "費目", "項目", "大分類"], contains: ["大項目", "カテゴリ", "大分類"] },
  // 家計簿アプリの書き出しの分類の内訳（大項目の下の中項目）。仕分けの手がかりに使う（前はメモとして読んでいた）
  subCategory: { exact: ["中項目", "中分類", "小項目", "小分類", "カテゴリの内訳", "カテゴリー内訳", "内訳", "サブカテゴリ", "サブカテゴリー"], contains: ["中項目", "中分類", "内訳"] },
  memo: { exact: ["メモ", "備考", "MEMO"], contains: ["メモ", "備考"] },
  transfer: { exact: ["振替", "振替フラグ"], contains: ["振替"] },
};

/** 種類ごとに見る役割の順番（銀行は出金・入金、カードは使った額と払う額） */
const ROLE_ORDER: Record<SourceKind, readonly ColumnRole[]> = {
  card: ["date", "merchant", "payAmount", "amount", "payMonth", "plan", "installmentCount", "installmentIndex", "user", "memo"],
  bank: ["date", "merchant", "withdrawal", "deposit", "amount", "memo"],
  app: ["date", "merchant", "amount", "category", "subCategory", "memo", "transfer", "withdrawal", "deposit"],
};

function roleOf(cell: string, role: ColumnRole, contains: boolean): boolean {
  const k = looseKey(cell);
  if (k === "") return false;
  const w = HEADER_WORDS[role];
  return contains ? w.contains.some((x) => k.includes(looseKey(x))) : w.exact.some((x) => looseKey(x) === k);
}

/** 見出しの行の言葉から、対応付けを推し量る */
export function guessFromHeader(header: readonly string[], kind: SourceKind): Partial<Record<ColumnRole, number>> {
  const used = new Set<number>();
  const out: Partial<Record<ColumnRole, number>> = {};
  for (const contains of [false, true]) {
    for (const role of ROLE_ORDER[kind]) {
      if (out[role] !== undefined) continue;
      const i = header.findIndex((c, j) => !used.has(j) && roleOf(c, role, contains));
      if (i >= 0) {
        out[role] = i;
        used.add(i);
      }
    }
  }
  return out;
}

/**
 * 前の版で覚えた形を今の列の役割に合わせる。家計簿アプリの書き出しの中項目の列は、前は見出し「中項目」をメモとして読んでいたので、
 * 覚えた形（推し量った形も覚える）のままだと中項目が読まれない。見出しから中項目の列が分かり、その列がメモか、どの役割にも使っていないときだけ
 * 中項目に付け替える（メモは、見出しから分かる別の列が空いていればその列）。中項目の役割がもう入っている形は変えない
 */
export function upgradeLearnedMapping(m: ColumnMapping, table: Table, kind: SourceKind): ColumnMapping {
  if (kind !== "app" || m.headerRow === null || m.columns.subCategory !== undefined) return m;
  const header = table.cells[m.headerRow];
  if (header === undefined) return m;
  const g = guessFromHeader(header, kind);
  const j = g.subCategory;
  if (j === undefined) return m;
  const owner = COLUMN_ROLES.find((r) => m.columns[r] === j);
  if (owner !== undefined && owner !== "memo") return m;
  const columns: Partial<Record<ColumnRole, number>> = { ...m.columns, subCategory: j };
  if (owner === "memo") {
    delete columns.memo;
    const mj = g.memo;
    if (mj !== undefined && !Object.values(columns).includes(mj)) columns.memo = mj;
  }
  return { ...m, columns };
}

function headerScore(row: readonly string[], kind: SourceKind): number {
  const g = guessFromHeader(row, kind);
  const has = (r: ColumnRole) => g[r] !== undefined;
  if (!has("date")) return 0;
  if (!(has("amount") || has("withdrawal") || has("deposit") || has("payAmount"))) return 0;
  return Object.keys(g).length;
}

/** 見出しの行を探す（最初の30行のうち、見出しの言葉が最も多く当たる行） */
export function findHeaderRow(table: Table, kind: SourceKind): number | null {
  let best: { row: number; score: number } | null = null;
  const n = Math.min(table.cells.length, 30);
  for (let i = 0; i < n; i++) {
    const s = headerScore(table.cells[i] as readonly string[], kind);
    if (s >= 2 && (best === null || s > best.score)) best = { row: i, score: s };
  }
  return best?.row ?? null;
}

const enc = new TextEncoder();

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return `sha256:${[...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** 見出しの並びの指紋（種類＋見出しの言葉をそろえた形の並び）。見出しが無い表は列の数と欄の形から */
export async function headerFingerprint(table: Table, headerRow: number | null, kind: SourceKind): Promise<string> {
  if (headerRow !== null) return sha256(`${kind}\u001e${(table.cells[headerRow] ?? []).map(looseKey).join("\u001f")}`);
  const sample = table.cells.slice(0, 5).map((r) => r.map((c) => (parseDate(c) !== null ? "D" : parseAmount(c) !== null ? "N" : c === "" ? "_" : "T")).join(""));
  return sha256(`${kind}\u001e#nohead\u001e${sample.join("\u001f")}`);
}

/** 見出しの無い表の推し量り: 日付として読める列・金額として読める列・文字の列 */
function guessFromContent(table: Table, kind: SourceKind): Partial<Record<ColumnRole, number>> {
  const rows = table.cells.slice(0, 50);
  const width = Math.max(0, ...rows.map((r) => r.length));
  const ratio = (j: number, f: (c: string) => boolean) => {
    const vals = rows.map((r) => r[j] ?? "").filter((c) => c.trim() !== "");
    return vals.length === 0 ? 0 : vals.filter(f).length / vals.length;
  };
  const out: Partial<Record<ColumnRole, number>> = {};
  for (let j = 0; j < width; j++) if (out.date === undefined && ratio(j, (c) => parseDate(c, 2000) !== null) > 0.8) out.date = j;
  const amounts: number[] = [];
  for (let j = 0; j < width; j++) if (j !== out.date && ratio(j, (c) => parseAmount(c) !== null) > 0.8) amounts.push(j);
  let bestText = -1;
  let bestLen = 0;
  for (let j = 0; j < width; j++) {
    if (j === out.date || amounts.includes(j)) continue;
    const len = rows.reduce((n, r) => n + nfkc(r[j] ?? "").length, 0);
    if (len > bestLen) {
      bestLen = len;
      bestText = j;
    }
  }
  if (bestText >= 0) out.merchant = bestText;
  if (kind === "bank" && amounts.length >= 2) {
    out.withdrawal = amounts[0] as number;
    out.deposit = amounts[1] as number;
  } else if (amounts.length >= 1) out.amount = amounts[0] as number;
  return out;
}

/** 対応付けを推し量る（見出しがあれば見出しの言葉、無ければ欄の形から） */
export function guessMapping(table: Table, kind: SourceKind): ColumnMapping {
  const headerRow = findHeaderRow(table, kind);
  const columns = headerRow !== null ? guessFromHeader(table.cells[headerRow] as readonly string[], kind) : guessFromContent(table, kind);
  return { headerRow, columns, sign: guessSign(table, headerRow, columns, kind) };
}

function guessSign(table: Table, headerRow: number | null, columns: Partial<Record<ColumnRole, number>>, kind: SourceKind): ColumnMapping["sign"] {
  const j = columns.amount;
  if (j === undefined || kind === "card") return "expensePositive";
  const vals = table.cells.slice((headerRow ?? -1) + 1, (headerRow ?? -1) + 201).map((r) => parseAmount(r[j] ?? "")).filter((v): v is number => v !== null && v !== 0);
  if (vals.length === 0) return "expensePositive";
  return vals.filter((v) => v < 0).length / vals.length > 0.6 ? "expenseNegative" : "expensePositive";
}

/** 対応付けの検査（使った日・店の名前・金額のどれかの列が要る。列の番号が表の中にあり、同じ列を2つの役割に使わない） */
export function checkMapping(m: ColumnMapping, width: number): string[] {
  const out: string[] = [];
  const c = m.columns;
  if (c.date === undefined) out.push("使った日の列を選んでください");
  if (c.merchant === undefined) out.push("店の名前（内容・摘要）の列を選んでください");
  if (c.amount === undefined && c.withdrawal === undefined && c.deposit === undefined && c.payAmount === undefined) out.push("金額の列を選んでください");
  const seen = new Map<number, ColumnRole>();
  for (const role of COLUMN_ROLES) {
    const j = c[role];
    if (j === undefined) continue;
    if (!Number.isInteger(j) || j < 0 || j >= width) out.push(`${ROLE_LABELS[role]}の列が表の外です`);
    const prev = seen.get(j);
    if (prev !== undefined) out.push(`${ROLE_LABELS[prev]}と${ROLE_LABELS[role]}に同じ列を選んでいます`);
    seen.set(j, role);
  }
  return out;
}

/** 読み手が返す明細の1行（番号らしき数字は消した後。元の行の文字そのものは持たない） */
export interface ReadRow {
  /** 元のファイルの行（1始まり） */
  readonly line: number;
  /** 使った日（YYYY-MM-DD） */
  readonly date: string;
  /** 店の名前（表示用。番号を消し、振込の相手の名前を外した後） */
  readonly merchant: string;
  /** 金額（円）。支出が正、返品・取り消し・入金が負 */
  readonly amount: number;
  /** 金額が「その月に払う額」から来た（使った額の列が無い） */
  readonly fromPayment?: true;
  readonly payMonth?: string;
  readonly payAmount?: number;
  readonly plan?: PaymentPlan;
  readonly cardUser?: "self" | "family";
  /** 家計簿アプリの分類・大項目（番号を消した後） */
  readonly sourceCategory?: string;
  /** 家計簿アプリの中項目（番号を消した後）。大項目と組で仕分けの手がかりにする */
  readonly sourceSubCategory?: string;
  /** 振替の印（家計簿アプリ） */
  readonly transfer?: true;
  readonly memo?: string;
  /** 年の無い日付を補った */
  readonly yearGuessed?: true;
}

/**
 * 合計・小計などの行（明細ではない）。欄の文字を looseKey でそろえ、文字と数字のほかを外した形で比べる
 * （「【合計】」「合 計」「＜小計＞」「合計（5件）」もそろう。ひらがなはカタカナになる）。
 * - 「合計」「小計」「総計」で終わる（「ご利用合計」「ショッピング合計」「ご本人様ご利用分合計」「ご利用金額合計」。後ろの件数は許す）
 * - 請求・支払の額だけの欄（「ご請求額」「今回ご請求金額」「当月お支払金額」）、残高・繰越の欄
 * 「合計屋 架空店」のように合計の言葉で始まる店の名前は、明細として読む
 */
const TOTAL_KEYS = [
  /^.{0,20}?(?:合計|小計|総計|TOTAL|SUBTOTAL)(?:額|金額)?(?:\d{1,5}件|\d{1,9}円)?$/u,
  /^(?:今回|当月|前回|次回)?[ゴオ]?(?:請求|支払イ?)(?:金)?額$/u,
  /^(?:前回|今回|前日|本日|前月|当月|次月|月末)?(?:繰越)?残高$/u,
  /^(?:前月|次月|前回)?繰越(?:金|額)?$/u,
];

export function isTotalRow(text: string): boolean {
  const k = looseKey(text).replace(/[^\p{L}\p{N}]/gu, "");
  return k !== "" && TOTAL_KEYS.some((re) => re.test(k));
}

/** 振込・送金の相手の名前は残さない（0012。前の言葉だけ残す） */
const TRANSFER_PREFIX = /^(振込|振替|送金|フリコミ|フリカエ|ソウキン|ﾌﾘｺﾐ|ﾌﾘｶｴ|仕送り|PAYPAY送金|ペイペイ送金)(?:[\s:：*＊/／]|$)/iu;

/** 店の名前の欄の後始末（振込の相手の名前を外す） */
export function sanitizeMerchant(kind: SourceKind, text: string): string {
  const s = nfkc(text);
  const m = TRANSFER_PREFIX.exec(s);
  if (m !== null && kind !== "card") return `${m[1] as string}（相手の名前は残しません）`;
  return s;
}

/** 年の無い日付を補う年: 同じ表の年つきの日付のうち一番多い年（無ければ undefined。そのときは外の手がかりの年を使う） */
function inferYear(table: Table, col: number, start: number): number | undefined {
  const counts = new Map<number, number>();
  for (let i = start; i < table.cells.length; i++) {
    const d = parseDate(table.cells[i]?.[col] ?? "");
    if (d !== null) {
      const y = Number(d.date.slice(0, 4));
      counts.set(y, (counts.get(y) ?? 0) + 1);
    }
  }
  let best: number | undefined;
  let n = 0;
  for (const [y, c] of counts) if (c > n) [best, n] = [y, c];
  return best;
}

/** 年の書かれていない日付（月日だけ）の行の数と、いちばん新しい月日 */
export interface Yearless {
  readonly rows: number;
  /** いちばん新しい月日（MM-DD）。月日を1年の輪に並べ、いちばん長い間（使っていない期間）の前の月日（11/05〜02/10 の明細なら 02-10） */
  readonly end: string;
}

/** 年の書かれていない日付の行を数え、いちばん新しい月日を出す（無ければ null） */
export function yearlessDates(table: Table, col: number, start: number): Yearless | null {
  const days = new Set<number>();
  let rows = 0;
  for (let i = start; i < table.cells.length; i++) {
    const raw = table.cells[i]?.[col] ?? "";
    if (parseDate(raw) !== null) continue;
    // うるう年（2000年）で読み、1月1日からの日の番号にする
    const d = parseDate(raw, 2000);
    if (d === null || !d.yearGuessed) continue;
    rows++;
    days.add((Date.parse(`${d.date}T00:00:00Z`) - Date.UTC(2000, 0, 1)) / 86_400_000);
  }
  if (rows === 0) return null;
  const sorted = [...days].sort((a, b) => a - b);
  // いちばん長い間の前の日がいちばん新しい日（輪の切れ目。年をまたがなければ最後の日の後ろの間）
  let endAt = sorted.length - 1;
  let gap = (sorted[0] as number) + 366 - (sorted[endAt] as number);
  for (let k = 0; k < sorted.length - 1; k++) {
    const g = (sorted[k + 1] as number) - (sorted[k] as number);
    if (g > gap) [gap, endAt] = [g, k];
  }
  const end = new Date(Date.UTC(2000, 0, 1) + (sorted[endAt] as number) * 86_400_000).toISOString().slice(5, 10);
  return { rows, end };
}

export interface TableRowsResult {
  readonly rows: ReadRow[];
  readonly issues: Issue[];
  /** 明細として読まなかった行の数（合計の行・空の行など） */
  readonly skipped: number;
  /** 年の書かれていない日付があり、表の中の日付から年を決められなかった（年は外の手がかりの年。無ければ読めない） */
  readonly yearless?: Yearless;
}

/** 欄の表を、列の対応付けで明細の行にする */
export function tableToRows(table: Table, m: ColumnMapping, kind: SourceKind, hint: { readonly year?: number; readonly notAfter?: string } = {}): TableRowsResult {
  const c = m.columns;
  const rows: ReadRow[] = [];
  const issues: Issue[] = [];
  let skipped = 0;
  const start = m.headerRow === null ? 0 : m.headerRow + 1;
  const dateCol = c.date as number;
  const tableYear = inferYear(table, dateCol, start);
  const year = tableYear ?? hint.year;
  // 表の中に年が無い明細（月日だけ）: 外の手がかりの年を、いちばん新しい月日の年として読む。それより後の月日は前の年（11/05〜02/10 の明細の 11/05 は前の年）
  const yearless = tableYear === undefined ? yearlessDates(table, dateCol, start) : null;
  const notAfter = hint.notAfter ?? (yearless !== null && year !== undefined ? `${year}-${yearless.end}` : undefined);
  const cell = (r: readonly string[], role: ColumnRole): string => {
    const j = c[role];
    return j === undefined ? "" : nfkc(r[j] ?? "");
  };
  let missingYear = 0;
  for (let i = start; i < table.cells.length; i++) {
    const r = table.cells[i] as readonly string[];
    const line = table.lines[i] ?? i + 1;
    const merchantRaw = cell(r, "merchant");
    if (isTotalRow(merchantRaw) || isTotalRow(cell(r, "date"))) {
      skipped++;
      continue;
    }
    const dateRaw = cell(r, "date");
    let d = parseDate(dateRaw, year);
    // 年を補った日付が明細の日付より後になるとき（1月の明細の12月の利用など）は前の年
    if (d !== null && d.yearGuessed && notAfter !== undefined && d.date > notAfter && year !== undefined) d = parseDate(dateRaw, year - 1);
    let amount: number | null = null;
    let fromPayment = false;
    const sgn = m.sign === "expenseNegative" ? -1 : 1;
    if (c.amount !== undefined) {
      const a = parseAmount(cell(r, "amount"));
      if (a !== null) amount = a * sgn;
    }
    if (amount === null && (c.withdrawal !== undefined || c.deposit !== undefined)) {
      const w = parseAmount(cell(r, "withdrawal"));
      const dep = parseAmount(cell(r, "deposit"));
      if (w !== null || dep !== null) amount = (w ?? 0) - (dep ?? 0);
    }
    const pay = c.payAmount !== undefined ? parseAmount(cell(r, "payAmount")) : null;
    if (amount === null && pay !== null) {
      amount = pay;
      fromPayment = true;
    }
    if (d === null && amount === null) {
      skipped++;
      continue;
    }
    if (d === null) {
      if (dateRaw !== "" && /^\d{1,2}[/.\-月]\d{1,2}日?$/u.test(dateRaw)) missingYear++;
      else issues.push(issue("warning", "S_ROW_DATE", `使った日が読めない行を飛ばしました（${line}行目）`, line));
      continue;
    }
    if (amount === null) {
      issues.push(issue("warning", "S_ROW_AMOUNT", `金額が読めない行を飛ばしました（${line}行目）`, line));
      continue;
    }
    let plan: PaymentPlan | null = c.plan !== undefined ? parsePlan(cell(r, "plan")) : null;
    if (c.installmentCount !== undefined) {
      const n = Number(cell(r, "installmentCount").replace(/回$/u, ""));
      if (Number.isInteger(n) && n > 1 && n <= 120) {
        const idx = Number(cell(r, "installmentIndex").replace(/回目?$/u, ""));
        plan = Number.isInteger(idx) && idx >= 1 && idx <= n ? { kind: "installment", count: n, index: idx } : { kind: "installment", count: n };
      }
    } else if (plan?.kind === "installment" && plan.index === undefined && c.installmentIndex !== undefined) {
      const idx = Number(cell(r, "installmentIndex").replace(/回目?$/u, ""));
      if (Number.isInteger(idx) && idx >= 1 && idx <= plan.count) plan = { ...plan, index: idx };
    }
    const payMonth = c.payMonth !== undefined ? parseYearMonth(cell(r, "payMonth"), year) : null;
    const user = c.user !== undefined ? parseUser(cell(r, "user")) : null;
    const category = cell(r, "category");
    const subCategory = cell(r, "subCategory");
    const memo = cell(r, "memo");
    rows.push({
      line,
      date: d.date,
      merchant: sanitizeMerchant(kind, merchantRaw),
      amount,
      ...(fromPayment ? { fromPayment: true as const } : {}),
      ...(payMonth !== null ? { payMonth } : {}),
      ...(pay !== null && !fromPayment ? { payAmount: pay } : {}),
      ...(plan !== null ? { plan } : {}),
      ...(user !== null ? { cardUser: user } : {}),
      ...(category !== "" ? { sourceCategory: category } : {}),
      ...(subCategory !== "" ? { sourceSubCategory: subCategory.slice(0, 60) } : {}),
      ...(c.transfer !== undefined && truthy(cell(r, "transfer")) ? { transfer: true as const } : {}),
      ...(memo !== "" ? { memo } : {}),
      ...(d.yearGuessed ? { yearGuessed: true as const } : {}),
    });
  }
  if (missingYear > 0) issues.push(issue("warning", "S_ROW_YEAR", `年の書かれていない日付が ${missingYear} 行あり、年を決められませんでした。明細の年を選んでから読み直してください`));
  if (rows.length === 0) issues.push(issue("error", "S_NO_ROWS", "明細の行を1行も読めませんでした。列の対応付けを確かめてください"));
  return { rows, issues, skipped, ...(yearless !== null ? { yearless } : {}) };
}

/** 列ごと消す列（見出しが口座番号・カード番号など、または全部の行が同じ7桁以上の数字）を消した表にする */
export function maskNumberColumns(cells: string[][], headerRow: number | null): { cells: string[][]; masked: number } {
  const width = Math.max(0, ...cells.map((r) => r.length));
  let masked = 0;
  const kill = new Set<number>();
  for (let j = 0; j < width; j++) {
    const head = headerRow !== null ? (cells[headerRow]?.[j] ?? "") : "";
    if (head !== "" && NUMBER_HEADER.test(nfkc(head)) && !/回数|回目/u.test(head)) kill.add(j);
    const vals = cells.slice(headerRow === null ? 0 : headerRow + 1).map((r) => nfkc(r[j] ?? "")).filter((v) => v !== "");
    if (vals.length >= 2 && vals.every((v) => v === vals[0]) && /^[\d\-\s*]{7,}$/u.test(vals[0] as string) && (vals[0] as string).replace(/\D/gu, "").length >= 7) kill.add(j);
  }
  if (kill.size === 0) return { cells, masked };
  const out = cells.map((r, i) =>
    r.map((v, j) => {
      if (!kill.has(j) || i === headerRow || v.trim() === "") return v;
      masked++;
      return MASK;
    }),
  );
  return { cells: out, masked };
}
