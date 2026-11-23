// 相続税の目安（0039）: 時点ごとに、亡くなる人の財産から相続税のだいたいの額を出す。お金の流れ（キャッシュフロー表）には入れない（表示だけ）。
// 要求の inheritanceTax を指定したときだけ、根の部品の後にエンジンが呼ぶ（必要保障額の推移と同じ。キャッシュフロー表の部品の結果を使い回す）。
// - 時点: 万一の想定（死亡）の無い要求では「いま本人・配偶者が亡くなったら」（now。亡くなる月は計算基準月）と「二人とも亡くなった後」
//   （bothAfter。表の最後の年の12月。後に亡くなる人は lastSurvivor、省略は年下の人、同じなら配偶者）。万一の想定（死亡）のある要求では、
//   その想定の時点（contingency）だけ
// - 財産（亡くなる人の名義の分）: 金融資産（いまは入力の時価、ほかの時点は財産を見る年の年末の残高。万一の想定は亡くなる年の前の年末）＋
//   不動産（年末の評価額×評価の割合。省略は 0.8＝時価の80%の推定。持ち家は名義の割合 ownership で分ける。持ち始める時点の前の不動産は
//   評価額の行が無いので入らない）＋車・その他の資産・保険の契約の権利（亡くなる人が被保険者でない契約の解約返戻金）＋死亡保険金
//   （亡くなる人が契約者で被保険者の契約）＋死亡退職金（退職給付の見込みを勤続の月数で按分。確定拠出年金・小規模企業共済の残高を含む）＋
//   相続時精算課税で贈与した財産（年ごとの基礎控除の後。gift.tax の settlementByGiver）−債務（負債の残高のうち亡くなる人の分。団信で消える分を
//   除く）−葬式の費用。名義の無い財産は unassignedShare（省略は夫婦なら半分、一人なら全部）。二人とも亡くなった後は夫婦の財産を合わせる
// - 非課税: 死亡保険金と死亡退職金のそれぞれ 500万円×法定相続人の数（制度データ）
// - 法定相続人: 配偶者（法律婚だけ。事実婚は入れない）＋第1順位 子（世帯の子と世帯の外の子。先に亡くなった子の子は代襲で親の分を分ける）、
//   子がいなければ第2順位 直系尊属（親、親がいなければ祖父母）、それもいなければ第3順位 兄弟姉妹。世帯の外の家族は構成員の印 outside か、
//   世帯の外の家族から作った贈与者（relative・leaves）から数える。亡くなる見込み（leaves）が亡くなる月以前の世帯の外の家族と、まだ生まれていない
//   子は数えない。誰の家族か（of）の無い世帯の外の家族は本人の家族と読む。養子（adopted）は実子がいれば1人・いなければ2人まで数える
//   （数えない養子は目安の分け方からも外す）。数は heirCounts で直せる（代襲・放棄など。直したときは、配偶者のほかを同じ順位で等分とみなす）
// - 税: 課税価格の合計−基礎控除（3,000万円＋600万円×法定相続人の数）を法定相続分で分け（1,000円未満切り捨て）、速算表を当てて合計
//   （100円未満切り捨て）。目安は法定相続分どおりに分けたとし、各人の税＝税の総額×法定相続分。配偶者の軽減は 配偶者の税×（配偶者の取得額と
//   「1億6,000万円か法定相続分の額の多い方」の小さい方）÷課税価格の合計。精算課税で払った贈与税は受け取った相続人の税から引き、引ききれない分は
//   還付（refund）。納める額は各人の100円未満を切り捨てる
// - FP が入れた額（overrides）があれば amount はその額（state: confirmed）。目安は消さずに並べる
// - 改訂2（0170）: 万一の想定の時点は、年金で受け取る死亡保険金（収入保障。相続税の対象）も受け取る総額で数える（いまの時点の死亡保障額と同じ）。
//   二人とも亡くなった後は、夫婦のどちらかが団信の対象の負債の残高を債務から除く（先に亡くなった人の死亡で消えている）
// - 改訂3・約束の版 1.1（0039 の追記）: 亡くなった人がまだ払っていない、死亡の年までの所得の税（所得税・住民税・事業税。上場株式等と暗号資産の
//   譲渡益の税を除く。必要保障額で数える物と同じ範囲。0170 の追記）を債務に入れる（相続税法13条1項・14条2項）。内訳の unpaidTaxes（債務の内数）。
//   準確定申告の還付は、亡くなった人の財産としてその他に入れる。万一の想定の時点はその表（亡くなった月より後に、亡くなった人の名で払う税）、
//   いまの時点は計算基準月に亡くなる想定の表（ctx.deathScenario。必要保障額の計算基準年と同じ表）。二人とも亡くなった後は入れない（払う月が表の
//   終わりより後になる）
// - 改訂4（0039 の追記 2026-11-15）: いまの時点（と、計算基準年の万一の想定の時点）の財産は、どれも計算基準月の初め（入力の時価の時点。
//   その月のお金の動きの前）の姿で数える。前は金融資産だけ入力の時価で、不動産・車・負債・解約返戻金は計算基準年の年末の残高の行、死亡保険金は
//   その年の12月の死亡保障額だったので、計算基準年のうちに買う家（頭金を払う前の預金と、買った後の家の両方）・これから始まる保険が入り、
//   今年のうちに終わる保険・売る物件が抜けた
//   - 計算基準月か、それより後に買う・借りる・持ち始める・結ぶ物（住まいの購入・注文住宅の土地・持ち始める時点・負債・自動車ローン・車の最初の購入・
//     保険の契約）は入れない。計算基準月から12月までに売る住まい・物件は、その年の評価額で入れる
//   - 額: 金融資産・確定拠出年金・小規模企業共済・貸していない不動産・その他の資産は入力の時価。住まい・物件は計算基準年の評価額（評価額は
//     年ごとに変わるので、計算基準月の額と同じ）。いまの時点の世帯の負債は計算基準月の残高（年末の残高＋計算基準月から12月までに返す元金。
//     未払利息は年末の額）。死亡保険金は計算基準月の死亡保障額（insurance.policy の start。必要保障額と同じ）。車と解約返戻金は年末の額の近似
//     （月ごとの額を持たない）。万一の想定の時点の負債は、団信で消える分が想定の表で減っているので、年末の残高のまま
// - 入れていない決まり（notIncluded）: 2割加算・小規模宅地等の特例・土地の評価の細部・一次と二次の分け方の比べ・暦年課税の贈与の加算・
//   相次相続控除・未成年者控除・障害者控除・受け取る側の目安（親の遺産の総額から）。当たりそうなとき（兄弟姉妹が相続人・持ち家がある・数えない
//   養子がいる・相続人でない人への精算課税の贈与）は cautions に出す
// - 改訂5（0232）: 収益不動産の建てる・買う予定の「土地ごと買う」は、買う月から持つ物として数える（持ち始める時点と同じ。予定の無い世帯の結果は同じ）
// - 改訂6・約束の版 1.2（0231）: 「相続税も試算する」（要求の detailed）の世帯だけ、不動産ごとの設定（lands）で土地と建物を評価し、小規模宅地等の
//   特例・2割加算・未成年者控除を入れる。detailed の無い世帯の結果は改訂5と同じ（年ごとの計算は増やさない。時点ごとに1回）
//   - 土地（物件全体）: 路線価×面積・固定資産税評価額×倍率・固定資産税評価額×8/7（推定）・時価×評価の割合（省略）。補正の率を掛ける。入れた値は
//     計算基準年（持ち始めが後ならその年）の値とみなし、ほかの年は評価額の推移（土地の行）と同じ割合で動かす
//   - 建物: 固定資産税評価額（入れた値か、画面が固定資産税の目安から入れた推定 buildingEstimate。固定資産税の目安と同じ式〔0181。経過年数の補正率・
//     再建築費評点補正率。下限に届いたら横ばいで、出力に buildingFloor〕で評価の年へ動かす。構造と建った年の無い器は建物の行と同じ割合）。建てる・買う予定の物件は、
//     入れた値が無ければ asset.realEstate の評価の年の years[].assessed（予定の欄の額を評価替えごとに動かした額。0232）。無ければ時価×評価の割合
//   - 貸している物件: 建物は借家権割合（30%）×賃貸割合、土地は借地権割合×借家権割合×賃貸割合を引く（貸家・貸家建付地）。貸しているか・賃貸割合の省略は、
//     評価の年（valuationYear）の asset.realEstate の years[].rentedShare（年末の月に貸している割合。1−空室率、今の家賃で入れた物件は1、貸していなければ0。
//     0232）。評価額と同じ年末の姿で見る。民泊・宿は貸家にしない（rentedShare も出ない）
//   - 小規模宅地等の特例: 自宅（特定居住用 330㎡・80%）・事業（特定事業用と特定同族会社事業用 合わせて400㎡・80%）・貸付（200㎡・50%）。取得する人と
//     要件は利用者が選ぶ（一次は primary、二次〔二人とも亡くなった後〕は secondary。自宅を配偶者が取得するときは要件なし。一次で選んでいない自宅は
//     配偶者がいれば配偶者が取得するとみなす）。貸し始めて3年以内の貸付は対象にしない（事業的規模を3年を超えて続けている印があれば対象）。貸し始めは
//     asset.realEstate と同じ読み方（省略は建てる・買う予定の月か取得の月。予定の月・持ち始める月より前なら、その月）で、亡くなる月から数える。
//     面積の上限は、貸付を入れないとき自宅330㎡・事業400㎡を別に、入れるとき 自宅×200/330＋事業×200/400＋貸付≦200㎡。減る額の大きい土地から
//     適用し、貸付を入れる・入れないの多く減る方を採る
//   - 2割加算（兄弟姉妹・祖父母・代襲でない孫養子）と未成年者控除（法定相続人で18歳未満。引ききれない分は他の相続人〔配偶者から〕の税から引く）
import {
  RATE_ONE,
  type Rate,
  assessedAtFloor,
  assessedBuildingRatio,
  bracketFor,
  boxValue,
  defineComponent,
  formatYm,
  monthIndex,
  parseYm,
  propertyHoldStart,
  yearOf,
  yen,
  type AccountInput,
  type AnnualRow,
  type BuildingStructure,
  type ContingencyEventOutput,
  type CarOutput,
  type DebtInput,
  type DebtScheduleOutput,
  type HousingValuationOutput,
  type RealEstateOutput,
  type Flow,
  type GiftReceivedOutput,
  type GiftTaxOutput,
  type InsuranceContractInput,
  type InsurancePolicyOutput,
  type MemberInput,
  type MonthCtx,
  type MonthIndex,
  type RelationInput,
  type RetirementReceipt,
  type Yen,
} from "../../sdk/index.ts";

type Point = "now" | "bothAfter" | "contingency";

interface Request {
  readonly points?: readonly Point[];
  readonly members?: readonly string[];
  readonly lastSurvivor?: string;
  readonly realEstateRatio?: string;
  readonly unassignedShare?: string;
  readonly funeral?: Yen;
  readonly adopted?: readonly string[];
  readonly heirCounts?: readonly { readonly decedent: string; readonly count: number }[];
  readonly retirementAllowances?: readonly { readonly decedent: string; readonly amount: Yen }[];
  readonly overrides?: readonly { readonly point: Point; readonly decedent?: string; readonly amount: Yen }[];
  readonly detailed?: boolean;
  readonly lands?: readonly LandSetting[];
  readonly division?: Division;
  readonly timeline?: TimelineRequest;
}

/**
 * 遺産の分け方（0251。相続税も試算する世帯だけ）。割合は財産の評価額（小規模宅地等の特例の前。債務・葬式の費用を引く前）のうち。
 * spouseShare は一次の相続（配偶者がいる人の相続）で配偶者が取得する割合（省略は法定相続分）。shares は配偶者のほかの相続人の分け方
 * （配偶者の分を除いた残りのうちの割合。入れていない人は、残りを法定相続分の比で分ける。合計が1を超える・全員入れて1でないときは使わず、
 * 法定相続分どおりにして注意 divisionSharesInvalid）。first は一次と二次の推移で先に亡くなる人（lastSurvivor が無いときの後に亡くなる人を決める）
 */
interface Division {
  readonly spouseShare?: string;
  readonly shares?: readonly { readonly member: string; readonly share: string }[];
  readonly first?: string;
}
/** 一次と二次の推移（0251）: 比較する分け方（key と配偶者の割合。spouseShare の省略は法定相続分）と、年の間引き（step 年ごと） */
interface TimelineRequest {
  readonly alternatives?: readonly { readonly key: string; readonly spouseShare?: string }[];
  readonly step?: number;
}

type Acquirer = "spouse" | "cohabiting" | "noHome" | "successor" | "other";
interface Choice {
  readonly acquirer: Acquirer;
  readonly met?: boolean;
  /** 取得する人（0251。配偶者のほかの相続人。省略は配偶者のほかの相続人で分け方の割合どおりに分ける） */
  readonly member?: string;
}
type Use = "residence" | "rental" | "business" | "familyCompany" | "none";
/** 相続税の試算の不動産1つの設定（0231。物件全体の値） */
interface LandSetting {
  readonly object: string;
  readonly area?: string;
  readonly method?: "market" | "routePrice" | "multiplier" | "fixedEstimate";
  readonly routePrice?: Yen;
  readonly fixedValue?: Yen;
  readonly multiplier?: string;
  readonly adjustment?: string;
  readonly leaseholdRatio?: keyof typeof LEASEHOLD;
  readonly buildingValue?: Yen;
  readonly buildingEstimate?: Yen;
  readonly rentalRatio?: string;
  readonly use?: Use;
  readonly rentalContinued?: boolean;
  readonly primary?: Choice;
  readonly secondary?: Choice;
}

/** 借地権割合（路線価図の記号。財産評価基本通達の財産評価基準書の凡例）。省略は D（60%。0231） */
export const LEASEHOLD = { A: "0.9", B: "0.8", C: "0.7", D: "0.6", E: "0.5", F: "0.4", G: "0.3" } as const;
export const LEASEHOLD_DEFAULT = "D";
/** 借家権割合（財産評価基準書。各国税局とも30%。財産評価基本通達94） */
export const TENANCY_RIGHT_RATIO = "0.3";
/** 固定資産税評価額から路線価の水準を推定する割合（評価額は公示価格の7割程度、路線価は8割程度を目途とするため 8/7。0231） */
export const FIXED_TO_ROUTE = { num: 8, den: 7 } as const;

const P = {
  base: "inheritanceTax.basicDeduction.base",
  perHeir: "inheritanceTax.basicDeduction.perHeir",
  table: "inheritanceTax.rateTable",
  insurance: "inheritanceTax.lifeInsurance.exemptionPerHeir",
  retirement: "inheritanceTax.retirementAllowance.exemptionPerHeir",
  spouseFloor: "inheritanceTax.spouseReduction.floor",
  adoptedWith: "inheritanceTax.adoptedChildren.withNatural",
  adoptedWithout: "inheritanceTax.adoptedChildren.withoutNatural",
  taxableRound: "inheritanceTax.taxable.rounding",
  totalRound: "inheritanceTax.total.rounding",
  taxRound: "inheritanceTax.tax.rounding",
  resArea: "inheritanceTax.smallLand.residential.areaLimit",
  resRate: "inheritanceTax.smallLand.residential.reductionRate",
  bizArea: "inheritanceTax.smallLand.business.areaLimit",
  bizRate: "inheritanceTax.smallLand.business.reductionRate",
  rentArea: "inheritanceTax.smallLand.rental.areaLimit",
  rentRate: "inheritanceTax.smallLand.rental.reductionRate",
  rentRecent: "inheritanceTax.smallLand.rental.recentYears",
  surcharge: "inheritanceTax.surcharge.rate",
  minorPerYear: "inheritanceTax.minorCredit.perYear",
  minorAge: "inheritanceTax.minorCredit.untilAge",
};

/** 所得の税の行（所得税・住民税・事業税。上場株式等と暗号資産の譲渡益の税は除く。必要保障額の protection.need と同じ範囲。改訂3） */
const UNPAID_TAX_ROWS = ["cf.taxSi.incomeTax", "cf.taxSi.residentTax", "cf.taxSi.businessTax"];
const UNPAID_TAX_EXCLUDED: ReadonlySet<string> = new Set(["cf.taxSi.incomeTax.capitalGains", "cf.taxSi.residentTax.capitalGains", "cf.taxSi.incomeTax.cryptoAsset", "cf.taxSi.residentTax.cryptoAsset"]);
const isUnpaidTaxRow = (row: string): boolean => !UNPAID_TAX_EXCLUDED.has(row) && UNPAID_TAX_ROWS.some((p) => row === p || row.startsWith(`${p}.`));

/** 不動産の評価の割合の推定（土地の路線価は公示価格等の8割程度を目途に定められる。国税庁の路線価等の公表資料。0039） */
export const REAL_ESTATE_RATIO = "0.8";

/** 目安に含めていない決まり（いつも同じ一覧） */
export const NOT_INCLUDED: readonly string[] = [
  "twentyPercentSurcharge",
  "smallLandSpecial",
  "landValuationDetail",
  "primarySecondaryComparison",
  "calendarGiftAddBack",
  "successiveInheritanceCredit",
  "minorCredit",
  "disabilityCredit",
  "receivingSideEstimate",
];

/**
 * 相続税も試算する世帯（detailed）で含めていない決まり（0231。土地の評価・小規模宅地等の特例・2割加算・未成年者控除を外し、補正の細部を足す。
 * 0251 で一次と二次の分け方の比較を外した〔分け方と推移〕）
 */
export const NOT_INCLUDED_DETAILED: readonly string[] = [
  "landCorrectionDetail",
  "calendarGiftAddBack",
  "successiveInheritanceCredit",
  "disabilityCredit",
  "receivingSideEstimate",
];

const FINANCIAL_EXCLUDED: ReadonlySet<string> = new Set(["realEstate", "insurance", "otherAsset", "ideco", "corporateDc", "smallBusinessMutualAid"]);
/** 死亡退職金と同じ扱い（退職手当金等）の器: 確定拠出年金の死亡一時金・小規模企業共済の死亡の共済金 */
const RETIREMENT_KINDS: ReadonlySet<string> = new Set(["ideco", "corporateDc", "smallBusinessMutualAid"]);

type Relation = "spouse" | "child" | "grandchild" | "parent" | "grandparent" | "sibling";

interface Heir {
  member: string;
  relation: Relation;
  outside: boolean;
  counted: boolean;
  adopted: boolean;
  representing?: string;
  /** 法定相続分（数えない養子は null） */
  share: [bigint, bigint] | null;
}

/** 親族の候補（構成員と、世帯の外の家族から作った贈与者） */
interface Person {
  id: string;
  kind: string;
  outside: boolean;
  /** 誰の家族か（世帯の外の家族。省略は null） */
  of: string | null;
  birth: MonthIndex | null;
  joins: MonthIndex | null;
  expected: boolean;
  /** 亡くなる見込み（世帯の外の家族だけ） */
  dies: MonthIndex | null;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
};
const frac = (n: bigint, d: bigint): [bigint, bigint] => {
  const g = gcd(n, d);
  return [n / g, d / g];
};
const fmtFrac = (f: [bigint, bigint]) => `${f[0]}/${f[1]}`;
type Frac = [bigint, bigint];
const F0: Frac = [0n, 1n];
const F1: Frac = [1n, 1n];
const fAdd = (a: Frac, b: Frac): Frac => frac(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const fSub = (a: Frac, b: Frac): Frac => frac(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const fMul = (a: Frac, b: Frac): Frac => frac(a[0] * b[0], a[1] * b[1]);
const fDiv = (a: Frac, b: Frac): Frac => (b[0] === 0n ? F0 : frac(a[0] * b[1], a[1] * b[0]));
const fCmp = (a: Frac, b: Frac): number => {
  const d = a[0] * b[1] - b[0] * a[1];
  return d > 0n ? 1 : d < 0n ? -1 : 0;
};
/** 10進の文字列の割合（0〜1）を分数に */
const fOf = (text: string): Frac => {
  const [i, f = ""] = text.split(".");
  let den = 1n;
  for (let k = 0; k < f.length; k++) den *= 10n;
  return frac(BigInt(`${i ?? "0"}${f}`), den);
};

type SpecialStatus = "applied" | "limit" | "notSet" | "notMet" | "noArea" | "within3Years" | "notLived" | "notRented" | "none";
/** 不動産1つの評価（亡くなる人の分）と小規模宅地等の特例（0231） */
type LandResult = {
  object: string;
  method: "market" | "routePrice" | "multiplier" | "fixedEstimate";
  /** 時価（亡くなる人の分。土地・建物） */
  landMarket: Yen;
  buildingMarket: Yen;
  /** 評価（亡くなる人の分。貸家建付地・貸家の減額の後、特例の前） */
  land: Yen;
  building: Yen;
  buildingSource: "entered" | "estimate" | "market" | "none";
  /** 建物の固定資産税評価額の経過年数の補正率が下限（20%）に届いていて、評価替えでも下がらない（入れた値・推定・予定の欄の額のとき） */
  buildingFloor?: true;
  rentalRatio?: string;
  /** 土地の面積のうち亡くなる人の分（㎡） */
  area?: string;
  use: Use;
  special: { status: SpecialStatus; rate?: string; acquirer?: Acquirer; member?: string; defaulted?: boolean; appliedArea?: string; reduction: Yen; recentRental?: boolean };
};

type PointResult = {
  point: Point;
  decedent: string;
  month: string;
  valuationYear: number;
  status: "ok" | "noHeirs" | "noData";
  assets: Record<
    "financial" | "realEstateMarket" | "realEstate" | "other" | "insurance" | "insuranceExempt" | "retirement" | "retirementExempt" | "settlementGifts" | "debts" | "funeral" | "taxablePrice",
    Yen
  > & { unpaidTaxes?: Yen; smallLandReduction?: Yen };
  heirs: { member: string; relation: Relation; outside: boolean; counted: boolean; share?: string; adopted?: boolean; representing?: string }[];
  heirCount: number;
  heirCountOverridden: boolean;
  basicDeduction: Yen;
  taxableEstate: Yen;
  totalTax: Yen;
  spouseReduction: Yen;
  settlementCredit: Yen;
  byHeir: {
    member?: string;
    count?: number;
    outside: boolean;
    acquisition: Yen;
    tax: Yen;
    spouseReduction: Yen;
    credit: Yen;
    payable: Yen;
    refund: Yen;
    surcharge?: Yen;
    minorCredit?: Yen;
    /** 0251: 取得した土地の小規模宅地等の特例で減った額（相続税も試算する世帯で、特例の減額を取得する人に寄せたとき） */
    landReduction?: Yen;
    successiveCredit?: Yen;
  }[];
  /** 0231: 2割加算・未成年者控除の合計（相続税も試算する世帯だけ） */
  surcharge?: Yen;
  minorCredit?: Yen;
  /** 0231: 不動産ごとの評価と小規模宅地等の特例（相続税も試算する世帯だけ） */
  lands?: LandResult[];
  /** 0251: 相次相続控除の合計（一次と二次の推移の二次だけ） */
  successiveCredit?: Yen;
  /** 0251: 分け方（相続税も試算する世帯だけ）。配偶者が取得した割合（評価額のうち）と、取得する土地の評価に合わせて割合を直したか */
  division?: { entered: boolean; spouseShare?: string; adjusted?: true };
  payable: Yen;
  payableHousehold: Yen;
  payableOutside: Yen;
  refund: Yen;
  noTax: boolean;
  margin: Yen;
  amount: Yen;
  state: "estimated" | "confirmed";
  cautions: string[];
};

/** 一次と二次の推移の1年（0251） */
type TimelineRow = {
  year: number;
  month: string;
  primary: Yen;
  secondary: Yen;
  total: Yen;
  primaryTaxable: Yen;
  secondaryTaxable: Yen;
  spouseAcquisition: Yen;
  spouseTax: Yen;
  inherited: Yen;
  successiveCredit: Yen;
  secondaryMinorCredit: Yen;
};
type Timeline = {
  first: string;
  second: string;
  secondMonth: string;
  step: number;
  /** 二次の相続人がいないので二次を計算していない（0251） */
  secondaryStatus?: "noHeirs";
  series: { key: string; spouseShare?: string; rows: TimelineRow[] }[];
};

export default defineComponent<{ request: Request }, { points: PointResult[]; notIncluded: readonly string[]; timeline?: Timeline }>({
  id: "inheritance.estimate",
  title: "相続税の目安（基礎控除・法定相続人・非課税・速算表・配偶者の軽減・精算課税の足し戻し）",
  contract: "1.3",
  revision: 7,
  requires: {
    "plan.cashflow": ">=1 <2",
    "insurance.policy": ">=1 <2",
    "retirement.receipts": ">=1 <2",
    "retirement.benefit": ">=1 <2",
    "contingency.event": ">=1 <2",
    "contingency.lumpSum": ">=1 <2",
    "gift.received": ">=1 <2",
    "gift.tax": ">=1 <2",
    "housing.valuation": ">=1 <2",
    "asset.realEstate": ">=1 <2",
    "debt.schedule": ">=1 <2",
    "expense.car": ">=1 <2",
  },
  params: Object.values(P),
  reads: [
    "member.kind",
    "member.birth",
    "member.joins",
    "member.leaves",
    "member.expected",
    "member.outside",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.marriage",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
    "donor.kind",
    "donor.of",
    "donor.relative",
    "donor.leaves",
    "account.kind",
    "account.owner",
    "account.marketValue",
    "account.property",
    "account.holdFrom",
    "account.sale",
    "insurance.policyholder",
    "insurance.insured",
    "insurance.contractDate",
    "debt.debtors",
    "debt.creditLife",
    "debt.start",
    "car.purchase",
    "residence.ownership",
    "residence.from",
    "residence.to",
    "residence.purchase",
    "residence.valuation",
    "goal.kind",
    "goal.owner",
  ],
  input: "inheritance.estimate.input",
  output: "inheritance.estimate.output",
  compute(input, ctx) {
    const req = input.request;
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    const donors = ctx.list<{ id: string; kind: string; of?: string; relative?: string; leaves?: unknown }>("donor");
    const adults = members.filter((m) => m.outside === undefined && (m.kind === "self" || m.kind === "spouse"));
    const self = adults.find((m) => m.kind === "self") ?? adults[0];
    const adopted = new Set(req.adopted ?? []);
    const resolveTp = (tp: unknown): MonthIndex | null => (tp === null || tp === undefined ? null : ctx.time.resolve(tp as never));

    // 親族の候補
    const people: Person[] = [
      ...members.map(
        (m): Person => ({
          id: m.id,
          kind: m.kind,
          outside: m.outside !== undefined,
          of: m.outside?.of ?? null,
          birth: (m.birth as { birthYearMonth?: string } | undefined)?.birthYearMonth !== undefined ? parseYm((m.birth as { birthYearMonth: string }).birthYearMonth) : null,
          joins: resolveTp(m.joins),
          expected: m.expected,
          dies: m.outside !== undefined ? resolveTp(m.leaves) : null,
        }),
      ),
      ...donors.map(
        (d): Person => ({ id: d.id, kind: d.relative ?? d.kind, outside: true, of: d.of ?? null, birth: null, joins: null, expected: false, dies: resolveTp(d.leaves) }),
      ),
    ];
    const byId = new Map(people.map((p) => [p.id, p]));
    // 人の並びは入力の順（構成員、世帯の外の家族から作った贈与者の順）
    const inOrder = (ids: ReadonlySet<string>): string[] => people.filter((p) => ids.has(p.id)).map((p) => p.id);
    const alive = (id: string, D: MonthIndex): boolean => {
      const p = byId.get(id);
      if (p === undefined) return false;
      if (p.birth !== null && p.birth > D) return false;
      if (p.expected && p.joins !== null && p.joins > D) return false;
      if (p.dies !== null && p.dies <= D) return false;
      return true;
    };
    // 世帯の外の家族の「誰の家族か」（省略は本人）
    const ofOf = (p: Person): string | null => p.of ?? self?.id ?? null;
    const parentsGiven = relations.some((r) => r.type === "parentOf");
    const childrenOfX = (x: string): string[] => {
      const out = new Set<string>();
      for (const r of relations) if (r.type === "parentOf" && r.parent === x) out.add(r.child);
      const me = byId.get(x);
      if (!parentsGiven && me !== undefined && !me.outside && (me.kind === "self" || me.kind === "spouse")) {
        for (const p of people) if (!p.outside && p.kind === "child") out.add(p.id);
      }
      for (const p of people) if (p.outside && p.kind === "child" && ofOf(p) === x) out.add(p.id);
      return inOrder(out);
    };
    const parentsOfX = (x: string): string[] => {
      const out = new Set<string>();
      for (const r of relations) if (r.type === "parentOf" && r.child === x && byId.get(r.parent)?.kind !== "self" && byId.get(r.parent)?.kind !== "spouse") out.add(r.parent);
      for (const p of people) if (p.kind === "parent" && (p.outside ? ofOf(p) : self?.id) === x) out.add(p.id);
      return inOrder(out);
    };
    const ofKind = (x: string, kind: string): string[] => people.filter((p) => p.kind === kind && (p.outside ? ofOf(p) : self?.id) === x).map((p) => p.id);
    const legalSpouseAt = (x: string, D: MonthIndex): string | null => {
      for (const r of relations) {
        if (r.type !== "spouse" || r.marriage !== "legal" || (r.a !== x && r.b !== x)) continue;
        const from = resolveTp(r.from);
        const to = resolveTp(r.to);
        if ((from !== null && from > D) || (to !== null && to < D)) continue;
        const other = r.a === x ? r.b : r.a;
        if (alive(other, D)) return other;
      }
      return null;
    };

    /** 法定相続人（spouseAllowed は配偶者を数えるか。二人とも亡くなった後は数えない） */
    const heirsOf = (x: string, D: MonthIndex, spouseAllowed: boolean, childrenFrom: readonly string[] | null, at: MonthCtx): Heir[] => {
      const heirs: Heir[] = [];
      const spouse = spouseAllowed ? legalSpouseAt(x, D) : null;
      // 第1順位: 子（代襲は parentOf の関係でたどる）
      const childIds = childrenFrom ?? childrenOfX(x);
      const lines: { head: string; members: { id: string; representing?: string }[] }[] = [];
      for (const c of childIds) {
        if (c === x) continue;
        if (alive(c, D)) lines.push({ head: c, members: [{ id: c }] });
        else {
          const grand = inOrder(new Set(relations.flatMap((r) => (r.type === "parentOf" && r.parent === c && alive(r.child, D) ? [r.child] : []))));
          if (grand.length > 0) lines.push({ head: c, members: grand.map((g) => ({ id: g, representing: c })) });
        }
      }
      let others: Heir[] = [];
      if (lines.length > 0) {
        // 養子の数の制限（数えない養子は目安の分け方からも外す）
        const natural = lines.filter((l) => l.members.some((m) => m.representing !== undefined) || !adopted.has(l.head));
        const adoptedLines = lines.filter((l) => !natural.includes(l));
        const limit = (natural.length > 0 ? at.paramCount(P.adoptedWith) : at.paramCount(P.adoptedWithout)) ?? adoptedLines.length;
        const countedLines = [...natural, ...adoptedLines.slice(0, limit)];
        const n = BigInt(countedLines.length);
        for (const l of lines) {
          const counted = countedLines.includes(l);
          for (const m of l.members) {
            others.push({
              member: m.id,
              relation: m.representing !== undefined ? "grandchild" : "child",
              outside: byId.get(m.id)?.outside ?? false,
              counted,
              adopted: adopted.has(m.id),
              ...(m.representing !== undefined ? { representing: m.representing } : {}),
              share: counted ? [1n, n * BigInt(l.members.length)] : null,
            });
          }
        }
      } else {
        // 第2順位: 直系尊属（親、いなければ祖父母）
        let asc = parentsOfX(x).filter((p) => alive(p, D));
        let rel: Relation = "parent";
        if (asc.length === 0) {
          asc = ofKind(x, "grandparent").filter((p) => alive(p, D));
          rel = "grandparent";
        }
        if (asc.length === 0) {
          asc = ofKind(x, "sibling").filter((p) => alive(p, D));
          rel = "sibling";
        }
        others = asc.map((id) => ({ member: id, relation: rel, outside: byId.get(id)?.outside ?? true, counted: true, adopted: false, share: [1n, BigInt(asc.length)] }));
      }
      // 配偶者と組み合わせた法定相続分（民法900条）
      if (spouse !== null) {
        const rank = others.find((h) => h.counted)?.relation;
        const sp: [bigint, bigint] = rank === undefined ? [1n, 1n] : rank === "child" || rank === "grandchild" ? [1n, 2n] : rank === "sibling" ? [3n, 4n] : [2n, 3n];
        const rest: [bigint, bigint] = [sp[1] - sp[0], sp[1]];
        heirs.push({ member: spouse, relation: "spouse", outside: byId.get(spouse)?.outside ?? false, counted: true, adopted: false, share: sp });
        for (const h of others) if (h.share !== null) h.share = frac(rest[0] * h.share[0], rest[1] * h.share[1]);
      }
      for (const h of others) if (h.share !== null) h.share = frac(h.share[0], h.share[1]);
      return [...heirs, ...others];
    };

    // 年末の残高の行（plan.cashflow）
    const cashflow = ctx.call<{ annual: readonly AnnualRow[]; flows: readonly Flow[] }>("plan.cashflow", {});
    const annual = cashflow.annual;
    // 年末の残高の行を年ごとに1回だけ分けておく（一次と二次の推移で年ごとに読むため。0251）
    const balanceByYear = new Map<number, AnnualRow[]>();
    for (const a of annual) {
      if (!a.row.startsWith("cf.balance.")) continue;
      const list = balanceByYear.get(a.year);
      if (list === undefined) balanceByYear.set(a.year, [a]);
      else list.push(a);
    }
    const rowsOf = (y: number): readonly AnnualRow[] => balanceByYear.get(y) ?? [];
    const accounts = ctx.list<AccountInput>("account");
    const contracts = ctx.list<InsuranceContractInput>("insurance");
    const debts = ctx.list<DebtInput>("debt");
    const residences = ctx.list<{ id: string; from: unknown; to?: unknown; purchase?: { at?: unknown; land?: { at: unknown } }; ownership?: readonly { member: string; share: string }[] }>("residence");
    // いまの時点（計算基準月。opening）の財産（改訂4）: 計算基準月の初め（入力の時価の時点。その月のお金の動きの前）に持っている物・借りている
    // 負債だけを数える。計算基準月より後に、または計算基準月に買う・借りる・持ち始める物は入れず、計算基準月より後に売る物は入れる
    const S = base;
    // 持っているか（住まいは購入〔注文住宅は土地の決済が早ければその月〕が計算基準月より前。購入の無い持ち家は住み始めが計算基準月まで。
    // 住まい以外の不動産は持ち始める時点が計算基準月より前。housing.valuation・asset.realEstate の持ち始めと同じ月）
    const heldAtS = new Map<string, boolean>();
    for (const r of residences) {
      if (r.purchase === undefined) {
        const from = resolveTp(r.from);
        heldAtS.set(r.id, from === null || from <= S);
        continue;
      }
      const bought = resolveTp(r.purchase.at ?? r.from);
      const land = r.purchase.land === undefined ? null : resolveTp(r.purchase.land.at);
      const from = land !== null && (bought === null || land < bought) ? land : bought;
      heldAtS.set(r.id, from === null || from < S);
    }
    for (const a of ctx.list<AccountInput>("account")) {
      // 建てる・買う予定の「土地ごと買う」は買う月から持つ（sdk の propertyHoldStart。0232）
      const from = a.kind === "realEstate" && a.property !== undefined ? propertyHoldStart(ctx, a.property) : null;
      if (from !== null) heldAtS.set(a.id, from < S);
    }
    // 計算基準月から計算基準年の12月までに売る不動産（年末の評価額の行が無い）の、その年の評価額
    const soldLater: { object: string; owner: string | null; value: Yen }[] = [];
    const realEstateOut = ctx.call<RealEstateOutput>("asset.realEstate", {}).properties;
    const valued = [...ctx.call<HousingValuationOutput>("housing.valuation", {}).properties, ...realEstateOut];
    for (const p of valued) {
      if (p.sale === null) continue;
      const m = parseYm(p.sale.ym);
      if (m >= S && yearOf(m) === baseYear && heldAtS.get(p.object) !== false) soldLater.push({ object: p.object, owner: p.owner, value: p.sale.value });
    }
    // 計算基準月に持っている車（今の車か、最初の購入の月が計算基準月より前の車。額は計算基準年の年末の評価額で近似）
    const carHeld = new Map<string, boolean>();
    for (const c of ctx.list<{ id: string; purchase?: { first: unknown; owned?: boolean } }>("car")) {
      const first = c.purchase === undefined ? null : resolveTp(c.purchase.first);
      carHeld.set(c.id, c.purchase !== undefined && (c.purchase.owned === true || (first !== null && first < S)));
    }
    // ほかの部品が作った自動車ローンの借りた月
    const carLoanStart = new Map<string, MonthIndex>();
    for (const m of members) for (const l of ctx.call<CarOutput>("expense.car", { member: m.id }).loans) if (l.start !== undefined) carLoanStart.set(l.object, parseYm(l.start));
    // 世帯の負債の計算基準月の残高（計算基準年の年末の残高＋計算基準月から12月までに返した元金。元金＝返済・繰上返済・売ったときの返済−利息に充てた額
    // −借り換えで新しいローンに含めた費用）。借りる月が計算基準月か、それより後の負債は数えない
    const debtAtS = new Map<string, { balance: Yen; unpaid: Yen }>();
    const PAID = (formula: string) => formula === "debt.schedule.equalPayment" || formula === "debt.schedule.equalPrincipal" || formula === "debt.schedule.salePayoff" || formula.startsWith("debt.schedule.prepayment.");
    for (const d of debts) {
      if (ctx.time.resolve(d.start) >= S) continue;
      const o = ctx.call<DebtScheduleOutput>("debt.schedule", { object: d.id });
      const e = o.yearEnd.find((x) => x.year === baseYear);
      if (e === undefined) continue;
      let paid = 0;
      for (const f of o.flows) {
        const m = parseYm(f.ym);
        if (m >= S && yearOf(m) === baseYear && PAID(f.formula)) paid += f.amount;
      }
      const interest = o.byYear?.find((x) => x.year === baseYear)?.interestPaid ?? 0;
      let financed = 0;
      for (const r of o.refinances ?? []) {
        const m = parseYm(r.ym);
        if (m >= S && yearOf(m) === baseYear && r.principal > r.before) financed += r.principal - r.before;
      }
      debtAtS.set(d.id, { balance: yen(Math.max(0, e.balance + (o.byYear === undefined ? 0 : paid - interest - financed))), unpaid: e.unpaidInterest });
    }
    const goals = ctx.list<{ id: string; kind: string; owner: string }>("goal");
    const realRatio = ctx.rate.of(req.realEstateRatio ?? REAL_ESTATE_RATIO);
    const policyOut = new Map<string, InsurancePolicyOutput>();
    const policy = (id: string) => {
      let o = policyOut.get(id);
      if (o === undefined) {
        o = ctx.call<InsurancePolicyOutput>("insurance.policy", { object: id });
        policyOut.set(id, o);
      }
      return o;
    };

    /** 亡くなる人（owners）の分の割合（名義の無い財産は unassigned） */
    const shareOf = (owner: string | null | undefined, owners: ReadonlySet<string>, unassigned: string): string | null => {
      if (owner === null || owner === undefined) return unassigned;
      return owners.has(owner) ? "1" : null;
    };
    const part = (amount: Yen, share: string | null): number => (share === null || amount <= 0 ? 0 : share === "1" ? amount : ctx.money.mulRate(amount, ctx.rate.of(share), "conv.exact"));


    // ---- 相続税も試算する世帯（detailed）: 不動産ごとの評価と小規模宅地等の特例（0231） ----
    const detailed = req.detailed === true;
    const landSettings = new Map((req.lands ?? []).map((l) => [l.object, l]));
    const VAL = "conv.asset.valuation";
    const rOf = (n: number): Rate => ctx.rate.of(String(n));
    const ZERO = ctx.rate.of("0");
    const valuedYears = new Map(valued.map((p) => [p.object, p.years]));
    /** 住まい以外の不動産の、その年の年末の相続税の評価の材料（asset.realEstate の years[].assessed・rentedShare。0232） */
    const realEstateYears = new Map(realEstateOut.map((p) => [p.object, p.years]));
    const realEstateYear = (object: string, year: number) => realEstateYears.get(object)?.find((e) => e.year === year);
    /** 入れた値（路線価・固定資産税評価額）の時点の物件全体の時価: 計算基準年（持ち始めが後ならその年）の年末の評価額。中身の無い器は入力の時価 */
    const refOf = (object: string): { land: number; building: number } => {
      const ys = valuedYears.get(object);
      if (ys !== undefined) {
        const y = ys.find((e) => e.year >= baseYear);
        return y === undefined ? { land: 0, building: 0 } : { land: y.land, building: y.building };
      }
      const a = accounts.find((x) => x.id === object);
      return { land: a === undefined ? 0 : (boxValue(a.marketValue) ?? 0), building: 0 };
    };
    const growth = (now: number, ref: number): Rate => (now > 0 && ref > 0 ? ctx.rate.div(rOf(now), rOf(ref)) : RATE_ONE);
    /** 入れた値の時点の年（計算基準年。持ち始めが後ならその年） */
    const refYearOf = (object: string): number => valuedYears.get(object)?.find((e) => e.year >= baseYear)?.year ?? baseYear;
    /**
     * 建物の構造と建った年（固定資産税評価額を評価替えごとに動かす元）。持ち家は housing.valuation と同じ読み方（構造の省略は木造、建った年の省略は
     * 評価の基にする額の時点の年）、住まい以外の不動産は asset.realEstate の建った年。中身の無い器は null（建物の行の推移と同じ割合で動かす）
     */
    const buildingFacts = new Map(realEstateOut.map((p) => [p.object, p.facts?.builtYear]));
    const buildingOf = (object: string): { structure: BuildingStructure; built: number } | null => {
      const r = residences.find((x) => x.id === object) as
        | { from: unknown; purchase?: { at?: unknown }; valuation?: { asOf?: string; structure?: BuildingStructure; builtYear?: number } }
        | undefined;
      if (r !== undefined) {
        const v = r.valuation;
        const purchaseAt = r.purchase === undefined ? null : resolveTp(r.purchase.at ?? r.from);
        const asOf = v?.asOf !== undefined ? parseYm(v.asOf) : (purchaseAt ?? S);
        return { structure: v?.structure ?? "wood", built: v?.builtYear ?? yearOf(asOf) };
      }
      const p = accounts.find((x) => x.id === object)?.property;
      const built = buildingFacts.get(object);
      if (p === undefined || built === undefined) return null;
      return { structure: (p.structure ?? "wood") as BuildingStructure, built };
    };
    /**
     * 貸しているか・賃貸割合の省略の値（評価の年 V の年末の月に貸している割合。asset.realEstate の rentedShare。0232）と、貸し始め（3年以内の貸付の判定。
     * asset.realEstate の貸し始めと同じ読み方: 省略は建てる・買う予定の月か取得の月。予定の月〔無ければ持ち始める月〕より前なら、その月）
     */
    const rentalAt = (object: string, V: number): { rented: boolean; ratio: Rate; start: MonthIndex | null } => {
      const a = accounts.find((x) => x.id === object);
      const p = a?.property;
      const r = p?.rental;
      // 民泊・宿は貸家（借家権）ではないので、貸家・貸家建付地と貸付の特例の省略の対象にしない（asset.realEstate の rentedShare も民泊・宿には出さない）
      if (a === undefined || p === undefined || r === undefined || p.lodging !== undefined) return { rented: false, ratio: ZERO, start: null };
      const share = realEstateYear(object, V)?.rentedShare;
      const ratio = share === undefined ? ZERO : ctx.rate.of(share);
      const planAt = p.planned !== undefined ? ctx.time.resolve(p.planned.at) : null;
      const acq = p.acquisition?.at !== undefined ? parseYm(p.acquisition.at) : null;
      const opStart = planAt ?? propertyHoldStart(ctx, p);
      let start = r.from !== undefined ? ctx.time.resolve(r.from) : (planAt ?? acq);
      if (start !== null && opStart !== null && opStart > start) start = opStart;
      return { rented: ctx.rate.compare(ratio, ZERO) > 0, ratio, start };
    };
    /** 亡くなる月に住んでいる持ち家か */
    const livedAt = (object: string, D: MonthIndex): boolean => {
      const r = residences.find((x) => x.id === object);
      if (r === undefined) return false;
      const from = resolveTp(r.from);
      const to = resolveTp(r.to);
      return (from === null || from <= D) && (to === null || to >= D);
    };
    type Cand = { i: number; kind: "residence" | "business" | "rental"; value: Yen; area: Rate; rate: Rate };
    /**
     * 面積の上限で、どの土地のどれだけの面積に特例を適用するか（措置法69条の4第2項）。貸付を入れないとき: 自宅330㎡・事業400㎡を別々に、
     * 1㎡あたりの減る額の大きい順。貸付を入れるとき: 自宅×200/330＋事業×200/400＋貸付≦200㎡ を、換算した1㎡あたりの減る額の大きい順
     * （分けられる量の詰め方なので、この順が最も多く減る）。2つのうち多く減る方（同じなら貸付を入れない方）
     */
    const allocate = (cands: readonly Cand[], at: MonthCtx): { applied: Map<number, Rate>; withRental: boolean } => {
      const lim = { residence: rOf(at.paramCount(P.resArea) ?? 0), business: rOf(at.paramCount(P.bizArea) ?? 0), rental: rOf(at.paramCount(P.rentArea) ?? 0) };
      const perArea = (c: Cand): Rate => ctx.rate.mul(ctx.rate.div(rOf(c.value), c.area), c.rate);
      const reductionOf = (c: Cand, a: Rate): Yen => ctx.money.mulRate(c.value, ctx.rate.mul(ctx.rate.div(a, c.area), c.rate), VAL);
      const byDesc = (key: (c: Cand) => Rate) => (a: Cand, b: Cand) => ctx.rate.compare(key(b), key(a)) || a.i - b.i;
      const minR = (a: Rate, b: Rate): Rate => (ctx.rate.compare(a, b) <= 0 ? a : b);
      // 貸付を入れない
      const a1 = new Map<number, Rate>();
      for (const kind of ["residence", "business"] as const) {
        let left = lim[kind];
        for (const c of cands.filter((x) => x.kind === kind).sort(byDesc(perArea))) {
          const take = minR(c.area, left);
          if (ctx.rate.compare(take, ZERO) <= 0) break;
          a1.set(c.i, take);
          left = ctx.rate.sub(left, take);
        }
      }
      const total = (m: Map<number, Rate>) => cands.reduce((sum, c) => sum + (m.has(c.i) ? reductionOf(c, m.get(c.i) as Rate) : 0), 0);
      if (!cands.some((c) => c.kind === "rental")) return { applied: a1, withRental: false };
      // 貸付を入れる（換算: 自宅 200/330・事業 200/400・貸付 1。割り算の丸めが出ないよう、上限の面積どうしの比で数える）
      const num = (c: Cand): Rate => (c.kind === "rental" ? RATE_ONE : lim.rental);
      const den = (c: Cand): Rate => (c.kind === "rental" ? RATE_ONE : lim[c.kind]);
      const a2 = new Map<number, Rate>();
      let left = lim.rental;
      for (const c of [...cands].sort(byDesc((c) => ctx.rate.div(ctx.rate.mul(perArea(c), den(c)), num(c))))) {
        const room = ctx.rate.div(ctx.rate.mul(left, den(c)), num(c));
        if (ctx.rate.compare(room, ZERO) <= 0) break;
        if (ctx.rate.compare(c.area, room) >= 0) {
          a2.set(c.i, room);
          left = ZERO;
        } else {
          a2.set(c.i, c.area);
          left = ctx.rate.sub(left, ctx.rate.div(ctx.rate.mul(c.area, num(c)), den(c)));
        }
      }
      return total(a2) > total(a1) ? { applied: a2, withRental: true } : { applied: a1, withRental: false };
    };
    /** 不動産ごとの評価（亡くなる人の分）と特例の減額 */
    const evaluateLands = (
      parts: ReadonlyMap<string, { land: number; building: number; unsplit: number; fullLand: number; fullBuilding: number; fullUnsplit: number; share: string }>,
      job: { decedent: string; D: MonthIndex; V: number; second: boolean },
      at: MonthCtx,
      cautions: Set<string>,
    ): { value: Yen; reduction: Yen; lands: LandResult[] } => {
      const { decedent: X, D, V, second } = job;
      const spouseAlive = !second && legalSpouseAt(X, D) !== null;
      const lands: LandResult[] = [];
      const cands: Cand[] = [];
      let value = 0;
      for (const [object, pt] of parts) {
        const st = landSettings.get(object);
        const isHome = residences.some((r) => r.id === object);
        const share = ctx.rate.of(pt.share);
        // 中身の無い器（と、その年のうちに売る物件）は時価の全部を土地とみなす
        const fullLand = pt.fullLand + pt.fullUnsplit;
        const ref = refOf(object);
        const gL = growth(fullLand, ref.land);
        // 建物の入れた値・推定は、固定資産税の目安と同じ式（0181。経過年数の補正率・再建築費評点補正率で評価替えごとに動かし、下限に届いたら横ばい）で
        // 入れた値の時点の年から評価の年へ動かす。構造と建った年が分からない器は、建物の行の推移と同じ割合
        const bf = buildingOf(object);
        const gB = bf !== null ? assessedBuildingRatio(ctx, bf.structure, bf.built, refYearOf(object), V) : pt.fullUnsplit > 0 && pt.fullBuilding === 0 ? gL : growth(pt.fullBuilding, ref.building);
        const adj = ctx.rate.of(st?.adjustment ?? "1");
        // 面積の省略は、住まい以外の不動産の中身の土地の面積（0079）
        const areaText = st?.area ?? (accounts.find((x) => x.id === object)?.property as { area?: { land?: string } } | undefined)?.area?.land;
        const area = areaText !== undefined ? ctx.rate.of(areaText) : null;
        let method = st?.method ?? "market";
        let landFull: Yen;
        if (method === "routePrice" && st?.routePrice !== undefined && area !== null) landFull = ctx.money.mulRate(st.routePrice, ctx.rate.mul(ctx.rate.mul(area, adj), gL), VAL);
        else if (method === "multiplier" && st?.fixedValue !== undefined && st.multiplier !== undefined) landFull = ctx.money.mulRate(st.fixedValue, ctx.rate.mul(ctx.rate.mul(ctx.rate.of(st.multiplier), adj), gL), VAL);
        else if (method === "fixedEstimate" && st?.fixedValue !== undefined) landFull = ctx.money.mulRate(ctx.money.mulRatio(st.fixedValue, FIXED_TO_ROUTE.num, FIXED_TO_ROUTE.den, VAL), ctx.rate.mul(adj, gL), VAL);
        else {
          if (method !== "market") cautions.add("landInputMissing");
          method = "market";
          landFull = ctx.money.mulRate(ctx.money.mulRate(yen(fullLand), realRatio, VAL), adj, VAL);
        }
        // 建物（固定資産税評価額。無ければ時価×評価の割合。中身の無い器を時価で評価するときは土地に含めている）。建てる・買う予定の物件は、入れた値が
        // 無ければ評価の年の asset.realEstate の assessed（予定の欄の額を評価替えごとに動かした額。0232）を使い、建物がまだ無い年は建物を数えない
        const plan = accounts.find((x) => x.id === object)?.property?.planned;
        const assessed = plan === undefined || st?.buildingValue !== undefined ? undefined : realEstateYear(object, V)?.assessed;
        const bv = st?.buildingValue ?? st?.buildingEstimate;
        let buildingFull: Yen = yen(0);
        let buildingSource: LandResult["buildingSource"] = "none";
        if (plan !== undefined && pt.fullBuilding === 0) {
          // 建てる予定の建物がまだ無い（土地だけ）
        } else if (assessed !== undefined) {
          buildingFull = assessed;
          buildingSource = plan?.assessed?.state === "estimated" ? "estimate" : "entered";
        } else if (pt.fullBuilding > 0 || (bv !== undefined && !(pt.fullUnsplit > 0 && method === "market"))) {
          if (bv !== undefined) {
            buildingFull = ctx.money.mulRate(bv, gB, VAL);
            buildingSource = st?.buildingValue !== undefined ? "entered" : "estimate";
          } else {
            buildingFull = ctx.money.mulRate(yen(pt.fullBuilding), realRatio, VAL);
            buildingSource = "market";
          }
        }
        // 貸家・貸家建付地（賃貸割合は亡くなる月に貸していなければ0）
        const rent = isHome ? { rented: false, ratio: ZERO, start: null } : rentalAt(object, V);
        const rr = rent.rented ? (st?.rentalRatio !== undefined ? ctx.rate.of(st.rentalRatio) : rent.ratio) : ZERO;
        if (ctx.rate.compare(rr, ZERO) > 0) {
          const tenancy = ctx.rate.of(TENANCY_RIGHT_RATIO);
          const lease = ctx.rate.of(LEASEHOLD[st?.leaseholdRatio ?? LEASEHOLD_DEFAULT]);
          buildingFull = ctx.money.mulRate(buildingFull, ctx.rate.sub(RATE_ONE, ctx.rate.mul(tenancy, rr)), VAL);
          landFull = ctx.money.mulRate(landFull, ctx.rate.sub(RATE_ONE, ctx.rate.mul(ctx.rate.mul(lease, tenancy), rr)), VAL);
        }
        const land = ctx.money.mulRate(landFull, share, VAL);
        const building = ctx.money.mulRate(buildingFull, share, VAL);
        value += land + building;
        const areaMine = area === null ? null : ctx.rate.mul(area, share);
        // 小規模宅地等の特例
        const use: Use = st?.use ?? (isHome ? "residence" : rent.rented ? "rental" : "none");
        const special: LandResult["special"] = { status: "none", reduction: yen(0) };
        if (use !== "none" && land > 0) {
          const kind = use === "residence" ? "residence" : use === "rental" ? "rental" : "business";
          const rate = at.paramRate(kind === "residence" ? P.resRate : kind === "rental" ? P.rentRate : P.bizRate) ?? ZERO;
          special.rate = ctx.rate.toString(rate);
          let choice = second ? st?.secondary : st?.primary;
          if (choice === undefined && use === "residence" && spouseAlive) {
            choice = { acquirer: "spouse" };
            special.defaulted = true;
          }
          if (choice !== undefined) {
            special.acquirer = choice.acquirer;
            if (choice.member !== undefined && choice.acquirer !== "spouse") special.member = choice.member;
          }
          const recentYears = at.paramCount(P.rentRecent) ?? 0;
          const recent = use === "rental" && rent.start !== null && rent.start > D - recentYears * 12;
          if (recent) special.recentRental = true;
          if (use === "residence" && !(isHome && livedAt(object, D))) special.status = "notLived";
          else if (use === "rental" && !rent.rented) special.status = "notRented";
          else if (recent && st?.rentalContinued !== true) special.status = "within3Years";
          else if (choice === undefined) special.status = "notSet";
          else if (choice.acquirer === "other" || (choice.acquirer === "spouse" && !spouseAlive) || !((choice.acquirer === "spouse" && use === "residence") || choice.met === true)) special.status = "notMet";
          else if (areaMine === null || ctx.rate.compare(areaMine, ZERO) <= 0) special.status = "noArea";
          else {
            special.status = "limit";
            cands.push({ i: lands.length, kind, value: land, area: areaMine, rate });
          }
          if (recent) cautions.add("smallLandRecentRental");
          if (special.status === "notSet") cautions.add("smallLandNotSet");
          if (special.status === "noArea") cautions.add("smallLandAreaMissing");
        }
        lands.push({
          object,
          method,
          landMarket: yen(pt.land + pt.unsplit),
          buildingMarket: yen(pt.building),
          land,
          building,
          buildingSource,
          ...((buildingSource === "entered" || buildingSource === "estimate") && bf !== null && assessedAtFloor(bf.structure, bf.built, V) ? { buildingFloor: true as const } : {}),
          ...(ctx.rate.compare(rr, ZERO) > 0 ? { rentalRatio: ctx.rate.toString(rr) } : {}),
          ...(areaMine !== null ? { area: ctx.rate.toString(areaMine) } : {}),
          use,
          special,
        });
      }
      let reduction = 0;
      if (cands.length > 0) {
        const { applied } = allocate(cands, at);
        for (const c of cands) {
          const a = applied.get(c.i);
          const l = lands[c.i] as LandResult;
          if (a === undefined) continue;
          const red = ctx.money.mulRate(c.value, ctx.rate.mul(ctx.rate.div(a, c.area), c.rate), VAL);
          l.special = { ...l.special, status: "applied", appliedArea: ctx.rate.toString(a), reduction: red };
          reduction += red;
          if (ctx.rate.compare(a, c.area) < 0) cautions.add("smallLandAreaLimit");
        }
        if (lands.some((l) => l.special.status === "limit")) cautions.add("smallLandAreaLimit");
      }
      return { value: yen(value), reduction: yen(reduction), lands };
    };

    /** 相続時精算課税で亡くなる人（X）が贈与した財産と、受け取った人が払った贈与税（亡くなる月 D までの贈与。受け取った人ごと） */
    const settlementCache = new Map<string, { recipient: string; amount: number; tax: number }[]>();
    const settlementOf = (X: string, D: MonthIndex): { recipient: string; amount: number; tax: number }[] => {
      const key = `${X}|${String(D)}`;
      const hit = settlementCache.get(key);
      if (hit !== undefined) return hit;
      const out: { recipient: string; amount: number; tax: number }[] = [];
      const defaultPayer = (recipient: string): string | undefined =>
        relations.flatMap((r) => (r.type === "parentOf" && r.child === recipient ? [r.parent] : []))[0] ?? members.find((m) => m.kind === "self")?.id;
      for (const m of members) {
        if (m.id === X) continue;
        const gifts = ctx.call<GiftReceivedOutput>("gift.received", { member: m.id }).gifts;
        // 精算課税は一度選ぶと同じ贈与者のその後の贈与にも当たる（gift.tax）ので、精算課税の贈与がある人は亡くなる月までの贈与の年をすべて見る
        if (!gifts.some((g) => g.method === "settlement")) continue;
        const years = [...new Set(gifts.filter((g) => parseYm(g.ym) <= D).map((g) => yearOf(parseYm(g.ym))))].sort((a, b) => a - b);
        for (const y of years) {
          const t = ctx.call<GiftTaxOutput>("gift.tax", { member: m.id, year: y });
          for (const e of t.settlementByGiver ?? []) {
            let giver = e.member;
            if (giver === undefined && e.giver.startsWith("household|")) {
              const goal = goals.find((g) => e.objects.includes(g.id));
              giver = goal !== undefined ? defaultPayer(goal.owner) : undefined;
            }
            if (giver !== X) continue;
            out.push({ recipient: m.id, amount: e.amount, tax: e.tax });
          }
        }
      }
      settlementCache.set(key, out);
      return out;
    };

    const contingencyDeath = (() => {
      for (const m of members) {
        const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: m.id }).event;
        if (ev !== null && ev.kind === "death") return { member: m.id, month: parseYm(ev.month) };
      }
      return null;
    })();
    const wanted = (p: Point) => req.points === undefined || req.points.includes(p);
    /**
     * 時点の計算の1件。kind: now（いま亡くなったら）・bothAfter（二人とも亡くなった後）・contingency（万一の想定）は出力の時点。
     * primaryAt（一次と二次の推移の、計算基準年より後の年の12月に先に亡くなる）・secondaryAt（その推移の二次。後に亡くなる人が表の最後の年の12月に亡くなる。
     * 一次で取得した土地の分を inherit で足す）は推移だけ（0251）
     */
    type Job = {
      point: Point;
      kind: "now" | "bothAfter" | "contingency" | "primaryAt" | "secondaryAt";
      decedent: string;
      D: MonthIndex;
      V: number;
      opening: boolean;
      owners: Set<string>;
      spouseAllowed: boolean;
      childrenFrom: string[] | null;
      /** 二次（secondaryAt）: 先に亡くなった人（from）の名義の不動産のうち、一次で後に亡くなる人が取得した割合（物ごと）と、名義の無い財産の先に亡くなった人の分 */
      inherit?: { from: string; unassigned: string; fraction: ReadonlyMap<string, Frac> };
    };
    const jobs: Job[] = [];
    // 二人とも亡くなった後の、後に亡くなる人（lastSurvivor。省略は年下の人、同じなら配偶者）と夫婦の子
    // 相続税も試算する世帯で先に亡くなる人（division.first）を選んでいれば、もう一人（0251。試算しない世帯は読まない）
    const firstChosen = req.detailed === true && req.division?.first !== undefined ? adults.find((a) => a.id !== req.division?.first && adults.some((b) => b.id === req.division?.first))?.id : undefined;
    const lastOf = (): string | undefined =>
      req.lastSurvivor ??
      firstChosen ??
      [...adults].sort((a, b) => {
        const ba = byId.get(a.id)?.birth ?? 0;
        const bb = byId.get(b.id)?.birth ?? 0;
        return bb - ba || (a.kind === "spouse" ? -1 : 1);
      })[0]?.id;
    const coupleKids = (): string[] => inOrder(new Set(adults.flatMap((a) => childrenOfX(a.id))));
    const nowJob = (id: string): Job => ({ point: "now", kind: "now", decedent: id, D: base, V: baseYear, opening: true, owners: new Set([id]), spouseAllowed: true, childrenFrom: null });
    if (contingencyDeath !== null) {
      if (wanted("contingency")) {
        const D = contingencyDeath.month;
        const y = yearOf(D);
        jobs.push({ point: "contingency", kind: "contingency", decedent: contingencyDeath.member, D, V: y > baseYear ? y - 1 : baseYear, opening: y <= baseYear, owners: new Set([contingencyDeath.member]), spouseAllowed: true, childrenFrom: null });
      }
    } else {
      if (wanted("now")) {
        const ids = req.members ?? adults.map((m) => m.id);
        for (const id of ids) jobs.push(nowJob(id));
      }
      if (wanted("bothAfter") && adults.length > 0) {
        const last = lastOf();
        if (last !== undefined) jobs.push({ point: "bothAfter", kind: "bothAfter", decedent: last, D: monthIndex(endYear, 12), V: endYear, opening: false, owners: new Set(adults.map((a) => a.id)), spouseAllowed: false, childrenFrom: coupleKids() });
      }
    }

    /** 税の総額までの材料（1つの時点）。分け方で変わらない部分 */
    type Gathered = {
      job: Job;
      at: MonthCtx;
      cautions: Set<string>;
      heirs: Heir[];
      N: number;
      given: number | undefined;
      base: PointResult;
      /** 財産の合計（特例の前。非課税の後）と、債務・葬式の費用、特例で減った額 */
      grossNoRed: number;
      deductions: number;
      reduction: number;
      landEval: { value: Yen; reduction: Yen; lands: LandResult[] } | null;
      credits: Map<string, number>;
      /** 相続時精算課税で贈与した財産（受け取った人ごと。分け方で、その人の取得の分に先に置く。0251） */
      gifts: Map<string, number>;
      exempt: number;
    };

    /** 時点1つの財産・相続人・課税価格（相続人がいない・制度データが無い時点は、出力の形のまま返す） */
    const gather = (job: Job): Gathered | PointResult => {
      const { point, decedent: X, D, V, opening, owners } = job;
      const second = job.kind === "bothAfter" || job.kind === "secondaryAt";
      const at = ctx.at(D);
      const empty = (status: PointResult["status"]): PointResult => ({
        point,
        decedent: X,
        month: formatYm(D),
        valuationYear: V,
        status,
        assets: { financial: yen(0), realEstateMarket: yen(0), realEstate: yen(0), other: yen(0), insurance: yen(0), insuranceExempt: yen(0), retirement: yen(0), retirementExempt: yen(0), settlementGifts: yen(0), debts: yen(0), funeral: yen(0), taxablePrice: yen(0) },
        heirs: [],
        heirCount: 0,
        heirCountOverridden: false,
        basicDeduction: yen(0),
        taxableEstate: yen(0),
        totalTax: yen(0),
        spouseReduction: yen(0),
        settlementCredit: yen(0),
        byHeir: [],
        payable: yen(0),
        payableHousehold: yen(0),
        payableOutside: yen(0),
        refund: yen(0),
        noTax: true,
        margin: yen(0),
        amount: yen(0),
        state: "estimated",
        cautions: [],
      });
      if (!at.has(P.base)) {
        ctx.notice("N_PARAM_MISSING", [P.base, X]);
        return empty("noData");
      }
      const cautions = new Set<string>();
      // 相続人
      const heirs = heirsOf(X, D, job.spouseAllowed, job.childrenFrom, at);
      const autoCount = heirs.filter((h) => h.counted).length;
      const given = req.heirCounts?.find((h) => h.decedent === X)?.count;
      const N = given ?? autoCount;
      if (heirs.some((h) => !h.counted)) cautions.add("adoptedLimit");
      if (!detailed && heirs.some((h) => h.relation === "sibling" || h.relation === "grandparent")) cautions.add("twentyPercentSurcharge");
      const hasSpouse = heirs.some((h) => h.relation === "spouse") || (second ? false : legalSpouseAt(X, D) !== null);
      // 二次（推移）は、名義の無い財産のうち一次で亡くなった人の分の残り（後に亡くなる人の分）
      const unassigned = job.inherit !== undefined ? ctx.rate.toString(ctx.rate.sub(RATE_ONE, ctx.rate.of(job.inherit.unassigned))) : (req.unassignedShare ?? (second || !hasSpouse || adults.length < 2 ? "1" : "0.5"));

      // 財産
      let financial = 0;
      let realMarket = 0;
      let other = 0;
      let retirement = 0;
      let insurance = 0;
      let debtTotal = 0;
      const insuredByX = new Set(contracts.filter((c) => c.insured === X).map((c) => c.id));
      const startOf = (id: string): MonthIndex => {
        const c = contracts.find((x) => x.id === id);
        return c === undefined ? S : parseYm(c.contractDate);
      };
      const rows = rowsOf(V);
      const residenceShareFor = (object: string | undefined, who: ReadonlySet<string>): string | null | undefined => {
        const r = residences.find((x) => x.id === object);
        if (r === undefined || r.ownership === undefined || r.ownership.length === 0) return undefined;
        let sum = ctx.rate.of("0");
        for (const o of r.ownership) if (who.has(o.member)) sum = ctx.rate.add(sum, ctx.rate.of(o.share));
        return ctx.rate.compare(sum, ctx.rate.of("0")) === 0 ? null : ctx.rate.toString(sum);
      };
      const residenceShare = (object: string | undefined) => residenceShareFor(object, owners);
      /** 二次（推移）: 先に亡くなった人の名義の不動産のうち、一次で後に亡くなる人が取得した分を足す（0251） */
      const withInherited = (object: string | undefined, member: string | null | undefined, own: string | null): string | null => {
        const inh = job.inherit;
        const f = inh === undefined || object === undefined ? undefined : inh.fraction.get(object);
        if (inh === undefined || f === undefined || f[0] === 0n) return own;
        const from = new Set([inh.from]);
        const rs = residenceShareFor(object, from);
        const xs = rs !== undefined ? rs : member === null || member === undefined ? inh.unassigned : member === inh.from ? "1" : null;
        if (xs === null) return own;
        const add = ctx.rate.div(ctx.rate.mul(ctx.rate.of(xs), rOf(Number(f[0]))), rOf(Number(f[1])));
        const sum = ctx.rate.add(own === null ? ZERO : ctx.rate.of(own), add);
        return ctx.rate.compare(sum, ZERO) === 0 ? null : ctx.rate.toString(sum);
      };
      let hasHome = false;
      // 不動産ごとの時価（物件全体 full と亡くなる人の分 mine。土地・建物・分けていない器。相続税も試算する世帯で使う。0231）
      const parts = new Map<string, { land: number; building: number; unsplit: number; fullLand: number; fullBuilding: number; fullUnsplit: number; share: string }>();
      const addPart = (object: string | undefined, kind: "land" | "building" | "unsplit", full: number, mine: number, share: string | null) => {
        if (object === undefined || share === null || mine <= 0) return;
        const e = parts.get(object) ?? { land: 0, building: 0, unsplit: 0, fullLand: 0, fullBuilding: 0, fullUnsplit: 0, share };
        if (kind === "land") {
          e.land += mine;
          e.fullLand += full;
        } else if (kind === "building") {
          e.building += mine;
          e.fullBuilding += full;
        } else {
          e.unsplit += mine;
          e.fullUnsplit += full;
        }
        parts.set(object, e);
      };
      /** 世帯の負債の、亡くなる人の分（負担の割合。団信で消える分を除く） */
      const debtShare = (d: DebtInput, total: Yen, unpaidInterest: boolean): number => {
        const mine = d.debtors.filter((x) => owners.has(x.member) && x.role !== "guarantor");
        if (mine.length === 0 || total <= 0) return 0;
        const payers = d.debtors.filter((x) => x.role !== "guarantor");
        // 負担の割合（share。書いていなければ債務者の数で等分）
        let amount: Yen;
        if (mine.every((m) => m.share !== undefined)) {
          let share = ctx.rate.of("0");
          for (const m of mine) share = ctx.rate.add(share, ctx.rate.of(m.share as string));
          amount = ctx.money.mulRate(total, share, "conv.exact");
        } else amount = ctx.money.mulRatio(total, mine.length, payers.length, "conv.exact");
        // 団信で消える分（亡くなる人が対象で、事由に死亡がある。二人とも亡くなった後は、夫婦のどちらかが対象なら先に亡くなった人の分も消えている。0170）
        const cl = d.creditLife;
        const deadCovered = cl === undefined ? [] : cl.covered.filter((m) => (second ? owners.has(m) : m === X));
        if (cl !== undefined && deadCovered.length > 0 && (cl.events ?? ["death"]).includes("death") && !unpaidInterest) {
          let ratio = ctx.rate.of("0");
          for (const m of deadCovered) {
            const xs = d.debtors.find((x) => x.member === m)?.share;
            ratio = ctx.rate.add(ratio, ctx.rate.of(cl.spouseJoint === true ? "1" : (cl.ratio ?? (d.debtors.length > 1 && xs !== undefined ? xs : "1"))));
          }
          if (ctx.rate.compare(ratio, ctx.rate.of("1")) > 0) ratio = ctx.rate.of("1");
          amount = yen(Math.max(0, amount - ctx.money.mulRate(total, ratio, "conv.exact")));
        }
        return amount;
      };
      if (opening) {
        for (const a of accounts) {
          const v = boxValue(a.marketValue) ?? yen(0);
          const s = shareOf(a.owner, owners, unassigned);
          // 貸していない不動産・その他の資産も入力の時価（計算基準月に持っている物。持ち始める時点が計算基準月か、それより後の物・計算基準月より前に売った物は入れない。改訂4）
          if ((a.kind === "realEstate" && a.property === undefined) || a.kind === "otherAsset") {
            if (a.holdFrom !== undefined && ctx.time.resolve(a.holdFrom) >= S) continue;
            if (a.sale !== undefined && ctx.time.resolve(a.sale.at) < S) continue;
            if (a.kind === "realEstate") {
              realMarket += part(v, s);
              addPart(a.id, "unsplit", v, part(v, s), s);
            } else other += part(v, s);
            continue;
          }
          if (FINANCIAL_EXCLUDED.has(a.kind) && !RETIREMENT_KINDS.has(a.kind)) continue;
          if (RETIREMENT_KINDS.has(a.kind)) retirement += part(v, s);
          else financial += part(v, s);
        }
        for (const x of soldLater) {
          const rs = residenceShare(x.object);
          const xs = rs !== undefined ? rs : shareOf(x.owner, owners, unassigned);
          const v = part(x.value, xs);
          if (v > 0 && residences.some((r) => r.id === x.object)) hasHome = true;
          realMarket += v;
          addPart(x.object, "unsplit", x.value, v, xs);
        }
        for (const d of job.kind === "now" ? debts : []) {
          const b = debtAtS.get(d.id);
          if (b !== undefined) debtTotal += debtShare(d, b.balance, false) + debtShare(d, b.unpaid, true);
        }
      }
      for (const a of rows) {
        const kind = a.row.slice("cf.balance.".length);
        if (kind.startsWith("account.")) {
          const k = kind.slice("account.".length);
          if (k.startsWith("realEstate")) {
            // いまの時点（改訂4）: 貸していない不動産の器は入力の時価で数えた（上）。住まい・貸している不動産は、持ち始める月が計算基準月より後の物を入れない
            if (opening && (k === "realEstate" || (a.object !== undefined && heldAtS.get(a.object) === false))) continue;
            const rs = residenceShare(a.object);
            const s = withInherited(a.object, a.member, rs !== undefined ? rs : shareOf(a.member, owners, unassigned));
            const v = part(a.amount, s);
            if (v > 0 && residences.some((r) => r.id === a.object)) hasHome = true;
            realMarket += v;
            addPart(a.object, k === "realEstate.land" ? "land" : k === "realEstate.building" ? "building" : "unsplit", a.amount, v, s);
            continue;
          }
          if (k === "insurance") {
            // 亡くなる人が被保険者の契約は死亡保険金で数える
            if (a.object !== undefined && insuredByX.has(a.object)) continue;
            // いまの時点は、計算基準月か、それより後に結ぶ契約を入れない（改訂4。額は年末の解約返戻金で近似）
            if (opening && a.object !== undefined && startOf(a.object) >= S) continue;
            other += part(a.amount, shareOf(a.member, owners, unassigned));
            continue;
          }
          if (k === "car" || k === "otherAsset") {
            // いまの時点（改訂4）: その他の資産は入力の時価で数えた（上）。車は計算基準月に持っている物だけ（額は年末の評価額で近似）
            if (opening && (k === "otherAsset" || (a.object !== undefined && carHeld.get(a.object) === false))) continue;
            other += part(a.amount, shareOf(a.member, owners, unassigned));
            continue;
          }
          if (opening) continue;
          const v = part(a.amount, shareOf(a.member, owners, unassigned));
          if (RETIREMENT_KINDS.has(k)) retirement += v;
          else financial += v;
          continue;
        }
        if (kind.startsWith("debt.")) {
          const d = debts.find((x) => x.id === a.object);
          if (d === undefined) {
            // ほかの部品が作った負債（自動車ローンなど）。いまの時点は、借りる月が計算基準月か、それより後の物を入れない（改訂4）
            const st = a.object === undefined ? undefined : carLoanStart.get(a.object);
            if (opening && st !== undefined && st >= S) continue;
            debtTotal += part(a.amount, shareOf(a.member, owners, unassigned));
            continue;
          }
          // 世帯の負債のいまの時点は、計算基準月の残高（上）。計算基準年の万一の想定の時点は、借りる月が計算基準月か、それより後の負債を入れない
          // （残高は年末の額。団信で消える分は想定の表で減っているため）
          if (opening && (job.kind === "now" || ctx.time.resolve(d.start) >= S)) continue;
          debtTotal += debtShare(d, a.amount, a.row === "cf.balance.debt.unpaidInterest");
        }
      }
      // 死亡保険金（亡くなる人が契約者で被保険者の契約。二人とも亡くなった後は夫婦のどちらかが契約者）
      for (const c of contracts) {
        // 推移の二次は、先に亡くなった人が契約者の契約（一次で受け継いだ契約）も数える（0251）
        const holderOk = owners.has(c.policyholder) || (job.inherit !== undefined && c.policyholder === job.inherit.from);
        if (c.insured !== X || !holderOk || (!second && c.policyholder !== X)) continue;
        const o = policy(c.id);
        if (job.kind === "contingency") {
          // 年金で受け取る死亡保険金（収入保障）も相続税の対象（相続税法3条1項1号）。いまの時点と同じく受け取る総額で数える（0170）
          for (const r of o.receipts) if ((r.kind === "death" || r.kind === "incomeProtection") && r.taxClass === "inheritance") insurance += r.amount;
        } else if (job.kind === "now") {
          // いまの時点は、計算基準月の死亡保障額（その年の最初の月の値。計算基準年は計算基準月。必要保障額と同じ取り方。改訂4。前はその年の12月の額）
          const e = o.years.find((x) => x.year === yearOf(D));
          insurance += e?.start?.deathBenefit ?? e?.deathBenefit ?? 0;
        } else insurance += o.years.find((e) => e.year === yearOf(D))?.deathBenefit ?? 0;
      }
      // 死亡退職金
      if (job.kind === "contingency") {
        const flows: readonly Flow[] = [
          ...ctx.call<{ flows: readonly Flow[] }>("retirement.benefit", { member: X }).flows,
          ...ctx.call<{ flows: readonly Flow[] }>("contingency.lumpSum", {}).flows,
        ];
        for (const f of flows) {
          if (f.formula === "retirement.benefit.deathAllowance" || f.formula === "contingency.lumpSum.retirementAllowance") retirement += f.amount;
          else if (f.formula === "retirement.benefit.guaranteeRemainder") other += f.amount;
        }
      } else {
        // いま亡くなったときの死亡退職金の額（0039。推移の先の年・二次には使わない）
        const givenRa = job.kind === "primaryAt" || job.kind === "secondaryAt" ? undefined : req.retirementAllowances?.find((r) => r.decedent === X)?.amount;
        if (givenRa !== undefined) retirement += givenRa;
        else {
          for (const r of ctx.call<{ receipts: readonly RetirementReceipt[] }>("retirement.receipts", { member: X }).receipts) {
            const m = parseYm(r.ym);
            if (r.source !== "retirement" || m <= D) continue;
            const f = parseYm(r.serviceFrom);
            const t = parseYm(r.serviceTo);
            retirement += t > D && D >= f ? ctx.money.mulRatio(r.amount, D - f + 1, t - f + 1, "conv.retirement.estimate") : D < f ? 0 : r.amount;
          }
        }
      }
      // 相続時精算課税で贈与した財産と、払った贈与税（受け取った人ごと）
      let settlement = 0;
      const credits = new Map<string, number>();
      const gifts = new Map<string, number>();
      for (const e of settlementOf(X, D)) {
        settlement += e.amount;
        credits.set(e.recipient, (credits.get(e.recipient) ?? 0) + e.tax);
        gifts.set(e.recipient, (gifts.get(e.recipient) ?? 0) + e.amount);
      }
      // 亡くなった人がまだ払っていない、死亡の年までの所得の税（相続する人が納める。相続税法13条1項・14条2項）と、準確定申告の還付（財産）
      let unpaidTaxes = 0;
      if (job.kind === "now" || job.kind === "contingency") {
        const scene = job.kind === "contingency" ? cashflow.flows : (ctx.deathScenario(X, D) ?? []);
        for (const f of scene) {
          if (f.member !== X || !isUnpaidTaxRow(f.row) || parseYm(f.ym) <= D || f.accrualYear > yearOf(D)) continue;
          if (f.amount > 0) unpaidTaxes += f.amount;
          else other -= f.amount;
        }
      }
      debtTotal += unpaidTaxes;
      const funeral = req.funeral ?? 0;

      // 非課税と課税価格
      const insExempt = Math.min(insurance, ctx.money.mulRatio(at.paramYen(P.insurance) ?? yen(0), N, 1, "conv.exact"));
      const retExempt = Math.min(retirement, ctx.money.mulRatio(at.paramYen(P.retirement) ?? yen(0), N, 1, "conv.exact"));
      // 相続税も試算する世帯は不動産ごとに評価し、小規模宅地等の特例で減らす（0231）。ほかは時価の合計×評価の割合（今まで）
      const landEval = detailed ? evaluateLands(parts, { decedent: X, D, V, second }, at, cautions) : null;
      const realEval = landEval !== null ? landEval.value : ctx.money.mulRate(yen(realMarket), realRatio, "conv.asset.valuation");
      const grossNoRed = financial + realEval + other + (insurance - insExempt) + (retirement - retExempt) + settlement;
      const reduction = landEval?.reduction ?? 0;
      const T = at.money.round(yen(Math.max(0, grossNoRed - reduction - debtTotal - funeral)), P.taxableRound);
      const basic = yen((at.paramYen(P.base) ?? 0) + ctx.money.mulRatio(at.paramYen(P.perHeir) ?? yen(0), N, 1, "conv.exact"));
      const assets: PointResult["assets"] = {
        financial: yen(financial),
        realEstateMarket: yen(realMarket),
        realEstate: realEval,
        other: yen(other),
        insurance: yen(insurance),
        insuranceExempt: yen(insExempt),
        retirement: yen(retirement),
        retirementExempt: yen(retExempt),
        settlementGifts: yen(settlement),
        debts: yen(debtTotal),
        ...(unpaidTaxes > 0 ? { unpaidTaxes: yen(unpaidTaxes) } : {}),
        ...(landEval !== null && landEval.reduction > 0 ? { smallLandReduction: landEval.reduction } : {}),
        funeral: yen(funeral),
        taxablePrice: T,
      };
      if (hasHome && !detailed) cautions.add("smallLandSpecial");
      const heirIds = new Set(heirs.filter((h) => h.counted).map((h) => h.member));
      if ([...credits.keys()].some((id) => !heirIds.has(id))) cautions.add("settlementGiftToNonHeir");
      const heirsOut = heirs.map((h) => ({
        member: h.member,
        relation: h.relation,
        outside: h.outside,
        counted: h.counted,
        ...(h.share !== null ? { share: fmtFrac(h.share) } : {}),
        ...(h.adopted ? { adopted: true } : {}),
        ...(h.representing !== undefined ? { representing: h.representing } : {}),
      }));
      const r: PointResult = { ...empty(N === 0 ? "noHeirs" : "ok"), assets, heirs: heirsOut, heirCount: N, heirCountOverridden: given !== undefined, basicDeduction: basic, margin: yen(basic - T), noTax: T <= basic };
      if (N === 0) {
        cautions.add("noHeirs");
        return { ...r, cautions: [...cautions].sort() };
      }
      return { job, at, cautions, heirs, N, given, base: r, grossNoRed, deductions: debtTotal + funeral, reduction, landEval, credits, gifts, exempt: insExempt + retExempt };
    };

    /** 税の総額を出す相続人と法定相続分（数を直したときは、配偶者のほかを同じ順位で等分とみなす） */
    type Slot = { member?: string; count?: number; outside: boolean; share: Frac; spouse: boolean };
    const slotsOf = (g: Gathered): Slot[] => {
      const { heirs, N, given } = g;
      const spouseHeir = heirs.find((h) => h.relation === "spouse");
      if (given === undefined) return heirs.filter((h) => h.counted && h.share !== null).map((h) => ({ member: h.member, outside: h.outside, share: h.share as Frac, spouse: h.relation === "spouse" }));
      const rest = Math.max(0, N - (spouseHeir !== undefined ? 1 : 0));
      const rank = heirs.find((h) => h.relation !== "spouse" && h.counted)?.relation ?? "child";
      const sp: Frac = spouseHeir === undefined ? [0n, 1n] : rest === 0 ? [1n, 1n] : rank === "child" || rank === "grandchild" ? [1n, 2n] : rank === "sibling" ? [3n, 4n] : [2n, 3n];
      const slots: Slot[] = [];
      if (spouseHeir !== undefined) slots.push({ member: spouseHeir.member, outside: spouseHeir.outside, share: sp, spouse: true });
      if (rest > 0) slots.push({ count: rest, outside: heirs.some((h) => h.relation !== "spouse" && h.outside), share: frac(sp[1] - sp[0], sp[1]), spouse: false });
      return slots;
    };

    /**
     * 分け方（0251）: 相続人ごとの、財産の評価額（特例の前。債務を引く前）のうち取得する分 P と、その人が取得する土地の評価 L・特例で減った額 R。
     * 割合は spouseShare（配偶者）と shares（配偶者のほかの相続人の残りの分け方。入れていない人は残りを法定相続分の比で）。土地は取得する人
     * （一次は primary、二次は secondary。配偶者・選んだ人・配偶者のほかの相続人で割合どおり。選んでいない土地は全員で割合どおり）に寄せる。
     * 相続時精算課税で贈与した財産は、受け取った人の分に置く（G）。取得する土地の評価と贈与の合計が割合の分より大きい人は、その人の分を
     * その合計まで増やし、ほかの人の分を割合の比で減らす（adjusted）。債務と葬式の費用は、取得する分 P の比で負担する（呼ぶ側で引く）。
     * 子の割合の合計が1を超える・全員入れて1でないときは使わない（sharesInvalid。法定相続分の比）。spLands は配偶者が取得した土地の評価（物ごと）
     */
    const allocateEstate = (
      g: Gathered,
      slots: readonly Slot[],
      division: Division | undefined,
      T0: number,
    ): { P: number[]; L: number[]; G: number[]; R: number[]; target: Frac[]; adjusted: boolean; sharesInvalid: boolean; spLands: Map<string, number> } => {
      const second = g.job.kind === "bothAfter" || g.job.kind === "secondaryAt";
      const n = slots.length;
      const sp = slots.findIndex((s) => s.spouse);
      const others = slots.map((_, i) => i).filter((i) => i !== sp);
      // 配偶者のほかの相続人の分け方の重み（合計1）
      const given = new Map<number, Frac>();
      for (const i of others) {
        const m = slots[i]?.member;
        const e = m === undefined ? undefined : division?.shares?.find((x) => x.member === m);
        if (e !== undefined) given.set(i, fOf(e.share));
      }
      let gsum = F0;
      for (const v of given.values()) gsum = fAdd(gsum, v);
      const w: Frac[] = slots.map(() => F0);
      let missing = others.filter((i) => !given.has(i));
      // 合計が1を超える・全員入れて1でない: 黙って補わず、入れた割合を使わない（法定相続分の比。注意を出す）
      const sharesInvalid = given.size > 0 && (fCmp(gsum, F1) > 0 || (missing.length === 0 && fCmp(gsum, F1) !== 0));
      if (sharesInvalid) {
        given.clear();
        gsum = F0;
        missing = [...others];
      }
      for (const [i, v] of given) w[i] = v;
      let legal = F0;
      for (const i of missing) legal = fAdd(legal, (slots[i] as Slot).share);
      for (const i of missing) w[i] = given.size === 0 ? fDiv((slots[i] as Slot).share, legal) : fMul(fSub(F1, gsum), fDiv((slots[i] as Slot).share, legal));
      const spShare: Frac = sp < 0 ? F0 : others.length === 0 ? F1 : division?.spouseShare !== undefined ? fOf(division.spouseShare) : (slots[sp] as Slot).share;
      const target: Frac[] = slots.map((_, i) => (i === sp ? spShare : fMul(fSub(F1, spShare), w[i] as Frac)));
      // 土地を取得する人
      const L = slots.map(() => 0);
      const R = slots.map(() => 0);
      const spLands = new Map<string, number>();
      let current = "";
      const spread = (value: number, red: number, weights: readonly Frac[]) => {
        let sum = F0;
        for (const x of weights) sum = fAdd(sum, x);
        if (sum[0] === 0n) return;
        let leftV = value;
        let leftR = red;
        const idx = weights.map((x, i) => (x[0] === 0n ? -1 : i)).filter((i) => i >= 0);
        idx.forEach((i, k) => {
          const f = fDiv(weights[i] as Frac, sum);
          const v = k === idx.length - 1 ? leftV : ctx.money.mulRatio(yen(value), f[0], f[1], "conv.tax.allocate");
          const r = k === idx.length - 1 ? leftR : ctx.money.mulRatio(yen(red), f[0], f[1], "conv.tax.allocate");
          L[i] = (L[i] ?? 0) + v;
          R[i] = (R[i] ?? 0) + r;
          if (i === sp) spLands.set(current, (spLands.get(current) ?? 0) + v);
          leftV -= v;
          leftR -= r;
        });
      };
      for (const l of g.landEval?.lands ?? []) {
        const value = l.land + l.building;
        const red = l.special.status === "applied" ? l.special.reduction : 0;
        const st = landSettings.get(l.object);
        current = l.object;
        const choice = l.special.defaulted === true ? { acquirer: "spouse" as const } : second ? st?.secondary : st?.primary;
        if (choice !== undefined && choice.acquirer === "spouse" && sp >= 0) spread(value, red, slots.map((_, i) => (i === sp ? F1 : F0)));
        else if (choice !== undefined && others.length > 0) {
          // 選んだ人（数を直した世帯は、配偶者のほかの相続人のまとめた行）。選んでいなければ配偶者のほかの相続人で分け方の割合どおり
          let who = -1;
          if (choice.member !== undefined) {
            who = others.find((i) => slots[i]?.member === choice.member) ?? -1;
            if (who < 0) who = others.find((i) => slots[i]?.count !== undefined) ?? -1;
          }
          spread(value, red, slots.map((_, i) => (who >= 0 ? (i === who ? F1 : F0) : i === sp ? F0 : (w[i] as Frac))));
        } else spread(value, red, target);
      }
      // 相続時精算課税で贈与した財産は、受け取った人の分（数を直した世帯は、配偶者のほかの相続人のまとめた行）
      const G = slots.map(() => 0);
      for (const [m, amount] of g.gifts) {
        let i = slots.findIndex((x) => x.member === m);
        if (i < 0 && slots.some((x) => x.count !== undefined) && heirsOfG(g).has(m)) i = slots.findIndex((x) => x.count !== undefined);
        if (i >= 0) G[i] = (G[i] ?? 0) + amount;
      }
      // 割合の分（P）と、土地の評価・贈与に足りない人の直し
      const P = slots.map(() => 0);
      const least = slots.map((_, i) => (L[i] ?? 0) + (G[i] ?? 0));
      const sumL = least.reduce((a, b) => a + b, 0);
      let adjusted = false;
      if (sumL > T0) {
        // 取得する土地の評価と贈与の合計が財産より大きい（起きないはずの丸めの差）: その比で分ける
        for (let i = 0; i < n; i++) P[i] = sumL <= 0 ? 0 : ctx.money.mulRatio(yen(T0), least[i] ?? 0, sumL, "conv.tax.allocate");
        return { P, L, G, R, target, adjusted: true, sharesInvalid, spLands };
      }
      const fixed = new Set<number>();
      for (let loop = 0; loop <= n; loop++) {
        const free = slots.map((_, i) => i).filter((i) => !fixed.has(i));
        const remainder = T0 - [...fixed].reduce((a, i) => a + (least[i] ?? 0), 0);
        let ts = F0;
        for (const i of free) ts = fAdd(ts, target[i] as Frac);
        const weights = free.map((i) => (ts[0] === 0n ? (slots[i] as Slot).share : (target[i] as Frac)));
        let ws = F0;
        for (const x of weights) ws = fAdd(ws, x);
        let left = remainder;
        free.forEach((i, k) => {
          const f = fDiv(weights[k] as Frac, ws);
          const v = k === free.length - 1 ? left : ctx.money.mulRatio(yen(Math.max(0, remainder)), f[0], f[1], "conv.tax.allocate");
          P[i] = v;
          left -= v;
        });
        for (const i of fixed) P[i] = least[i] ?? 0;
        const short = free.filter((i) => (P[i] ?? 0) < (least[i] ?? 0));
        if (short.length === 0) break;
        adjusted = true;
        for (const i of short) fixed.add(i);
      }
      return { P, L, G, R, target, adjusted, sharesInvalid, spLands };
    };
    /** その時点の数える相続人（配偶者を除く） */
    const heirsOfG = (g: Gathered): Set<string> => new Set(g.heirs.filter((h) => h.counted && h.relation !== "spouse").map((h) => h.member));

    /** 分け方の結果（推移の二次に渡す）: 配偶者の取得の分 */
    type Finished = {
      result: PointResult;
      /** 配偶者が取得した財産の評価額（特例の前・債務を引く前）・そのうち土地・非課税の分・負担した債務と葬式の費用・課税価格・納める額 */
      spouse: { pre: number; land: number; gift: number; lands: Map<string, number>; exempt: number; debt: number; acquisition: Yen; payable: Yen } | null;
      minorUsed: Map<string, { full: number; used: number }>;
    };

    /**
     * 税の計算（分け方・推移の二次の直し）。T・gross は推移の二次で一次の取得を足したときの課税価格と財産の合計（特例の前。省略は時点の値）。minorCap は一次で受けた
     * 未成年者控除の残り（相続税法19条の3第3項）、successive は相次相続控除（同20条）の材料
     */
    const finish = (
      g: Gathered,
      o: { division?: Division | undefined; T?: Yen; gross?: number; minorCap?: ReadonlyMap<string, number>; successive?: { A: Yen; B: Yen; months: number }; override?: boolean } = {},
    ): Finished => {
      const { job, at, heirs } = g;
      const { point, decedent: X, D } = job;
      const cautions = new Set(g.cautions);
      const T = o.T ?? g.base.assets.taxablePrice;
      const basic = g.base.basicDeduction;
      const r: PointResult = o.T === undefined ? g.base : { ...g.base, assets: { ...g.base.assets, taxablePrice: T }, margin: yen(basic - T), noTax: T <= basic };
      const slots = slotsOf(g);
      const taxable = yen(Math.max(0, T - basic));
      let total = 0;
      const table = at.paramBrackets(P.table);
      if (taxable > 0 && table !== null) {
        for (const s of slots) {
          const n = s.count ?? 1;
          // 1人あたりの取得金額（等分のまとめた行は人数で割る）
          const each = at.money.mulRatio(taxable, s.share[0], s.share[1] * BigInt(n), P.taxableRound);
          const b = bracketFor(table, each);
          const t = b.rate === undefined ? 0 : Math.max(0, ctx.money.mulRate(each, b.rate, "conv.tax.exact") - (b.amount ?? 0));
          total += t * n;
        }
      }
      const totalTax = at.money.round(yen(total), P.totalRound);
      // 分け方（0251）: 相続税も試算する世帯で、分け方を入れたか、特例の減額を取得する人に寄せるとき。ほかは法定相続分どおり（今まで）
      const G0 = o.gross ?? g.grossNoRed;
      // 相続税も試算する世帯は、いつも取得する分を配分する（推移の二次に足す配偶者の分にも使う）。人ごとの税に使うのは、分け方を入れたか、
      // 特例の減額を取得する人に寄せるか、土地の評価・贈与に合わせて割合を直したときだけ（ほかは法定相続分どおりで同じ額）
      const alloc = detailed ? allocateEstate(g, slots, o.division, Math.max(0, G0)) : null;
      const entered = o.division !== undefined && (o.division.spouseShare !== undefined || (o.division.shares?.length ?? 0) > 0);
      const useDivision = alloc !== null && (entered || g.reduction > 0 || alloc.adjusted);
      // 課税価格の割合: 取得する分−その分の比で負担する債務と葬式の費用−取得した土地の特例で減った額
      const net = !useDivision || alloc === null ? null : alloc.P.map((p, i) => Math.max(0, p - (G0 > 0 ? ctx.money.mulRatio(yen(g.deductions), p, G0, "conv.tax.allocate") : 0) - (alloc.R[i] ?? 0)));
      const netSum = net === null ? 0 : net.reduce((a, b) => a + b, 0);
      if (useDivision && alloc?.adjusted === true) cautions.add("divisionAdjusted");
      if (alloc?.sharesInvalid === true) cautions.add("divisionSharesInvalid");
      const ratioOf = (i: number, s: Slot): Frac => (net === null || netSum <= 0 ? s.share : frac(BigInt(net[i] ?? 0), BigInt(netSum)));
      const floor = at.paramYen(P.spouseFloor) ?? yen(0);
      // 2割加算（相続税法18条）と未成年者控除（同19条の3）は、相続税も試算する世帯だけ（0231）。人ごとの行（数を直していない）のとき
      const kidsOfX = new Set(job.childrenFrom ?? childrenOfX(X));
      const surchargeRate = detailed ? at.paramRate(P.surcharge) : null;
      const minorAge = detailed ? at.paramCount(P.minorAge) : null;
      const minorPer = detailed ? at.paramYen(P.minorPerYear) : null;
      /** 2割加算の対象か: 一親等の血族（代襲の孫を含む）と配偶者のほか。孫養子（子の子を養子にした人）は代襲でなければ対象 */
      const surchargeOf = (member: string | undefined): boolean => {
        const h = heirs.find((x) => x.member === member);
        if (h === undefined) return false;
        if (h.relation === "sibling" || h.relation === "grandparent") return true;
        return h.relation === "child" && h.adopted && relations.some((x) => x.type === "parentOf" && x.child === h.member && x.parent !== X && kidsOfX.has(x.parent));
      };
      /** 未成年者控除の額（満18歳になるまでの年数。1年未満は1年。年齢は月で数える）。前の相続で受けたことがあれば、その残りまで（19条の3第3項） */
      const minorOf = (member: string | undefined): number => {
        if (minorAge === null || minorPer === null || member === undefined) return 0;
        const b = byId.get(member)?.birth ?? null;
        if (b === null || b > D) return 0;
        const age = Math.floor((D - b) / 12);
        const full = age < minorAge ? ctx.money.mulRatio(minorPer, minorAge - age, 1, "conv.exact") : 0;
        const cap = o.minorCap?.get(member);
        return cap === undefined ? full : Math.min(full, cap);
      };
      const heirRows = slots.map((s, i) => {
        const f = ratioOf(i, s);
        const acquisition = ctx.money.mulRatio(T, f[0], f[1], "conv.tax.allocate");
        const base = ctx.money.mulRatio(totalTax, f[0], f[1], "conv.tax.allocate");
        const surcharge = surchargeRate !== null && s.count === undefined && surchargeOf(s.member) ? ctx.money.mulRate(base, surchargeRate, "conv.tax.allocate") : 0;
        const tax = base + surcharge;
        let sRed = 0;
        if (s.spouse && T > 0) {
          const legal = ctx.money.mulRatio(T, s.share[0], s.share[1], "conv.tax.allocate");
          const lim = Math.min(acquisition, Math.max(floor, legal));
          // 相続税法19条の2: 相続税の総額×（配偶者の課税価格と「1億6,000万円か法定相続分の額の多い方」の小さい方）÷課税価格の合計
          sRed = Math.min(tax, ctx.money.mulRatio(totalTax, lim, T, "conv.tax.allocate"));
        }
        // 未成年者控除は財産を取得した人だけ（相続税法19条の3第1項。分け方で取得しない子は受けない）
        const minorFull = s.count === undefined && acquisition > 0 ? minorOf(s.member) : 0;
        const minor = Math.min(minorFull, tax - sRed);
        return { s, i, acquisition, base, surcharge, tax, sRed, minor, minorFull, excess: minorFull - minor, successive: 0 };
      });
      // 引ききれない未成年者控除は、扶養義務者（配偶者、次に他の相続人の順）の税から引く
      const excessAll = heirRows.reduce((sum, x) => sum + x.excess, 0);
      let excess = excessAll;
      for (const x of [...heirRows.filter((y) => y.s.spouse), ...heirRows.filter((y) => !y.s.spouse)]) {
        if (excess <= 0) break;
        const room = x.tax - x.sRed - x.minor;
        const take = Math.min(room, excess);
        if (take <= 0 || x.excess > 0) continue;
        x.minor += take;
        excess -= take;
      }
      // 受けた未成年者控除（本人の税から引いた分と、扶養義務者の税から引いた分を引ききれた比で）
      const minorUsed = new Map<string, { full: number; used: number }>();
      for (const x of heirRows) {
        if (x.s.member === undefined || x.minorFull <= 0) continue;
        const own = Math.min(x.minorFull, x.tax - x.sRed);
        const passed = excessAll <= 0 ? 0 : ctx.money.mulRatio(yen(x.excess), excessAll - excess, excessAll, "conv.exact");
        minorUsed.set(x.s.member, { full: x.minorFull, used: own + passed });
      }
      // 相次相続控除（相続税法20条。推移の二次）: A×（C÷(B−A)。1を超えれば1）×（D÷C）×（10−経過年数）÷10。経過年数の1年未満は切り捨て（No.4168）
      let successiveSum = 0;
      if (o.successive !== undefined && o.successive.A > 0 && o.successive.months < 120 && T > 0) {
        const { A, B, months } = o.successive;
        const years = 10 - Math.floor(months / 12);
        const capped = B - A <= 0 || T >= B - A ? A : ctx.money.mulRatio(A, T, B - A, "conv.tax.allocate");
        const whole = ctx.money.mulRatio(capped, years, 10, "conv.tax.allocate");
        for (const x of heirRows) {
          const room = Math.max(0, x.tax - x.sRed - x.minor);
          x.successive = Math.min(room, ctx.money.mulRatio(whole, x.acquisition, T, "conv.tax.allocate"));
          successiveSum += x.successive;
        }
      }
      let red = 0;
      let creditSum = 0;
      let payable = 0;
      let payableHousehold = 0;
      let payableOutside = 0;
      let refund = 0;
      let surchargeSum = 0;
      let minorSum = 0;
      const byHeir: PointResult["byHeir"] = [];
      let spouseOut: Finished["spouse"] = null;
      for (const { s, i, acquisition, tax, surcharge, sRed, minor, successive } of heirRows) {
        const credit = s.member !== undefined ? (g.credits.get(s.member) ?? 0) : 0;
        const before = tax - sRed - minor - successive;
        const pay = at.money.round(yen(Math.max(0, before - credit)), P.taxRound);
        const back = Math.max(0, credit - before);
        red += sRed;
        creditSum += credit;
        payable += pay;
        refund += back;
        surchargeSum += surcharge;
        minorSum += minor;
        if (s.outside) payableOutside += pay;
        else payableHousehold += pay;
        const landRed = useDivision ? (alloc?.R[i] ?? 0) : 0;
        byHeir.push({
          ...(s.member !== undefined ? { member: s.member } : {}),
          ...(s.count !== undefined ? { count: s.count } : {}),
          outside: s.outside,
          acquisition,
          tax: yen(tax),
          spouseReduction: yen(sRed),
          credit: yen(credit),
          payable: pay,
          refund: yen(back),
          ...(surcharge > 0 ? { surcharge: yen(surcharge) } : {}),
          ...(minor > 0 ? { minorCredit: yen(minor) } : {}),
          ...(landRed > 0 ? { landReduction: yen(landRed) } : {}),
          ...(successive > 0 ? { successiveCredit: yen(successive) } : {}),
        });
        if (s.spouse)
          spouseOut = {
            pre: alloc?.P[i] ?? ctx.money.mulRatio(yen(Math.max(0, G0)), s.share[0], s.share[1], "conv.tax.allocate"),
            land: alloc?.L[i] ?? 0,
            gift: alloc?.G[i] ?? 0,
            lands: alloc?.spLands ?? new Map(),
            exempt: 0,
            debt: 0,
            acquisition,
            payable: pay,
          };
      }
      if (spouseOut !== null) {
        const so = spouseOut as NonNullable<Finished["spouse"]>;
        so.exempt = G0 > 0 ? ctx.money.mulRatio(yen(g.exempt), Math.min(so.pre, G0), G0, "conv.tax.allocate") : 0;
        so.debt = G0 > 0 ? ctx.money.mulRatio(yen(g.deductions), Math.min(so.pre, G0), G0, "conv.tax.allocate") : 0;
      }
      const override = o.override === true ? req.overrides?.find((x) => x.point === point && (x.decedent === undefined || x.decedent === X)) : undefined;
      const sp = slots.findIndex((s) => s.spouse);
      // 配偶者が取得した割合（小数4桁に丸める）
      const shareText = (num: number, den: number): string => {
        const q = (BigInt(num) * 10000n + BigInt(den) / 2n) / BigInt(den);
        return ctx.rate.toString(ctx.rate.div(rOf(Number(q)), rOf(10000)));
      };
      const division: PointResult["division"] | undefined =
        useDivision && alloc !== null
          ? {
              entered,
              ...(sp >= 0 && G0 > 0 ? { spouseShare: shareText(alloc.P[sp] ?? 0, G0) } : {}),
              ...(alloc.adjusted ? { adjusted: true as const } : {}),
            }
          : undefined;
      return {
        result: {
          ...r,
          taxableEstate: taxable,
          totalTax,
          spouseReduction: yen(red),
          settlementCredit: yen(creditSum),
          byHeir,
          payable: yen(payable),
          payableHousehold: yen(payableHousehold),
          payableOutside: yen(payableOutside),
          refund: yen(refund),
          amount: override !== undefined ? override.amount : yen(payable),
          state: override !== undefined ? "confirmed" : "estimated",
          ...(detailed ? { surcharge: yen(surchargeSum), minorCredit: yen(minorSum), lands: g.landEval?.lands ?? [] } : {}),
          ...(successiveSum > 0 ? { successiveCredit: yen(successiveSum) } : {}),
          ...(division !== undefined ? { division } : {}),
          cautions: [...cautions].sort(),
        },
        spouse: spouseOut,
        minorUsed,
      };
    };

    const results: PointResult[] = [];
    for (const job of jobs) {
      const g = gather(job);
      if (!("job" in g)) {
        results.push(g);
        continue;
      }
      results.push(finish(g, { division: req.division, override: true }).result);
    }

    // ---- 一次と二次の推移（0251。相続税も試算する世帯で、要求に timeline があり、法律婚の夫婦の世帯だけ） ----
    const timeline = ((): Timeline | undefined => {
      if (!detailed || req.timeline === undefined || contingencyDeath !== null || adults.length < 2) return undefined;
      const second = lastOf();
      const first = adults.find((a) => a.id !== second)?.id;
      if (second === undefined || first === undefined) return undefined;
      const D2 = monthIndex(endYear, 12);
      const step = Math.min(10, Math.max(1, Math.floor(req.timeline.step ?? 1)));
      const kids = coupleKids();
      const series: { key: string; division: Division | undefined }[] = [
        { key: "entered", division: req.division },
        ...(req.timeline.alternatives ?? []).map((a) => ({ key: a.key, division: { ...(req.division?.shares !== undefined ? { shares: req.division.shares } : {}), ...(a.spouseShare !== undefined ? { spouseShare: a.spouseShare } : {}) } as Division })),
      ];
      // 一次の配偶者の法定相続分（選んでいない土地を配偶者が取得する割合の省略）と、配偶者のほかの相続人がいるか（計算基準月の家族）
      const heirsAtBase = heirsOf(first, base, true, null, ctx.at(base));
      const legalSpouse = heirsAtBase.find((x) => x.relation === "spouse")?.share ?? F0;
      const othersAtBase = heirsAtBase.some((x) => x.relation !== "spouse" && x.counted);
      /**
       * 一次で後に亡くなる人が取得する、先に亡くなる人の不動産の割合（物ごと）。一次の配分（allocateEstate）と同じ決まり: 配偶者を選んだ土地と、
       * 取得する人を選んでいない自宅（特例の種類が自宅）は全部、配偶者のほかの人を選んだ土地は無し（配偶者のほかの相続人がいなければ全部）、
       * 選んでいない土地は配偶者の割合（配偶者のほかの相続人がいなければ全部）
       */
      const fractionOf = (division: Division | undefined): Map<string, Frac> => {
        const share = !othersAtBase ? F1 : division?.spouseShare !== undefined ? fOf(division.spouseShare) : legalSpouse;
        const out = new Map<string, Frac>();
        const objects = [...residences.map((x) => x.id), ...accounts.filter((a) => a.kind === "realEstate").map((a) => a.id)];
        for (const object of objects) {
          const st = landSettings.get(object);
          const isHome = residences.some((x) => x.id === object);
          const use = st?.use ?? (isHome ? "residence" : "none");
          const c = st?.primary;
          out.set(object, c === undefined ? (use === "residence" ? F1 : share) : c.acquirer === "spouse" || !othersAtBase ? F1 : F0);
        }
        return out;
      };
      const unassignedFirst = req.unassignedShare ?? "0.5";
      const secondaries = new Map<string, Gathered | PointResult>();
      const secondaryOf = (division: Division | undefined): Gathered | PointResult => {
        const fraction = fractionOf(division);
        const key = JSON.stringify([...fraction].map(([k, v]) => [k, fmtFrac(v)]));
        let g = secondaries.get(key);
        if (g === undefined) {
          g = gather({ point: "bothAfter", kind: "secondaryAt", decedent: second, D: D2, V: endYear, opening: false, owners: new Set([second]), spouseAllowed: false, childrenFrom: kids, inherit: { from: first, unassigned: unassignedFirst, fraction } });
          secondaries.set(key, g);
        }
        return g;
      };
      const years: number[] = [];
      for (let y = baseYear; y <= endYear; y += step) years.push(y);
      if (years[years.length - 1] !== endYear) years.push(endYear);
      const out: Timeline["series"] = series.map((s) => ({ key: s.key, ...(s.division?.spouseShare !== undefined ? { spouseShare: s.division.spouseShare } : {}), rows: [] }));
      for (const y of years) {
        const job: Job = y === baseYear ? nowJob(first) : { point: "now", kind: "primaryAt", decedent: first, D: monthIndex(y, 12), V: y, opening: false, owners: new Set([first]), spouseAllowed: true, childrenFrom: null };
        if (legalSpouseAt(first, job.D) !== second) continue;
        const g1 = gather(job);
        series.forEach((s, k) => {
          const p1 = "job" in g1 ? finish(g1, { division: s.division }) : null;
          const sp = p1?.spouse ?? null;
          const A = sp?.payable ?? yen(0);
          const g2 = secondaryOf(s.division);
          // 一次で取得した土地・建物のうち、表の最後の年に無い物（二次の前に売る・手放す物）は、一次の時点の評価のまま二次の財産に残す
          // （売った代金は表では先に亡くなった人の名義の口座に入り、後に亡くなる人の財産に乗らないため）
          const atEnd = new Set(("job" in g2 ? (g2.landEval?.lands ?? []) : []).map((l) => l.object));
          let goneLands = 0;
          for (const [object, v] of sp?.lands ?? []) if (!atEnd.has(object)) goneLands += v;
          // 二次の財産に足す一次の取得: 土地・建物と精算課税で前にもらった財産のほか（非課税の分を含む）−負担した債務と葬式の費用−一次で納めた額
          // （一次の時点の額のまま）＋二次の前に手放す土地・建物
          const inherited = sp === null ? 0 : Math.max(0, sp.pre - sp.land - sp.gift + sp.exempt - sp.debt - A + goneLands);
          let secondary = yen(0);
          let secondaryTaxable = yen(0);
          let successive = yen(0);
          let minor2 = yen(0);
          if ("job" in g2) {
            const gross = g2.grossNoRed + inherited;
            const T2 = g2.at.money.round(yen(Math.max(0, gross - g2.reduction - g2.deductions)), P.taxableRound);
            const cap = new Map<string, number>();
            for (const [m, u] of p1?.minorUsed ?? []) if (u.used > 0) cap.set(m, Math.max(0, u.full - u.used));
            const p2 = finish(g2, { division: s.division?.shares !== undefined ? { shares: s.division.shares } : undefined, T: T2, gross, minorCap: cap, ...(sp !== null ? { successive: { A, B: sp.acquisition, months: D2 - job.D } } : {}) }).result;
            secondary = p2.payable;
            secondaryTaxable = T2;
            successive = p2.successiveCredit ?? yen(0);
            minor2 = p2.minorCredit ?? yen(0);
          }
          const primary = p1?.result.payable ?? yen(0);
          out[k]?.rows.push({
            year: y,
            month: formatYm(job.D),
            primary,
            secondary,
            total: yen(primary + secondary),
            primaryTaxable: p1?.result.assets.taxablePrice ?? yen(0),
            secondaryTaxable,
            spouseAcquisition: sp?.acquisition ?? yen(0),
            spouseTax: A,
            inherited: yen(inherited),
            successiveCredit: successive,
            secondaryMinorCredit: minor2,
          });
        });
      }
      // 二次の相続人がいない（子のいない夫婦で、兄弟姉妹などを入れていない）: 二次を計算していないことを出す
      const noHeirs = [...secondaries.values()].some((g) => !("job" in g) && g.status === "noHeirs");
      return { first, second, secondMonth: formatYm(D2), step, ...(noHeirs ? { secondaryStatus: "noHeirs" as const } : {}), series: out };
    })();

    // 目安（推定）であることと、不動産の評価の割合に既定（時価の80%）を使ったこと
    if (results.some((p) => p.status === "ok")) ctx.notice("N_ESTIMATED", ["inheritanceTax.estimate"]);
    if (req.realEstateRatio === undefined && results.some((p) => p.assets.realEstateMarket > 0)) ctx.notice("N_DEFAULT_USED", ["inheritanceTax.realEstateRatio"]);
    return { points: results, notIncluded: detailed ? NOT_INCLUDED_DETAILED : NOT_INCLUDED, ...(timeline !== undefined ? { timeline } : {}) };
  },
});
