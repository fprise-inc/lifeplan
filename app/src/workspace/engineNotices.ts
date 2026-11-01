// 計算の知らせ（計算エンジンの見出しの notices。0006・0064）: エンジンは知らせを「コードと ID だけ」で出す（0005 の8）。
// 画面はここで、FP 向けの文・種類・対象（人・物の呼び名）・年・どのプランで出たかにして、同じ知らせを1行にまとめる。
// - 種類は5つ: 入力が足りない／計算に入れていない／前提の外（制度の決まりで変えた）／仮の値・推定／制度データの確認待ち・先の年の値
// - 入力で直せる知らせは、入るカードを持つ（結果のタブから「入力で開く」、確かめの一覧に「計算の知らせ」として出す）
// - 文の表に無い知らせも、種類の決まりの文で出す（黙って捨てない）。制度の値の名前は登録簿の名前（PARAM_LABELS）
import type { EngineRequest, PreviewResult } from "../engine/types.ts";
import { PARAM_LABELS } from "../generated/labels.ts";
import type { StageId } from "./input/form.ts";
import type { WorkingHousehold } from "./input/household.ts";
import { memberLabels } from "./input/labels.ts";

export type NoticeKind = "input" | "missing" | "outside" | "assumed" | "data";

/** 種類の並び（上から。FP が直せる・計算に入っていない所を先に） */
export const NOTICE_KINDS: readonly { id: NoticeKind; label: string; short: string }[] = [
  { id: "input", label: "入力が足りないため、計算できていない所", short: "入力が足りない" },
  { id: "missing", label: "計算に入れていないもの", short: "計算に入れていない" },
  { id: "outside", label: "制度の決まり・前提の外で変えた所", short: "前提の外" },
  { id: "assumed", label: "仮の値・推定で計算した所", short: "仮の値・推定" },
  { id: "data", label: "制度データの確認待ち・先の年の値", short: "データの確認待ち" },
];

export const REFORM_TEXT = "遺族年金は2028年4月の見直し前の制度で計算しています（2028年4月以後に亡くなる想定）";

/** 知らせの文の定義。group が同じ知らせは1行にまとめ、part をその行の内訳にする */
interface Msg {
  kind: NoticeKind;
  text: string;
  card?: StageId;
  group?: string;
  part?: string;
}

const inherit = (what: string): Msg => ({ kind: "missing", text: `${what}は相続税の対象になりますが、相続税はお金の流れに入れていません（受け取る額をそのまま入れています）`, group: "inheritanceTax" });

/**
 * 文の表。鍵は「コード|部品|話題」「コード|話題」「コード|部品」の順に引く（話題は ID の最初の、物の ID でも年でもない文字）
 */
const MESSAGES: Readonly<Record<string, Msg>> = {
  // ---- 計算に入れていないもの ----
  "N_NOT_SUPPORTED|transfers": { kind: "missing", text: "口座の間の移し替えは、計算に入れていません（入れた移し替えは、お金の流れと残高に反映されていません）", card: "savings" },
  "N_NOT_SUPPORTED|incomeFlow.inheritanceTax": { kind: "missing", text: "受け取る相続の相続税は、計算に入れていません（受け取る額をそのまま入れています）", card: "inheritance" },
  "N_NOT_SUPPORTED|realEstate.businessTax": { kind: "missing", text: "収益不動産（事業的規模の目安に当たる貸付け・事業所得の民泊・宿）の個人事業税は、計算に入れていません", card: "rental" },
  "N_NOT_SUPPORTED|realEstate.saleNonBusinessPeriod": { kind: "missing", text: "売る物件に貸していない期間があります。その期間の建物の価値の減り（非業務用の減価）は取得費から引いていないので、譲渡所得の税が少なめに出ることがあります", card: "rental" },
  "N_NOT_SUPPORTED|realEstate.consumptionTax": { kind: "missing", text: "民泊・宿の売上が年1,000万円を超える年がありますが、消費税は計算に入れていません", card: "rental" },
  "N_NOT_SUPPORTED|residence.saleTax": { kind: "missing", text: "自宅を売ったときの譲渡所得の税は、計算に入れていません（住まいの項目で税の額を入れると計算に入ります）", card: "housing" },
  "N_NOT_SUPPORTED|residence.sale": { kind: "input", text: "持ち家の住まいが途中で終わりますが、売るかどうかが入っていないので、売ったお金は計算に入れていません", card: "housing" },
  "N_NOT_SUPPORTED|housing.residence|giftTax": { kind: "missing", text: "住まいの購入で受け取る贈与の贈与税（非課税の特例を含む）は、計算に入れていません", card: "housing" },
  "N_NOT_SUPPORTED|education.cost|giftTax": { kind: "missing", text: "教育の資金の贈与（祖父母からなど）の贈与税は、計算に入れていません", card: "education" },
  "N_NOT_SUPPORTED|giftTax": { kind: "missing", text: "贈与税は、計算に入れていません" },
  "N_NOT_SUPPORTED|giftTax.settlement.inheritanceAddBack": { kind: "missing", text: "相続時精算課税を選んだ贈与の、相続のときの加算（相続税の計算）は入れていません", card: "inheritance" },
  "N_NOT_SUPPORTED|debt.creditLife.illness": { kind: "missing", text: "団体信用生命保険のがん・3大疾病・8大疾病の保障は、計算に入れていません（死亡・高度障害の保障だけを入れています）", card: "housing" },
  "N_NOT_SUPPORTED|insurance.template": { kind: "missing", text: "まだ計算できない種類の保険の契約があり、その保険料と保障は計算に入れていません", card: "insurance" },
  "N_NOT_SUPPORTED|insurance.medicalBenefit": { kind: "missing", text: "医療保障（入院・手術・がんの給付など）は、病気の想定の中身（病名・入院の日数など）が入っていないので、計算に入れていません", card: "insurance" },
  "N_NOT_SUPPORTED|civilServant.retirementAllowance.adjustmentAmount": { kind: "missing", text: "公務員の退職手当の調整額は、計算に入れていません（基本額だけで計算しています）", card: "retirement" },
  "N_NOT_SUPPORTED|educationSupport.higher.assetTest": { kind: "missing", text: "大学などの修学支援（授業料の減免・給付型奨学金）は、資産の要件と理工農系の学部への支援を見ずに計算しています" },
  "N_NOT_SUPPORTED|educationSupport.higher.juniorCollegeVocational": { kind: "missing", text: "短大・専門学校の修学支援（授業料の減免・給付型奨学金）は、まだ計算していません" },
  "N_NOT_SUPPORTED|educationSupport.higher.kosenUpper": { kind: "missing", text: "高専の4・5年の修学支援（授業料の減免・給付型奨学金）は、まだ計算していません" },
  "N_NOT_SUPPORTED|socialInsurance.nationalHealth.preschoolReduction": { kind: "missing", text: "国民健康保険の未就学児の均等割の軽減と、産前産後の保険料の免除は、計算に入れていません" },
  "N_NOT_SUPPORTED|highCostMedical.over70": { kind: "missing", text: "70歳以上の高額療養費（自己負担の上限）は、まだ計算していません（70歳以後の医療費は上限なしで数えています）" },
  "N_NOT_SUPPORTED|incomeTax.housingLoanCredit.period.specialSpecified": { kind: "missing", text: "消費税10%で取得した住宅（令和元年10月〜令和3年の入居）の11〜13年目の住宅ローン控除は、建物の価格が要るので計算に入れていません", card: "housing" },
  "N_NOT_SUPPORTED|residentTax.designatedCityAllocation": { kind: "assumed", text: "住民税は標準の税率で計算しています（政令指定都市の税率の配分と、市区町村の超過課税は入れていません）" },
  "N_INHERITANCE_TAX|contingency.inheritance": { kind: "missing", text: "亡くなる想定の相続税は、お金の流れに入れていません（目安は万一のときのタブに出します）" },
  "N_INHERITANCE_TAX|insurance.deathBenefit": inherit("死亡保険金（亡くなった人が契約者の契約）"),
  "N_INHERITANCE_TAX|retirementBenefit.deathAllowance": inherit("死亡退職金"),
  "N_INHERITANCE_TAX|retirementBenefit.guaranteeRemainder": inherit("企業年金の保証期間の残り（ご家族が受け取る分）"),
  "N_INHERITANCE_TAX|account.ideco.deathLumpSum": inherit("iDeCo の死亡一時金"),
  "N_GIFT_TAX_BY_RECIPIENT|gift.tax": { kind: "missing", text: "贈与税のうち、世帯のお金の流れに入らない贈与の分は、お金の流れに入れていません", card: "inheritance" },
  // ---- 入力が足りない ----
  "N_INPUT_REQUIRED|residence.valuation": { kind: "input", text: "持ち家の時価の元（購入の価格か今の時価）が入っていないので、資産と負債に住まいの価値を入れていません", card: "housing" },
  "N_INPUT_REQUIRED|account.property.acquisition": { kind: "input", text: "貸している不動産の取得の時期・価格が入っていないので、減価償却を入れずに家賃の所得を計算しています", card: "rental" },
  "N_INPUT_REQUIRED|account.property.lodging": { kind: "input", text: "民泊・宿の1泊の単価か稼働率が入っていないので、その分の売上を0円で計算しています", card: "rental" },
  "N_INPUT_REQUIRED|retirementBenefit.amount": { kind: "input", text: "退職金の額が入っていない（目安も出せない）ので、退職金を0円で計算しています", card: "retirement" },
  "N_INPUT_REQUIRED|retirementBenefit.receipt.annualAmount": { kind: "input", text: "企業年金の年金の額（か受け取る年数）が入っていないので、年金を0円で計算しています", card: "retirement" },
  "N_INPUT_REQUIRED|goal.education.stages.annualOverride": { kind: "input", text: "専門学校・公立の短大の学費は統計の値が無いので、年額を入れてください（入れるまで0円で計算しています）", card: "education" },
  "N_INPUT_REQUIRED|insurance.simple.returnRate": { kind: "input", text: "貯蓄型の保険の解約返戻金の目安（返戻率）が入っていないので、解約返戻金を0円で数えています（資産と負債）", card: "insurance" },
  "N_INPUT_REQUIRED|socialInsurance.continuation.rates": { kind: "input", text: "任意継続の健康保険の保険料率が無いので、任意継続の保険料を0円で計算しています", card: "work" },
  "N_INPUT_REQUIRED|socialInsurance.nationalHealth.rates": { kind: "input", text: "国民健康保険の料率が無いので、国民健康保険料を0円で計算しています" },
  "N_INPUT_REQUIRED|pension.survivor.middleAgeSpecial": { kind: "input", text: "40歳以後の厚生年金の加入月数が入っていないので、遺族厚生年金の中高齢の特例を見ずに計算しています", card: "pension" },
  "N_INPUT_REQUIRED|lifeTable.lifeExpectancy": { kind: "outside", text: "平均余命の表に無い年齢なので、必要保障額の期間（平均余命まで）を出せませんでした" },
  // ---- 前提の外・制度の決まりで変えた所 ----
  "N_NOT_DEDUCTIBLE|advisoryFee": { kind: "outside", text: "FP顧問料は、所得税・住民税の控除にしていません（家計の支出として数えています）" },
  "N_LIMIT_APPLIED|ideco.contributionLimit": { kind: "outside", text: "iDeCo の掛金は、上限を超えた分を除いて計算しています", card: "savings" },
  "N_LIMIT_APPLIED|realEstate.lodging.days": { kind: "outside", text: "住宅宿泊事業（民泊）の営業日数は年180日までなので、180日で計算しています", card: "rental" },
  "N_LIMIT_APPLIED|income.miscellaneousLoss": { kind: "outside", text: "雑所得（副業・売電・個人年金など。公的年金を除く）の赤字は、ほかの雑所得と公的年金からだけ引き、給与などほかの所得からは引けないので、引ききれない分は0円として計算しています（副業を事業として営んでいるなら、所得の区分を事業所得にすると赤字を引けます）", card: "work" },
  "N_LIMIT_APPLIED|taxReturn.blueDeduction": { kind: "outside", text: "不動産所得が事業的規模の目安に当たらず事業所得も無い年は、青色申告特別控除の55万円・65万円を使えないので、10万円で計算しています", card: "rental" },
  "N_LIMIT_APPLIED|nisa.annualLimit": { kind: "outside", text: "NISA の投資枠を超える積立は、枠を超えた分を NISA の外（課税口座か預金）に置いて計算しています", card: "savings" },
  "N_LIMIT_APPLIED|pension.deferral.survivorRight": { kind: "outside", text: "繰下げの途中で遺族年金の受給権ができる想定なので、そこで繰下げを止めた額で計算しています", card: "pension" },
  "N_LIMIT_APPLIED|moneyRow.counterpartyDeath": { kind: "outside", text: "仕送り・援助などのお金の行は、相手が亡くなる見込みの月で止めました（行の終わりの値はそのままです）", card: "care" },
  "N_LIMIT_APPLIED|smallBusinessMutualAid.contribution.monthlyMax": { kind: "outside", text: "小規模企業共済の掛金は、上限の月額までにしています", card: "savings" },
  "N_NOT_ENTITLED|pension.qualifyingMonths": { kind: "outside", text: "受給資格期間（10年）に足りないので、老齢年金を0円で計算しています", card: "pension" },
  "N_NOT_ENTITLED|employmentInsurance.basicAllowance.requiredMonths": { kind: "outside", text: "雇用保険に入っていた期間が足りないので、辞めた後の失業の給付は出ない計算です", card: "work" },
  "N_NOT_ENTITLED|pension.disability.afterEarlyClaim": { kind: "outside", text: "老齢年金を繰上げた後の病気・けがなので、障害年金は出ない計算です" },
  "N_NOT_ELIGIBLE|educationSupport.highSchool.nationality": { kind: "outside", text: "高校の就学支援金の対象外として計算しています", card: "family" },
  "N_NOT_ELIGIBLE|incomeTax.housingLoanCredit.rate": { kind: "outside", text: "この入居の年は、住宅ローン控除の対象外です（令和13年以後の入居。いまの制度の期限の後）", card: "housing" },
  "N_NOT_ELIGIBLE|incomeTax.housingLoanCredit.limit.new.other": { kind: "outside", text: "令和6年以後に入居する新築の省エネ基準に合わない住宅は、住宅ローン控除の対象外です", card: "housing" },
  "N_PROTECTION_TRUNCATED|protection.horizon": { kind: "outside", text: "必要保障額の期間が表の最後の年を超えるので、表の最後の年で打ち切っています" },
  "N_REFORM_NOT_REFLECTED|survivorPension.reform2028": { kind: "outside", text: REFORM_TEXT },
  "N_RECONCILE_SURPLUS": { kind: "outside", text: "実際の支出との答え合わせで、計算の支出が実際の支出より多くなっています（説明のつかない支出は0円にしています）", card: "living" },
  // ---- 仮の値・推定 ----
  "N_ESTIMATED|pensionRecord": { kind: "assumed", text: "年金の加入記録（ねんきん定期便）が入っていないので、働き方の入力から推計して計算しています", card: "pension" },
  "N_ESTIMATED|education.nurseryFee.auto": { kind: "assumed", text: "保育料は、世帯の住民税から推計しています", card: "education" },
  "N_ESTIMATED|education.cost": { kind: "assumed", text: "学費の表に入学の年度の値が無いので、近い年度の学費で計算しています" },
  "N_ESTIMATED|inheritanceTax.estimate": { kind: "assumed", text: "相続税は目安です（小規模宅地等の特例・2割加算などは含めていません）" },
  "N_ESTIMATED|pension.disability.oldAgeChoice": { kind: "assumed", text: "障害年金と老齢年金は、多い方を受け取るものとして計算しています" },
  "N_ESTIMATED|pension.survivor.category1Months": { kind: "assumed", text: "国民年金（第1号）の納めた月数が入っていないので、加入記録から推計しています（死亡一時金・寡婦年金）", card: "pension" },
  "N_ESTIMATED|lifeTable.interpolated": { kind: "assumed", text: "平均余命は、表の年齢の間を按分して出しています" },
  "N_DEFAULT_USED|care.otherMonthly": { kind: "assumed", text: "介護の費用のうち入っていない所は、統計の平均で計算しています", card: "care", group: "care.default", part: "月々の費用" },
  "N_DEFAULT_USED|care.initial": { kind: "assumed", text: "介護の費用のうち入っていない所は、統計の平均で計算しています", card: "care", group: "care.default", part: "始めにかかる費用" },
  "N_DEFAULT_USED|care.months": { kind: "assumed", text: "介護の費用のうち入っていない所は、統計の平均で計算しています", card: "care", group: "care.default", part: "介護の期間" },
  "N_DEFAULT_USED|residence.valuation.landShare": { kind: "assumed", text: "土地と建物の割合が入っていないので、既定の割合で時価の変わり方を計算しています", card: "housing", group: "landShare" },
  "N_DEFAULT_USED|account.property.landShare": { kind: "assumed", text: "土地と建物の割合が入っていないので、既定の割合で時価の変わり方を計算しています", card: "rental", group: "landShare" },
  "N_ASSUMED|realEstate.saleEstimatedCost": { kind: "assumed", text: "売る物件の取得価額が入っていないので、取得費を売却価格の5%（概算取得費）として譲渡所得の税を計算しています", card: "rental" },
  "N_ASSUMED|realEstate.saleHoldingLong": { kind: "assumed", text: "売る物件の取得の年月が入っていないので、所有期間を5年超（長期譲渡）として計算しています", card: "rental" },
  "N_ASSUMED|realEstate.saleTaxSimplified": { kind: "assumed", text: "収益不動産を売ったときの譲渡所得の税は、特例（特別控除・買換えなど）と、引ききれない所得控除を譲渡所得から引く扱いを入れずに計算しています", card: "rental" },
  "N_ASSUMED|realEstate.repairExpensed": { kind: "assumed", text: "収益不動産の大きな修繕は、全額をその年の経費として計算しています", card: "rental" },
  "N_DEFAULT_USED|residentTax.exemption.perCapita.gradeOne": { kind: "assumed", text: "住民税の非課税の基準は、1級地（大都市）の額で計算しています" },
  "N_DEFAULT_USED|socialInsurance.care.firstInsured.nationalAverage": { kind: "assumed", text: "65歳以上の介護保険料は、全国平均の基準額で計算しています（お住まいの市区町村の額は入れていません）" },
  "N_DEFAULT_USED|socialInsurance.lateElderly.nationalAverage": { kind: "assumed", text: "後期高齢者医療の保険料は、全国平均の料率で計算しています" },
  "N_DEFAULT_USED|socialInsurance.nationalHealth.nationalStandard": { kind: "assumed", text: "国民健康保険料は、全国の標準の料率で計算しています（お住まいの市区町村の料率は入れていません）" },
  "N_DEFAULT_USED|inheritanceTax.realEstateRatio": { kind: "assumed", text: "相続税の目安の不動産の評価は、時価の80%としています" },
  "N_ASSUMED|account.contributions.afterRetirement": { kind: "assumed", text: "もう退職した人の積立（終わりが空欄）は、取り崩しの始まりの前の月まで続くものとしています", card: "savings" },
  "N_ASSUMED|giftTax.settlement.irrevocable": { kind: "assumed", text: "相続時精算課税は一度選ぶと戻せないので、後の年の同じ人からの贈与も精算課税で計算しています", card: "inheritance" },
  "N_ASSUMED|employmentInsurance.basicAllowance.rateBreak": { kind: "assumed", text: "雇用保険の給付率の変わり目の賃金日額は、それより前の月にも、制度データにある最初の期間の値を使っています" },
  "N_ASSUMED|pension.survivor.ownPensionBefore65": { kind: "assumed", text: "65歳までの遺族厚生年金と自分の老齢年金は、多い方を受け取るものとして計算しています" },
  "N_ASSUMED|pension.earlyClaim.simultaneous": { kind: "assumed", text: "老齢基礎年金と老齢厚生年金の繰上げは同時にする決まりなので、受け取り始めをそろえて計算しています", card: "pension" },
  "N_ASSUMED|incomeTax.housingLoanCredit.specifiedAcquisition": { kind: "assumed", text: "平成26〜令和3年の入居は、新築は消費税のかかった取得、中古は個人からの取得として、住宅ローン控除の借入限度額を決めています", card: "housing" },
  "N_ASSUMED|educationSupport.highSchool.nationality": { kind: "assumed", text: "高校の就学支援金は、支給の要件（国籍・在留資格）を満たすものとして計算しています" },
  "N_APPROXIMATED|education.nurseryFee.assessedResidentTax": { kind: "assumed", text: "保育料は、住民税の決定額から所得割を推計して計算しています（均等割の分だけ多め）" },
  "N_APPROXIMATED|educationSupport.higher.assessedResidentTax": { kind: "assumed", text: "大学などの修学支援の判定は、住民税の決定額から推計しています" },
  "N_APPROXIMATED|incomeTax.retirementIncome.specifiedOfficer.mixed": { kind: "assumed", text: "役員の期間と一般の期間がある退職金の退職所得は、近い値で計算しています" },
  "N_APPROXIMATED|smallBusinessMutualAid.benefitAmount": { kind: "assumed", text: "小規模企業共済の共済金は、掛金と納めた月数からの近い値で計算しています" },
  // ---- 制度データ ----
  "N_PARAM_MISSING|incomeTax.housingLoanCredit.rate": { kind: "data", text: "住宅ローン控除の控除率に、入居の年に合う値が制度データに無いので、住宅ローン控除を計算していません", card: "housing" },
  "N_PARAM_MISSING|socialInsurance.nationalHealth.childSupport.nationalStandard": { kind: "data", text: "国民健康保険の子ども・子育て支援金分の標準の料率が制度データに無いので、その分は保険料に入れていません" },
  "N_PARAM_MISSING|pension.supplementaryBenefit.supplementaryIncomeLimit": { kind: "data", text: "年金生活者支援給付金（補足的な給付）の所得の基準が制度データに無い年は、その給付を計算していません" },
  "N_FICTIONAL_DATA": { kind: "data", text: "学費の表に架空の見本のデータを使っています（実際の学費ではありません）" },
};

/** 種類ごとの決まりの文（文の表に無い知らせ） */
const FALLBACK: Readonly<Record<string, Msg>> = {
  N_NOT_SUPPORTED: { kind: "missing", text: "まだ計算に入れていない制度があります" },
  N_INHERITANCE_TAX: { kind: "missing", text: "相続税の対象になる受け取りがありますが、相続税はお金の流れに入れていません", group: "inheritanceTax" },
  N_INPUT_REQUIRED: { kind: "input", text: "入力が足りないので、計算していない所があります" },
  N_ESTIMATED: { kind: "assumed", text: "推定の値で計算した所があります" },
  N_DEFAULT_USED: { kind: "assumed", text: "入っていない所を、既定の値で計算しています" },
  N_ASSUMED: { kind: "assumed", text: "前提を置いて計算した所があります" },
  N_APPROXIMATED: { kind: "assumed", text: "近い値で計算した所があります" },
  N_LIMIT_APPLIED: { kind: "outside", text: "制度の上限で、額を抑えて計算した所があります" },
  N_NOT_ENTITLED: { kind: "outside", text: "受け取る条件を満たさないので、0円にした給付があります" },
  N_NOT_ELIGIBLE: { kind: "outside", text: "対象外として計算した制度があります" },
};

const FUTURE: Msg = { kind: "data", text: "制度の値が決まっていない先の年は、最後に決まっている値をそのまま使うか、前提（賃金・物価）で延ばして計算しています", group: "future" };
const MISSING_PARAM: Msg = { kind: "data", text: "制度データに値が無い（原本での確認待ちの）所は、その分を計算していないか、いまの水準の値で計算しています", group: "paramMissing" };
const RECORDED_LATER: Msg = { kind: "data", text: "制度データの後の版で記録した値を、前の時点の計算に使った所があります", group: "recordedLater" };
// さかのぼりの仮定（0099）: 制度データが持っている時期より前の値（計算基準月より前の年の所得に対する住民税・保険料の控除、年金を受け取り始めた頃の額など）
const BACKFILLED: Msg = { kind: "data", text: "制度データが持っている時期より前の値は、制度データのいちばん古い値で計算しています（その時期の実際の制度の値とは違うことがあります）", group: "backfilled" };

/** 部品の ID が前に付かない知らせ（エンジンの全体の段が出す） */
const NO_COMPONENT_CODES = new Set(["N_PARAM_EXTENDED", "N_PARAM_RECORDED_LATER", "N_PARAM_BACKFILLED"]);
const NO_COMPONENT_TOPICS = new Set(["account.contributions.afterRetirement"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 知らせ1件を、部品・話題・物の ID・年に分ける */
export function parseNotice(n: { code: string; ids: readonly string[] }): { component: string | null; topics: string[]; subjects: string[]; years: number[] } {
  const hasComponent = !NO_COMPONENT_CODES.has(n.code) && !NO_COMPONENT_TOPICS.has(n.ids[0] ?? "") && n.ids.length > 0;
  const rest = hasComponent ? n.ids.slice(1) : [...n.ids];
  const topics: string[] = [];
  const subjects: string[] = [];
  const years: number[] = [];
  for (const id of rest) {
    if (UUID.test(id)) subjects.push(id);
    else if (/^\d{4}$/.test(id)) years.push(Number(id));
    else if (/^\d{4}-\d{2}$/.test(id)) years.push(Number(id.slice(0, 4)));
    else topics.push(id);
  }
  return { component: hasComponent ? (n.ids[0] as string) : null, topics, subjects, years };
}

/** 制度の値の名前（登録簿の名前。後ろの括弧の注は省く。名前の無い値は「制度の値」） */
export function paramName(ref: string): string {
  const id = ref.replace(/@\d+$/, "");
  const l = PARAM_LABELS[id];
  return l === undefined ? "制度の値" : l.replace(/（[^（）]*）$/, "");
}

/** 知らせ1件の文の定義と、まとめる鍵・内訳 */
function messageOf(code: string, component: string | null, topics: readonly string[]): { msg: Msg; key: string; part: string | null } {
  const topic = topics[0] ?? "";
  if (code === "N_PARAM_EXTENDED" || code === "N_PARAM_PROJECTED") return { msg: FUTURE, key: "future", part: paramName(topic) };
  if (code === "N_PARAM_RECORDED_LATER") return { msg: RECORDED_LATER, key: "recordedLater", part: paramName(topic) };
  if (code === "N_PARAM_BACKFILLED") return { msg: BACKFILLED, key: "backfilled", part: paramName(topic) };
  const hit = MESSAGES[`${code}|${component ?? ""}|${topic}`] ?? MESSAGES[`${code}|${topic}`] ?? MESSAGES[`${code}|${component ?? ""}`] ?? MESSAGES[code];
  if (hit !== undefined) return { msg: hit, key: hit.group ?? `${code}|${component ?? ""}|${topic}`, part: hit.part ?? null };
  if (code === "N_PARAM_MISSING") return { msg: MISSING_PARAM, key: "paramMissing", part: [...new Set(topics.map(paramName))].join("・") };
  const fb = FALLBACK[code] ?? { kind: "data" as const, text: "計算の前提についての知らせがあります" };
  return { msg: fb, key: fb.group ?? code, part: null };
}

/** 文の表（か、制度の値の知らせの決まりの文）で文を持つ知らせか（持たない知らせは種類の決まりの文で出る。テストで見本の世帯の知らせを確かめる） */
export function knownNotice(n: { code: string; ids: readonly string[] }): boolean {
  const p = parseNotice(n);
  const m = messageOf(n.code, p.component, p.topics).msg;
  return !Object.values(FALLBACK).includes(m) && !(m.text === "計算の前提についての知らせがあります");
}

/** 知らせの1行（同じ知らせをまとめた後） */
export interface NoticeRow {
  key: string;
  kind: NoticeKind;
  text: string;
  /** 対象の人・物の呼び名（無ければ空） */
  subjects: string[];
  /** 年の範囲（例: 2027〜2050年。無ければ null） */
  years: string | null;
  /** 内訳（制度の値の名前と年など。無ければ空） */
  parts: string[];
  /** 出たプランの名前（全部のプランで出たとき・プランが1つのときは null） */
  plans: string[] | null;
  /** 入力で直せるカード（無ければ null） */
  card: StageId | null;
}

/** 知らせを集める元（帯のプランごとの結果） */
export interface NoticeSource {
  /** プランの名前（例: 現状・プランB） */
  label: string;
  result: PreviewResult | null;
  /** そのプランの要求（プランで足した物の呼び名を引く。省くと現状の世帯から引く） */
  request?: EngineRequest;
}

const range = (lo: number, hi: number) => (lo === hi ? `${lo}年` : `${lo}〜${hi}年`);

/** 物の ID → 呼び名（人・子の教育・退職金・保険・口座・住まい・介護など。分からない物は null） */
export function nameResolver(wh: WorkingHousehold, requests: readonly EngineRequest[] = []): (id: string) => string | null {
  const people = memberLabels(wh);
  const map = new Map<string, string>();
  const who = (id: unknown) => (typeof id === "string" ? (people.get(id) ?? null) : null);
  for (const req of [wh.request, ...requests]) {
    const h = req.input.household;
    for (const m of h.members) if (!map.has(m.id)) map.set(m.id, people.get(m.id) ?? "ご家族");
    const put = (id: string, name: string | null) => {
      if (name !== null && !map.has(id)) map.set(id, name);
    };
    for (const g of h.goals ?? []) put(g.id, g.education !== undefined ? `${who(g.owner) ?? "子"}の教育` : typeof g.label === "string" ? g.label : null);
    for (const b of h.retirementBenefits ?? []) put(b.id, `${who(b.member) ?? ""}の退職金・企業年金`);
    for (const c of h.insuranceContracts ?? []) put(c.id, typeof c.label === "string" && c.label !== "" ? c.label : `${who(c.insured) ?? ""}の保険`);
    for (const a of h.accounts ?? []) put(a.id, typeof a.label === "string" && a.label !== "" ? a.label : `${who(a.owner) ?? ""}の口座・資産`);
    for (const r of h.residences ?? []) put(r.id, r.kind === "rent" ? "賃貸の住まい" : "持ち家");
    for (const c of h.careExpenses ?? []) put(c.id, `${who(c.member) ?? ""}の介護`);
    for (const p of h.employmentPeriods ?? []) put(p.id, `${who(p.member) ?? ""}の働き方の期間`);
    for (const l of h.livingExpenses ?? []) put(l.id, "基本生活費");
  }
  return (id) => map.get(id) ?? null;
}

/** 呼び名の並び（世帯の構成員の順、次に物の順。呼び名を引いた順に番号を振る） */
function subjectOrder(wh: WorkingHousehold): (name: string) => number {
  const order = new Map<string, number>();
  for (const name of memberLabels(wh).values()) if (!order.has(name)) order.set(name, order.size);
  return (name) => order.get(name) ?? 1000;
}

/**
 * 子の知らせのうち、FP が直す所でないもの: 子の年金の加入記録の推計（子は加入記録を入れないので、推計なのが当たり前）。
 * 受給資格期間に足りない知らせは、エンジンが働き方も加入の記録も入れていない子には出さない（働き方を入れた子には出す）
 */
const CHILD_SILENT = new Set(["N_ESTIMATED|pensionRecord"]);
function dropSubject(code: string, topic: string, subject: string, req: EngineRequest): boolean {
  if (CHILD_SILENT.has(`${code}|${topic}`)) return req.input.household.members.find((m) => m.id === subject)?.kind === "child";
  return false;
}

/**
 * 帯のプランの結果の知らせを、FP 向けの行にする。同じ知らせ（同じ文の行）は1行にまとめ、対象・年・内訳・出たプランを足す。
 * 並びは種類の順（NOTICE_KINDS）、同じ種類の中は最初に出た順
 */
export function noticeRows(wh: WorkingHousehold, sources: readonly NoticeSource[]): NoticeRow[] {
  const nameOf = nameResolver(wh, sources.flatMap((s) => (s.request !== undefined ? [s.request] : [])));
  const rank = subjectOrder(wh);
  const acc = new Map<string, { msg: Msg; subjects: Set<string>; lo: number | null; hi: number | null; parts: Map<string, { lo: number | null; hi: number | null }>; plans: Set<string> }>();
  const counted = sources.filter((s) => s.result !== null);
  for (const s of counted) {
    for (const n of s.result?.header.notices ?? []) {
      const p = parseNotice(n);
      const topic = p.topics[0] ?? "";
      const subjects = p.subjects.filter((x) => !dropSubject(n.code, topic, x, s.request ?? wh.request));
      if (p.subjects.length > 0 && subjects.length === 0) continue;
      const m = messageOf(n.code, p.component, p.topics);
      let a = acc.get(m.key);
      if (a === undefined) {
        a = { msg: m.msg, subjects: new Set(), lo: null, hi: null, parts: new Map(), plans: new Set() };
        acc.set(m.key, a);
      }
      a.plans.add(s.label);
      for (const x of subjects) {
        const name = nameOf(x);
        if (name !== null) a.subjects.add(name);
      }
      const lo = p.years.length > 0 ? Math.min(...p.years) : null;
      const hi = p.years.length > 0 ? Math.max(...p.years) : null;
      if (m.part !== null && m.part !== "") {
        const q = a.parts.get(m.part) ?? { lo: null, hi: null };
        if (lo !== null && hi !== null) a.parts.set(m.part, { lo: q.lo === null ? lo : Math.min(q.lo, lo), hi: q.hi === null ? hi : Math.max(q.hi, hi) });
        else a.parts.set(m.part, q);
      } else if (lo !== null && hi !== null) {
        a.lo = a.lo === null ? lo : Math.min(a.lo, lo);
        a.hi = a.hi === null ? hi : Math.max(a.hi, hi);
      }
    }
  }
  const order = new Map(NOTICE_KINDS.map((k, i) => [k.id, i]));
  const rows = [...acc.entries()].map(([key, a]): NoticeRow => ({
    key,
    kind: a.msg.kind,
    text: a.msg.text,
    subjects: [...a.subjects].sort((x, y) => rank(x) - rank(y)),
    years: a.lo !== null && a.hi !== null ? range(a.lo, a.hi) : null,
    parts: [...a.parts.entries()].map(([name, y]) => (y.lo !== null && y.hi !== null ? `${name}（${range(y.lo, y.hi)}）` : name)),
    plans: counted.length > 1 && a.plans.size < counted.length ? counted.filter((s) => a.plans.has(s.label)).map((s) => s.label) : null,
    card: a.msg.card ?? null,
  }));
  return rows.map((r, i) => ({ r, i })).sort((x, y) => (order.get(x.r.kind) ?? 9) - (order.get(y.r.kind) ?? 9) || x.i - y.i).map((x) => x.r);
}

/** 種類ごとの数 */
export function noticeCounts(rows: readonly NoticeRow[]): Record<NoticeKind, number> {
  const out: Record<NoticeKind, number> = { input: 0, missing: 0, outside: 0, assumed: 0, data: 0 };
  for (const r of rows) out[r.kind]++;
  return out;
}

/** 行の添え書き（対象・年・内訳・プラン）を1つの文に */
export function noticeMeta(r: NoticeRow): string[] {
  const out: string[] = [];
  if (r.subjects.length > 0) out.push(`対象: ${r.subjects.join("・")}`);
  if (r.years !== null) out.push(`年: ${r.years}`);
  if (r.parts.length > 0) out.push(`内訳: ${r.parts.join("、")}`);
  if (r.plans !== null) out.push(`${r.plans.join("・")}だけ`);
  return out;
}
