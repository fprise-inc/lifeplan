// 収益不動産（0079）: 人に貸して家賃・地代を受け取っている不動産を、物件ごとに1つのまとまりで入れる。
// - 物件は不動産の器（accounts[] の kind realEstate）のうち、中身（property。0028）を持つもの。中身の無い不動産（評価額だけ）は貯蓄・運用の
//   「その他の資産」に残る。「＋ 物件を足す」は中身を持つ器を作るので、足せば最初から中身の欄（土地と建物・家賃収入・経費・売却・ローン）が出る
// - 物件を見分ける欄（物件名・種類・所在地・持分・権利・戸数・面積・メモ）は表示用で、計算には使わない（計算部品は読まない）
// - 欄のキーは貯蓄・運用の中にあったときのまま（`sav/<器の ID>/…`）。次回確かめるの印・読み替え表の当て先がそのまま当たる
// - 上の一覧表（rentalOverview）は入力から出せる数字だけ（評価額・ローン残高・空室率を引いた後の月の収入）
// - お金の欄（0080）: 取得価額の内訳・取得時の諸費用・自己資金、家賃以外の月の収入・礼金と更新料、経費の費目、大きな修繕の予定、物件のローンの
//   借入先・金利の段階・繰上返済・借り換え・団信、民泊・宿の営業の形と売上（1泊の単価×稼働率×営業日数か月の売上の見込み）と経費の入れ方
// - 税と出口（0081）: 売ったときにこの物件のローンを返すか（売却の詳細）、民泊・宿の所得の区分（雑所得・事業所得・不動産所得。詳細）、
//   物件の持ち主ごとの申告の仕方（青色・白色）と青色申告特別控除の額、事業的規模の目安（5棟10室。種類と戸数から）
import type { Account, Debt, Household, Member, RealEstateExpenseItem, RealEstateProperty } from "../../../engine/types.ts";
import type { Address } from "../../store/readings.ts";
import { addMonths } from "../../levers.ts";
import { byId, field, plain, removeAction, resolveTimepoint, timepointField, yenBox, type FieldDef, type Finder, type GroupDef, type Option, type StageDef } from "../form.ts";
import { confirmedBox, mutate, newId, standardBox, type WorkingHousehold } from "../household.ts";
import { BUILDING_STRUCTURES, memberLabels, memberOptions, VALUATION_DEFAULTS } from "../labels.ts";
import { monthsBetween } from "../loanMath.ts";
import { stagedGroups } from "../staged.ts";
import { creditLifeFields, loanFields, loanStepGroups } from "./housing.ts";
import { loanMoreActions } from "./housingLoans.ts";
import { GROWTH_RANGE } from "../rateRanges.ts";
import { presetNum, presetRate } from "../../../../../hearing/src/presets.ts";

const accounts = (h: Household) => h.accounts;
/** 欄の当て先（器の中の入力項目） */
const onAccount = (id: string, item: string, at: string[] = []) => (): Address => ({ target: { object: id }, item, at });
const withAddress = (f: FieldDef, a: () => Address): FieldDef => ({ ...f, address: a });

export const UNENTERED_PROPERTY_VALUE = "未入力（評価額を入れてください。0円で計算中）";
export const UNENTERED_RENT = "未入力（家賃を入れてください。0円で計算中）";

/** 収益不動産の物件（不動産の器のうち、中身を持つもの） */
export const isRentalProperty = (a: Pick<Account, "kind" | "property">): boolean => a.kind === "realEstate" && a.property !== undefined;
export const rentalProperties = (h: Household): Account[] => (h.accounts ?? []).filter(isRentalProperty);

/** 物件の種類（表示用） */
export const RENTAL_KINDS: Option[] = [
  { value: "condo", label: "区分マンション" },
  { value: "apartment", label: "一棟アパート" },
  { value: "mansion", label: "一棟マンション" },
  { value: "house", label: "戸建て" },
  { value: "commercial", label: "店舗/事務所" },
  { value: "parking", label: "駐車場" },
  { value: "land", label: "貸している土地" },
  { value: "lodging", label: "民泊・宿" },
];
/** 建物の無い種類（貸している土地・駐車場）。建物の欄を出さず、取得価額を全部土地として計算する（エンジンの isLandOnlyKind と同じ） */
export const isLandOnlyKind = (kind: string | undefined): boolean => kind === "land" || kind === "parking";
/**
 * 建物の無い種類なのに、建物の分が計算に入っている（前の版で入れた土地の割合が1未満か、取得価額の内訳の建物がある）。
 * このときは黙って変えず、建物の欄を出したまま知らせる
 */
export function landOnlyWithBuilding(p: RealEstateProperty | undefined): boolean {
  if (p === undefined || !isLandOnlyKind(p.kind)) return false;
  return (p.landShare !== undefined && Number(p.landShare) < 1) || (p.acquisition?.parts?.building ?? 0) > 0;
}
/**
 * 種類ごとの言葉（0079 の追記 2026-11-06）。貸している土地は地代、駐車場は駐車料・区画で言う。ほかの種類は家賃・部屋。
 * 欄のキーと計算は種類で変えない（言葉だけ）
 */
export function rentWords(kind: string | undefined): { income: string; rent: string; rentHelp: string; vacancy: string; vacancyHelp: string } {
  if (kind === "parking")
    return {
      income: "駐車場の収入",
      rent: "満車時の駐車料（合計）",
      rentHelp: "すべての区画が埋まっているときの、駐車場全体の月の駐車料の合計です。自販機・看板などの収入は、「詳細」で別の欄に入れます",
      vacancy: "空車率（空き区画の割合）",
      vacancyHelp: "1年を通して、区画が空いている割合の見込みです。満車時の駐車料からこの割合を引いて計算します（例: 20区画のうち平均して2区画空くなら 10%）",
    };
  if (kind === "land")
    return {
      income: "地代収入",
      rent: "地代（月額）",
      rentHelp: "土地を貸して受け取る地代の月額です（年払いなら12で割った額）。更新料・承諾料などは、「詳細」の更新料・承諾料などの欄に年あたりにならして入れます",
      vacancy: "地代が入らない割合",
      vacancyHelp: "契約が終わってから次の借り手が決まるまでの空き期間や、滞納の見込みです。契約が続く間はふつう 0% です。地代からこの割合を引いて計算します",
    };
  return {
    income: "家賃収入",
    rent: "満室時の家賃（合計）",
    rentHelp: "すべての部屋（区画）が埋まっているときの、物件全体の家賃の合計です。共益費・駐車場の収入などは、「詳細」で別の欄に入れます",
    vacancy: "空室率",
    vacancyHelp: "1年を通して、部屋が空いている割合の見込みです。満室時の家賃からこの割合を引いて計算します（例: 1年のうち平均して半月空くなら 4%）。共益費・駐車場などの収入からも同じ割合を引きます",
  };
}
/** 大きな修繕の例（種類ごと） */
export const repairExamples = (kind: string | undefined): string => (kind === "parking" ? "舗装の打ち直し・機械式駐車設備の更新" : kind === "land" ? "整地・擁壁や塀の補修" : "外壁・屋根・設備の更新");
/** 評価額の意味（時価。0079 の追記 2026-11-06） */
const MARKET_VALUE_NOTE = "今売るとしたらの値段の目安（時価）です。固定資産税評価額・相続税評価額（路線価）ではありません。";
/** 会社名義の物件の案内（名義の欄の「?」。0079 の追記 2026-11-06） */
export const CORPORATE_NOTE = "家族の誰の名義かを選びます。会社（法人）の名義の物件はここに入れません。家計には、会社からの役員報酬・会社への貸付金・自社株などとして入れます";
const LAND_ONLY_WARN ="貸している土地・駐車場には建物が無いので、ふつうは土地の割合を入れません。今はこの割合で建物の分を減価償却しています。空にすると、取得価額と評価額を全部土地として計算します";
const LAND_ONLY_PART_WARN = "貸している土地・駐車場には建物が無いので、今はこの額を建物として減価償却しています。舗装・機械式駐車設備などは、設備の欄に入れてください";
/** 民泊・宿の計算に入れていないもの（消費税・個人事業税は扱わない。0080・0081。種類の欄の「?」の中） */
export const LODGING_NOTE = "売上が年1,000万円を超えるときの消費税と、個人事業税は計算しません";
/** 民泊・宿の所得の区分（0081）。省略は営業の形から（エンジンと同じ: 旅館業は事業所得、ほかは雑所得） */
export const LODGING_INCOME_KINDS: Option[] = [
  { value: "miscellaneous", label: "雑所得" },
  { value: "business", label: "事業所得" },
  { value: "realEstate", label: "不動産所得" },
];
export const lodgingIncomeKind = (l: NonNullable<RealEstateProperty["lodging"]>): "miscellaneous" | "business" | "realEstate" => l.incomeKind ?? (l.business === "inn" ? "business" : "miscellaneous");
/** 申告の仕方と青色申告特別控除の区分（0081） */
export const TAX_RETURN_METHODS: Option[] = [
  { value: "white", label: "白色" },
  { value: "blue", label: "青色" },
];
export const BLUE_DEDUCTIONS: Option[] = [
  { value: "electronic", label: "65万円" },
  { value: "doubleEntry", label: "55万円" },
  { value: "simple", label: "10万円" },
];
/** 事業的規模の目安（5棟10室。1棟を2室として合わせる。エンジンの tax.totalIncome と同じ数え方） */
export const BUSINESS_SCALE_ROOMS = 10;
export const BUSINESS_SCALE_HELP =
  "貸している部屋がおおむね10室以上か、戸建てがおおむね5棟以上なら、事業的規模とされます（国税庁 No.1373）。戸建ては1棟を2室、ほかは戸数を室として数え、駐車場・土地は数えていません。事業的規模なら青色申告特別控除の55万円・65万円が使えます。最終の判断は税理士にご確認ください";

/** その人の物件から数えた事業的規模の目安（不動産所得の物件だけ。民泊・宿は所得の区分が不動産所得のときだけ） */
export function businessScale(h: Household, member: string): { rooms: number; houses: number; met: boolean } {
  let rooms = 0;
  let houses = 0;
  for (const a of rentalProperties(h)) {
    const p = a.property;
    if (a.owner !== member || p === undefined || p.rental === undefined) continue;
    if (p.lodging !== undefined && lodgingIncomeKind(p.lodging) !== "realEstate") continue;
    if (p.kind === "condo") rooms += 1;
    else if (p.kind === "house") houses += 1;
    else if (p.kind === "apartment" || p.kind === "mansion" || p.kind === "commercial" || p.kind === "lodging") rooms += p.units ?? 1;
  }
  return { rooms, houses, met: rooms + houses * 2 >= BUSINESS_SCALE_ROOMS };
}

/** その人に事業所得があるか（自営の働き方・事業所得の民泊・宿。青色申告特別控除の55万円・65万円の要件） */
function hasBusinessIncome(h: Household, member: string): boolean {
  if ((h.employmentPeriods ?? []).some((x) => x.member === member && x.type === "selfEmployed")) return true;
  return rentalProperties(h).some((a) => a.owner === member && a.property?.lodging !== undefined && lodgingIncomeKind(a.property.lodging) === "business");
}
/** 住宅宿泊事業の営業日数の上限（エンジンと同じ） */
export const PRIVATE_LODGING_DAYS = 180;
/** 民泊・宿の営業の形 */
export const LODGING_BUSINESSES: Option[] = [
  { value: "privateLodging", label: "住宅宿泊事業（民泊新法）" },
  { value: "inn", label: "旅館業（簡易宿所など）" },
  { value: "specialZone", label: "特区民泊" },
];
const SALES_BY: Option[] = [
  { value: "month", label: "月の売上の見込みで" },
  { value: "night", label: "1泊の単価・稼働率・営業日数で" },
];
/**
 * 経費の費目（0080）。show: その物件で欄を出すか（値が入っていれば必ず出す）。byKind: 建物の無い種類（駐車場・貸している土地）での
 * 名前と説明（0079 の追記 2026-11-06。費目のキーと計算は変えない）
 */
export interface ExpenseItemDef {
  key: RealEstateExpenseItem;
  label: string;
  show: (p: RealEstateProperty) => boolean;
  help?: string;
  byKind?: Partial<Record<"parking" | "land", { label: string; help?: string }>>;
}
export const EXPENSE_ITEMS: readonly ExpenseItemDef[] = [
  // 貸している土地には建物の管理が無いので出さない（入れてあれば「管理費」として出す）
  { key: "management", label: "建物管理費・修繕積立金", show: (p) => p.kind !== "land", byKind: { parking: { label: "管理費・設備の保守", help: "清掃・巡回・機械式駐車設備の保守点検などの、毎年の額です" }, land: { label: "管理費" } } },
  { key: "propertyTax", label: "固定資産税・都市計画税", show: () => true },
  { key: "insurance", label: "損害保険（火災・地震）", show: () => true, byKind: { parking: { label: "保険料（施設賠償責任など）" }, land: { label: "保険料（施設賠償責任など）", help: "建物は借り手のものなので、地主の保険はふつう少額か0円です" } } },
  { key: "groundRent", label: "地代", show: (p) => p.tenure === "leasehold", help: "借地権の物件で、土地の持ち主に払う地代です" },
  { key: "facility", label: "共用部の光熱費・清掃・設備点検", show: (p) => p.lodging === undefined && p.kind !== "land", byKind: { parking: { label: "照明などの電気代・設備点検" }, land: { label: "光熱費・清掃など" } } },
  {
    key: "leasing",
    label: "入居者募集の費用・原状回復",
    show: (p) => p.lodging === undefined,
    help: "広告料・仲介の手数料・退去のときの原状回復などを、年あたりにならした額です",
    byKind: { parking: { label: "利用者の募集の費用", help: "看板・募集サイトの掲載料・仲介の手数料などを、年あたりにならした額です" }, land: { label: "借り手の募集の費用", help: "仲介の手数料・契約の書類の費用などを、年あたりにならした額です" } },
  },
  { key: "cleaning", label: "清掃・リネン", show: (p) => p.lodging !== undefined },
  { key: "supplies", label: "消耗品", show: (p) => p.lodging !== undefined },
  { key: "utilities", label: "光熱費・通信", show: (p) => p.lodging !== undefined },
  { key: "other", label: "税理士の報酬・その他", show: () => true },
];
/** その物件での費目の名前と説明（建物の無い種類は byKind） */
export function expenseItemText(x: ExpenseItemDef, p: RealEstateProperty): { label: string; help?: string } {
  const k = p.kind === "parking" || p.kind === "land" ? x.byKind?.[p.kind] : undefined;
  const help = k === undefined ? x.help : k.help;
  return { label: k?.label ?? x.label, ...(help !== undefined ? { help } : {}) };
}
/** 費目の合計（1つも入れていなければ null） */
export function expenseItemsTotal(p: RealEstateProperty | undefined): number | null {
  const xs = Object.values(p?.expenses?.items ?? {}).filter((v): v is number => typeof v === "number");
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0);
}
/** 取得価額の内訳の合計（入れていなければ null） */
export function acquisitionPartsTotal(p: RealEstateProperty | undefined): number | null {
  const parts = p?.acquisition?.parts;
  if (parts === undefined) return null;
  return (parts.land ?? 0) + (parts.building ?? 0) + (parts.equipment ?? 0);
}
/** 建物附属設備の法定耐用年数の既定（エンジンと同じ） */
const EQUIPMENT_LIFE = 15;
/** 戸数を標準で聞く種類（一棟） */
const WHOLE_BUILDING = new Set(["apartment", "mansion"]);
const TENURES: Option[] = [
  { value: "ownership", label: "所有権" },
  { value: "leasehold", label: "借地権" },
];

const kindLabel = (a: Account): string | null => RENTAL_KINDS.find((o) => o.value === a.property?.kind)?.label ?? null;

/** 物件の呼び方: 物件名、無ければ「物件1」「物件2」（収益不動産の中の並びの番号） */
export function rentalName(h: Household, a: Account): string {
  const name = a.property?.name?.trim();
  if (name !== undefined && name !== "") return name;
  const i = rentalProperties(h).findIndex((x) => x.id === a.id);
  return `物件${i < 0 ? 1 : i + 1}`;
}

/** 評価額がまだ入っていない（「＋ 物件を足す」の印のまま） */
export const propertyValueUnentered = (a: Account): boolean => a.marketValue?.state === "estimated" && (a.marketValue.value ?? 0) === 0;

/** 円を万円の文字に（1万円未満は小数1桁まで） */
function man(yen: number): string {
  const m = yen / 10000;
  if (Number.isInteger(m)) return m.toLocaleString("ja-JP");
  if (Math.abs(yen) < 1_000_000) return String(Math.round(m * 10) / 10);
  return Math.round(m).toLocaleString("ja-JP");
}

/** その物件のローン（負債の型で、debts[].property がその器を指すもの。0028） */
export const propertyLoans = (h: Household, id: string): Debt[] => (h.debts ?? []).filter((d) => d.property === id);

/**
 * ローンの今の残高（入力から出す目安）: 今の残高を入れていればその値。無ければ借入額と最初の金利・返済の方法・期間から、計算の基準の月の
 * 残高を出す（金利の段階・繰上返済・ボーナス返済は見ない。計算の結果の残高とは少し違うことがある）。これから借りるローンは0
 */
export function loanBalanceNow(h: Household, d: Debt, baseMonth: string): number {
  if (d.balance?.value != null) return d.balance.value;
  const start = resolveTimepoint(h, d.start);
  const n = d.repayment.termMonths;
  // これから借りるローン（借入の月が計算の基準の月より後）は、今の残高に入れない
  if (start !== null && start > baseMonth) return 0;
  const k = start === null ? 0 : Math.max(0, Math.min(n, monthsBetween(start, baseMonth)));
  if (k <= 0) return d.principal;
  if (k >= n) return 0;
  const r = Number(d.rateSchedule[0]?.rate ?? "0") / 12;
  if (d.repayment.method === "equalPrincipal") return Math.max(0, Math.round(d.principal * (1 - k / n)));
  if (r === 0) return Math.max(0, Math.round(d.principal * (1 - k / n)));
  const g = Math.pow(1 + r, k);
  const pay = (d.principal * r) / (1 - Math.pow(1 + r, -n));
  return Math.max(0, Math.round(d.principal * g - (pay * (g - 1)) / r));
}

/** 民泊・宿の月の売上（1泊の単価×稼働率×営業日数÷12。住宅宿泊事業は180日まで。エンジンと同じく円未満を切り捨てる） */
export function lodgingMonthlySales(p: RealEstateProperty): number | null {
  const l = p.lodging;
  if (l === undefined || l.salesBy !== "night") return null;
  const cap = l.business === "privateLodging" ? PRIVATE_LODGING_DAYS : 366;
  const days = Math.min(l.days ?? (l.business === "privateLodging" ? PRIVATE_LODGING_DAYS : 365), cap);
  return Math.floor((Math.floor((l.nightly ?? 0) * Number(l.occupancy ?? "0")) * days) / 12);
}

/**
 * 月の収入（空室率を引いた後。貸していなければ 0）: 満室時の家賃と家賃以外の月の収入（共益費・駐車場・その他）から、それぞれ空室率を引いた額。
 * 民泊・宿は月の売上（空室率は使わない）。礼金・更新料は入れない。エンジンと同じく円未満を切り捨てる
 */
export function monthlyIncome(a: Account): number {
  const p = a.property;
  const r = p?.rental;
  if (p === undefined || r === undefined) return 0;
  if (p.lodging !== undefined) return lodgingMonthlySales(p) ?? (r.monthly.value ?? 0);
  const keep = 1 - Number(r.vacancyRate ?? "0");
  const extra = (r.commonFee ?? 0) + (r.parking ?? 0) + (r.otherMonthly ?? 0);
  return Math.floor((r.monthly.value ?? 0) * keep) + (extra > 0 ? Math.floor(extra * keep) : 0);
}

export interface RentalRow {
  id: string;
  name: string;
  kind: string | null;
  value: number;
  loan: number;
  /** 月の収入（空室率を引いた後。家賃以外の月の収入・民泊の売上を含む） */
  income: number;
}

/** 物件の一覧表（入力から出せる数字だけ。物件が無ければ null） */
export function rentalOverview(wh: WorkingHousehold): { rows: RentalRow[]; total: Omit<RentalRow, "id" | "name" | "kind"> } | null {
  const h = wh.request.input.household;
  const list = rentalProperties(h);
  if (list.length === 0) return null;
  const base = wh.request.input.baseMonth;
  const rows = list.map((a) => ({
    id: a.id,
    name: rentalName(h, a),
    kind: kindLabel(a),
    value: a.marketValue?.value ?? 0,
    loan: propertyLoans(h, a.id).reduce((s, d) => s + loanBalanceNow(h, d, base), 0),
    income: monthlyIncome(a),
  }));
  const sum = (k: "value" | "loan" | "income") => rows.reduce((s, r) => s + r[k], 0);
  return { rows, total: { value: sum("value"), loan: sum("loan"), income: sum("income") } };
}

/** 物件を1件足す（中身つきの不動産の器。評価額と家賃は「未入力（0円で計算中）」の印で始める） */
export function addRentalProperty(wh: WorkingHousehold, id: () => string = newId): WorkingHousehold {
  return mutate(wh, (h) => {
    const self = h.members.find((m) => m.kind === "self") ?? h.members[0];
    if (self === undefined) return;
    (h.accounts ??= []).push({
      id: id(),
      kind: "realEstate",
      owner: self.id,
      marketValue: standardBox(0, UNENTERED_PROPERTY_VALUE),
      asOf: wh.request.input.baseMonth,
      contributions: [],
      property: { rental: { monthly: standardBox(0, UNENTERED_RENT) } },
    });
  });
}

/** 物件の見出しと、物件を見分ける欄・名義・評価額 */
function headGroup(wh: WorkingHousehold, a: Account): GroupDef {
  const h = wh.request.input.household;
  const find = byId(accounts, a.id);
  const findP: Finder = (hh, w) => (find(hh, w) as Account | undefined)?.property as Record<string, unknown> | undefined;
  const k = `sav/${a.id}`;
  const kp = `${k}/property`;
  const p = a.property ?? {};
  const whole = p.kind !== undefined && WHOLE_BUILDING.has(p.kind);
  // 建物の無い種類（駐車場・貸している土地）は、評価額の名前と「?」を種類に合わせる。前の版で建物の分が入っている物件は、
  // 計算が今までどおり建物の分を年数で減らすので、今までの名前と「?」のまま（0079 の追記 2026-11-06）
  const noBuilding = isLandOnlyKind(p.kind) && !landOnlyWithBuilding(p);
  const growthBase = "入れなければ前提条件の土地の上昇率（入れていなければ物価上昇率）。";
  const valueLabel = !noBuilding ? "今の評価額（土地と建物の合計）" : p.kind === "parking" ? "今の評価額（土地と設備の合計）" : "今の評価額（土地）";
  // 評価額は時価（今売るとしたらの値段の目安）。固定資産税評価額・相続税評価額（路線価）と取り違えないように書く（0079 の追記 2026-11-06）
  const valueHelp = !noBuilding
    ? `${MARKET_VALUE_NOTE}土地の割合で土地と建物に分け、建物は構造の耐用年数で減らし、土地は土地の評価額の増減率で動かします`
    : p.kind === "parking"
      ? `舗装・機械式駐車設備などの設備も含めた、駐車場全体の今の時価（売るとしたらの値段の目安）です。固定資産税評価額・相続税評価額（路線価）ではありません。全部を土地として扱い、土地の評価額の増減率で動かします`
      : `貸している土地の今の時価（売るとしたらの値段の目安）です。固定資産税評価額・相続税評価額（路線価）ではありません。借地権の付いた土地（底地）は、更地より低い額になるのがふつうです。土地の評価額の増減率で動かします`;
  const growthHelp = !noBuilding
    ? `${growthBase}建物は構造の耐用年数で減らします`
    : p.kind === "parking"
      ? `${growthBase}建物が無いので、評価額の全部（設備の分も）をこの率で動かします。設備は評価額では減らさず、減価償却だけを設備の耐用年数でします`
      : `${growthBase}建物が無いので、評価額の全部をこの率で動かします`;
  const self = h.members.find((m) => m.id === a.owner);
  const ageOf = self !== undefined ? { ageOf: (hh: Household) => hh.members.find((m) => m.id === self.id) } : {};
  const shareField = withAddress(
    plain({ key: `${kp}/share`, item: "account.property", label: "持分", level: "detail", kind: "pct", find: findP, path: ["share"], optional: true, help: "共有名義のとき、名義の人の持分です（例: 2分の1なら 50%）。入れなければ全部（単独の名義）" }),
    onAccount(a.id, "account.property", ["share"]),
  );
  const kindBase = withAddress(
    plain({
      key: `${kp}/kind`,
      item: "account.property",
      label: "種類",
      level: "simple",
      kind: "select",
      options: RENTAL_KINDS,
      find: findP,
      path: ["kind"],
      optional: true,
      structural: true,
      help: `種類と戸数は、事業的規模の目安（5棟10室）を数えるときだけ計算に使います。民泊・宿を選ぶと、家賃の代わりに宿泊の売上（1泊の単価・稼働率・営業日数か、月の売上の見込み）と、売上に対する手数料・清掃などの経費で入れます。${LODGING_NOTE}`,
      // 民泊・宿の入れ方（lodging）は種類が民泊・宿のときだけ持つ
      after: (_h, t, v) => {
        if (v === "lodging") t.lodging ??= {};
        else delete t.lodging;
      },
    }),
    onAccount(a.id, "account.property", ["kind"]),
  );
  const kindField: FieldDef = kindBase;
  const fields: FieldDef[] = [
    withAddress(
      plain({ key: `${kp}/name`, item: "account.property.name", label: "物件名", level: "simple", kind: "text", find: findP, path: ["name"], optional: true, help: "入れなければ「物件1」「物件2」と呼びます。ふだんの呼び方（「○○のアパート」など）で入れると見分けやすくなります" }),
      onAccount(a.id, "account.property.name"),
    ),
    kindField,
    plain({ key: `${k}/owner`, item: "account.owner", label: "名義", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["owner"], help: CORPORATE_NOTE }),
    yenBox({ key: `${k}/value`, item: "account.marketValue", label: valueLabel, level: "simple", basis: "once", find, path: ["marketValue"], help: valueHelp }),
    plain({ key: `${k}/asOf`, item: "account.asOf", label: "評価額の時点", level: "detail", kind: "ym", find, path: ["asOf"] }),
    // 持ち始める時点（0039。相続・贈与で受け取る物件。その月から評価額・家賃収入・経費に入れ、受け取るときの支払いは無い）。物件そのものの時点なので、
    // 評価額の時点の後に置く（前は「土地と建物」のまとまりの中にあった）
    withAddress(
      timepointField({
        key: `${kp}/holdFrom`,
        item: "account.property",
        label: "持ち始める時点",
        level: "detail",
        find: findP,
        path: ["holdFrom"],
        optional: true,
        absentWhenEmpty: true,
        nullText: "今から持っている",
        help: "これから相続・贈与で受け取る不動産の、持ち始める月です。その月から評価額（その年の年末から）・家賃収入・経費に入れます。受け取るときの支払いはありません（買うなら、購入の支払いを出るお金で入れます）。相続税の目安にも、その時点から入ります",
        ...ageOf,
      }),
      onAccount(a.id, "account.property", ["holdFrom"]),
    ),
    plain({
      key: `${k}/growth`,
      item: "account.valueGrowth",
      label: "土地の評価額の増減率（年）",
      level: "simple",
      kind: "pct",
      ...GROWTH_RANGE,
      find,
      path: ["valueGrowth"],
      optional: true,
      help: growthHelp,
    }),
    withAddress(plain({ key: `${kp}/location`, item: "account.property.location", label: "所在地", level: "detail", kind: "text", find: findP, path: ["location"], optional: true, help: "都道府県・市区町村まで（例: 埼玉県さいたま市）。番地は入れません" }), onAccount(a.id, "account.property.location")),
    {
      ...shareField,
      get: (w) => {
        const s = shareField.get(w);
        const v = typeof s.value === "string" ? Number(s.value) : null;
        return v !== null && v < 1 ? { ...s, warn: "計算はまだ全部を名義の人の分として扱います（評価額・家賃・経費・ローンは物件全体の額で入れてください）" } : s;
      },
    },
    withAddress(plain({ key: `${kp}/tenure`, item: "account.property", label: "権利", level: "detail", kind: "select", options: TENURES, find: findP, path: ["tenure"], optional: true }), onAccount(a.id, "account.property", ["tenure"])),
    withAddress(plain({ key: `${kp}/units`, item: "account.property", label: "戸数", level: whole ? "simple" : "detail", kind: "int", suffix: "戸", min: 1, max: 9999, find: findP, path: ["units"], optional: true, help: "一棟のときの部屋の数です。空室は、家賃収入の「空室率」で入れます" }), onAccount(a.id, "account.property", ["units"])),
    withAddress(plain({ key: `${kp}/landArea`, item: "account.property", label: "土地の面積", level: "detail", kind: "decimal", suffix: "㎡", find: findP, path: ["area", "land"], optional: true }), onAccount(a.id, "account.property", ["area", "land"])),
    // 建物の無い種類は出さない（入れてあれば出す）
    ...(!noBuilding || p.area?.floor !== undefined ? [withAddress(plain({ key: `${kp}/floorArea`, item: "account.property", label: "建物の延べ床面積", level: "detail", kind: "decimal", suffix: "㎡", find: findP, path: ["area", "floor"], optional: true }), onAccount(a.id, "account.property", ["area", "floor"]))] : []),
    withAddress(plain({ key: `${kp}/memo`, item: "account.property.memo", label: "メモ", level: "detail", kind: "text", find: findP, path: ["memo"], optional: true, help: "物件について FP が覚えておくこと（管理会社・修繕の予定など）。計算には使いません" }), onAccount(a.id, "account.property.memo")),
  ];
  const kl = kindLabel(a);
  return {
    key: k,
    title: `${rentalName(h, a)}（${[kl, propertyValueUnentered(a) ? "評価額は未入力" : `評価額 ${man(a.marketValue?.value ?? 0)}万円`].filter((x) => x !== null).join("・")}）`,
    level: "simple",
    // 売却・大きな修繕の予定は、別の「▸」（売却・大きな修繕の予定のまとまり）で開く
    moreLabel: "所在地・持分・メモなどを入れる",
    fields,
    actions: [
      removeAction(`${k}/remove`, "外す", "simple", (hh) => {
        hh.accounts = (hh.accounts ?? []).filter((x) => x.id !== a.id);
        for (const d of hh.debts ?? []) if (d.property === a.id) delete d.property;
      }),
    ],
  };
}

/** 取得価額の内訳（土地・建物・建物附属設備）・建物附属設備の耐用年数・取得時の諸費用・自己資金（詳細。0080） */
function acquisitionFields(wh: WorkingHousehold, a: Account): FieldDef[] {
  const find = byId(accounts, a.id);
  const findP: Finder = (h, w) => (find(h, w) as Account | undefined)?.property as Record<string, unknown> | undefined;
  const kp = `sav/${a.id}/property`;
  const asOf = a.asOf ?? wh.request.input.baseMonth;
  const p = a.property ?? {};
  // 内訳を書いたら、取得価額（合計）を内訳の合計にする（取得の年月が無ければ評価額の時点）。内訳を全部消したら合計はそのまま残す
  const afterPart = (h: Household, _t: unknown, _v: unknown, w: WorkingHousehold) => {
    const x = find(h, w) as Account | undefined;
    const acq = x?.property?.acquisition as (NonNullable<RealEstateProperty["acquisition"]> & { price?: number }) | undefined;
    if (acq === undefined) return;
    const total = acquisitionPartsTotal(x?.property);
    if (total === null) {
      if (acq.price === undefined) delete x!.property!.acquisition;
      return;
    }
    acq.price = total;
    acq.at ??= asOf;
  };
  const part = (key: "land" | "building" | "equipment", label: string, help: string): FieldDef => ({
    ...withAddress(
      plain({ key: `${kp}/part/${key}`, item: "account.property", label, level: "detail", kind: "yen", basis: "once", find: findP, path: ["acquisition", "parts", key], optional: true, help, after: afterPart }),
      onAccount(a.id, "account.property", ["acquisition", "parts", key]),
    ),
    sideEffects: "取得価額（合計）を内訳の合計にします",
  });
  const parts = p.acquisition?.parts;
  const has = (key: "land" | "building" | "equipment") => parts?.[key] !== undefined;
  const fields: FieldDef[] = [];
  if (!isLandOnlyKind(p.kind)) {
    fields.push(
      part("land", "取得価額の内訳: 土地", "売買契約書・固定資産税の評価額の比などで分けた土地の額です。内訳を入れると、土地の割合の代わりにこの内訳で取得価額を分けます（取得価額は内訳の合計になります）"),
      part("building", "取得価額の内訳: 建物", "建物の本体の額です。構造の法定耐用年数で減価償却します"),
      part("equipment", "取得価額の内訳: 建物附属設備", "給排水・電気・ガス・空調などの設備の額です。建物とは別の耐用年数（法定15年）で減価償却します"),
    );
  } else {
    // 建物の無い種類: 駐車場は土地と設備（舗装・機械式駐車設備など）に分けられる。貸している土地は、前に入れた内訳があるときだけ出す。
    // 建物の内訳は、前に入れた額があるときだけ出して知らせる（黙って消さない）
    const parking = p.kind === "parking";
    if (parking || has("land")) fields.push(part("land", "取得価額の内訳: 土地", "土地の額です。減価償却はしません（売ったときの取得費に入ります）"));
    if ((parts?.building ?? 0) > 0) {
      const b = part("building", "取得価額の内訳: 建物", "建物の本体の額です。構造の法定耐用年数で減価償却します");
      fields.push({ ...b, get: (w) => ({ ...b.get(w), warn: LAND_ONLY_PART_WARN }) });
    }
    if (parking || has("equipment"))
      fields.push(part("equipment", "取得価額の内訳: 設備（舗装・機械式駐車設備など）", "アスファルトなどの舗装・機械式駐車設備・照明・フェンスなどの額です。入れると、その耐用年数で減価償却します（入れなければ設備は無いものとして、全部を土地として計算します）"));
  }
  if ((p.acquisition?.parts?.equipment ?? 0) > 0)
    fields.push(
      withAddress(
        isLandOnlyKind(p.kind)
          ? plain({ key: `${kp}/equipmentLife`, item: "account.property", label: "設備の耐用年数", level: "detail", kind: "int", suffix: "年", min: 2, max: 50, find: findP, path: ["acquisition", "equipmentLife"], optional: true, fallback: EQUIPMENT_LIFE, help: "定額法で減価償却します。設備の種類の法定耐用年数を入れてください（舗装はアスファルト敷き10年・コンクリート敷き15年など。最終の判断は税理士にご確認ください）。入れなければ15年です" })
          : plain({ key: `${kp}/equipmentLife`, item: "account.property", label: "建物附属設備の耐用年数", level: "detail", kind: "int", suffix: "年", min: 2, max: 50, find: findP, path: ["acquisition", "equipmentLife"], optional: true, fallback: EQUIPMENT_LIFE, help: "定額法で減価償却します。入れなければ法定の15年（中古は建物と同じ経過年数で簡便法に直した年数）。入れたときは、その年数のまま使います" }),
        onAccount(a.id, "account.property", ["acquisition", "equipmentLife"]),
      ),
    );
  // 諸費用・自己資金は取得の中の欄なので、取得価額を入れてから
  if (p.acquisition !== undefined)
    fields.push(
      withAddress(
        plain({ key: `${kp}/acqCosts`, item: "account.property", label: "取得時の諸費用", level: "detail", kind: "yen", basis: "once", find: findP, path: ["acquisition", "costs"], optional: true, help: "仲介手数料・登記の費用・不動産取得税・印紙税などの合計です。建物（と建物附属設備）の分は取得価額に含めて減価償却します。土地の分は償却しません（売ったときの取得費に入ります）" }),
        onAccount(a.id, "account.property", ["acquisition", "costs"]),
      ),
      withAddress(
        plain({ key: `${kp}/equity`, item: "account.property", label: "自己資金", level: "detail", kind: "yen", basis: "once", find: findP, path: ["acquisition", "equity"], optional: true, help: "買うときに手元のお金から出した額（頭金と諸費用）です。計算には使いません" }),
        onAccount(a.id, "account.property", ["acquisition", "equity"]),
      ),
    );
  return fields;
}

/** 物件の中身: 土地と建物（構造・建った年・土地の割合・取得）、貸している（家賃・空室・変化率・期間）、経費、売却、ローン（0028） */
function propertyGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}`;
  const p = a.property ?? {};
  const setting = wh.request.input.assumptions?.realEstateValuation;
  const asOf = a.asOf ?? wh.request.input.baseMonth;
  const self = wh.request.input.household.members.find((m) => m.id === a.owner);
  const ageOf = self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
  const kp = `${k}/property`;
  // 中身（property）の中の欄は、中身を起点に読み書きする（欄を空にしても中身ごとは消えない）
  const findP: Finder = (h, w) => (find(h, w) as Account | undefined)?.property as Record<string, unknown> | undefined;
  const ensureProp = (h: Household, w: WorkingHousehold) => {
    const x = find(h, w) as Account | undefined;
    return x === undefined ? undefined : ((x.property ??= {}) as Record<string, unknown>);
  };
  const acquisitionYear = p.acquisition?.at !== undefined ? Number(p.acquisition.at.slice(0, 4)) : null;
  const partsTotal = acquisitionPartsTotal(p);
  const partsShare = partsTotal !== null && partsTotal > 0 ? String(Math.round(((p.acquisition?.parts?.land ?? 0) / partsTotal) * 1e6) / 1e6) : undefined;
  // 内訳を入れたら、取得価額（合計）は内訳の合計で、ここでは書き換えない
  const acqPriceField = (f: FieldDef): FieldDef =>
    partsTotal === null ? f : { ...f, readOnly: "取得価額の内訳を入れているので、その合計です（内訳の欄で直します）", get: (w) => ({ ...f.get(w), derived: "内訳の合計" }) };
  // 建物の無い種類（貸している土地・駐車場）は、建物の構造・建った年・土地の割合を出さない（全部を土地として計算する）。
  // 前の版で建物の分が入っている（土地の割合が1未満・内訳の建物）ときは、黙って変えずに欄を出し、土地の割合の欄で知らせる
  const landOnly = isLandOnlyKind(p.kind);
  const withBuilding = !landOnly || landOnlyWithBuilding(p);
  const structureField = plain({ key: `${kp}/structure`, item: "account.property", label: "建物の構造", level: "simple", kind: "select", options: BUILDING_STRUCTURES, find: findP, path: ["structure"], optional: true, fallback: "wood", help: "評価額の建物の部分を耐用年数（木造22年・軽量鉄骨19年・重量鉄骨34年・鉄筋コンクリート47年）で減らします。減価償却の耐用年数にも使います" });
  const builtYearField = plain({ key: `${kp}/builtYear`, item: "account.property", label: "建物が建った年", level: "simple", kind: "int", suffix: "年", min: 1900, max: 2200, find: findP, path: ["builtYear"], optional: true, fallback: acquisitionYear ?? Number(asOf.slice(0, 4)), help: "入れなければ取得の年（取得の年が無ければ評価額の時点の年）に新築とみなします" });
  const landShareBase = plain({
    key: `${kp}/landShare`,
    item: "account.property",
    label: "土地の割合",
    level: "simple",
    kind: "pct",
    min: 0,
    max: 100,
    find: findP,
    path: ["landShare"],
    optional: true,
    fallback: partsShare ?? setting?.landShare ?? VALUATION_DEFAULTS.landShare,
    help: "評価額と取得価額を土地と建物に分けます。マンションは土地の割合が小さめです。取得価額の内訳を入れたときは、取得価額は内訳で分け、この割合は評価額だけに使います（入れなければ内訳の土地の割合）",
  });
  const landShareField: FieldDef = !landOnly
    ? landShareBase
    : {
        ...landShareBase,
        get: (w) => {
          const st = landShareBase.get(w);
          return typeof st.value === "string" && Number(st.value) < 1
            ? {
                ...st,
                warn: LAND_ONLY_WARN,
                warnFix: {
                  label: "空にする（全部を土地にする）",
                  run: (ww) =>
                    mutate(ww, (hh) => {
                      const x = (hh.accounts ?? []).find((y) => y.id === a.id);
                      if (x?.property !== undefined) delete x.property.landShare;
                    }),
                },
              }
            : st;
        },
      };
  const groups: GroupDef[] = [
    {
      key: `${kp}/building`,
      title: withBuilding ? "土地と建物" : p.kind === "parking" ? "土地と設備" : "土地",
      level: "simple",
      moreLabel: landOnly ? (p.kind === "parking" ? "設備（舗装など）・諸費用を入れる" : "取得時の諸費用などを入れる") : "取得価額の内訳を入れる",
      fields: [
        ...(withBuilding ? [structureField, builtYearField, landShareField] : []),
        acqPriceField(plain({
          key: `${kp}/acqPrice`,
          item: "account.property",
          label: landOnly ? "取得価額" : "取得価額（土地と建物の合計）",
          level: "simple",
          kind: "yen",
          basis: "once",
          find: findP,
          path: ["acquisition", "price"],
          optional: true,
          help: landOnly
            ? `売ったときの取得費と、借入の利息のうち土地の取得のための分の計算に使います。建物が無いので減価償却はしません（全部を土地として計算します）${p.kind === "parking" ? "（舗装・機械式駐車設備などは、「詳細」の取得価額の内訳の設備に入れると、その耐用年数で減価償却します）" : ""}`
            : "減価償却費（建物の分）の計算に使います。入れなければ減価償却費は計算しません。取得価額の内訳を入れたときは、その合計です",
          after: (h, _t, v, w) => {
            const x = find(h, w) as Account | undefined;
            if (x?.property === undefined) return;
            if (v === null) delete x.property.acquisition;
            else if (x.property.acquisition !== undefined) x.property.acquisition.at ??= asOf;
          },
        })),
        plain({
          key: `${kp}/acqAt`,
          item: "account.property",
          label: "取得の年月",
          level: "simple",
          kind: "ym",
          find: findP,
          path: ["acquisition", "at"],
          optional: true,
          help: "取得価額といっしょに入れます",
          after: (h, _t, v, w) => {
            const x = find(h, w) as Account | undefined;
            if (x?.property?.acquisition === undefined) return;
            if (v === null || x.property.acquisition.price === undefined) delete x.property.acquisition;
          },
        }),
        ...acquisitionFields(wh, a),
      ],
      actions: [],
    },
  ];
  // 貸している（家賃収入）。民泊・宿は宿泊の売上（0080）
  const lodging = p.lodging;
  const rentFields: FieldDef[] = [
    field({
      key: `${kp}/rented`,
      item: "account.property",
      label: lodging !== undefined ? "営業している" : "貸している",
      help: lodging !== undefined ? "宿泊の売上を受け取っているときに入れます（これから始めるときも）" : "家賃・地代を受け取っているときに入れます（今は空いていて、これから貸すときも）",
      level: "simple",
      kind: "bool",
      structural: true,
      get: (w) => ({ value: (find(w.request.input.household, w) as Account | undefined)?.property?.rental !== undefined }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = ensureProp(h, w);
          if (x === undefined) return;
          if (v === true) x.rental ??= { monthly: confirmedBox(0) };
          else delete x.rental;
        }),
    }),
  ];
  const rentYen = (key: string, path: string[], label: string, basis: "monthly" | "annual", help: string, level: "simple" | "detail" = "detail") =>
    withAddress(plain({ key: `${kp}/${key}`, item: "account.property", label, level, kind: "yen", basis, find: findP, path, optional: true, help }), onAccount(a.id, "account.property", path));
  // 建物の無い種類（駐車場・貸している土地）は、地代・駐車料の言葉にし、共益費と駐車場の収入の欄は出さない（入れてあれば出す。
  // 駐車場の種類では、駐車場の収入は満車時の駐車料と重なるので、入れてあれば知らせる。どちらも計算は今までどおり足す）
  const words = rentWords(p.kind);
  const vac = words.vacancy;
  const showExtra = (x: number | undefined) => !landOnly || x !== undefined;
  const parkingExtra = rentYen("parking", ["rental", "parking"], "駐車場の収入（月額）", "monthly", `物件の駐車場の収入です。${vac}と変化率は家賃と同じに掛けます`);
  if (p.rental !== undefined && lodging !== undefined) rentFields.push(...lodgingSalesFields(wh, a));
  else if (p.rental !== undefined)
    rentFields.push(
      yenBox({ key: `${kp}/rent`, item: "account.property", label: words.rent, level: "simple", basis: "monthly", help: words.rentHelp, find: findP, path: ["rental", "monthly"] }),
      plain({ key: `${kp}/vacancy`, item: "account.property", label: vac, level: "simple", kind: "pct", find: findP, path: ["rental", "vacancyRate"], optional: true, fallback: "0", help: words.vacancyHelp }),
      ...(showExtra(p.rental.commonFee) ? [rentYen("commonFee", ["rental", "commonFee"], "共益費（月額）", "monthly", `家賃とは別に受け取る共益費・管理費です。${vac}と変化率は家賃と同じに掛けます`)] : []),
      ...(showExtra(p.rental.parking)
        ? [
            p.kind === "parking"
              ? {
                  ...parkingExtra,
                  get: (w: WorkingHousehold) => {
                    const st = parkingExtra.get(w);
                    return typeof st.value === "number" && st.value > 0 ? { ...st, warn: "種類が駐車場なので、駐車料はふつう「満車時の駐車料（合計）」に入れます。この欄の額も足して計算しています（同じ収入を両方に入れていないか確かめてください。分ける必要が無ければ、満車時の駐車料に足してこの欄を空にします）" } : st;
                  },
                }
              : parkingExtra,
          ]
        : []),
      rentYen("otherMonthly", ["rental", "otherMonthly"], "その他の月の収入", "monthly", `自販機・看板・アンテナの設置料など、毎月の収入です。${vac}と変化率は家賃と同じに掛けます`),
      rentYen(
        "keyMoney",
        ["rental", "keyMoney"],
        p.kind === "land" ? "更新料・承諾料など（年あたりの見込み）" : "礼金・更新料（年あたりの見込み）",
        "annual",
        p.kind === "land"
          ? "更新料や、名義を変えるとき・建て替えのときの承諾料などを、年あたりにならした額です。12か月に分けて受け取るとみなします（地代が入らない割合は掛けません）。保証金は返すお金なので入れません"
          : `入居の入れ替わり・更新の周期からならした、1年あたりの礼金・更新料です。12か月に分けて受け取るとみなします（${vac}は掛けません）`,
      ),
    );
  if (p.rental !== undefined)
    rentFields.push(
      plain({ key: `${kp}/rentGrowth`, item: "account.property", label: lodging !== undefined ? "売上の変化率（年）" : p.kind === "land" ? "地代の変化率（年）" : p.kind === "parking" ? "駐車料の変化率（年）" : "家賃の変化率（年）", level: "detail", kind: "pct", ...GROWTH_RANGE, find: findP, path: ["rental", "growth"], optional: true, fallback: "0", help: landOnly ? "下がる見込みはマイナスで入れます" : "古くなって家賃が下がる見込みはマイナスで入れます" }),
      timepointField({ key: `${kp}/rentFrom`, item: "account.property", label: "貸し始め", level: "detail", find: findP, path: ["rental", "from"], mode: "ym", optional: true, absentWhenEmpty: true, nullText: p.acquisition !== undefined ? "取得の月から" : "前から貸している", ...ageOf }),
      timepointField({ key: `${kp}/rentTo`, item: "account.property", label: "貸し終わり", level: "detail", find: findP, path: ["rental", "to"], startPath: ["rental", "from"], mode: "ym", optional: true, absentWhenEmpty: true, nullText: p.sale !== undefined ? "売るまで" : "最後まで", ...ageOf }),
    );
  groups.push({ key: `${kp}/rental`, title: lodging !== undefined ? "宿泊の売上" : words.income, level: "simple", moreLabel: lodging !== undefined ? "売上の変化率・貸す期間を入れる" : p.kind === "land" ? "更新料・貸す期間などを入れる" : landOnly ? "その他の収入・貸す期間などを入れる" : "共益費・礼金などを入れる", ...(p.rental !== undefined && p.acquisition === undefined && withBuilding ? { note: "取得価額と取得の年月を入れると、減価償却費を引いた不動産所得で税を計算します" } : {}), fields: rentFields, actions: [] });
  // 家賃と経費の年額の段階・例外の年（0040。詳細）
  const staged = (part: "rental" | "expenses", what: string, basis: "monthly" | "annual", value: (x: Account) => number | null, yearly = false): GroupDef[] =>
    stagedGroups(wh, {
      key: `${kp}/${part}`,
      find,
      target: { object: a.id },
      stages: { path: ["property", part, "stages"], item: "account.property", at: [part, "stages"] },
      exceptions: { path: ["property", part, "exceptions"], item: "account.property", at: [part, "exceptions"] },
      basis,
      what,
      base: (h) => {
        const x = (h.accounts ?? []).find((y) => y.id === a.id);
        return x === undefined ? null : value(x);
      },
      ...ageOf,
      ...(yearly ? { yearly: true } : {}),
      flow: part === "rental" ? "in" : "out",
      // 額の変化は、その額のまとまり（家賃収入・経費）の変化率の欄のすぐ後に並べる
      place: { group: `${kp}/${part}`, after: `${kp}/${part === "rental" ? "rentGrowth" : "expGrowth"}` },
    });
  if (p.rental !== undefined) groups.push(...staged("rental", lodging !== undefined ? "売上" : p.kind === "land" ? "地代" : p.kind === "parking" ? "駐車料" : "家賃", "monthly", (x) => (x.property === undefined ? null : (lodgingMonthlySales(x.property) ?? x.property.rental?.monthly.value ?? null))));
  // 経費（費目を1つでも入れたら、年額はその合計。0080）
  const itemsTotal = expenseItemsTotal(p);
  const annualBase = yenBox({ key: `${kp}/expAnnual`, item: "account.property", label: "年額（持っている間）", level: "simple", basis: "annual", find: findP, path: ["expenses", "annual"], optional: true, help: `${landOnly ? (p.kind === "parking" ? "固定資産税・都市計画税・管理費・設備の保守・保険料" : "固定資産税・都市計画税") : "管理費・修繕積立金・固定資産税・保険料"}など、毎年かかる額の合計です。「詳細」で費目ごとに入れると、その合計になります` });
  const annualField: FieldDef =
    itemsTotal === null
      ? annualBase
      : { ...annualBase, readOnly: "費目ごとに入れているので、その合計です（費目の欄で直します。費目を全部空にすると、前に入れた年額に戻ります）", get: (w) => ({ ...annualBase.get(w), value: expenseItemsTotal((find(w.request.input.household, w) as Account | undefined)?.property) ?? null, estimated: null, derived: "費目の合計" }) };
  const itemFields = EXPENSE_ITEMS.filter((x) => x.show(p) || p.expenses?.items?.[x.key] !== undefined).map((x) => {
    const t = expenseItemText(x, p);
    return withAddress(
      plain({ key: `${kp}/expItem/${x.key}`, item: "account.property", label: t.label, level: "detail", kind: "yen", basis: "annual", find: findP, path: ["expenses", "items", x.key], optional: true, help: `年額です。費目を1つでも入れると、経費の年額はその合計になります${t.help !== undefined ? `。${t.help}` : ""}` }),
      onAccount(a.id, "account.property", ["expenses", "items", x.key]),
    );
  });
  const expFields: FieldDef[] = [
    annualField,
    plain({
      key: `${kp}/expRate`,
      item: "account.property",
      label: lodging !== undefined ? "運営代行の手数料（売上に対する割合）" : p.kind === "land" ? "管理委託料など（地代に対する割合）" : p.kind === "parking" ? "管理委託料など（駐車料に対する割合）" : "管理委託料など（家賃に対する割合）",
      level: "simple",
      kind: "pct",
      min: 0,
      max: 100,
      find: findP,
      path: ["expenses", "rate"],
      optional: true,
      help: lodging !== undefined ? "運営代行・管理の会社に払う、売上に比例する手数料です（例: 20%）" : landOnly ? `管理委託料など、受け取る${p.kind === "land" ? "地代" : "駐車料"}（その他の月の収入を含む。${p.kind === "land" ? "更新料・承諾料など" : "礼金・更新料"}は含まない）に比例する経費（例: 5%）` : "管理委託料など、受け取る家賃（共益費・駐車場などの月の収入を含む。礼金・更新料は含まない）に比例する経費（例: 5%）",
    }),
  ];
  if (lodging !== undefined)
    expFields.push(withAddress(plain({ key: `${kp}/platformRate`, item: "account.property", label: "仲介サイトの手数料（売上に対する割合）", level: "simple", kind: "pct", find: findP, path: ["lodging", "platformRate"], optional: true, help: "宿泊の予約サイトに払う手数料です（例: 15%）" }), onAccount(a.id, "account.property", ["lodging", "platformRate"])));
  expFields.push(plain({ key: `${kp}/expGrowth`, item: "account.property", label: "年額の変化率（年）", level: "detail", kind: "pct", ...GROWTH_RANGE, find: findP, path: ["expenses", "growth"], optional: true, fallback: "0", help: landOnly ? "固定資産税の評価替えによる増減など" : "修繕積立金の値上がりなど" }), ...itemFields);
  groups.push({ key: `${kp}/expenses`, title: "経費", level: "simple", moreLabel: "経費の内訳を入れる", fields: expFields, actions: [] });
  if (p.expenses !== undefined) groups.push(...staged("expenses", "経費の年額", "annual", (x) => expenseItemsTotal(x.property) ?? x.property?.expenses?.annual?.value ?? null, true));
  // 売却・大きな修繕の予定（標準では、このまとまりの「▸」で開く。詳細では、修繕と売却のまとまりをそのまま出す）
  groups.push(plansGroup(wh, a));
  groups.push(...repairGroups(wh, a).map((g) => ({ ...g, unitOf: `${kp}/plans` })));
  // 売却の予定
  const saleFields: FieldDef[] = [
    field({
      key: `${kp}/sell`,
      item: "account.property",
      label: "売る予定がある",
      level: "simple",
      kind: "bool",
      structural: true,
      help: `売ると、売却価格から売却の費用を引いた手取りが預金に入り、その年から不動産は無くなります。譲渡所得の税（売った年の1月1日に所有期間が5年を超えれば長期で所得税15%・住民税5%、5年以下は短期で30%・9%。復興特別所得税などを含む）を、翌年3月の所得税と翌年度の住民税として計算します。取得費は取得価額と取得時の諸費用${withBuilding ? "から建物の減価償却の累計を引いた額" : p.kind === "parking" ? "から設備の減価償却の累計を引いた額" : "の合計"}（入っていなければ売却価格の5%）です`,
      get: (w) => ({ value: (find(w.request.input.household, w) as Account | undefined)?.property?.sale !== undefined }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = ensureProp(h, w);
          if (x === undefined) return;
          if (v === true) x.sale ??= { at: { at: addMonths(w.request.input.baseMonth, 120) } };
          else delete x.sale;
        }),
    }),
  ];
  if (p.sale !== undefined)
    saleFields.push(
      timepointField({ key: `${kp}/saleAt`, item: "account.property", label: "売る時期", level: "simple", find: findP, path: ["sale", "at"], ...ageOf }),
      plain({ key: `${kp}/salePrice`, item: "account.property", label: "売却価格", level: "simple", kind: "yen", basis: "once", find: findP, path: ["sale", "price"], optional: true, help: "入れなければ、その年の評価額で売るとみなします" }),
      plain({ key: `${kp}/saleCost`, item: "account.property", label: "売却の費用（売却価格に対する割合）", level: "detail", kind: "pct", find: findP, path: ["sale", "costRate"], optional: true, fallback: setting?.saleCostRate ?? VALUATION_DEFAULTS.saleCostRate, help: "仲介手数料・印紙税など。譲渡所得の計算では譲渡費用として引きます" }),
    );
  if (p.sale !== undefined && propertyLoans(wh.request.input.household, a.id).length > 0)
    saleFields.push(
      withAddress(
        plain({ key: `${kp}/saleRepay`, item: "account.property", label: "売ったときに、この物件のローンを返す", level: "detail", kind: "bool", find: findP, path: ["sale", "repayLoan"], fallback: true, help: "オンなら、売る月の返済の後に、この物件のローンの残りを一括で返します（キャッシュフロー表ではローンの返済の行に出ます）。オフなら、売った後も返済の予定のまま払います" }),
        onAccount(a.id, "account.property", ["sale", "repayLoan"]),
      ),
    );
  groups.push({ key: `${kp}/sale`, title: "売却", level: "detail", unitOf: `${kp}/plans`, fields: saleFields, actions: [] });
  // この物件のローン（負債の型。「住まい・ローン」の住宅ローン以外のローンと同じ欄）
  const loans = propertyLoans(wh.request.input.household, a.id);
  for (const d of loans) groups.push(...propertyLoanGroups(wh, d));
  groups.push({
    key: `${kp}/loans`,
    level: "simple",
    ...(loans.length === 0 ? { note: "この物件を買うために借りたローンがあれば足してください。利息を不動産所得の経費にします（返済は「住宅ローン以外のローン」として支出に入ります）" } : {}),
    fields: [],
    actions: [
      {
        key: `${kp}/addLoan`,
        label: "＋ この物件のローン",
        level: "simple",
        run: (w) =>
          mutate(w, (h) => {
            const start = (find(h, w) as Account | undefined)?.property?.acquisition?.at ?? w.request.input.baseMonth;
            (h.debts ??= []).push({
              id: newId(),
              kind: "other",
              property: a.id,
              debtors: [{ member: a.owner, role: "primary" }],
              principal: presetNum("preset.rental.loan.principal"),
              start: { at: start },
              rateSchedule: [{ from: { at: start }, type: "fixed", rate: presetRate("preset.rental.loan.rate") }],
              repayment: { method: "equalPayment", termMonths: presetNum("preset.rental.loan.termYears") * 12 },
            });
          }),
      },
    ],
  });
  return groups;
}

/**
 * 売却・大きな修繕の予定の入口（標準だけ）。標準では、売却と大きな修繕のまとまりは詳細の段なので、物件の頭の「▸」の中に埋もれて
 * どこで入れるか分かりにくかった。このまとまりの「▸ 売る予定・大きな修繕を入れる」で、その2つだけを開く。見出しに今入っている予定を書く
 */
function plansGroup(wh: WorkingHousehold, a: Account): GroupDef {
  const h = wh.request.input.household;
  const p = a.property ?? {};
  const kp = `sav/${a.id}/property`;
  const sale = p.sale !== undefined ? resolveTimepoint(h, p.sale.at) : null;
  const repairs = (p.repairs ?? []).length;
  const now = [...(sale !== null ? [`${Number(sale.slice(0, 4))}年${Number(sale.slice(5, 7))}月に売る`] : p.sale !== undefined ? ["売る予定あり"] : []), ...(repairs > 0 ? [`大きな修繕 ${repairs}件`] : [])];
  return {
    key: `${kp}/plans`,
    title: `売却・大きな修繕の予定${now.length > 0 ? `（${now.join("・")}）` : ""}`,
    ...(now.length === 0 ? { note: `まだありません（売る予定と、${repairExamples(p.kind)}など何年かに一度の大きな修繕の予定です。大きな修繕は、貸している間なら全額をその年の経費にします）` } : {}),
    level: "simple",
    simpleOnly: true,
    moreLabel: "売る予定・大きな修繕を入れる",
    fields: [],
    actions: [],
  };
}

/** 民泊・宿の売上の欄（営業の形・売上の入れ方と、1泊の単価・稼働率・営業日数か月の売上の見込み。0080） */
function lodgingSalesFields(wh: WorkingHousehold, a: Account): FieldDef[] {
  const find = byId(accounts, a.id);
  const findP: Finder = (h, w) => (find(h, w) as Account | undefined)?.property as Record<string, unknown> | undefined;
  const kp = `sav/${a.id}/property`;
  const l = a.property?.lodging ?? {};
  // 欄を空にしても、民泊・宿の入れ方（lodging）は残す（種類が民泊・宿の間は持つ）
  const keep = (_h: Household, t: Record<string, unknown>) => void (t.lodging ??= {});
  const lp = (key: string, path: string[], o: Omit<Parameters<typeof plain>[0], "key" | "item" | "find" | "path" | "after">) =>
    withAddress(plain({ key: `${kp}/${key}`, item: "account.property", find: findP, path: ["lodging", ...path], after: keep, ...o }), onAccount(a.id, "account.property", ["lodging", ...path]));
  const fields: FieldDef[] = [
    lp("lodgingBusiness", ["business"], { label: "営業の形", level: "simple", kind: "select", options: LODGING_BUSINESSES, optional: true, help: "住宅宿泊事業（民泊新法）は、営業日数が年180日までです。旅館業（簡易宿所など）・特区民泊は日数の上限なしで計算します" }),
    lp("salesBy", ["salesBy"], { label: "売上の入れ方", level: "simple", kind: "select", options: SALES_BY, optional: true, fallback: "month", structural: true, help: "月の売上の見込みか、1泊の単価×稼働率×営業日数（年）÷12 で毎月の売上にします。空室率は使いません" }),
    lp("incomeKind", ["incomeKind"], {
      label: "所得の区分",
      level: "detail",
      kind: "select",
      options: LODGING_INCOME_KINDS,
      optional: true,
      fallback: l.business === "inn" ? "business" : "miscellaneous",
      help: `入れなければ営業の形から、住宅宿泊事業・特区民泊は雑所得、旅館業は事業所得とします（国税庁の住宅宿泊事業の所得の扱い）。雑所得の赤字は給与などほかの所得から引けません。事業所得の赤字は引け、青色申告特別控除も使えます。賃貸の合間に一時的に貸すときは不動産所得にできます。${LODGING_NOTE}`,
    }),
  ];
  if (l.salesBy === "night") {
    const cap = l.business === "privateLodging";
    const days = lp("days", ["days"], { label: "営業日数（年）", level: "simple", kind: "int", suffix: "日", min: 1, max: 366, optional: true, fallback: cap ? PRIVATE_LODGING_DAYS : 365, help: "1年のうち宿として営業する日数です。入れなければ、住宅宿泊事業は180日、ほかは365日" });
    fields.push(
      lp("nightly", ["nightly"], { label: "1泊の単価", level: "simple", kind: "yen", basis: "once", unit: "yen", optional: true, help: "1泊あたりの宿泊料（清掃料などを含めた、受け取る額）の平均です" }),
      lp("occupancy", ["occupancy"], { label: "稼働率", level: "simple", kind: "pct", optional: true, help: "営業日数のうち、泊まりのある日の割合です（例: 70%）" }),
      {
        ...days,
        get: (w) => {
          const st = days.get(w);
          const x = (find(w.request.input.household, w) as Account | undefined)?.property?.lodging;
          return x?.business === "privateLodging" && typeof st.value === "number" && st.value > PRIVATE_LODGING_DAYS ? { ...st, warn: "住宅宿泊事業は年180日までなので、180日で計算しています" } : st;
        },
      },
    );
  } else fields.push(yenBox({ key: `${kp}/rent`, item: "account.property", label: "月の売上の見込み", level: "simple", basis: "monthly", find: findP, path: ["rental", "monthly"], help: "宿泊の売上（清掃料などを含めた、受け取る額）の1か月あたりの見込みです" }));
  return fields;
}

/** 大きな修繕の予定（年月・金額・中身。詳細。一時的支出で、貸している間なら全額をその年の経費。0080） */
function repairGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const kp = `sav/${a.id}/property`;
  const self = wh.request.input.household.members.find((m) => m.id === a.owner);
  const ageOf = self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
  const list = a.property?.repairs ?? [];
  const groups: GroupDef[] = list.map((x, j) => {
    const findR: Finder = (h, w) => (find(h, w) as Account | undefined)?.property?.repairs?.find((r) => r.id === x.id) as Record<string, unknown> | undefined;
    const kr = `${kp}/repair/${x.id}`;
    const addr = (path: string) => onAccount(a.id, "account.property", ["repairs", x.id, path]);
    return {
      key: kr,
      title: `大きな修繕 ${j + 1}${x.label !== undefined && x.label !== "" ? `（${x.label}）` : ""}`,
      level: "detail",
      fields: [
        withAddress(timepointField({ key: `${kr}/at`, item: "account.property", label: "年月", level: "detail", find: findR, path: ["at"], mode: "ym", ...ageOf }), addr("at")),
        withAddress(plain({ key: `${kr}/amount`, item: "account.property", label: "金額", level: "detail", kind: "yen", basis: "once", find: findR, path: ["amount"], help: "その月の一時的支出にします。貸している間なら、全額をその年の経費として不動産所得を計算します（資本的支出として減価償却する扱いはしていません）" }), addr("amount")),
        withAddress(
          plain({ key: `${kr}/label`, item: "account.property", label: "中身", level: "detail", kind: "text", find: findR, path: ["label"], optional: true, help: `${a.property?.kind === "parking" ? "舗装の打ち直し・ゲートの交換" : a.property?.kind === "land" ? "擁壁の補修・整地" : "外壁・屋上防水・給湯器の交換"}など（40字まで。計算には使いません）`, after: (_h, t, v) => void (typeof v === "string" && v.length > 40 ? (t.label = v.slice(0, 40)) : undefined) }),
          addr("label"),
        ),
      ],
      actions: [
        removeAction(`${kr}/remove`, "外す", "detail", (h) => {
          const p = (h.accounts ?? []).find((y) => y.id === a.id)?.property;
          if (p?.repairs === undefined) return;
          p.repairs = p.repairs.filter((r) => r.id !== x.id);
          if (p.repairs.length === 0) delete p.repairs;
        }),
      ],
    };
  });
  groups.push({
    key: `${kp}/repairs`,
    level: "detail",
    fields: [],
    actions: [
      {
        key: `${kp}/addRepair`,
        label: "＋ 大きな修繕",
        level: "detail",
        help: `${repairExamples(a.property?.kind)}など、何年かに一度の大きな修繕の予定です。その月の一時的支出にし、全額をその年の経費として計算します`,
        run: (w) =>
          mutate(w, (h) => {
            const p = (h.accounts ?? []).find((y) => y.id === a.id)?.property;
            if (p === undefined) return;
            (p.repairs ??= []).push({ id: newId(), at: { at: addMonths(w.request.input.baseMonth, presetNum("preset.rental.repair.afterMonths")) }, amount: presetNum("preset.rental.repair.amount") });
          }),
      },
    ],
  });
  return groups;
}

/** 物件のローンの団信の対象の「?」（住宅ローン向けの文ではなく、収益物件のローン向け） */
export const RENTAL_CREDIT_LIFE_HELP =
  "亡くなったとき・高度障害のとき、この人の負担分の残高が消え、その後の返済と利息がなくなります（家賃収入はそのまま家族に残ります）。アパートローンなど収益物件のローンでは、団信の加入を条件にするかどうかが金融機関や商品で分かれ、保険料が金利に上乗せされることもあります。契約の書類で確かめてください";

/** この物件のローン（負債の型。借入先・借入額・借りた年月・金利・返済の方法・期間・団信と、詳細の金利の段階・繰上返済・借り換え。0080） */
function propertyLoanGroups(wh: WorkingHousehold, d: Debt): GroupDef[] {
  const k = `housing/debt/${d.id}`;
  const findD = byId((h) => h.debts, d.id);
  const label = withAddress(
    plain({ key: `${k}/label`, item: "debt.label", label: "借入先", level: "detail", kind: "text", find: findD, path: ["label"], optional: true, help: "金融機関の名前など（見分けるための名前です。計算には使いません）" }),
    () => ({ target: { object: d.id }, item: "debt.label", at: [] }),
  );
  const title = typeof d.label === "string" && d.label !== "" ? `この物件のローン（${d.label}）` : "この物件のローン";
  return [
    {
      key: k,
      title,
      level: "simple",
      moreLabel: "金利の段階・借り換えを入れる",
      fields: [label, ...loanFields(wh, d, k), ...creditLifeFields(wh, d, "detail", { coveredHelp: RENTAL_CREDIT_LIFE_HELP })],
      actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.debts = (h.debts ?? []).filter((x) => x.id !== d.id)))],
    },
    ...loanStepGroups(d, k, { refinance: true }),
    {
      key: `${k}/more`,
      level: "detail",
      fields: [],
      actions: [
        ...loanMoreActions(wh, d, k).filter((x) => x.level === "detail"),
        {
          key: `${k}/addRefinance`,
          label: "＋ 借り換え",
          level: "detail",
          help: "その月に残りの残高を新しいローンで返します（新しい金利・期間・費用を入れます）",
          run: (w) =>
            mutate(w, (h) => {
              const x = (h.debts ?? []).find((y) => y.id === d.id);
              if (x === undefined) return;
              const when = addMonths(w.request.input.baseMonth, 60);
              (x.refinance ??= []).push({ at: { at: when }, rateSchedule: [{ id: newId(), from: { at: when }, type: "fixed", rate: x.rateSchedule.at(-1)?.rate ?? presetRate("preset.rental.loan.rate") }], termMonths: presetNum("preset.rental.refinance.termMonths") });
            }),
        },
      ],
    },
  ];
}

/** 物件の持ち主ごとの申告の仕方（青色・白色）と青色申告特別控除の額・事業的規模の目安（詳細。members[].taxReturn。0081） */
export function taxReturnGroups(wh: WorkingHousehold): GroupDef[] {
  const h = wh.request.input.household;
  const owners = [...new Set(rentalProperties(h).map((a) => a.owner))];
  const labels = memberLabels(wh);
  return owners.map((id): GroupDef => {
    const findM: Finder = (hh) => hh.members.find((m) => m.id === id) as Record<string, unknown> | undefined;
    const m = h.members.find((x) => x.id === id) as Member | undefined;
    const k = `rental/taxReturn/${id}`;
    const addr = (at: string) => (): Address => ({ target: { object: id }, item: "member.taxReturn", at: [at] });
    const fields: FieldDef[] = [
      withAddress(
        plain({
          key: `${k}/method`,
          item: "member.taxReturn",
          label: "申告の仕方",
          level: "detail",
          kind: "select",
          options: TAX_RETURN_METHODS,
          find: findM,
          path: ["taxReturn", "method"],
          optional: true,
          fallback: "white",
          structural: true,
          help: "青色申告なら、青色申告特別控除を不動産所得（と事業所得）から引き、損益通算で引ききれない赤字を翌年から3年繰り越します。白色は、引ききれない赤字を捨てます",
          // 白色（空欄）に戻したら申告の欄ごと外す
          after: (_h, t, v) => void (v === null || v === "white" ? delete t.taxReturn : undefined),
        }),
        addr("method"),
      ),
    ];
    if (m?.taxReturn?.method === "blue") {
      const scale = businessScale(h, id);
      const business = hasBusinessIncome(h, id);
      const dedBase = withAddress(
        plain({
          key: `${k}/blueDeduction`,
          item: "member.taxReturn",
          label: "青色申告特別控除",
          level: "detail",
          kind: "select",
          options: BLUE_DEDUCTIONS,
          find: findM,
          path: ["taxReturn", "blueDeduction"],
          optional: true,
          fallback: "simple",
          help: "65万円は複式簿記の帳簿と e-Tax での申告（か電子帳簿の保存）、55万円は複式簿記の帳簿と貸借対照表・損益計算書を期限内に出すとき、それ以外は10万円です。55万円・65万円は、不動産所得が事業的規模か事業所得があるときだけ使えます。不動産所得・事業所得の黒字の合計が上限で、不動産所得から先に引きます",
        }),
        addr("blueDeduction"),
      );
      fields.push({
        ...dedBase,
        get: (w) => {
          const st = dedBase.get(w);
          return (st.value === "electronic" || st.value === "doubleEntry") && !scale.met && !business ? { ...st, warn: "事業的規模の目安に当たらず事業所得も無いので、10万円で計算しています" } : st;
        },
      });
    }
    const scale = businessScale(h, id);
    const count = [scale.rooms > 0 ? `${scale.rooms}室` : "", scale.houses > 0 ? `${scale.houses}棟` : ""].filter((x) => x !== "").join("・");
    fields.push(
      field({
        key: `${k}/scale`,
        item: null,
        label: "事業的規模の目安",
        level: "detail",
        kind: "text",
        readOnly: "物件の種類と戸数から数えています",
        help: BUSINESS_SCALE_HELP,
        get: () => ({ value: `${scale.met ? "当たります" : "当たりません"}${count !== "" ? `（${count}）` : ""}` }),
        set: (w) => w,
      }),
    );
    // 物件1件の一部ではなく、持ち主ごとの欄（その人の物件をまとめて申告する）。物件の枠の外に置くので、見出しでそうと分かるように
    return { key: k, title: `申告（${labels.get(id) ?? "ご家族"}）: 持ち主ごと・その人の物件をまとめて`, level: "detail", fields, actions: [] };
  });
}

/** 物件1件のまとまり（見出しの欄と中身） */
export function rentalGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  return [headGroup(wh, a), ...propertyGroups(wh, a)];
}

export const RENTAL_HELP =
  "人に貸して、家賃や地代を受け取っている不動産です（アパート・区分マンション・戸建て・店舗・駐車場・貸している土地など）。貸していない土地・別荘は『貯蓄・運用』のその他の資産に入れます";

export function rentalStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const list = rentalProperties(h);
  return {
    id: "rental",
    label: "収益不動産",
    lead: "貸している物件ごとの評価額・家賃・経費・ローン・売却の予定。",
    sections: [
      {
        key: "rental/properties",
        title: "物件",
        note: list.length === 0 ? `まだありません。${RENTAL_HELP}` : `${RENTAL_HELP}。物件の評価額は資産と負債の推移・提案書のバランスシートに入り、家賃収入から経費・減価償却費・ローンの利息を引いた不動産所得は税・社会保険料の計算に入ります`,
        level: "simple",
        groups: [...list.flatMap((a) => rentalGroups(wh, a)), ...taxReturnGroups(wh)],
        actions: [{ key: "rental/add", label: "＋ 物件を足す", help: "評価額と家賃は未入力（0円で計算中）で始めます", level: "simple", run: (w) => addRentalProperty(w) }],
      },
    ],
  };
}
