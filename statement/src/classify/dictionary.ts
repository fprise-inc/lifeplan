// 店の名前の辞書（0034 の4）。2層:
//   (a) アプリ同梱の最初の辞書（builtin.ts）
//   (b) FP が直した結果を覚える辞書（事務所データに暗号化して持つ。事務所で共有しているときは共有する。保存は本体の household-store）
// 引き当ての順番: FP がその行で決めた項目 → 覚えた辞書（店の鍵が完全に一致）→ 家計簿アプリの分類 → 同梱の辞書 → 分からない
import { merchantKey } from "../merchant.ts";
import { looseKey } from "../text/normalize.ts";
import { BUILTIN, CARD_ISSUERS, GENERIC_CARD_PAYMENT, type BuiltinFlag } from "./builtin.ts";
import { isCategory, type StatementCategory } from "./categories.ts";

/** 覚えた辞書の1行（事務所データ。店の鍵ごとに1行。消したときは removed を立てて残す＝共有の PC どうしで消したことを伝える） */
export interface DictionaryEntry {
  /** 店の鍵（merchantKey） */
  readonly key: string;
  readonly category: StatementCategory;
  /** 年1回の支払い（保険料・税・車検など）として「一時的」の候補にする */
  readonly annual?: true;
  /** 直した日時（ISO 8601）。共有の PC どうしで同じ鍵があれば新しいほうを使う */
  readonly at: string;
  /** 直した人（事務所の名簿のメンバーID。1人で使うときは無し） */
  readonly by?: string;
  readonly removed?: true;
}

export interface Match {
  readonly category: StatementCategory;
  readonly source: "office" | "sourceCategory" | "builtin";
  readonly flags: readonly BuiltinFlag[];
  /** カード会社への引き落としのとき、どのカード会社か（分からなければ無し） */
  readonly issuer?: string;
}

interface Indexed {
  readonly key: string;
  readonly category: StatementCategory;
  readonly match: "prefix" | "contains" | "exact";
  readonly flags: readonly BuiltinFlag[];
  readonly issuer?: string;
}

let index: Indexed[] | null = null;

function builtinIndex(): Indexed[] {
  if (index === null) {
    const cards: Indexed[] = [
      ...CARD_ISSUERS.flatMap((ci) => ci.patterns.map((p): Indexed => ({ key: merchantKey(p), category: "transfer", match: "prefix", flags: ["cardPayment"], issuer: ci.id }))),
      ...GENERIC_CARD_PAYMENT.map((p): Indexed => ({ key: merchantKey(p), category: "transfer", match: "contains", flags: ["cardPayment"] })),
    ];
    index = [...BUILTIN.map(([p, c, m, f]): Indexed => ({ key: merchantKey(p), category: c, match: m ?? "prefix", flags: f ?? [] })), ...cards].filter((e) => e.key !== "");
  }
  return index;
}

const RANK = { exact: 3, prefix: 2, contains: 1 } as const;

/** 同梱の辞書を引く（カード会社への引き落としの言葉は、銀行の明細のときだけ） */
export function lookupBuiltin(key: string, bank: boolean): Match | null {
  let best: Indexed | null = null;
  for (const e of builtinIndex()) {
    if (e.flags.includes("cardPayment") && !bank) continue;
    const hit = e.match === "exact" ? key === e.key : e.match === "prefix" ? key.startsWith(e.key) : key.includes(e.key);
    if (!hit) continue;
    if (best === null || RANK[e.match] > RANK[best.match] || (RANK[e.match] === RANK[best.match] && e.key.length > best.key.length)) best = e;
  }
  return best === null ? null : { category: best.category, source: "builtin", flags: best.flags, ...(best.issuer !== undefined ? { issuer: best.issuer } : {}) };
}

/** 家計簿アプリの分類の言葉 → 項目（アプリごとの言葉の違いを、言葉の一部で吸収する） */
const SOURCE_WORDS: readonly [string, StatementCategory][] = [
  ["振替", "transfer"], ["カード引き落とし", "transfer"], ["現金カード", "transfer"], ["収入", "income"], ["給与", "income"], ["賞与", "income"],
  ["ATM", "cash"], ["現金", "cash"], ["食", "food"], ["日用", "dailyGoods"], ["光熱", "utilities"], ["水道", "utilities"], ["電気", "utilities"], ["ガス", "utilities"],
  ["通信", "communication"], ["電話", "communication"], ["携帯", "communication"], ["インターネット", "communication"], ["交通", "transport"],
  ["自動車", "car"], ["車", "car"], ["ガソリン", "car"], ["医療", "medical"], ["健康", "medical"], ["病院", "medical"], ["薬", "medical"],
  ["衣", "clothing"], ["服", "clothing"], ["美容", "clothing"], ["家具", "furniture"], ["家電", "furniture"], ["教育", "education"], ["学費", "education"], ["習い事", "education"],
  ["娯楽", "recreation"], ["趣味", "recreation"], ["教養", "recreation"], ["レジャー", "recreation"], ["旅行", "lumpSum"], ["特別", "lumpSum"], ["冠婚", "lumpSum"],
  ["保険", "insurance"], ["税", "tax"], ["社会保", "tax"], ["年金", "tax"], ["住宅", "housing"], ["住まい", "housing"], ["家賃", "housing"], ["ローン", "housing"],
  ["交際", "social"], ["プレゼント", "social"], ["こづかい", "allowance"], ["小遣い", "allowance"], ["おこづかい", "allowance"], ["その他", "otherLiving"], ["雑費", "otherLiving"],
];

export function lookupSourceCategory(raw: string | undefined): StatementCategory | null {
  if (raw === undefined) return null;
  const k = looseKey(raw);
  if (k === "" || k === looseKey("未分類")) return null;
  for (const [w, c] of SOURCE_WORDS) if (k.includes(looseKey(w))) return c;
  return null;
}

/** 覚えた辞書を店の鍵で引ける形にする（消した行は外す） */
export function officeIndex(entries: readonly DictionaryEntry[]): Map<string, DictionaryEntry> {
  const m = new Map<string, DictionaryEntry>();
  for (const e of mergeEntries(entries)) if (e.removed !== true) m.set(e.key, e);
  return m;
}

/** 項目を引く（FP がその行で決めたものは呼ぶ側で先に見る） */
export function lookup(key: string, opts: { office: ReadonlyMap<string, DictionaryEntry>; sourceCategory?: string; bank: boolean }): Match | null {
  const o = opts.office.get(key);
  if (o !== undefined) return { category: o.category, source: "office", flags: o.annual === true ? ["annual"] : [] };
  const b = lookupBuiltin(key, opts.bank);
  // カード会社への引き落としの印は、家計簿アプリの分類より強い（二重に数えないため）
  if (b !== null && b.flags.includes("cardPayment")) return b;
  const s = lookupSourceCategory(opts.sourceCategory);
  if (s !== null) return { category: s, source: "sourceCategory", flags: [] };
  return b;
}

/** 覚えた辞書の行どうしをまとめる（同じ鍵は日時の新しいほう。同じ日時なら消した行、次に名簿の ID の大きいほう＝どの PC でも同じ結果） */
export function mergeEntries(entries: readonly DictionaryEntry[]): DictionaryEntry[] {
  const m = new Map<string, DictionaryEntry>();
  for (const e of entries) {
    const cur = m.get(e.key);
    if (cur === undefined || newer(e, cur)) m.set(e.key, e);
  }
  return [...m.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function newer(a: DictionaryEntry, b: DictionaryEntry): boolean {
  if (a.at !== b.at) return a.at > b.at;
  if ((a.removed === true) !== (b.removed === true)) return a.removed === true;
  return (a.by ?? "") > (b.by ?? "");
}

/** 覚えた辞書の大きさの上限（事務所全体。古い行から外す） */
export const MAX_DICTIONARY = 20000;

/** 覚えた辞書の1行の検査（返ってきた事務所データ・共有フォルダのファイルを信用しない） */
export function readEntry(v: unknown): DictionaryEntry | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.key !== "string" || o.key === "" || o.key.length > 64 || o.key !== merchantKey(o.key)) return null;
  if (!isCategory(o.category) || typeof o.at !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(o.at)) return null;
  return {
    key: o.key,
    category: o.category,
    ...(o.annual === true ? { annual: true as const } : {}),
    at: o.at,
    ...(typeof o.by === "string" && o.by.length <= 64 ? { by: o.by } : {}),
    ...(o.removed === true ? { removed: true as const } : {}),
  };
}

/**
 * FP が行の項目を直したとき、覚える辞書の行を作る。同梱の辞書と同じ答えなら覚えない（辞書を太らせない）が、
 * 覚えた辞書に違う答えが残っていれば、それを消す行を返す。変える必要が無ければ null
 */
export function learnEntry(key: string, category: StatementCategory, at: string, opts: { office: ReadonlyMap<string, DictionaryEntry>; by?: string; annual?: boolean }): DictionaryEntry | null {
  if (key === "") return null;
  const cur = opts.office.get(key);
  if (cur !== undefined && cur.category === category && (cur.annual === true) === (opts.annual === true)) return null;
  const b = lookupBuiltin(key, false);
  if (b !== null && b.category === category && (opts.annual === true) === b.flags.includes("annual")) return cur !== undefined ? forgetEntry(key, at, opts.by) : null;
  return { key, category, ...(opts.annual === true ? { annual: true as const } : {}), at, ...(opts.by !== undefined ? { by: opts.by } : {}) };
}

/** 覚えた行を消す（消した印の行） */
export function forgetEntry(key: string, at: string, by?: string): DictionaryEntry {
  return { key, category: "otherLiving", at, ...(by !== undefined ? { by } : {}), removed: true };
}
