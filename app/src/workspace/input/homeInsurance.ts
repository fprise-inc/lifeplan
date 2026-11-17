// 住宅購入の予定の火災保険・地震保険（0221）: 買った後に必ず入る火災保険（建物）と地震保険の、契約の年数分の保険料の推定。
// - 欄は住宅購入の予定の purchase.homeInsurance（契約の年数・火災保険料・地震保険料・推定の元の都道府県・保険の入力項目で入れた印）。
//   計算エンジン（housing.residence）が買った月と、その後は年数ごとに払い、地震保険の分を地震保険料控除に入れる
// - 推定（空にしない。入れ忘れを防ぐ）: これから買う家（購入の月が計算基準月か後）の購入の予定に欄が無ければ、推定で足す（refreshEstimates から）。
//   推定のままの保険料は、物件の価格・購入の種類・建物の構造・建った年・都道府県・契約の年数に合わせて入れ直す。FP が入れた額は変えない
// - 保険金額（建物）: 物件の価格の建物の分（物件の価格×(1−土地の割合)。注文住宅は合計−土地の代金）。マンションは専有部分の割合（目安50%）を掛ける
//   （共用部分は管理組合の保険）。火災保険は建て直しの額で入るので、中古も築年数で下げない。家財の保険は含めない
// - 火災保険料: 構造の区分（M＝マンション・T＝鉄骨・コンクリート造の戸建て・H＝木造の戸建て）の保険金額1,000万円あたり5年分の目安
//   （損害保険料率算出機構の統計から。事務所の推定の値 hearing/src/presets.ts）。5年以外は地震保険と同じ長期係数で直す
// - 地震保険料: 保険金額＝火災保険の保険金額×割合（目安50%。建物は5,000万円まで）。都道府県と構造（イ構造＝マンション・鉄骨・コンクリート造、
//   ロ構造＝木造）の基本料率（QUAKE_LAW）に、建築年割引10%（新築と1982年から建った中古）と長期係数を当てる。都道府県が分からなければ、
//   いちばん高い区分（東京都・神奈川県・千葉県・静岡県など）で見る（少なく見積もらない）
import type { Box, Household, InsuranceContract, Residence } from "../../engine/types.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { presetNum } from "../../../../hearing/src/presets.ts";
import { kindOf } from "./insuranceKinds.ts";
import { PREFECTURES } from "./labels.ts";
import { propertyTaxInputs } from "./propertyTax.ts";
import { formatYen } from "./units.ts";

/**
 * 地震保険の制度の値（事務所で変えられない。改定のときに直す）。財務省「地震保険の基本料率（令和4年10月1日以降保険始期の地震保険契約）」と
 * 「地震保険制度の概要」（長期係数・割引制度・保険金額の決め方）。2026-11-17 に確かめた（損害保険料率算出機構の基準料率。その後の改定は無い）
 * - rates: 都道府県（JIS の番号）ごとの [イ構造, ロ構造] の保険金額1,000万円・1年あたりの基本料率（円）
 * - longTerm: 契約の年数（1〜5年）の長期係数（1年あたりの料率に掛ける）
 * - builtYearDiscount: 建築年割引（昭和56年6月1日以後に新築した建物）10%。耐震等級割引（最大50%）・免震建築物割引は分からないので当てない
 * - buildingLimit: 地震保険の保険金額の上限（建物）5,000万円
 * - unknown: 都道府県が分からないときに使う区分（いちばん高い区分）
 */
export const QUAKE_LAW = {
  rates: {
    "01": [7300, 11200], "02": [7300, 11200], "03": [7300, 11200], "04": [11600, 19500], "05": [7300, 11200], "06": [7300, 11200], "07": [11600, 19500],
    "08": [23000, 41100], "09": [7300, 11200], "10": [7300, 11200], "11": [26500, 41100], "12": [27500, 41100], "13": [27500, 41100], "14": [27500, 41100],
    "15": [7300, 11200], "16": [7300, 11200], "17": [7300, 11200], "18": [7300, 11200], "19": [11600, 19500], "20": [7300, 11200], "21": [7300, 11200],
    "22": [27500, 41100], "23": [11600, 19500], "24": [11600, 19500], "25": [7300, 11200], "26": [7300, 11200], "27": [11600, 19500], "28": [7300, 11200],
    "29": [7300, 11200], "30": [11600, 19500], "31": [7300, 11200], "32": [7300, 11200], "33": [7300, 11200], "34": [7300, 11200], "35": [7300, 11200],
    "36": [23000, 41100], "37": [11600, 19500], "38": [11600, 19500], "39": [23000, 41100], "40": [7300, 11200], "41": [7300, 11200], "42": [7300, 11200],
    "43": [7300, 11200], "44": [7300, 11200], "45": [11600, 19500], "46": [7300, 11200], "47": [11600, 19500],
  } as Readonly<Record<string, readonly [number, number]>>,
  longTerm: [1, 1.9, 2.85, 3.75, 4.7] as const,
  builtYearDiscount: 0.1,
  /** 建築年割引が当たる建った年（昭和56年6月1日以後の新築。年しか分からないので1982年から） */
  builtYearFrom: 1982,
  buildingLimit: 50_000_000,
  unknown: [27500, 41100] as const,
};

/** 推定の根拠の文の頭（この頭の推定を、この推定の印として読む） */
export const FIRE_BASIS = "火災保険の推定";
export const QUAKE_BASIS = "地震保険の推定";

/** 契約の年数の既定（事務所の推定の値） */
export const HOME_INSURANCE_YEARS = (): number => Math.min(5, Math.max(1, Math.round(presetNum("preset.housing.homeInsurance.years"))));

export interface HomeInsuranceInputs {
  /** 物件の価格の建物の分（円） */
  building: number;
  condo: boolean;
  /** 建物の構造（wood・lightSteel・steel・rc） */
  structure: string;
  newBuild: boolean;
  /** 建った年（中古で入れていなければ undefined） */
  builtYear?: number;
  /** 都道府県（"01"〜"47"。分からなければ undefined） */
  prefecture?: string;
  /** 契約の年数（1〜5） */
  years: number;
  /** 注文住宅 */
  custom?: boolean;
}

export interface HomeInsuranceEstimate {
  fire: number;
  fireBasis: string;
  earthquake: number;
  earthquakeBasis: string;
  /** 火災保険・地震保険の保険金額（建物） */
  insured: number;
  quakeInsured: number;
}

const round100 = (v: number): number => Math.round(v / 100) * 100;
const roundTo100k = (v: number): number => Math.round(v / 100000) * 100000;
const man = (v: number): string => `${formatYen(Math.round(v / 10000) * 10000, "man")}万円`;
const yenText = (v: number): string => `${formatYen(v, "yen")}円`;
const pct = (r: number): string => `${String(Math.round(r * 1000) / 10)}%`;
const coef = (years: number): number => QUAKE_LAW.longTerm[Math.min(5, Math.max(1, Math.round(years))) - 1] ?? 1;
const isWood = (structure: string): boolean => structure !== "rc" && structure !== "steel" && structure !== "lightSteel";
const prefName = (code: string | undefined): string | null => PREFECTURES.find((p) => p.value === code)?.label ?? null;

/** 火災保険の構造の区分（マンションは M、鉄骨・コンクリート造の戸建ては T、木造の戸建ては H） */
export function fireClass(condo: boolean, structure: string): "m" | "t" | "h" {
  return condo ? "m" : isWood(structure) ? "h" : "t";
}
const FIRE_CLASS_TEXT = { m: "M構造（マンション）", t: "T構造（鉄骨・コンクリート造の戸建て）", h: "H構造（木造の戸建て。省令準耐火ならT構造で安くなる）" } as const;

/** 推定の計算（純粋な関数） */
export function homeInsuranceEstimate(o: HomeInsuranceInputs): HomeInsuranceEstimate {
  const years = Math.min(5, Math.max(1, Math.round(o.years)));
  const share = o.condo ? presetNum("preset.housing.homeInsurance.condoShare") : 1;
  const insured = roundTo100k(Math.max(0, o.building) * share);
  // 火災保険: 構造の区分の1,000万円あたり5年分の目安 ÷ 5年の長期係数 × その年数の長期係数
  const cls = fireClass(o.condo, o.structure);
  const rate5 = presetNum(`preset.housing.homeInsurance.fire.${cls}`);
  const fire = round100(((insured / 10_000_000) * rate5 * coef(years)) / coef(5));
  const kind = o.custom === true ? "注文住宅（新築の戸建て）" : `${o.newBuild ? "新築" : "中古"}の${o.condo ? "マンション" : "戸建て"}`;
  const amountText = o.condo ? `建物の分${man(o.building)}×専有部分の割合${pct(share)}＝保険金額${man(insured)}` : `保険金額は建物の分${man(insured)}（建て直しの額。築年数で下げない）`;
  const fireBasis = `${FIRE_BASIS}（${String(years)}年分。${kind}・${amountText}・${FIRE_CLASS_TEXT[cls]}。保険金額1,000万円あたり5年分${yenText(rate5)}の目安（損害保険料率算出機構の2024年度の新契約の統計から）${years !== 5 ? `を長期係数（${String(years)}年 ${String(coef(years))}・5年 ${String(coef(5))}）で直した` : ""}。家財の保険は含めない。補償（水災など）と会社で変わるので、見積もりの額が分かれば入れてください）`;
  // 地震保険: 保険金額は火災保険の割合（上限5,000万円）。都道府県と構造の基本料率 × (1−建築年割引) × 長期係数
  const qShare = presetNum("preset.housing.homeInsurance.quakeShare");
  const quakeInsured = Math.min(QUAKE_LAW.buildingLimit, roundTo100k(insured * qShare));
  const wood = !o.condo && isWood(o.structure);
  const known = o.prefecture !== undefined ? QUAKE_LAW.rates[o.prefecture] : undefined;
  const rate1 = (known ?? QUAKE_LAW.unknown)[wood ? 1 : 0];
  const discount = o.newBuild || (o.builtYear !== undefined && o.builtYear >= QUAKE_LAW.builtYearFrom) ? QUAKE_LAW.builtYearDiscount : 0;
  const earthquake = round100((quakeInsured / 10_000_000) * rate1 * (1 - discount) * coef(years));
  const where = known !== undefined ? (prefName(o.prefecture) ?? "") : "都道府県が分からないので、いちばん高い区分（東京都・神奈川県・千葉県・静岡県など）";
  const earthquakeBasis = `${QUAKE_BASIS}（${String(years)}年分。保険金額は火災保険の${pct(qShare)}の${man(quakeInsured)}・${where}・${wood ? "ロ構造（木造。省令準耐火ならイ構造）" : "イ構造（鉄骨・コンクリート造・マンション）"}の基本料率 1,000万円あたり年${yenText(rate1)}（令和4年10月から）${discount > 0 ? `・建築年割引${pct(discount)}` : "・割引なし（建った年が分からないか、1981年より前）"}${years > 1 ? `・長期係数${String(coef(years))}` : ""}。耐震等級割引（最大50%）は見ない。付けないなら0円にしてください）`;
  return { fire, fireBasis, earthquake, earthquakeBasis, insured, quakeInsured };
}

// ---- 世帯から推定の元を読む ----

/** 購入の月（購入の年月。省略は住み始め） */
export const purchaseMonthOf = (h: Household, r: Residence): string | null => (r.purchase === undefined ? null : resolveTimepoint(h, r.purchase.at ?? r.from));

/** 推定の元（購入の予定の持ち家でなければ null）。建物の分・構造・新築か中古かは固定資産税の推定と同じ読み方（propertyTax.ts） */
export function homeInsuranceInputs(h: Household, r: Residence, landShareSetting?: string): HomeInsuranceInputs | null {
  const t = propertyTaxInputs(h, r, 9999, landShareSetting);
  if (t === null || r.purchase === undefined) return null;
  const hi = r.purchase.homeInsurance;
  return {
    building: Math.max(0, t.price * (1 - t.landShare)),
    condo: t.condo,
    structure: t.structure,
    newBuild: t.newBuild,
    ...(t.builtYear !== undefined ? { builtYear: t.builtYear } : {}),
    ...(hi?.prefecture !== undefined ? { prefecture: hi.prefecture } : {}),
    years: hi?.years ?? HOME_INSURANCE_YEARS(),
    ...(t.custom === true ? { custom: true } : {}),
  };
}

const basisOf = (b: Box<number> | undefined): string | undefined => (b as { estimate?: { basis?: string } } | undefined)?.estimate?.basis;
const isAuto = (b: Box<number> | undefined): boolean => b !== undefined && b.state === "estimated" && b.origin.kind === "auto";
/** 欄がこの推定のままか（FP が入れていない） */
export const isEstimatedPremium = (b: Box<number> | undefined, head: string): boolean => isAuto(b) && (basisOf(b)?.startsWith(head) ?? false);
const estBox = (value: number, basis: string): Box<number> => ({ value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis } }) as Box<number>;

/** 推定の値（欄を空にしたとき。推定の元が読めなければ null） */
export function homeInsuranceEstimateOf(h: Household, r: Residence, landShareSetting?: string): HomeInsuranceEstimate | null {
  const o = homeInsuranceInputs(h, r, landShareSetting);
  return o === null ? null : homeInsuranceEstimate(o);
}

/** 欄が無い購入の予定に足す欄（契約の年数の既定と推定の保険料） */
export function newHomeInsurance(h: Household, r: Residence, landShareSetting?: string): NonNullable<NonNullable<Residence["purchase"]>["homeInsurance"]> | null {
  const e = homeInsuranceEstimateOf(h, r, landShareSetting);
  if (e === null) return null;
  return { years: HOME_INSURANCE_YEARS(), fire: estBox(e.fire, e.fireBasis), earthquake: estBox(e.earthquake, e.earthquakeBasis) };
}

/**
 * 推定を入れる・入れ直す（h をそのまま書き換える）: これから買う家（購入の月が計算基準月か後）の購入の予定に欄が無ければ推定で足し、
 * 欄があれば推定のままの保険料だけを入れ直す。前に買った家（購入の月が計算基準月より前）には足さない（本当の契約は保険の入力項目で入れる）
 */
export function applyHomeInsurance(h: Household, r: Residence, baseMonth: string, landShareSetting?: string): void {
  if (r.kind !== "own" || r.purchase === undefined) return;
  const cur = r.purchase.homeInsurance;
  if (cur === undefined) {
    const ym = purchaseMonthOf(h, r);
    if (ym === null || ym < baseMonth) return;
    const add = newHomeInsurance(h, r, landShareSetting);
    if (add !== null) r.purchase.homeInsurance = add;
    return;
  }
  const fireOurs = isEstimatedPremium(cur.fire, FIRE_BASIS);
  const quakeOurs = isEstimatedPremium(cur.earthquake, QUAKE_BASIS);
  if (!fireOurs && !quakeOurs) return;
  const e = homeInsuranceEstimateOf(h, r, landShareSetting);
  if (e === null) return;
  if (fireOurs && (cur.fire.value !== e.fire || basisOf(cur.fire) !== e.fireBasis)) cur.fire = estBox(e.fire, e.fireBasis);
  if (quakeOurs && (cur.earthquake.value !== e.earthquake || basisOf(cur.earthquake) !== e.earthquakeBasis)) cur.earthquake = estBox(e.earthquake, e.earthquakeBasis);
}

/** 世帯の購入の予定の火災保険・地震保険の推定を入れ直す（refreshEstimates から。固定資産税の推定と同じ元を読むので、注文住宅の推定の後に） */
export function refreshHomeInsurance(h: Household, baseMonth: string, landShareSetting?: string): void {
  for (const r of h.residences ?? []) applyHomeInsurance(h, r, baseMonth, landShareSetting);
}

// ---- 二重に数えない（買った後の本当の契約を保険の入力項目で入れたとき） ----

/** 保険の入力項目の損害保険の契約（買った家の火災保険・地震保険かもしれない物） */
export const nonLifeContracts = (h: Household): InsuranceContract[] => (h.insuranceContracts ?? []).filter((c) => kindOf(c).kind === "nonLife" || c.deductionCategory.type === "earthquake");

/** 住宅購入の予定で火災保険・地震保険を数えているか（欄があり、保険の入力項目で入れた印が無い） */
export const countsHomeInsurance = (r: Residence): boolean => r.kind === "own" && r.purchase?.homeInsurance !== undefined && r.purchase.homeInsurance.countedInInsurance !== true;

/** 二重に数えているかもしれない文（欄の横と確かめの注意。損害保険が無ければ null） */
export function overlapText(h: Household, r: Residence): string | null {
  const n = nonLifeContracts(h).length;
  if (!countsHomeInsurance(r) || n === 0) return null;
  return `保険の入力項目に損害保険が${String(n)}件あります。買った家の火災保険・地震保険をそちらで入れたなら、ここと二重に数えています。「保険の入力項目で入れた」にしてください（今の住まいの家財の保険などなら、このままで構いません）`;
}
