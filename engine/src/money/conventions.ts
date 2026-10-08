// 0002: 法令に定めがない丸め（エンジンの規約）。ID は conv. で始める
import type { RoundingRule } from "./rounding.ts";

const DOWN1: RoundingRule = Object.freeze({ mode: "DOWN", unit: 1 });

export const CONVENTIONS: Readonly<Record<string, RoundingRule>> = Object.freeze({
  // 0003: 運用益は円未満切り捨て
  "conv.investment.return": DOWN1,
  // 年額などを月に分けるときの既定（端数は allocate の寄せ先へ）
  "conv.flow.allocate": DOWN1,
  // 給与の年額を12か月に、賞与を支給月に分ける（端数は最後の月）
  "conv.salary.monthly": DOWN1,
  // 賃金上昇率で翌年の給与を出す
  "conv.salary.growth": DOWN1,
  // 標準報酬月額の基にする報酬月額（3か月の平均など）
  "conv.socialInsurance.remuneration": DOWN1,
  // 割り切れる計算（課税所得金額×税率など。端数は出ない）
  "conv.tax.exact": DOWN1,
  // 年税額を支払月に分ける（端数は最後の月）
  "conv.tax.allocate": DOWN1,
  // 法令の端数処理を原本で確かめるまでの仮の規約（給与所得控除の10%の段・住民税の保険料控除の式。PR の一覧を参照）
  "conv.tax.fractionalDeduction": DOWN1,
  // 住民税の年税額を納期に分ける仮の規約（端数は最初の納期。法令の端数の扱いは原本で確かめる前）
  "conv.residentTax.installment": DOWN1,
  // 在職老齢年金の支給停止額の2分の1（円未満切り捨て。法令の端数の扱いは原本で確かめる前の仮の規約）
  "conv.pension.suspension": DOWN1,
  // 繰下げ待機中の在職停止額の平均（円未満切り捨て）
  "conv.pension.average": DOWN1,
  // 整数倍など、端数の出ない計算
  "conv.exact": DOWN1,
});
