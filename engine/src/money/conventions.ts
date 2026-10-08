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
  // 給与所得の表（別表第五など）の区分の数（収入金額−段の下限）÷区分の幅（切り捨て。幅は制度データ）
  "conv.tax.tableStep": DOWN1,
  // 年税額を支払月に分ける（端数は最後の月）
  "conv.tax.allocate": DOWN1,
  // 法令の端数処理を原本で確かめるまでの仮の規約（給与所得控除の10%の段・住民税の保険料控除の式。PR の一覧を参照）
  "conv.tax.fractionalDeduction": DOWN1,
  // 住民税の所得割のうち公的年金等に係る分（所得の割合で分ける）と、年金から差し引く額の半分（最初の年度の普通徴収・仮徴収）。
  // 納期ごとの分割の端数は制度の値（residentTax.installment.*.rounding。地方税法20条の4の2第6項）
  "conv.residentTax.pensionShare": DOWN1,
  // 在職老齢年金の支給停止額の2分の1（円未満切り捨て。法令の端数の扱いは原本で確かめる前の仮の規約）
  "conv.pension.suspension": DOWN1,
  // 繰下げ待機中の在職停止額の平均（円未満切り捨て）
  "conv.pension.average": DOWN1,
  // 整数倍など、端数の出ない計算
  "conv.exact": DOWN1,
  // 市町村・広域連合の保険料（国民健康保険・後期高齢者医療・介護保険の第1号）の年額（条例で違うので円未満切り捨てを既定にする）
  "conv.premium.local": DOWN1,
  // 年額を納期に分ける（端数は最初の納期）
  "conv.premium.installment": DOWN1,
  // 雇用保険の給付の賃金日額・給付額（法令の端数の扱いは原本で確かめる前の仮の規約）
  "conv.benefit.daily": DOWN1,
});
