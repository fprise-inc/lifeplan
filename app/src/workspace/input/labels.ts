// 入力の画面の言葉（FP が慣れた言葉。日本FP協会・FP技能検定の言葉を標準にする）と、構成員の呼び方
import type { Household, Member } from "../../engine/types.ts";
import { roles } from "../roles.ts";
import type { Option } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { presetRate } from "../../../../hearing/src/presets.ts";

const KIND_LABEL: Record<string, string> = { parent: "親", grandparent: "祖父母", sibling: "兄弟姉妹", grandchild: "孫", other: "ご家族" };

/** 親・祖父母の呼び方（性別と、配偶者の親か）: 父・母・義父・義母・祖父・祖母。性別の値が無ければ「親」「祖父母」 */
function elderLabel(wh: WorkingHousehold, m: Member): string | undefined {
  const h = wh.request.input.household;
  if (m.kind !== "parent" && m.kind !== "grandparent") return undefined;
  const spouse = h.members.find((x) => x.kind === "spouse");
  const inLaw = spouse !== undefined && m.outside?.of === spouse.id;
  if (m.sex !== "male" && m.sex !== "female") return undefined;
  if (m.kind === "grandparent") return m.sex === "male" ? "祖父" : "祖母";
  return `${inLaw ? "義" : ""}${m.sex === "male" ? "父" : "母"}`;
}

/** 構成員の呼び方: 続柄（ご本人・配偶者・第1子…）と、FP が付けた呼び名（任意） */
export function memberLabels(wh: WorkingHousehold): Map<string, string> {
  const out = new Map<string, string>();
  const h = wh.request.input.household;
  const rs = roles(wh.request);
  for (const r of rs) {
    const base = elderLabel(wh, r.member) ?? KIND_LABEL[r.member.kind] ?? r.label;
    const nick = wh.labelsByMember[r.member.id];
    out.set(r.member.id, nick !== undefined && nick !== "" ? `${base}（${nick}）` : base);
  }
  for (const m of h.members) if (!out.has(m.id)) out.set(m.id, elderLabel(wh, m) ?? KIND_LABEL[m.kind] ?? "ご家族");
  return out;
}

export function memberLabel(wh: WorkingHousehold, id: string | undefined): string {
  if (id === undefined) return "（未選択）";
  return memberLabels(wh).get(id) ?? "（いない家族）";
}

export function memberOptions(wh: WorkingHousehold, filter: (m: Member) => boolean = () => true): Option[] {
  const labels = memberLabels(wh);
  return roles(wh.request)
    .map((r) => r.member)
    .concat(wh.request.input.household.members.filter((m) => !roles(wh.request).some((r) => r.member.id === m.id)))
    .filter(filter)
    .map((m) => ({ value: m.id, label: labels.get(m.id) ?? "ご家族" }));
}

export const isAdult = (m: Member) => m.kind === "self" || m.kind === "spouse";

/** 本人・配偶者（働き方・年金の段階に出す人）。働き方の期間がある人も含める */
export function earners(h: Household): Member[] {
  const withPeriods = new Set((h.employmentPeriods ?? []).map((e) => e.member));
  const order = (m: Member) => (m.kind === "self" ? 0 : m.kind === "spouse" ? 1 : 2);
  return h.members.filter((m) => isAdult(m) || withPeriods.has(m.id)).sort((a, b) => order(a) - order(b));
}

export const KIND_OPTIONS: Option[] = [
  { value: "spouse", label: "配偶者" },
  { value: "child", label: "子" },
  { value: "parent", label: "親" },
  { value: "grandparent", label: "祖父母" },
  { value: "other", label: "その他の家族" },
];

export const SEX_OPTIONS: Option[] = [
  { value: "male", label: "男性" },
  { value: "female", label: "女性" },
];

export const EMPLOYMENT_TYPES: Option[] = [
  { value: "regular", label: "正社員" },
  { value: "contract", label: "契約社員・嘱託（再雇用など）" },
  { value: "partTime", label: "パート・アルバイト" },
  { value: "selfEmployed", label: "自営業" },
  { value: "civilServant", label: "公務員" },
  { value: "executive", label: "会社役員" },
  { value: "leave", label: "休業中（産休・育休・病気など）" },
  { value: "unemployed", label: "働いていない" },
];

export const LEAVE_KINDS: Option[] = [
  { value: "maternity", label: "産前産後休業" },
  { value: "childcare", label: "育児休業" },
  { value: "sick", label: "病気の休業" },
  { value: "care", label: "介護休業" },
  { value: "other", label: "その他の休業" },
];

export const HEALTH_INSURANCE: Option[] = [
  { value: "kyokaikenpo", label: "協会けんぽ" },
  { value: "union", label: "健康保険組合" },
  { value: "mutualAid", label: "共済組合" },
  { value: "national", label: "国民健康保険" },
  { value: "dependent", label: "家族の扶養" },
  { value: "continuation", label: "任意継続" },
  { value: "lateElderly", label: "後期高齢者医療" },
];

export const PENSION_CATEGORY: Option[] = [
  { value: "employee1", label: "厚生年金（会社員）" },
  { value: "employee2", label: "厚生年金（国家公務員）" },
  { value: "employee3", label: "厚生年金（地方公務員）" },
  { value: "employee4", label: "厚生年金（私学教職員）" },
  { value: "none", label: "厚生年金に入らない" },
];

export const POST_RETIREMENT_TYPES: Option[] = [
  { value: "", label: "働かない" },
  { value: "contract", label: "再雇用・嘱託" },
  { value: "partTime", label: "パート・アルバイト" },
  { value: "selfEmployed", label: "自営業" },
];

/** 年金の入れ方（ねんきん定期便の数字を入れる形を主にする） */
/** 年金の入れ方の区分（0066）: 推計（書類なし）／書類から／加入歴から。区分は画面の側（記録の型 kind から決まる） */
export const PENSION_MODES: Option[] = [
  { value: "", label: "推計（書類なし）" },
  { value: "document", label: "書類から" },
  { value: "history", label: "加入歴から" },
];

/** 書類の種類（0066。書類からのとき。記録の型 kind そのもの） */
export const DOCUMENT_KINDS: Option[] = [
  { value: "statementUnder50", label: "ねんきん定期便（50歳未満）" },
  { value: "statementOver50", label: "ねんきん定期便（50歳以上）" },
  { value: "receiving", label: "年金額改定通知書（受給中）" },
  { value: "projection", label: "ねんきんネットの見込額・見込額だけ" },
];

export const HISTORY_CATEGORIES: Option[] = [
  { value: "employee", label: "厚生年金" },
  { value: "national1", label: "国民年金（第1号・納付）" },
  { value: "national1Unpaid", label: "国民年金（第1号・未納）" },
  { value: "national1ExemptFull", label: "国民年金（全額免除）" },
  { value: "national1ExemptThreeQuarters", label: "国民年金（4分の3免除）" },
  { value: "national1ExemptHalf", label: "国民年金（半額免除）" },
  { value: "national1ExemptQuarter", label: "国民年金（4分の1免除）" },
  { value: "national1Deferred", label: "国民年金（納付猶予・学生納付特例）" },
  { value: "national3", label: "国民年金（第3号）" },
];

export const LIVING_STAGE_LABELS: Option[] = [
  { value: "childIndependence", label: "子の独立の後" },
  { value: "retirement", label: "退職後" },
  { value: "age70", label: "70歳から" },
  { value: "age80", label: "80歳から" },
  { value: "other", label: "その他の節目" },
];

/**
 * 基本生活費の内訳の名前（0100。家計簿アプリでよくある分け方に寄せた10費目）。
 * 交通・通信費（transport）とその他の消費（otherConsumption）は前の分け方の内訳で、前に保存した世帯に値があるときだけ出す（前の名前のまま）。
 * 仕送り（allowance）は内訳の並びから外した前の内訳で、前の世帯に値があるときだけ出す（0106）
 */
export const LIVING_CATEGORIES: Option[] = [
  { value: "food", label: "食費" },
  { value: "utilities", label: "水道・光熱費" },
  { value: "communication", label: "通信費" },
  { value: "transit", label: "交通費" },
  { value: "furniture", label: "日用品" },
  { value: "clothing", label: "被服・美容" },
  { value: "health", label: "医療費" },
  { value: "recreation", label: "趣味・娯楽" },
  { value: "pocketAndSocial", label: "こづかい・交際費" },
  { value: "other", label: "その他" },
  { value: "allowance", label: "仕送り（前の内訳）" },
  { value: "transport", label: "交通・通信費" },
  { value: "otherConsumption", label: "その他の消費（こづかい・交際費など）" },
];

export const GROWTH_KINDS: Option[] = [
  { value: "inflation", label: "物価上昇率に合わせる" },
  { value: "rate", label: "決まった変動率" },
  { value: "none", label: "変えない" },
];

export const SCHOOL_STAGES: Option[] = [
  { value: "nursery", label: "保育園（2歳まで）" },
  { value: "kindergarten", label: "保育園・幼稚園（3歳から）" },
  { value: "elementary", label: "小学校" },
  { value: "juniorHigh", label: "中学校" },
  { value: "highSchool", label: "高校" },
  { value: "kosen", label: "高専" },
  { value: "university", label: "大学" },
  { value: "juniorCollege", label: "短大" },
  { value: "vocational", label: "専門学校" },
  { value: "graduateMaster", label: "大学院（修士）" },
  { value: "graduateDoctor", label: "大学院（博士）" },
  { value: "graduateProfessional", label: "専門職大学院" },
];

export const NURSERY_HOURS: Option[] = [
  { value: "standard", label: "保育標準時間" },
  { value: "short", label: "保育短時間" },
];

export const SCHOOL_LUNCH: Option[] = [
  { value: "", label: "制度どおり" },
  { value: "free", label: "なし（自治体が無償化）" },
  { value: "paid", label: "あり（全額を払う）" },
];

export const SECTORS: Option[] = [
  { value: "public", label: "公立" },
  { value: "national", label: "国立" },
  { value: "private", label: "私立" },
];

export const FIELDS: Option[] = [
  { value: "humanities", label: "文系" },
  { value: "science", label: "理系" },
  { value: "medical", label: "医歯系" },
  { value: "other", label: "その他" },
];

export const LIVING_PLACE: Option[] = [
  { value: "home", label: "自宅から通う" },
  { value: "away", label: "自宅外（下宿・寮）" },
];

export const RESIDENCE_KINDS: Option[] = [
  { value: "rent", label: "賃貸" },
  { value: "own", label: "持ち家" },
];

/** 建物の構造（耐用年数の目安を選ぶ。持ち家の評価） */
export const BUILDING_STRUCTURES: Option[] = [
  { value: "wood", label: "木造" },
  { value: "lightSteel", label: "軽量鉄骨造" },
  { value: "steel", label: "重量鉄骨造" },
  { value: "rc", label: "鉄筋コンクリート造" },
];

/** 構造ごとの耐用年数の目安（計算エンジンの housing.valuation と同じ） */
export const USEFUL_LIFE: Readonly<Record<string, number>> = { wood: 22, lightSteel: 19, steel: 34, rc: 47 };
/** 持ち家の評価の目安（計算エンジンの housing.valuation と同じ目安。engine/src/sdk/estimates.ts。事務所の推定の値があればその値） */
export const VALUATION_DEFAULTS = {
  get landShare(): string {
    return presetRate("preset.realEstate.landShare");
  },
  get residualFloor(): string {
    return presetRate("preset.realEstate.residualFloor");
  },
  get saleCostRate(): string {
    return presetRate("preset.realEstate.saleCostRate");
  },
};

export const RATE_TYPES: Option[] = [
  { value: "variable", label: "変動金利" },
  { value: "fixedPeriod", label: "固定期間選択型" },
  { value: "fixed", label: "全期間固定" },
];

export const REPAYMENT_METHODS: Option[] = [
  { value: "equalPayment", label: "元利均等" },
  { value: "equalPrincipal", label: "元金均等" },
];

export const DEBT_KINDS: Option[] = [
  { value: "car", label: "自動車ローン" },
  { value: "scholarship", label: "奨学金" },
  { value: "other", label: "その他のローン" },
];

export const INSURANCE_TEMPLATES: Option[] = [
  { value: "insurance.term", label: "定期保険" },
  { value: "insurance.wholeLife", label: "終身保険" },
  { value: "insurance.incomeProtection", label: "収入保障保険" },
  { value: "insurance.medical", label: "医療保険" },
  { value: "insurance.cancer", label: "がん保険" },
  { value: "insurance.education", label: "学資保険" },
  { value: "insurance.privateAnnuity", label: "個人年金保険" },
  { value: "insurance.foreignCurrency", label: "外貨建て保険" },
  { value: "insurance.variable", label: "変額保険" },
  { value: "insurance.nonLife", label: "損害保険" },
];

export const PREMIUM_FREQUENCY: Option[] = [
  { value: "monthly", label: "月払い" },
  { value: "annual", label: "年払い" },
  { value: "single", label: "一時払い" },
];

export const DEDUCTION_TYPES: Option[] = [
  { value: "general", label: "一般生命保険料" },
  { value: "careMedical", label: "介護医療保険料" },
  { value: "pension", label: "個人年金保険料" },
  { value: "earthquake", label: "地震保険料" },
  { value: "longTermNonLife", label: "旧長期損害保険料" },
  { value: "none", label: "控除の対象外" },
];

export const BENEFITS: Option[] = [
  { value: "death", label: "死亡保険金" },
  { value: "incomeProtection", label: "収入保障（年金月額）" },
  { value: "incapacity", label: "就業不能" },
  { value: "highDisability", label: "高度障害" },
  { value: "maturity", label: "満期金" },
  { value: "annuity", label: "年金" },
  { value: "survival", label: "祝金" },
  { value: "hospitalDaily", label: "入院日額" },
  { value: "surgery", label: "手術" },
  { value: "cancerLump", label: "がん一時金" },
  { value: "other", label: "その他" },
];

export const ACCOUNT_KINDS: Option[] = [
  { value: "deposit", label: "預貯金" },
  { value: "taxable", label: "課税口座" },
  { value: "nisa", label: "NISA" },
  { value: "childNisa", label: "こどもNISA" },
  { value: "legacyNisa", label: "旧NISA" },
  { value: "juniorNisa", label: "ジュニアNISA" },
  { value: "ideco", label: "iDeCo" },
  { value: "corporateDc", label: "企業型DC" },
  { value: "smallBusinessMutualAid", label: "小規模企業共済" },
  { value: "zaikei", label: "財形貯蓄" },
  { value: "esop", label: "持株会" },
  { value: "fxDeposit", label: "外貨預金" },
  { value: "cryptoAsset", label: "暗号資産" },
  { value: "insurance", label: "保険（積立部分）" },
  { value: "realEstate", label: "不動産" },
  { value: "otherAsset", label: "その他の資産" },
];

/**
 * その他の資産（器の種類 otherAsset）の中身の細目（0120）。表示だけで、計算には使わない（評価額・増減率・時価の下落の対象から外す扱いは細目で変えない）。
 * 細目の無いものは「その他」。自社株（出資額）・会社への貸付金は役員として働く人の細目で、ここには入れない（officer.ts。0105）。
 * 暗号資産は細目でなく、金融資産の器の種類 cryptoAsset（ACCOUNT_KINDS。0122）。
 * label は欄の選択肢、short はまとまりの見出し（バランスシートの行の名前と同じ）、note は「?」の説明。バランスシートの行の名前は report/src/bsGroups.ts（同じ細目はまとめる）
 */
export const OTHER_ASSET_SUBTYPES = {
  preciousMetal: { label: "貴金属（金・プラチナなど）", short: "貴金属", note: "金・プラチナの地金・コインなど。評価額は今の買取の価格（重さ×1グラムあたりの買取の価格）で入れます。" },
  art: { label: "美術品・骨董品", short: "美術品・骨董品", note: "絵画・骨董品・時計・コレクションなど、売れば値の付くもの。評価額は買取の見込みの額で入れます。" },
  membership: { label: "会員権（ゴルフ・リゾートなど）", short: "会員権", note: "ゴルフ会員権・リゾート会員権など。評価額は相場の価格（預託金を返してもらうなら、返ってくる見込みの額）で入れます。" },
  securityDeposit: { label: "敷金・保証金", short: "敷金・保証金", note: "借りている住まい・事務所・駐車場などに預けている敷金・保証金のうち、返ってくる見込みの額。" },
  businessAsset: { label: "事業用の資産（設備・在庫など）", short: "事業用の資産", note: "個人事業で使っている設備・在庫などの今の価値。会社（法人）の資産は入れません。" },
} as const;
export type OtherAssetSubtype = keyof typeof OTHER_ASSET_SUBTYPES;
/** 中身の選択肢（「その他」は細目を持たない。欄の値 other は書かない） */
export const OTHER_ASSET_OPTIONS: Option[] = [...Object.entries(OTHER_ASSET_SUBTYPES).map(([value, x]) => ({ value, label: x.label })), { value: "other", label: "その他" }];
/** 細目の名前と説明（細目が無い・この一覧に無い細目〔役員の細目〕は null） */
export const otherAssetSubtypeOf = (subtype: string | undefined): (typeof OTHER_ASSET_SUBTYPES)[OtherAssetSubtype] | null =>
  subtype !== undefined && Object.hasOwn(OTHER_ASSET_SUBTYPES, subtype) ? OTHER_ASSET_SUBTYPES[subtype as OtherAssetSubtype] : null;

/**
 * 貸していない不動産（中身 property の無い不動産の器）の細目（0123）。表示と、毎年の費用（固定資産税）の目安の元・売ったときの知らせだけで使う。
 * 細目の無いものは「その他」。label は欄の選択肢、short はまとまりの見出し、note は「?」の説明
 */
export const HELD_ESTATE_SUBTYPES = {
  vacantLand: { label: "土地（更地）", short: "土地", note: "建物の無い宅地・使っていない空き地など。固定資産税の目安は、住宅用地の特例が当たらない土地として出します。" },
  forestFarm: { label: "山林・農地", short: "山林・農地", note: "山林・田畑など。評価の仕方が宅地と違うので、固定資産税の目安は出しません（納税通知書の額を入れてください）。" },
  villa: { label: "別荘", short: "別荘", note: "ふだん住んでいない別荘・セカンドハウス。別荘の土地は住宅用地の特例が当たらないので、固定資産税の目安はその形で出します。" },
  vacantHouse: { label: "空き家（住んでいない家）", short: "空き家", note: "相続した実家など、住んでいない家。住宅用地の特例を当てた固定資産税の目安を出します（特定空家として勧告を受けると特例が外れます）。" },
} as const;
export type HeldEstateSubtypeKey = keyof typeof HELD_ESTATE_SUBTYPES;
/** 貸していない不動産の中身の選択肢（「その他」は細目を持たない） */
export const HELD_ESTATE_OPTIONS: Option[] = [...Object.entries(HELD_ESTATE_SUBTYPES).map(([value, x]) => ({ value, label: x.label })), { value: "other", label: "その他" }];
export const heldEstateSubtypeOf = (subtype: string | undefined): (typeof HELD_ESTATE_SUBTYPES)[HeldEstateSubtypeKey] | null =>
  subtype !== undefined && Object.hasOwn(HELD_ESTATE_SUBTYPES, subtype) ? HELD_ESTATE_SUBTYPES[subtype as HeldEstateSubtypeKey] : null;

/** その他の資産を売ったときの税の扱い（0123） */
export const HELD_SALE_TAXATION: Option[] = [
  { value: "transfer", label: "譲渡所得（総合課税）" },
  { value: "nonTaxable", label: "非課税（生活に使う物・返ってくる敷金など）" },
  { value: "miscellaneous", label: "雑所得" },
];

export const ASSET_CLASSES: Option[] = [
  { value: "cash.deposit", label: "預金" },
  { value: "cash.foreign", label: "外貨預金" },
  { value: "bond.domestic", label: "国内債券" },
  { value: "bond.global", label: "外国債券" },
  { value: "equity.domestic", label: "国内株式" },
  { value: "equity.global", label: "外国株式" },
  { value: "reit.domestic", label: "国内REIT" },
  { value: "reit.global", label: "外国REIT" },
  { value: "balanced", label: "バランス型" },
  { value: "commodity", label: "コモディティ" },
  { value: "realEstate", label: "不動産" },
  { value: "other", label: "その他" },
];

export const PERIODIC_ROWS: Option[] = [
  { value: "cf.expense.lumpSum.other", label: "一時的支出" },
  { value: "cf.expense.lumpSum.wedding", label: "結婚の費用" },
  { value: "cf.expense.lumpSum.gift", label: "贈り物・援助" },
  { value: "cf.expense.lumpSum.car", label: "車両費（一時）" },
  { value: "cf.expense.housing.maintenance", label: "住まいの修繕" },
  { value: "cf.expense.care.medical", label: "医療・介護" },
  { value: "cf.expense.living", label: "基本生活費に含める" },
  { value: "cf.expense.other", label: "その他の支出" },
];

export const CARE_PLACE: Option[] = [
  { value: "home", label: "在宅" },
  { value: "facility", label: "施設" },
];

export const DONOR_KINDS: Option[] = [
  { value: "parent", label: "親" },
  { value: "grandparent", label: "祖父母" },
  { value: "other", label: "その他の親族" },
];

export const GIFT_PURPOSES: Option[] = [
  { value: "housing", label: "住宅資金" },
  { value: "wedding", label: "結婚資金" },
  { value: "other", label: "その他の援助" },
];

export const TAX_METHODS: Option[] = [
  { value: "calendar", label: "暦年課税" },
  { value: "settlement", label: "相続時精算課税" },
];

export const HOUSING_EXEMPTION: Option[] = [
  { value: "energySaving", label: "住宅取得等資金の非課税（省エネ等住宅）" },
  { value: "other", label: "住宅取得等資金の非課税（それ以外の住宅）" },
  { value: "none", label: "非課税の特例を使わない" },
];

/** 贈与する人の呼び方（氏名は持たない。0012）: 「ご本人の親」など */
export function donorLabel(wh: WorkingHousehold, d: { kind: string; of?: string }): string {
  const k = DONOR_KINDS.find((o) => o.value === d.kind)?.label ?? "親族";
  if (d.kind === "other") return k;
  return d.of !== undefined ? `${memberLabel(wh, d.of)}の${k}` : `受け取る人の${k}`;
}

export function donorOptions(wh: WorkingHousehold): Option[] {
  return [{ value: "", label: "贈与する人を選ばない" }, ...(wh.request.input.household.donors ?? []).map((d) => ({ value: d.id, label: donorLabel(wh, d) }))];
}

const PREFS = "北海道,青森,岩手,宮城,秋田,山形,福島,茨城,栃木,群馬,埼玉,千葉,東京,神奈川,新潟,富山,石川,福井,山梨,長野,岐阜,静岡,愛知,三重,滋賀,京都,大阪,兵庫,奈良,和歌山,鳥取,島根,岡山,広島,山口,徳島,香川,愛媛,高知,福岡,佐賀,長崎,熊本,大分,宮崎,鹿児島,沖縄".split(",");

/** 協会けんぽの支部（都道府県。kyokaikenpo.01〜47） */
export const KYOKAI_BRANCHES: Option[] = PREFS.map((p, i) => ({ value: `kyokaikenpo.${String(i + 1).padStart(2, "0")}`, label: `${p}支部` }));
