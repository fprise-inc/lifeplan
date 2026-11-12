// 結果の画面の「ご家族の夢」の区画の、夢ごとの一言の言い方。
// 「払えます」に当たる言い方はまだ決めていないので、言い方はここだけで決める（数字の出し方は present.ts の dreamNote）。
// ほかの言い方の候補: 「払えます」＋「2040年の終わりの金融資産 1,159万円（払った後）」、「この年の余裕 1,159万円」
import { man } from "../presentation/format.ts";
import type { DreamNote } from "../presentation/model.ts";

/** 払う年の数字（1回の夢は払う年が1つ。何年ごと・毎年の夢は、払う年のうち金融資産がいちばん少ない年） */
export interface DreamPayment {
  /** 払う年の数（1回の夢は1） */
  count: number;
  /** 入れた額の合計（入れた額 × 払う年の数。毎月の夢は × 12） */
  total: number;
  /** 見る年（1回の夢はその年。何年ごと・毎年の夢は、払う年のうち金融資産がいちばん少ない年か、資金が不足する最初の年） */
  year: number;
  /** その年の終わりの金融資産（払った後） */
  after: number;
  /** その年に資金の不足があるか */
  short: boolean;
}

const yen = (v: number) => `${man(v)}万円`;
/** 何年ごと・毎年の夢の頭（「4回・合計1,600万円。」） */
const times = (x: DreamPayment) => (x.count > 1 ? `${String(x.count)}回・合計${yen(x.total)}。` : "");

/** 計算に入れている夢の一言（払う年の金融資産） */
export function paidNote(x: DreamPayment): DreamNote {
  if (x.short) return { tone: "short", status: "資金が不足", text: `${times(x)}${String(x.year)}年に資金が不足します（払った後の金融資産 ${yen(x.after)}）` };
  if (x.count > 1) return { tone: "ok", status: null, text: `${times(x)}払った後も、いちばん少ない${String(x.year)}年で${yen(x.after)}残ります` };
  return { tone: "ok", status: null, text: `払った後も${yen(x.after)}残ります` };
}

/** 計算に入れていない夢の案内（数字の目安は出さない。運用で増える分が変わり、引き算の目安とずれるため） */
export const NOT_INCLUDED_NOTE: DreamNote = { tone: "info", status: null, text: "計算に入れていません。グラフの上の「外している物」で入れて比較できます" };

/** 額の無い夢の案内（計算に入れている夢と、入れていない夢） */
export function noAmountNote(included: boolean): DreamNote {
  return { tone: "info", status: null, text: included ? "額が決まると、払った後の金融資産を出せます" : "額が決まると、グラフの上の「外している物」で入れて比較できます" };
}
