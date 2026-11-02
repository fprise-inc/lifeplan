// コードの中の目安（0111 の2回目）の一覧: 空欄・「わからない」を補う、出典の無いよくある額・割合と、ボタンで足すときのひな形の値。
// 見直しのときに直す所はここの1か所（docs/estimates-review.md の2〜9章）。値を変えたら、その行の rev を1つ上げる
// （その値を事務所の値で上書きしている事務所に「公式の値が新しくなりました」と出す）。
// - 計算エンジンが引く目安（遺族の生活費の割合・入院の限度日数・持ち家の評価・ストレステストの既定など）は engine/src/sdk/estimates.ts に置き、
//   ここで一覧に取り込む（値を書く所は向こうの1か所。画面・ヒアリングシートも同じ値を読む）
// - 事務所の推定の値（defaults.estimates.values。値ID は「preset.」で始まる）があれば、その値を使う（statistics.ts の setOfficeEstimates が入れる）
// - 法令で決まる値（税率・耐用年数・制度の利率など）はここに置かない（事務所で変えられない）。前提条件の標準値・相続税の目安の不動産の評価の割合・
//   FP顧問料の料金表は、新しい世帯に写す事務所の既定値（0073）で別に扱う
import { ENGINE_PRESETS, type PresetDef, type PresetKind, type PresetUnit, type PresetUse } from "../../engine/src/sdk/estimates.ts";
import { officeBasisOf, officeEstimates } from "./statistics.ts";

export type { PresetDef, PresetKind, PresetUnit, PresetUse };

const NONE = "出典なし";
const p = (id: string, value: number | string, unit: PresetUnit, group: string, name: string, use: PresetUse, source: string = NONE, kind: PresetKind = "guide", rev = 1): PresetDef => ({ id, value, unit, group, name, source, kind, use, rev });

/** 画面とヒアリングシートの目安（エンジンが引く目安は ENGINE_PRESETS） */
const APP_PRESETS: readonly PresetDef[] = [
  // ---- 住まい・ローン ----
  p("preset.housing.rent", 80000, "yen", "住まい・ローン", "家賃（月額。住まいが入っていないとき）", "fill", "出典なし（地域・人数の統計はまだ無い）", "market"),
  p("preset.housing.purchase.price", 40000000, "yen", "住まい・ローン", "住宅購入の予定: 物件の価格", "template", NONE, "market"),
  p("preset.housing.purchase.downRate", "0.1", "pct", "住まい・ローン", "住宅購入の予定: 頭金の割合（物件の価格に対する）", "template"),
  p("preset.housing.purchase.costsRate", "0.05", "pct", "住まい・ローン", "住宅購入の予定: 諸費用の割合（物件の価格に対する）", "template", "出典なし（諸費用の目安は新築3〜7%・中古6〜10%）"),
  p("preset.housing.purchase.afterMonths", 24, "months", "住まい・ローン", "住宅購入の予定: 購入の時期（今から）", "template"),
  p("preset.housing.propertyTax", 120000, "yen", "住まい・ローン", "固定資産税・都市計画税（年額）", "template"),
  p("preset.housing.maintenance", 15000, "yen", "住まい・ローン", "修繕費・管理費（月額）", "template"),
  p("preset.housing.repair.amount", 1000000, "yen", "住まい・ローン", "修繕・リフォームの行: 1回の額", "template"),
  p("preset.housing.repair.everyYears", 10, "yearCount", "住まい・ローン", "修繕・リフォームの行: 間隔", "template"),
  p("preset.loan.mortgage.balance", 30000000, "yen", "住まい・ローン", "今の残高から入れる住宅ローン: 今の残高", "template"),
  p("preset.loan.mortgage.termYears", 35, "yearCount", "住まい・ローン", "住宅ローンの返済期間の標準", "template"),
  p("preset.loan.mortgage.payoffAge", 80, "age", "住まい・ローン", "住宅ローンの完済の年齢の上限（返済期間の標準を縮める）", "template"),
  p("preset.loan.addRate.fallback", "0.01", "pct", "住まい・ローン", "金利の段階を足すときの金利（前の段が無いとき）", "template", NONE, "market"),
  p("preset.loan.outlook.up1.after5", "0.005", "pct", "住まい・ローン", "変動金利の見込み「少し上がる」: 5年後の上乗せ", "template"),
  p("preset.loan.outlook.up1.after10", "0.01", "pct", "住まい・ローン", "変動金利の見込み「少し上がる」: 10年後の上乗せ", "template"),
  p("preset.loan.outlook.up2.after5", "0.01", "pct", "住まい・ローン", "変動金利の見込み「大きく上がる」: 5年後の上乗せ", "template"),
  p("preset.loan.outlook.up2.after10", "0.02", "pct", "住まい・ローン", "変動金利の見込み「大きく上がる」: 10年後の上乗せ", "template"),
  p("preset.loan.prepay.afterMonths", 60, "months", "住まい・ローン", "繰上返済の行: 時期（今から）", "template"),
  p("preset.loan.prepay.amount", 1000000, "yen", "住まい・ローン", "繰上返済の行: 額", "template"),
  p("preset.loan.rate.cardLoan", "0.15", "pct", "住まい・ローン", "ほかのローンの金利: カードローン・リボ", "template", NONE, "market"),
  p("preset.loan.rate.renovation", "0.025", "pct", "住まい・ローン", "ほかのローンの金利: リフォームローン", "template", NONE, "market"),
  p("preset.loan.rate.policyLoan", "0.03", "pct", "住まい・ローン", "ほかのローンの金利: 契約者貸付（保険）", "template", NONE, "market"),
  p("preset.loan.rate.other", "0.03", "pct", "住まい・ローン", "ほかのローンの金利: その他のローン", "template", NONE, "market"),
  p("preset.rental.loan.principal", 20000000, "yen", "住まい・ローン", "収益不動産のローン: 借入額", "template", NONE, "market"),
  p("preset.rental.loan.rate", "0.02", "pct", "住まい・ローン", "収益不動産のローン: 金利（固定。借り換えで前の金利が無いときも）", "template", NONE, "market"),
  p("preset.rental.loan.termYears", 25, "yearCount", "住まい・ローン", "収益不動産のローン: 返済期間", "template"),
  p("preset.rental.repair.afterMonths", 60, "months", "住まい・ローン", "収益不動産の大きな修繕: 時期（今から）", "template"),
  p("preset.rental.repair.amount", 1000000, "yen", "住まい・ローン", "収益不動産の大きな修繕: 額", "template"),
  p("preset.rental.refinance.termMonths", 240, "months", "住まい・ローン", "収益不動産のローンの借り換え: 返済期間", "template"),
  p("preset.loan.inherited.principal", 1000000, "yen", "住まい・ローン", "相続で受け継ぐ借金: 額", "template"),
  p("preset.loan.inherited.rate", "0.02", "pct", "住まい・ローン", "相続で受け継ぐ借金: 金利", "template", NONE, "market"),
  p("preset.loan.inherited.termYears", 5, "yearCount", "住まい・ローン", "相続で受け継ぐ借金: 返す年数", "template"),
  // ---- 生活費 ----
  p("preset.living.single", 140000, "yen", "生活費", "1人の世帯の基本生活費（月額）", "fill", "仮の値（統計の表に単身世帯が無い）"),
  p("preset.living.stage.childIndependence", "0.85", "pct", "生活費", "生活費の段階: 子の独立の後（今の生活費に対する割合）", "template"),
  p("preset.living.stage.retirement", "0.8", "pct", "生活費", "生活費の段階: 退職の後", "fill"),
  p("preset.living.stage.age70", "0.75", "pct", "生活費", "生活費の段階: 70歳から", "fill"),
  p("preset.living.stage.age80", "0.7", "pct", "生活費", "生活費の段階: 80歳から", "fill"),
  p("preset.living.stage.other", "0.9", "pct", "生活費", "生活費の段階: その他の節目", "template"),
  p("preset.living.annual.medical", 50000, "yen", "生活費", "年払いの支出のひな形: 通院・歯の治療（年額）", "template"),
  p("preset.living.annual.pet", 50000, "yen", "生活費", "年払いの支出のひな形: ペットの病気・けが（年額）", "template"),
  p("preset.living.annual.homecoming", 100000, "yen", "生活費", "年払いの支出のひな形: 帰省（年額）", "template"),
  p("preset.living.annual.appliances", 400000, "yen", "生活費", "年払いの支出のひな形: 家電・家具の買い替え（1回）", "template"),
  p("preset.living.annual.appliances.everyYears", 8, "yearCount", "生活費", "年払いの支出のひな形: 家電・家具の買い替えの間隔", "template"),
  p("preset.living.annual.fees", 30000, "yen", "生活費", "年払いの支出のひな形: 年会費・サブスクの年払い（年額）", "template"),
  p("preset.living.annual.smartphone", 120000, "yen", "生活費", "年払いの支出のひな形: スマホの買い替え（1台・1回）", "template"),
  p("preset.living.annual.smartphone.everyYears", 4, "yearCount", "生活費", "年払いの支出のひな形: スマホの買い替えの間隔", "template"),
  p("preset.living.annual.pc", 150000, "yen", "生活費", "年払いの支出のひな形: パソコンの買い替え（1回）", "template"),
  p("preset.living.annual.pc.everyYears", 5, "yearCount", "生活費", "年払いの支出のひな形: パソコンの買い替えの間隔", "template"),
  p("preset.living.annualRow", 100000, "yen", "生活費", "年1回・数年に1回の支出の行（年額）", "template"),
  p("preset.surplus.same", "0.6", "pct", "生活費", "黒字のうち貯金に回る割合（ずっと同じ）", "template"),
  p("preset.surplus.children.before", "0.5", "pct", "生活費", "黒字のうち貯金に回る割合（子育て中）", "template"),
  p("preset.surplus.children.after", "0.8", "pct", "生活費", "黒字のうち貯金に回る割合（末子の独立の後）", "template"),
  p("preset.surplus.retirement.before", "0.6", "pct", "生活費", "黒字のうち貯金に回る割合（退職の前）", "template"),
  p("preset.surplus.retirement.after", "0.8", "pct", "生活費", "黒字のうち貯金に回る割合（退職の後）", "template"),
  // ---- 教育 ----
  p("preset.education.outside.cram", 20000, "yen", "教育", "学校外の行: 塾（月額）", "template"),
  p("preset.education.outside.lessons", 8000, "yen", "教育", "学校外の行: 習い事（月額）", "template"),
  p("preset.education.outside.other", 5000, "yen", "教育", "学校外の行: その他（月額）", "template"),
  p("preset.education.scholarship.monthly", 50000, "yen", "教育", "貸与の奨学金: 月額", "template", "仮の値（返す年数は日本学生支援機構の返還年数算出表で決まる）"),
  p("preset.education.loan.rate", "0.0405", "pct", "教育", "教育ローンの金利（国の教育ローン。固定）", "template", "日本政策金融公庫「国の教育ローン」の固定金利（令和8年7月1日現在。保証料は別）", "market"),
  p("preset.education.abroad", 3500000, "yen", "教育", "留学の費用", "template"),
  p("preset.education.otherRow", 100000, "yen", "教育", "その他の教育費の行（年額）", "template"),
  p("preset.education.childGift.amount", 1000000, "yen", "教育", "子の結婚の援助（1人）", "template", "よくある額"),
  // ---- 介護 ----
  p("preset.care.allowance", 30000, "yen", "介護", "仕送りの行（月額）", "template"),
  // ---- 給与・収入 ----
  p("preset.wage.provisional.regular.male.salary", 4300000, "yen", "給与・収入", "統計が無いときの給与（正社員・男性。賞与を除く年額）", "fill", "仮の値"),
  p("preset.wage.provisional.regular.male.bonus", 1000000, "yen", "給与・収入", "統計が無いときの賞与（正社員・男性）", "fill", "仮の値"),
  p("preset.wage.provisional.regular.female.salary", 3300000, "yen", "給与・収入", "統計が無いときの給与（正社員・女性。賞与を除く年額）", "fill", "仮の値"),
  p("preset.wage.provisional.regular.female.bonus", 700000, "yen", "給与・収入", "統計が無いときの賞与（正社員・女性）", "fill", "仮の値"),
  p("preset.wage.provisional.civilServant.male.salary", 4500000, "yen", "給与・収入", "統計が無いときの給与（公務員・男性）", "fill", "仮の値"),
  p("preset.wage.provisional.civilServant.male.bonus", 1600000, "yen", "給与・収入", "公務員の賞与（男性）", "fill", "仮の値"),
  p("preset.wage.provisional.civilServant.female.salary", 4000000, "yen", "給与・収入", "統計が無いときの給与（公務員・女性）", "fill", "仮の値"),
  p("preset.wage.provisional.civilServant.female.bonus", 1400000, "yen", "給与・収入", "公務員の賞与（女性）", "fill", "仮の値"),
  p("preset.wage.provisional.contract.male.salary", 3200000, "yen", "給与・収入", "統計が無いときの給与（契約社員など・男性）", "fill", "仮の値"),
  p("preset.wage.provisional.contract.male.bonus", 300000, "yen", "給与・収入", "統計が無いときの賞与（契約社員など・男性）", "fill", "仮の値"),
  p("preset.wage.provisional.contract.female.salary", 2600000, "yen", "給与・収入", "統計が無いときの給与（契約社員など・女性）", "fill", "仮の値"),
  p("preset.wage.provisional.contract.female.bonus", 200000, "yen", "給与・収入", "統計が無いときの賞与（契約社員など・女性）", "fill", "仮の値"),
  p("preset.wage.provisional.partTime.male.salary", 1500000, "yen", "給与・収入", "統計が無いときのパートの年収（男性）", "fill", "仮の値"),
  p("preset.wage.provisional.partTime.female.salary", 1000000, "yen", "給与・収入", "統計が無いときのパートの年収（女性）", "fill", "仮の値"),
  p("preset.wage.provisional.executive.male.salary", 6000000, "yen", "給与・収入", "役員の報酬（男性。年額）", "fill", "仮の値"),
  p("preset.wage.provisional.executive.female.salary", 4800000, "yen", "給与・収入", "役員の報酬（女性。年額）", "fill", "仮の値"),
  p("preset.wage.partTime.weeklyHours", 15, "hours", "給与・収入", "パートの年収の推定の働く時間（週）", "fill"),
  p("preset.health.mutualAidRate", "0.0490", "pct", "給与・収入", "共済組合・健康保険組合の保険料率の目安（本人の負担分。協会けんぽの料率が読めないとき）", "fill", "仮の値"),
  p("preset.residentTax.socialInsuranceRatio", "0.15", "pct", "給与・収入", "住民税の概算で収入から引く社会保険料の割合", "fill", "仮定"),
  p("preset.work.retirementAge", 60, "age", "給与・収入", "定年（会社員）", "fill"),
  p("preset.retirement.executiveMultiplier", "1", "coef", "退職金", "役員の退職金の功績倍率", "fill", "出典なし（役員の地位でおよそ1.0〜3.0）"),
  p("preset.retirement.dbYears", 10, "yearCount", "退職金", "確定給付企業年金の年金で受け取る年数", "template"),
  p("preset.retirement.dbLumpShare", "0.5", "pct", "退職金", "確定給付企業年金の一時金と年金の併用: 一時金の割合", "template"),
  p("preset.work.employerSize", 300, "count", "給与・収入", "ヒアリングシートの勤め先の規模（空欄のとき。人）", "fill", "仮の値"),
  p("preset.work.employerSize.partTime", 30, "count", "給与・収入", "ヒアリングシートの勤め先の規模（パート。空欄のとき。人）", "fill", "仮の値"),
  p("preset.work.weeklyHours", 40, "hours", "給与・収入", "ヒアリングシートの勤務時間（空欄のとき。週）", "fill", "仮の値"),
  p("preset.work.weeklyHours.partTime", 20, "hours", "給与・収入", "ヒアリングシートの勤務時間（パート。空欄のとき。週）", "fill", "仮の値"),
  // ---- 車 ----
  p("preset.car.everyYears", 8, "yearCount", "車", "車の乗り換えの間隔", "fill", "仮の値"),
  p("preset.car.price", 2500000, "yen", "車", "車の新車の価格", "fill", "仮の値", "market"),
  p("preset.car.tradeIn", 500000, "yen", "車", "車の下取り", "fill", "仮の値", "market"),
  p("preset.car.upkeep", 360000, "yen", "車", "車の維持費の合計（年額。自動車税・保険・車検・駐車場・燃料）", "fill", "仮の値", "market"),
  p("preset.car.insurance", 70000, "yen", "車", "車の任意保険（年額）", "fill", "仮の値", "market"),
  p("preset.car.inspection", 100000, "yen", "車", "車検1回の費用（法定費用と整備）", "fill", "仮の値", "market"),
  p("preset.car.fuel", 100000, "yen", "車", "車の燃料（年額）", "fill", "仮の値", "market"),
  p("preset.car.keepYears", 13, "yearCount", "車", "買い替えない車を手放すまでの年数（買ってから）", "fill", "自動車検査登録情報協会「平均使用年数」令和7年3月末の乗用車（軽自動車を除く）13.35年を丸めた値", "statistic"),
  p("preset.car.keepYearsOwned", 5, "yearCount", "車", "今の車に乗り続けるときの手放すまでの年数（今から）", "fill"),
  p("preset.car.residual.year3", "0.5", "pct", "車", "下取り・売却の残価（3年乗ったとき。車両の価格に対する割合）", "fill", "ひな形"),
  p("preset.car.residual.year5", "0.35", "pct", "車", "下取り・売却の残価（5年）", "fill", "ひな形"),
  p("preset.car.residual.year8", "0.15", "pct", "車", "下取り・売却の残価（8年）", "fill", "ひな形"),
  p("preset.car.residual.year10", "0.05", "pct", "車", "下取り・売却の残価（10年以上）", "fill", "ひな形"),
  p("preset.car.loan.share", "0.8", "pct", "車", "自動車ローンの借入の割合（下取りを引いた額に対する）", "template"),
  p("preset.car.loan.termMonths", 60, "months", "車", "自動車ローンの返済期間", "template"),
  p("preset.car.loan.principal", 2000000, "yen", "車", "今返している自動車ローン: 借入額", "template"),
  p("preset.car.afterMonthly", 10000, "yen", "車", "車を手放した後の移動の費用（月額）", "template", "よくある額"),
  p("preset.car.oldRepair", 100000, "yen", "車", "古くなってからの車の修理費（年額。買ってから10年後から）", "template", "よくある額"),
  p("preset.car.supplies", 50000, "yen", "車", "車の修理・用品などの行（年額）", "template", "よくある額"),
  // ---- 万一・保険 ----
  p("preset.insurance.surgeryRatio", 10, "count", "万一・保険", "手術の給付（入院日額の何倍か）", "template", "ひな形"),
  p("preset.insurance.lowSurrender.duringRate", "0.7", "pct", "万一・保険", "低解約返戻金型終身保険: 払込中の解約返戻率（払った保険料の累計に対する）", "template", "目安（払込中の返戻金を抑える型は、払込中に払った保険料の累計の7割ほどの設計が多い。商品で違うので設計書の率に直す）"),
  p("preset.insurance.lowSurrender.endRate", "1.05", "pct", "万一・保険", "低解約返戻金型終身保険: 払込が終わった時の解約返戻率（払った保険料の累計に対する）", "template", "目安（払込が終わると、払った保険料の累計を少し上回る設計が多い。商品で違うので設計書の率に直す）"),
  p("preset.contingency.illness.months", 12, "months", "万一・保険", "大きな病気: 働けない期間", "template", "仮の値"),
  p("preset.contingency.illness.medicalMonthly", 600000, "yen", "万一・保険", "大きな病気: 医療費（月額）", "template", "仮の値"),
  p("preset.contingency.illness.medicalMonths", 6, "months", "万一・保険", "大きな病気: 医療費のかかる期間", "template", "仮の値"),
  p("preset.contingency.illness.afterRatio", "0.7", "pct", "万一・保険", "大きな病気: 働けない期間の後の収入（元の収入に対する割合）", "template", "仮の値"),
  p("preset.contingency.hospitalDays.cancer", 20, "days", "万一・保険", "入院の日数の想定（がん）", "template", "患者調査の平均在院日数を丸めた仮の値（版は未確認）", "statistic"),
  p("preset.contingency.hospitalDays.heartStroke", 30, "days", "万一・保険", "入院の日数の想定（心疾患・脳卒中）", "template", "患者調査の平均在院日数を丸めた仮の値（版は未確認）", "statistic"),
  p("preset.contingency.hospitalDays.other", 10, "days", "万一・保険", "入院の日数の想定（その他）", "template", "患者調査の平均在院日数を丸めた仮の値（版は未確認）", "statistic"),
  // ---- 前提条件・資産運用（前提条件の標準値〔物価・賃金・運用利回り〕は 0073 の事務所の既定値で別に扱う） ----
  p("preset.invest.equity.domestic.return", "0.05", "pct", "前提条件・資産運用", "資産の種類の期待リターン: 国内株", "fill", "仮の値", "market"),
  p("preset.invest.equity.domestic.volatility", "0.18", "pct", "前提条件・資産運用", "資産の種類の値動きの大きさ: 国内株", "fill", "仮の値", "market"),
  p("preset.invest.equity.global.return", "0.06", "pct", "前提条件・資産運用", "資産の種類の期待リターン: 外国株", "fill", "仮の値", "market"),
  p("preset.invest.equity.global.volatility", "0.2", "pct", "前提条件・資産運用", "資産の種類の値動きの大きさ: 外国株", "fill", "仮の値", "market"),
  p("preset.invest.bond.global.return", "0.01", "pct", "前提条件・資産運用", "資産の種類の期待リターン: 債券", "fill", "仮の値", "market"),
  p("preset.invest.bond.global.volatility", "0.05", "pct", "前提条件・資産運用", "資産の種類の値動きの大きさ: 債券", "fill", "仮の値", "market"),
  p("preset.invest.reit.global.return", "0.04", "pct", "前提条件・資産運用", "資産の種類の期待リターン: REIT", "fill", "仮の値", "market"),
  p("preset.invest.reit.global.volatility", "0.18", "pct", "前提条件・資産運用", "資産の種類の値動きの大きさ: REIT", "fill", "仮の値", "market"),
  p("preset.invest.cash.deposit.return", "0.001", "pct", "前提条件・資産運用", "資産の種類の期待リターン: 現金", "fill", "仮の値", "market"),
  p("preset.invest.cash.deposit.volatility", "0.005", "pct", "前提条件・資産運用", "資産の種類の値動きの大きさ: 現金", "fill", "仮の値", "market"),
  p("preset.invest.fee", "0.0025", "pct", "前提条件・資産運用", "運用の費用（信託報酬など。年）", "template", "仮の値", "market"),
  p("preset.withdrawal.startAge", 65, "age", "前提条件・資産運用", "取り崩しの計画: 始める年齢", "template", "仮の値"),
  p("preset.withdrawal.monthly", 150000, "yen", "前提条件・資産運用", "取り崩しの計画: 定額の月額", "template", "仮の値"),
  p("preset.withdrawal.rate", "0.04", "pct", "前提条件・資産運用", "取り崩しの計画: 定率の割合（年）", "template", "仮の値"),
  p("preset.assumptions.warn.investmentReturn", "0.05", "pct", "前提条件・資産運用", "注意の線: 運用利回りの上限", "template", "初めの線の仮の値"),
  p("preset.assumptions.warn.inflationHigh", "0.04", "pct", "前提条件・資産運用", "注意の線: 物価上昇率の上限", "template", "初めの線の仮の値"),
  // ---- ライフイベント ----
  p("preset.events.general", 500000, "yen", "ライフイベント", "ライフイベントの支出の行（1回）", "template"),
  p("preset.events.childSupport", 40000, "yen", "ライフイベント", "養育費を払う行（月額）", "template"),
  p("preset.events.realEstateCost", 1000000, "yen", "ライフイベント", "不動産の一時の経費の行（1回）", "template"),
  p("preset.events.other", 100000, "yen", "ライフイベント", "その他の支出の行（1回）", "template"),
  p("preset.events.newItem", 300000, "yen", "ライフイベント", "「＋ 項目を追加」の新しい支出（1回）", "template"),
  p("preset.events.comingOfAge", 150000, "yen", "ライフイベント", "子の成人式（1人）", "template", "よくある額"),
  p("preset.events.funeral", 1200000, "yen", "ライフイベント", "親の葬儀（世帯が払う分。1回）", "template", "よくある額"),
  p("preset.events.memorial", 200000, "yen", "ライフイベント", "法事（1回）", "template", "よくある額"),
];

/** 事務所で変えられるコードの中の目安の一覧（画面・ヒアリングシートの目安と、エンジンが引く目安） */
export const PRESETS: readonly PresetDef[] = [...APP_PRESETS, ...ENGINE_PRESETS];

const BY_ID: ReadonlyMap<string, PresetDef> = new Map(PRESETS.map((d) => [d.id, d]));

/** 目安の定義（無ければ undefined） */
export const presetDef = (id: string): PresetDef | undefined => BY_ID.get(id);

/** 目安の値ID か */
export const isPresetId = (id: string): boolean => BY_ID.has(id);

/** 目安の公式の値（事務所の値を当てない値。知らない値ID は投げる。打ち間違いをテストで見つけるため） */
export function officialPreset(id: string): number | string {
  const d = BY_ID.get(id);
  if (d === undefined) throw new Error(`unknown preset: ${id}`);
  return d.value;
}

/** 事務所の推定の値（無ければ null）と、その根拠の文 */
function officeOf(id: string): { value: number | string; basis: string } | null {
  const o = officeEstimates()[id];
  if (o === undefined) return null;
  return typeof o.value === "number" || typeof o.value === "string" ? { value: o.value, basis: o.basis } : null;
}

/** 目安の値（事務所の推定の値があればその値） */
export function presetValue(id: string): number | string {
  const off = officialPreset(id);
  return officeOf(id)?.value ?? off;
}

/** 目安の数（額・月数・日数。率は Number にした値） */
export const presetNum = (id: string): number => Number(presetValue(id));

/** 目安の率（10進の文字） */
export const presetRate = (id: string): string => String(presetValue(id));

/** 事務所の推定の値に置き換えているか */
export const presetIsOffice = (id: string): boolean => officeOf(id) !== null;

/**
 * 目安の根拠の文: describe（値から作る文。例 v → 「家賃 月8万円」）。事務所の推定の値なら、事務所の根拠の文そのもの（FP が書いた文か、
 * 自動の文「事務所の目安（変えた年月）」。ほかの文を足さない。事務所の値から作った推定を、根拠の文が完全に同じかで見分けるため）。
 * 文は値から作るので、一覧の値を変えれば文も変わる（見直しのときに文を直さなくてよい）
 */
export function presetText(id: string, describe: (v: number | string) => string): string {
  return officeBasisOf(id) ?? describe(officialPreset(id));
}

/** 事務所の推定の値の根拠の文（ids のうち最初の、事務所の値がある値。無ければ null。statistics.ts の officeBasisOf） */
export { officeBasisOf };
