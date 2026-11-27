// 相続税の目安の答えの文（時点1つ。0039 の追記 2026-11-27）。相続・贈与の入力項目の目安・入力のホームの要約の1行・万一のタブ・結果のタブのポイントで同じ決まりにする。
// 分け方（利用者の判断）:
// - (a) 課税価格の合計（小規模宅地等の特例の前）が基礎控除以下 → 「かからない見込み」（申告は要らない）
// - (b-0) 基礎控除を超えるが、納める額が0円 → 「配偶者の税額軽減で、相続税はかからない見込みです」のように何によってかからないかを書く。
//         配偶者の税額軽減・小規模宅地等の特例を使ったときは「申告は必要です」を添える（税額控除だけで0円なら申告は要らないので添えない）
// - (b-1) 1円〜9,999円 → 「1万円未満」
// - (c) 1万円以上 → 「約○万円」
// 読むだけで、計算の結果は変えない
import type { InheritancePoint } from "../../engine/types.ts";

/** 円を万円の数にする（items.ts の manText と同じ決まり。軽く読み込めるよう、ここにも置く） */
const manText = (yen: number): string => {
  const man = yen / 10000;
  if (Number.isInteger(man)) return man.toLocaleString("ja-JP");
  if (Math.abs(yen) < 1_000_000) return String(Math.round(man * 10) / 10);
  return Math.round(man).toLocaleString("ja-JP");
};

/** 時点の分け方: none = (a)・zero = (b-0)・small = (b-1)・amount = (c) */
export type InheritanceTaxKind = "none" | "zero" | "small" | "amount";

/** 0円の理由（並びは画面に出す順） */
export type ZeroReason = "smallLand" | "spouse" | "minor" | "settlement" | "successive";

export const ZERO_REASON_TEXT: Readonly<Record<ZeroReason, string>> = {
  smallLand: "小規模宅地等の特例",
  spouse: "配偶者の税額軽減",
  minor: "未成年者控除",
  settlement: "相続時精算課税分の贈与税額控除",
  successive: "相次相続控除",
};

/** 申告が要ることを添える一言（「申告は要ります」でなく「必要です」。利用者の判断） */
export const FILING_NEEDED = "申告は必要です";
/** 1万円未満の答え */
export const UNDER_10K = "1万円未満";
/** 基礎控除以下の答え */
export const NO_TAX = "かからない見込み";

type PointLike = Pick<InheritancePoint, "status" | "basicDeduction" | "payable" | "noTax"> & {
  assets: Record<string, number>;
  spouseReduction?: number;
  minorCredit?: number;
  settlementCredit?: number;
  successiveCredit?: number;
  refund?: number;
};

/**
 * 小規模宅地等の特例の前の課税価格の合計（1,000円未満切り捨て。計算エンジンの課税価格と同じ決まり）。
 * 申告が要るかは、特例を使わずに計算した課税価格の合計が基礎控除を超えるかで決まる（国税庁「相続税の申告のしかた」の「相続税の申告」）。
 * 特例を使っていなければ、エンジンの課税価格そのまま
 */
export function priceBeforeSpecial(p: PointLike): number {
  const a = p.assets ?? {};
  const reduction = a.smallLandReduction ?? 0;
  if (reduction <= 0) return a.taxablePrice ?? 0;
  const gross = (a.financial ?? 0) + (a.realEstate ?? 0) + (a.other ?? 0) + (a.insurance ?? 0) - (a.insuranceExempt ?? 0) + (a.retirement ?? 0) - (a.retirementExempt ?? 0) + (a.settlementGifts ?? 0);
  const net = Math.max(0, gross - (a.debts ?? 0) - (a.funeral ?? 0));
  return Math.floor(net / 1000) * 1000;
}

/**
 * 時点の分け方（相続人がいる・計算した時点だけ。FP が入れた額は見ない）。(a) は、エンジンの noTax（特例の後の課税価格が基礎控除以下）のうち、
 * 小規模宅地等の特例を使っていないか、特例の前でも基礎控除以下のとき（特例で基礎控除以下になったときは申告が要るので (b-0)）
 */
export function taxKind(p: PointLike): InheritanceTaxKind {
  if (p.noTax && ((p.assets?.smallLandReduction ?? 0) <= 0 || priceBeforeSpecial(p) <= p.basicDeduction)) return "none";
  if (p.payable >= 10_000) return "amount";
  if (p.payable > 0) return "small";
  // 理由が無い0円は、端数の切り捨て（1人あたりの取得金額の1,000円未満・税の100円未満）で税が出ない時点。納める税も申告の義務も無いので (a) と同じに出す
  return zeroReasons(p).length > 0 ? "zero" : "none";
}

/**
 * 納める額が0円になった理由（基礎控除を超える時点）。小規模宅地等の特例は使ったとき（課税価格が下がったとき）、
 * 配偶者の税額軽減・税額控除は引いた額があるとき。どれも無ければ空（端数の切り捨てで0円。かからない見込みとして出す）
 */
export function zeroReasons(p: PointLike): ZeroReason[] {
  const out: ZeroReason[] = [];
  if ((p.assets?.smallLandReduction ?? 0) > 0) out.push("smallLand");
  if ((p.spouseReduction ?? 0) > 0) out.push("spouse");
  if ((p.minorCredit ?? 0) > 0) out.push("minor");
  if ((p.settlementCredit ?? 0) > 0) out.push("settlement");
  if ((p.successiveCredit ?? 0) > 0) out.push("successive");
  return out;
}

/**
 * 0円でも申告が要るか: 配偶者の税額軽減（相続税法19条の2第3項）・小規模宅地等の特例（租税特別措置法69条の4。特例で基礎控除以下になるときも申告が要る）は、申告書に書かないと使えない。
 * 未成年者控除・相次相続控除・相続時精算課税分の贈与税額控除などの税額控除だけで0円になるときは、申告の義務が無い
 * （相続税法27条1項の「相続税額があるとき」は、配偶者の税額軽減〔19条の2〕を除き、税額控除〔19条の3〜20条の2・21条の14〜21条の18〕を引いた後の額で見る）
 */
export function filingNeeded(reasons: readonly ZeroReason[]): boolean {
  return reasons.includes("spouse") || reasons.includes("smallLand");
}

/** 理由を「AとB」「A・BとC」でつなぐ */
export function reasonText(reasons: readonly ZeroReason[]): string {
  const t = reasons.map((r) => ZERO_REASON_TEXT[r]);
  if (t.length <= 1) return t[0] ?? "";
  return `${t.slice(0, -1).join("・")}と${t[t.length - 1] ?? ""}`;
}

/** (b-0) の答え: 「配偶者の税額軽減で、相続税はかからない見込みです。申告は必要です」 */
export function zeroText(p: PointLike): string {
  const reasons = zeroReasons(p);
  const head = `${reasonText(reasons)}で、相続税はかからない見込みです`;
  if (filingNeeded(reasons)) return `${head}。${FILING_NEEDED}`;
  // 相続時精算課税で払った贈与税が引ききれないときは、申告すると戻る（申告の義務は無い。「相続税の申告のしかた」の税額控除のト）
  return (p.refund ?? 0) > 0 ? `${head}。引ききれない贈与税は、申告すると戻ります` : head;
}

/** 時点の答えの文（計算した時点だけ。FP が入れた額・相続人がいない時点は呼ぶ側で） */
export function estimateText(p: PointLike): string {
  switch (taxKind(p)) {
    case "none":
      return NO_TAX;
    case "zero":
      return zeroText(p);
    case "small":
      return UNDER_10K;
    case "amount":
      return `約${manText(p.payable)}万円`;
  }
}
