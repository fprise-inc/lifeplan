// 店の名前の辞書（0034 の4）。2層:
//   (a) アプリ同梱の最初の辞書（builtin.ts）
//   (b) FP が直した結果を覚える辞書（事務所データに暗号化して持つ。事務所で共有しているときは共有する。保存は本体の household-store）
// 引き当ての順番: FP がその行で決めた項目 → 覚えた辞書（店の鍵が完全に一致）→ 家計簿アプリの分類（大項目と中項目の組 → 大項目だけ）→ 同梱の辞書 → 分からない
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

/**
 * 家計簿アプリの書き出しの（大項目, 中項目）→ 項目（0034 の 2026-10-31 の追記）。大項目だけの言葉より先に見る。
 * 上から順に、大項目が major の言葉のどれかを含み（unless の言葉を含まない）、中項目が sub の言葉を含む最初のものを使う。
 * 言葉はアプリごとの違いを吸収するため一部で当てる（looseKey でそろえてから比べる）
 */
interface SubRule {
  readonly major: readonly string[];
  readonly unless?: readonly string[];
  readonly sub: readonly (readonly [word: string, category: StatementCategory])[];
}

const SUB_RULES: readonly SubRule[] = [
  // 現金・カード: カードの引き落とし・電子マネーへのチャージは除外（使った分はカード・電子マネーの側の行で数える。二重に数えない）。
  // ATM の引き出し・使途不明金は数える（使い道が見えないので「その他」の内訳。消えないようにする）
  {
    major: ["現金"],
    sub: [["引き落とし", "transfer"], ["引落", "transfer"], ["チャージ", "transfer"], ["電子マネー", "transfer"], ["ATM", "cash"], ["引き出し", "cash"], ["引出", "cash"], ["使途不明", "cash"]],
  },
  // 税・社会保険料のうち、住まい・車の税は住居・車（計算で出す税・社会保険料は大項目の言葉で除外）
  { major: ["税", "社会保"], sub: [["固定資産", "housing"], ["都市計画", "housing"], ["自動車税", "car"], ["軽自動車", "car"]] },
  // 医療・保険／健康・医療／保険: 保険料は保険（保険の欄で入れる）、病院代・薬代は医療。運動の施設は趣味・娯楽
  {
    major: ["医療", "健康", "保険"],
    unless: ["税", "社会保"],
    sub: [["保険", "insurance"], ["病院", "medical"], ["医療", "medical"], ["薬", "medical"], ["歯", "medical"], ["通院", "medical"], ["診療", "medical"], ["ボディケア", "medical"], ["マッサージ", "medical"], ["整体", "medical"], ["フィットネス", "recreation"], ["スポーツ", "recreation"], ["ジム", "recreation"]],
  },
  // 教養・教育: 学費・塾・習いごと・教材は教育（子ども・教育の入力項目で入れる）、書籍・新聞・雑誌は趣味・娯楽
  {
    major: ["教養", "教育"],
    sub: [["学費", "education"], ["授業料", "education"], ["塾", "education"], ["習い", "education"], ["教材", "education"], ["参考書", "education"], ["受験", "education"], ["学校", "education"], ["給食", "education"], ["保育", "education"], ["幼稚園", "education"], ["書籍", "recreation"], ["新聞", "recreation"], ["雑誌", "recreation"]],
  },
  // 日用品の中のこづかい・たばこ・ペット
  { major: ["日用"], sub: [["こづかい", "allowance"], ["小遣い", "allowance"], ["タバコ", "otherLiving"], ["煙草", "otherLiving"], ["ペット", "recreation"]] },
  // 住まいの中の保険・家具・家電
  { major: ["住宅", "住まい", "住居"], sub: [["保険", "insurance"], ["家具", "furniture"], ["家電", "furniture"]] },
  // 通信の中の放送の受信料（統計の分け方では趣味・娯楽）
  { major: ["通信"], sub: [["放送", "recreation"], ["受信料", "recreation"]] },
  // 交際の中の冠婚葬祭（一時的な支出）
  { major: ["交際"], sub: [["冠婚", "lumpSum"], ["葬祭", "lumpSum"]] },
  // その他の中の使途不明金・こづかい
  { major: ["その他"], sub: [["使途不明", "cash"], ["ATM", "cash"], ["引き出し", "cash"], ["こづかい", "allowance"], ["小遣い", "allowance"]] },
];

/**
 * 中項目で決まらないとき、大項目だけでは決めない大項目（言葉をすべて含むとき）。店の名前の辞書で引き、分からなければ迷う行にする。
 * - 現金・カード: 引き落とし（除外）か、引き出し（数える）かが分からない（前は全部を除外していたので、引き出しが消えていた）
 * - 医療・保険: 医療（基本生活費）か保険（保険の欄）かが分からない
 * - 教養・教育: 趣味・娯楽（基本生活費）か教育（子ども・教育）かが分からない
 */
const UNDECIDED_MAJORS: readonly (readonly string[])[] = [["現金"], ["医療", "保険"], ["教養", "教育"]];

/** 家計簿アプリの分類の言葉（大項目）→ 項目（アプリごとの言葉の違いを、言葉の一部で吸収する。上から順に、最初に含むもの） */
const SOURCE_WORDS: readonly [string, StatementCategory][] = [
  ["振替", "transfer"], ["カード引き落とし", "transfer"], ["収入", "income"], ["給与", "income"], ["賞与", "income"],
  ["ATM", "cash"], ["食", "food"], ["日用", "dailyGoods"], ["光熱", "utilities"], ["水道", "utilities"], ["電気", "utilities"], ["ガス", "utilities"],
  ["通信", "communication"], ["電話", "communication"], ["携帯", "communication"], ["インターネット", "communication"], ["交通", "transport"],
  ["自動車", "car"], ["クルマ", "car"], ["車", "car"], ["ガソリン", "car"], ["医療", "medical"], ["健康", "medical"], ["病院", "medical"], ["薬", "medical"],
  ["衣", "clothing"], ["服", "clothing"], ["美容", "clothing"], ["家具", "furniture"], ["家電", "furniture"], ["教育", "education"], ["学費", "education"], ["習い事", "education"],
  ["娯楽", "recreation"], ["エンタメ", "recreation"], ["趣味", "recreation"], ["教養", "recreation"], ["レジャー", "recreation"], ["大型出費", "lumpSum"], ["旅行", "lumpSum"], ["特別", "lumpSum"], ["冠婚", "lumpSum"],
  ["税", "tax"], ["社会保", "tax"], ["保険", "insurance"], ["年金", "tax"], ["住宅", "housing"], ["住まい", "housing"], ["家賃", "housing"], ["ローン", "housing"],
  ["交際", "social"], ["プレゼント", "social"], ["こづかい", "allowance"], ["小遣い", "allowance"], ["おこづかい", "allowance"], ["その他", "otherLiving"], ["雑費", "otherLiving"],
];

const has = (k: string, w: string) => k.includes(looseKey(w));

/**
 * 家計簿アプリの分類から項目を引く。中項目があれば（大項目, 中項目）の組を先に見て、次に大項目だけの言葉。
 * 決まらなければ null（店の名前の辞書で引く）
 */
export function lookupSourceCategory(raw: string | undefined, sub?: string): StatementCategory | null {
  if (raw === undefined) return null;
  const k = looseKey(raw);
  if (k === "" || k === looseKey("未分類")) return null;
  const sk = sub === undefined ? "" : looseKey(sub);
  if (sk !== "") {
    for (const r of SUB_RULES) {
      if (!r.major.some((w) => has(k, w)) || (r.unless ?? []).some((w) => has(k, w))) continue;
      for (const [w, c] of r.sub) if (has(sk, w)) return c;
    }
  }
  if (UNDECIDED_MAJORS.some((ws) => ws.every((w) => has(k, w)))) return null;
  for (const [w, c] of SOURCE_WORDS) if (has(k, w)) return c;
  return null;
}

/** 覚えた辞書を店の鍵で引ける形にする（消した行は外す） */
export function officeIndex(entries: readonly DictionaryEntry[]): Map<string, DictionaryEntry> {
  const m = new Map<string, DictionaryEntry>();
  for (const e of mergeEntries(entries)) if (e.removed !== true) m.set(e.key, e);
  return m;
}

/** 項目を引く（FP がその行で決めたものは呼ぶ側で先に見る） */
export function lookup(key: string, opts: { office: ReadonlyMap<string, DictionaryEntry>; sourceCategory?: string; sourceSubCategory?: string; bank: boolean }): Match | null {
  const o = opts.office.get(key);
  if (o !== undefined) return { category: o.category, source: "office", flags: o.annual === true ? ["annual"] : [] };
  const b = lookupBuiltin(key, opts.bank);
  // カード会社への引き落としの印は、家計簿アプリの分類より強い（二重に数えないため）
  if (b !== null && b.flags.includes("cardPayment")) return b;
  const s = lookupSourceCategory(opts.sourceCategory, opts.sourceSubCategory);
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
