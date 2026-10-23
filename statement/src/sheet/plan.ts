// 確認シート（0034 の9）に載せる行の組み立て: 迷う行のうち、店単位で答えられるものを店ごとに1行にまとめる。
// - 同じ店とみなすのは、店の鍵（row.key。画面の「辞書で分からない店」と同じ鍵）・持ち主・カード／口座・選べる区分・いまの見立てが同じ行。
//   持ち主・カード／口座が違えば分ける（お客さまが選ぶ区分は持ち主の働き方で変わり、カードごとに使い道が違うこともある）
// - まとめるのは、迷う理由がすべて店単位で答えられるもの（SHOP_FLAGS: 辞書で分からない店・区分が決まらない・カードの引き落とし）で、
//   金額が正の行だけ。同じ店に2行以上あるときだけまとめる（1回だけの店は今までどおり1行）
// - 1件ずつ判断が要る行（高額・高額で1回だけ・選べない区分・リボ・元の見つからない返品）は、同じ店でもまとめずに1行ずつ載せる
// - 載せる上限はシートの行で MAX_REQUEST_ROWS、依頼の記録の行の対応で MAX_REQUEST_ENTRIES。迷う度合いの重い行を含むものから載せる
import type { Flag } from "../classify/classify.ts";
import { MAX_REQUEST_ENTRIES, MAX_REQUEST_ROWS } from "../log.ts";
import type { ReviewItem } from "../review.ts";

/** 店単位で答えられる迷う印（同じ店の行をまとめてよい） */
export const SHOP_FLAGS: readonly Flag[] = ["unknownMerchant", "bucketUndecided", "cardPaymentKept"];

/** シートの1行（明細の1行か、店ごとにまとめた行） */
export interface SheetLine {
  /** row: 明細の1行。shop: 同じ店の行をまとめた1行 */
  readonly kind: "row" | "shop";
  /** この行に当てる明細の行（使った日の順） */
  readonly items: readonly ReviewItem[];
  /** 使った日の最初と最後 */
  readonly from: string;
  readonly to: string;
  /** 金額の合計（1行のときはその金額） */
  readonly total: number;
}

export interface SheetPlan {
  /** 載せる行（迷う度合いの重いものから。シートの並びは書き出しで決める） */
  readonly lines: readonly SheetLine[];
  /** 迷う行の数（明細の行） */
  readonly items: number;
  /** 店ごとにまとめた行の数と、そこに入った明細の行の数 */
  readonly shops: number;
  readonly grouped: number;
  /** 上限を超えて載せなかった明細の行の数 */
  readonly overflow: number;
}

/** 店ごとにまとめてよい行か */
export function groupable(it: ReviewItem): boolean {
  return it.key !== "" && it.amount > 0 && it.reasons.length > 0 && it.reasons.every((f) => SHOP_FLAGS.includes(f));
}

const groupKey = (it: ReviewItem) => [it.key, it.owner ?? "", it.account, it.category ?? "", it.bucket, it.allowed.join(",")].join("\u001f");

const byDate = (a: ReviewItem, b: ReviewItem) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0);

function lineOf(items: ReviewItem[]): SheetLine {
  const sorted = [...items].sort(byDate);
  const first = sorted[0] as ReviewItem;
  const last = sorted[sorted.length - 1] as ReviewItem;
  return { kind: sorted.length > 1 ? "shop" : "row", items: sorted, from: first.date, to: last.date, total: sorted.reduce((n, x) => n + x.amount, 0) };
}

/** 迷う行（reviewList の結果。重いものから並んでいる）から、シートに載せる行を作る */
export function planMarkSheet(items: readonly ReviewItem[]): SheetPlan {
  const groups = new Map<string, { at: number; items: ReviewItem[] }>();
  const singles: { at: number; items: ReviewItem[] }[] = [];
  items.forEach((it, at) => {
    if (!groupable(it)) {
      singles.push({ at, items: [it] });
      return;
    }
    const k = groupKey(it);
    const g = groups.get(k);
    if (g === undefined) groups.set(k, { at, items: [it] });
    else g.items.push(it);
  });
  // 重い行を含むものから（まとめた行は、その中でいちばん前に並んでいた行の位置）
  const all = [...singles, ...groups.values()].sort((a, b) => a.at - b.at);
  const lines: SheetLine[] = [];
  let entries = 0;
  for (const g of all) {
    if (lines.length >= MAX_REQUEST_ROWS) break;
    if (entries + g.items.length > MAX_REQUEST_ENTRIES) continue;
    lines.push(lineOf(g.items));
    entries += g.items.length;
  }
  const shops = lines.filter((l) => l.kind === "shop");
  return { lines, items: items.length, shops: shops.length, grouped: shops.reduce((n, l) => n + l.items.length, 0), overflow: items.length - entries };
}
