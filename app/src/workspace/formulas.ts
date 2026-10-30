// 計算式ID（エンジンの出力のお金の動きの formula）の、根拠の表示での名前と説明。
// 計算式IDの名前はまだ登録簿に無いので、画面の側に置く（登録簿 registry/ に formulas を足すことを提案している）。
// 載っていない計算式IDは、IDのまま表示する

// 国民健康保険料の区分ごとの説明。料率の入力が無いときは全国の目安で計算する（目安であることを根拠の表示で示す）
const NATIONAL_HEALTH = (part: string) =>
  `${part} ＝ 前年の所得（基礎控除の後）× 所得割の率 ＋ 均等割 × 人数 ＋ 平等割（低所得の軽減の後。賦課限度額まで）。料率の入力が無いときは全国の目安（公式の統計の全国の平均）で計算する。お住まいの市区町村の料率で変わる`;
const CONTINUATION = "任意継続の保険料 ＝ 退職したときの標準報酬月額（協会けんぽは全被保険者の平均の額が上限）× 保険料率（健康保険・40〜64歳の介護保険・支援金。全額を本人が払う）。最長2年";

export const FORMULA_LABELS: Readonly<Record<string, { label: string; text: string }>> = {
  "income.salary.monthly": { label: "月々の給与", text: "月々の給与 ＝ 年収（賞与を除く）÷ 12 を、昇給率で毎年延ばしたもの" },
  "income.salary.bonus": { label: "賞与", text: "賞与 ＝ 年間の賞与を支給月に分けたもの（昇給率で毎年延ばす）" },
  "pension.oldAge.basic.payment": { label: "老齢基礎年金", text: "老齢基礎年金 ＝ 満額 × 保険料を納めた月数 ÷ 上限の月数 × 受け取り開始の調整（繰上げは減額・繰下げは増額）" },
  "pension.oldAge.employee.payment": { label: "老齢厚生年金", text: "老齢厚生年金 ＝ 平均標準報酬額 × 乗率 × 加入月数 × 受け取り開始の調整" },
  "pension.supplementaryBenefit.payment": { label: "年金生活者支援給付金", text: "年金生活者支援給付金 ＝ 所得の条件を満たす年の給付の月額 × 月数" },
  "retirement.benefit.lumpSum.lumpSum": { label: "退職一時金", text: "退職一時金 ＝ 入力した額（退職の月に受け取る）" },
  "benefit.childAllowance.monthly": { label: "児童手当", text: "児童手当 ＝ 子の年齢と人数による月額 × 月数（支給月にまとめて受け取る）" },
  "education.support.highSchool": { label: "高等学校等就学支援金", text: "就学支援金 ＝ 制度の支給額（授業料に充てる）" },
  "education.nurseryFee.auto": {
    label: "保育料（自動計算・目安）",
    text: "保育料 ＝ 国の基準の上限（父母の市町村民税の所得割の合計の段階。4〜8月は前年度、9〜3月はその年度の住民税）× 多子の軽減（2人目は半額・3人目から0円）× 保育料の水準（国の基準に対する割合。目安 80%）。住民税非課税の世帯と3歳になった後の4月からは0円",
  },
  "education.nurseryFee.input": { label: "保育料", text: "保育料 ＝ 入力した月額 × 教育費の上昇率での延ばし（3歳になった後の4月からは0円）" },
  "education.nurseryFee.extra": { label: "保育料とは別にかかるお金", text: "保育料とは別にかかるお金 ＝ 教材・被服・保護者会・遠足・通園などの年額（入力か統計の目安）÷ 12 × 教育費の上昇率での延ばし（3歳になった後の4月の前の月まで）" },
  "education.cost.abroad": { label: "留学", text: "留学 ＝ 1回の額（今の値段）× 教育費の上昇率での延ばし（その学年の4月。短期は8月）" },
  "education.cost.school": { label: "学校の費用", text: "学校の費用 ＝ 学習費総額 − 学校外活動費（子供の学習費調査の平均。部活動などの費用を入れた段は教科外活動費をその額に入れ替える。教育費の上昇率で延ばす）" },
  "education.cost.outOfSchool": { label: "学校外活動費", text: "学校外活動費 ＝ 子供の学習費調査の平均（塾・習い事など。教育費の上昇率で延ばす）" },
  "education.cost.schoolLunchRelief": {
    label: "学校の費用（給食費の負担軽減を引いた額）",
    text: "学校の費用 ＝ 学習費総額 − 学校外活動費 − 学校給食費の負担軽減（公立小学校は令和8年度から国の基準額 月5,200円×11か月まで。自治体が無償化していれば全額）",
  },
  "expense.living.monthly": { label: "基本生活費", text: "基本生活費 ＝ 毎月の生活費 × 物価上昇率での延ばし" },
  "expense.living.stage": { label: "基本生活費（段階）", text: "段階の後の生活費 ＝ 毎月の生活費 × 段階の割合（子の独立・退職・80歳など） × 物価上昇率での延ばし" },
  "expense.periodic.payment": { label: "定期的な支出", text: "定期的な支出 ＝ 1回の額（n年ごと）" },
  "debt.schedule.equalPayment": { label: "住宅ローンの返済", text: "毎月の返済額 ＝ 元利均等返済（金利の見直し・5年ルール・125%ルールを含む）" },
  "housing.residence.propertyTax": { label: "固定資産税", text: "固定資産税 ＝ 入力した年額" },
  "housing.residence.maintenance": { label: "修繕費", text: "修繕費 ＝ 月額 × 上昇率での延ばし" },
  "housing.valuation.sale": { label: "持ち家の売却の手取り", text: "売却の手取り ＝ 売却価格（入れていなければその年の評価額）− 売却価格 × 売却の費用の割合（譲渡所得の税は別の行）" },
  "housing.valuation.saleTax": { label: "持ち家の譲渡所得の税", text: "譲渡所得の税 ＝ 入れた額（所得税・住民税の合計。売った月に払う。税の自動の計算はまだ無い）" },
  "asset.realEstate.rent": { label: "家賃収入", text: "家賃収入 ＝ 満室時の家賃（月額） × (1 − 空室率)（家賃は変化率で毎年動かす）" },
  "asset.realEstate.expenses": { label: "不動産の経費", text: "経費 ＝ 年額 ÷ 12 ＋ 受け取る家賃 × 家賃に対する割合（管理費・修繕積立金・固定資産税・管理委託料など）" },
  "asset.realEstate.sale": { label: "不動産の売却の手取り", text: "売却の手取り ＝ 売却価格（入れていなければその年の評価額）− 売却価格 × 売却の費用の割合（譲渡所得の税は別の行。ローンを返すときは返済の行）" },
  "tax.realEstateSale.incomeTax": {
    label: "不動産の譲渡所得の所得税",
    text: "所得税 ＝ 譲渡所得（売却価格 −（取得費 ＋ 売却の費用））× 15%（長期）・30%（短期）＋ 復興特別所得税・防衛特別所得税。取得費 ＝ 取得価額 ＋ 取得時の諸費用 − 建物の減価償却の累計（売却価格の5%のほうが大きければそれ）。翌年3月に払う",
  },
  "tax.realEstateSale.residentTax": { label: "不動産の譲渡所得の住民税", text: "住民税 ＝ 譲渡所得 × 5%（長期）・9%（短期）。翌年度に4回に分けて払う" },
  "debt.schedule.salePayoff": { label: "売ったときのローンの返済", text: "物件を売る月に、その月の返済の後のローンの残高を一括で返す" },
  "insurance.premiumPayment.monthly": { label: "保険料", text: "保険料 ＝ 契約の保険料（払込の期間の間）" },
  "plan.cashflow.closing": { label: "年末の金融資産", text: "年末の金融資産 ＝ 年初の残高 ＋ 年間収支 ＋ 運用益" },
  "plan.cashflow.debt": { label: "年末の借入の残高", text: "年末の残高 ＝ 返済の予定から計算した残高" },
  "plan.cashflow.contribution": { label: "NISAへの積立", text: "積立 ＝ 毎月の積立額（年の上限まで）" },
  "plan.cashflow.surplus": { label: "ゆとりの支出", text: "ゆとりの支出 ＝ 黒字（年間収支 − 退職金などの一時金の収入）− 貯まる額（黒字 × 黒字のうち貯まる割合。上限を入れたときは上限まで）。黒字の年だけ（取り崩しの計画がある年は差し引かない）" },
  "plan.cashflow.account": { label: "年末の残高", text: "年末の残高 ＝ 年初の残高 ＋ その年の出入り ＋ 運用益" },
  "incomeTax.annual.withholding": { label: "所得税（源泉徴収）", text: "所得税 ＝（所得 − 所得控除）× 税率 − 税額控除 ＋ 復興特別所得税" },
  "incomeTax.annual.settlement": { label: "所得税（精算）", text: "年末調整・確定申告での精算" },
  "residentTax.special.installment": { label: "住民税（給与から）", text: "住民税 ＝（前年の所得 − 所得控除）× 税率 − 税額控除 ＋ 均等割" },
  "residentTax.ordinary.installment": { label: "住民税（普通徴収）", text: "住民税 ＝（前年の所得 − 所得控除）× 税率 − 税額控除 ＋ 均等割" },
  "socialInsurance.health.monthly": { label: "健康保険料", text: "健康保険料 ＝ 標準報酬月額 × 保険料率（本人の負担分）" },
  "socialInsurance.health.bonus": { label: "健康保険料（賞与）", text: "健康保険料 ＝ 標準賞与額 × 保険料率（本人の負担分）" },
  "socialInsurance.pension.monthly": { label: "厚生年金保険料", text: "厚生年金保険料 ＝ 標準報酬月額 × 保険料率（本人の負担分）" },
  "socialInsurance.pension.bonus": { label: "厚生年金保険料（賞与）", text: "厚生年金保険料 ＝ 標準賞与額 × 保険料率（本人の負担分）" },
  "socialInsurance.care.monthly": { label: "介護保険料", text: "介護保険料 ＝ 標準報酬月額 × 保険料率（40〜64歳）" },
  "socialInsurance.employment.monthly": { label: "雇用保険料", text: "雇用保険料 ＝ 賃金 × 保険料率" },
  "socialInsurance.childSupport.monthly": { label: "子ども・子育て支援金", text: "支援金 ＝ 標準報酬月額 × 支援金率" },
  "socialInsurance.nationalHealth.medical": { label: "国民健康保険料（医療分）", text: NATIONAL_HEALTH("医療分") },
  "socialInsurance.nationalHealth.elderlySupport": { label: "国民健康保険料（後期高齢者支援金分）", text: NATIONAL_HEALTH("後期高齢者支援金分") },
  "socialInsurance.nationalHealth.care": { label: "国民健康保険料（介護分）", text: NATIONAL_HEALTH("介護分（40〜64歳）") },
  "socialInsurance.nationalHealth.childSupport": { label: "国民健康保険料（子ども・子育て支援金分）", text: NATIONAL_HEALTH("子ども・子育て支援金分") },
  "socialInsurance.nationalHealth.assessed": { label: "国民健康保険料（決定通知書の額）", text: "国民健康保険料 ＝ 入力した決定通知書の年額（納期に分ける）" },
  "socialInsurance.continuation.health": { label: "健康保険料（任意継続）", text: CONTINUATION },
  "socialInsurance.continuation.care": { label: "介護保険料（任意継続）", text: CONTINUATION },
  "socialInsurance.continuation.childSupport": { label: "子ども・子育て支援金（任意継続）", text: CONTINUATION },
};
