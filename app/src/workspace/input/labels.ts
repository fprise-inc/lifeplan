// 入力の画面の言葉（FP が慣れた言葉。日本FP協会・FP技能検定の言葉を標準にする）と、構成員の呼び方
import type { Household, Member } from "../../engine/types.ts";
import { ageAt } from "../levers.ts";
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

/**
 * 構成員の呼び方: 続柄（ご本人・配偶者・第1子…）と、FP が付けた呼び名（任意）。
 * nicknames を false にすると続柄だけ（顧客に渡すファイル〔持ち帰り用のレポート〕の文。呼び名は入れない。0030 の2）
 */
export function memberLabels(wh: WorkingHousehold, o: { nicknames?: boolean } = {}): Map<string, string> {
  const out = new Map<string, string>();
  const h = wh.request.input.household;
  const rs = roles(wh.request);
  for (const r of rs) {
    const base = elderLabel(wh, r.member) ?? KIND_LABEL[r.member.kind] ?? r.label;
    const nick = o.nicknames === false ? undefined : wh.labelsByMember[r.member.id];
    out.set(r.member.id, nick !== undefined && nick !== "" ? `${base}（${nick}）` : base);
  }
  for (const m of h.members) if (!out.has(m.id)) out.set(m.id, elderLabel(wh, m) ?? KIND_LABEL[m.kind] ?? "ご家族");
  // 孫は呼び名が無いと「孫」「孫」と並んで見分けられないので、同じ呼び方の孫が2人以上なら、足した順に「孫1」「孫2」…（呼び名のある孫は「孫（長男の子）」のまま）。
  // 顧客に渡すファイル（呼び名を入れない）では、孫が2人以上なら全員に番号が付く
  const grandchildren = h.members.filter((m) => m.kind === "grandchild").map((m) => ({ m, label: out.get(m.id) }));
  for (const g of grandchildren) {
    const same = grandchildren.filter((x) => x.label === g.label);
    if (same.length < 2) continue;
    const nick = o.nicknames === false ? undefined : wh.labelsByMember[g.m.id];
    const no = `${KIND_LABEL.grandchild ?? "孫"}${String(same.indexOf(g) + 1)}`;
    out.set(g.m.id, nick !== undefined && nick !== "" ? `${no}（${nick}）` : no);
  }
  return out;
}

/**
 * 時点 bothAfter（表の最後の年の12月）の呼び方: 配偶者のいる世帯（結婚の予定も。計算エンジンは世帯の中のご本人・配偶者の財産を合わせる）は「二人とも亡くなった後」、
 * 一人の世帯は「表の最後の年」（二人がいないので「二人とも」と言わない）
 */
export function bothAfterLabel(h: Household): string {
  return h.members.some((m) => m.kind === "spouse" && m.outside === undefined) ? "二人とも亡くなった後" : "表の最後の年";
}

export function memberLabel(wh: WorkingHousehold, id: string | undefined, o: { nicknames?: boolean } = {}): string {
  if (id === undefined) return "（未選択）";
  return memberLabels(wh, o).get(id) ?? "（いない家族）";
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

// ---- 名義・人の候補（入力項目をまたぐ言葉の決まりの「名義・人」）: 候補は、その物を持てる人だけ ----

/**
 * 持てる人の決まり（物の種類ごと）:
 * - anyone: 世帯の人なら誰でも（預金・課税口座・外貨預金・暗号資産・保険・不動産・その他の資産）
 * - pensionInsured: 20歳以上か、働き方の期間がある人（iDeCo。会社員の配偶者〔第3号〕も入れる。20歳前でも厚生年金に入って働いていれば入れる）
 * - employee: 勤めている期間（会社員・公務員・役員・パートなど。自営業と働いていないを除く）がある人（企業型DC・財形貯蓄・持株会）
 * - selfEmployedOrExecutive: 自営業か会社役員の期間がある人（小規模企業共済）
 * - age18: その時に18歳以上の人（NISA・旧NISA・今の車。これから買う車は買う月で見る）
 * - child: 子（こどもNISA・ジュニアNISA）
 */
export type HolderRule = "anyone" | "pensionInsured" | "employee" | "selfEmployedOrExecutive" | "age18" | "child";

/** 口座の種類ごとの持てる人（書いていない種類は anyone） */
export const ACCOUNT_HOLDER_RULES: Readonly<Partial<Record<string, HolderRule>>> = {
  ideco: "pensionInsured",
  corporateDc: "employee",
  zaikei: "employee",
  esop: "employee",
  smallBusinessMutualAid: "selfEmployedOrExecutive",
  nisa: "age18",
  legacyNisa: "age18",
  childNisa: "child",
  juniorNisa: "child",
};
export const accountHolderRule = (kind: string): HolderRule => ACCOUNT_HOLDER_RULES[kind] ?? "anyone";

const NOT_EMPLOYEE: ReadonlySet<string> = new Set(["selfEmployed", "unemployed"]);

/**
 * その人が持てるか（at はいつの時点で見るか。省略は計算の基準の月）。世帯の外の家族とこれから生まれる子は持てない。
 * 働き方の期間は、いつの期間でもあれば持てるとする（今は働いていなくても、前に入った iDeCo・財形を持ち続けることがあるため）
 */
export function canHold(h: Household, baseMonth: string, rule: HolderRule, m: Member, at: string = baseMonth): boolean {
  if (m.outside !== undefined || m.expected === true) return false;
  const periods = (h.employmentPeriods ?? []).filter((e) => e.member === m.id);
  switch (rule) {
    case "anyone":
      return true;
    case "pensionInsured":
      return ageAt(m, at) >= 20 || periods.some((e) => e.type !== "unemployed");
    case "employee":
      return periods.some((e) => !NOT_EMPLOYEE.has(e.type));
    case "selfEmployedOrExecutive":
      return periods.some((e) => e.type === "selfEmployed" || e.type === "executive");
    case "age18":
      return ageAt(m, at) >= 18;
    case "child":
      return m.kind === "child";
  }
}

/** 前に選んだが、今の決まりでは持てない人の名前の添え書き（世帯の値は書き換えず、そのまま見せて計算する） */
export const LEGACY_HOLDER_SUFFIX = "（前に選んだ人）";

/**
 * 名義・人の欄の選択肢（持てる人だけ）。今入っている人が持てない人なら、添え書きを付けて後ろに残す（黙って書き換えない）。
 * 当てはめは各入力項目の側（口座の名義・車の名義など）
 */
export function holderOptions(wh: WorkingHousehold, rule: HolderRule, current: string | undefined, at?: string): Option[] {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const out = memberOptions(wh, (m) => canHold(h, base, rule, m, at ?? base));
  if (current !== undefined && current !== "" && !out.some((o) => o.value === current) && h.members.some((m) => m.id === current)) out.push({ value: current, label: `${memberLabel(wh, current)}${LEGACY_HOLDER_SUFFIX}` });
  return out;
}

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

/**
 * 伸び方の選択肢（入力項目をまたぐ言葉の決まり）: 欄の名前は「伸び方」、率の欄は「伸び率（年）」か「増減率（年）」（下がることもある物は増減率。欄ごとの表は 0130 の追記 2026-11-08）。働き方の期間だけ「賃金に合わせる」を足す
 * （働き方の入力項目の側）。値（inflation・rate・none）と既定は変えない
 */
export const GROWTH_KINDS: Option[] = [
  { value: "inflation", label: "物価に合わせる" },
  { value: "rate", label: "決まった率で" },
  { value: "none", label: "変えない" },
];

/**
 * 入力項目をまたいで使う言葉（決まりの表の正は設計記録 0130。各入力項目の欄はこの言葉を使う）。
 * 制度・統計の名前（物価上昇率・賃金上昇率など）はこの決まりの外で、そのまま使う
 */
export const WORDS = {
  /** 伸び方の欄の名前 */
  growth: "伸び方",
  /** 決まった率の欄の名前（伸びるのが前提の物: 物価に連れる費用など） */
  growthRate: "伸び率（年）",
  /** 決まった率の欄の名前（下がることもある物: 評価額・家賃・売上・年収・入るお金など。0130 の追記 2026-11-08） */
  changeRate: "増減率（年）",
  /** くり返しの欄（1回／毎月／年ごと） */
  cadence: "回数",
  /** 1回のお金の「いつ」 */
  when: "時期",
  /** くり返す物・期間の始まりと終わり */
  start: "始まり",
  end: "終わり",
  /** 終わりが空のとき */
  untilLast: "最後まで",
  /** 物の持ち主 */
  holder: "名義",
  /** 物・行を外すボタン */
  remove: "外す",
  /** 選び直しの取りやめ */
  cancel: "キャンセル",
  /** 開いたまとまりを閉じるボタン */
  close: "▾ 閉じる",
  /** ご本人の呼び方（「本人の」と書かない） */
  self: "ご本人",
} as const;

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
  { value: "deposit", label: "預金" },
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

/**
 * 援助（住宅資金・教育資金など）の贈与する人に選べる人: 介護・親の項目の親・祖父母（世帯の外の家族。選ぶとその人を贈与する人として扱う。
 * 世帯ファイルでは援助の donor がその構成員の ID を指す）と、生年月を入れない贈与する人（donors）。
 * 前に援助で選んだ世帯の外の家族が親・祖父母でなくなっても、選んだまま見えるように候補に残す
 */
export function donorCandidates(wh: WorkingHousehold): Option[] {
  const h = wh.request.input.household;
  const used = new Set<string>();
  for (const r of h.residences ?? []) for (const g of r.purchase?.gifts ?? []) if (g.donor !== undefined) used.add(g.donor);
  for (const goal of h.goals ?? []) for (const g of goal.education?.gifts ?? []) if (g.donor !== undefined) used.add(g.donor);
  const elder = (m: Member) => m.kind === "parent" || m.kind === "grandparent";
  const elders = memberOptions(wh, (m) => (m.outside !== undefined || elder(m)) && (elder(m) || used.has(m.id)));
  return [...elders, ...(h.donors ?? []).map((d) => ({ value: d.id, label: `生年月を入れない贈与する人（${donorLabel(wh, d)}）` }))];
}

export function donorOptions(wh: WorkingHousehold): Option[] {
  return [{ value: "", label: "贈与する人を選ばない" }, ...donorCandidates(wh)];
}

/** 援助の贈与する人（donor）として選ばれている数（世帯の外の家族の構成員・生年月を入れない贈与する人のどちらの ID でも） */
export function donorUses(h: Household, id: string): number {
  let n = 0;
  for (const r of h.residences ?? []) for (const g of r.purchase?.gifts ?? []) if (g.donor === id) n++;
  for (const goal of h.goals ?? []) for (const g of goal.education?.gifts ?? []) if (g.donor === id) n++;
  return n;
}

const PREFS = "北海道,青森,岩手,宮城,秋田,山形,福島,茨城,栃木,群馬,埼玉,千葉,東京,神奈川,新潟,富山,石川,福井,山梨,長野,岐阜,静岡,愛知,三重,滋賀,京都,大阪,兵庫,奈良,和歌山,鳥取,島根,岡山,広島,山口,徳島,香川,愛媛,高知,福岡,佐賀,長崎,熊本,大分,宮崎,鹿児島,沖縄".split(",");

/** 協会けんぽの支部（都道府県。kyokaikenpo.01〜47） */
export const KYOKAI_BRANCHES: Option[] = PREFS.map((p, i) => ({ value: `kyokaikenpo.${String(i + 1).padStart(2, "0")}`, label: `${p}支部` }));

/**
 * 時点の欄で年齢を選べる人を大人（ご本人・配偶者）だけにする決まり（時点の部品の who。今入っている人・欄の人〔被保険者・名義の人〕はいつも出る）。
 * 車の手放す時期・保険の保障の終わり・預金の引き出せない期間の終わりなど、子の年齢で決めることのない欄に使う（入力項目をまたいだそろえ。0150）
 */
export const ADULTS_WHO = (m: Member): boolean => m.kind === "self" || m.kind === "spouse";
