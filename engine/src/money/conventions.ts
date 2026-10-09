// 0002: 法令に定めがない丸め（エンジンの規約）。ID は conv. で始める
import type { RoundingRule } from "./rounding.ts";

const DOWN1: RoundingRule = Object.freeze({ mode: "DOWN", unit: 1 });
const UP1: RoundingRule = Object.freeze({ mode: "UP", unit: 1 });

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
  // ローンの返済額（元利均等の返済額・元金均等の元金。円未満切り捨て。端数は最後の回で精算する。金融機関で違うので規約にする）
  "conv.loan.payment": DOWN1,
  // ローンの利息（残高×年利÷12。円未満切り捨て）
  "conv.loan.interest": DOWN1,
  // 元金均等の期間短縮で、元金の額を変えずに返し終える回数（切り上げ）
  "conv.loan.term": UP1,
  // 住まいの費用（家賃・管理費・固定資産税）の上昇率を当てた額（円未満切り捨て）
  "conv.housing.growth": DOWN1,
  // 課税口座の取り崩しで売る取得価額（取得価額×売る額÷時価。円未満切り捨て）と、NISA の枠の復活の簿価
  "conv.account.cost": DOWN1,
  // 住民税の住宅借入金等特別税額控除を市町村民税（5分の3）と道府県民税に分ける（円未満切り捨て。残りは道府県民税）
  "conv.residentTax.housingCredit": DOWN1,
  // 生活費・周期的な支出・車・FP顧問料・教育費を、物価上昇率（または教育費の上昇率・固定の率）で翌年の額にする（円未満切り捨て）
  "conv.expense.growth": DOWN1,
  // 年額・月額を月に分ける・割合を掛ける（円未満切り捨て。端数は allocate の寄せ先へ）
  "conv.expense.share": DOWN1,
  // 退職給付の年金額（一時金の額と予定利率から求める年額、年額を支払いの回数に分ける。円未満切り捨て）
  "conv.retirement.annuity": DOWN1,
  // 役員退職慰労金の見込み額（最終報酬月額×在任年数×功績倍率。円未満切り捨て）
  "conv.retirement.estimate": DOWN1,
});
