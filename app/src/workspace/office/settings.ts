// 事務所の既定値（0073）: 事務所全体で使う既定を、事務所データ（暗号化。0011 の6）に持つ。世帯ファイルには入れない。
// - 新しい世帯を作るときに写す（前提条件の標準値・本人と配偶者の介護を最初から入れるか・不動産の評価の割合）。写した値は推定の印で、
//   根拠「事務所の標準（年月）」。後で事務所の値を変えても、作った世帯は黙って変わらない（確かめの一覧に「事務所の新しい値があります」）
// - 新しい世帯に写す、入力項目の選び方（出す入力項目と開いたときの入れ方。input/itemChoice.ts）。作った世帯の選び方は世帯ごとに直す
// - 画面の側で読むだけの既定（入力項目の並び・対策に最初から出す項目・万一のタブの想定の前提に最初から出す項目と場面の帯の並べ方・
//   受け取る予定の相続・贈与の見込みの既定・FP顧問料の料金表）は、その操作のときに読む。
//   対策に最初から出す項目（plans/leverChoice.ts。0084）と万一のタブの見せ方（contingency/premiseChoice.ts。0085）は見せ方だけなので世帯に写さず、
//   変えるとどの世帯にもすぐ効く
// - 新しい世帯に写す、必要保障額の数え方（いつまでの資金を数えるか・出し方。0085。世帯の万一の前提に写す。作った世帯は世帯の値のまま）
// - 読むときは形を確かめ、読めない値は既定（FPライズの標準）にする
import type { StageId } from "../input/form.ts";
import { DEFAULT_LAYOUT, type CardLayout } from "../input/items.ts";
import { applyCareDefaults, DEFAULT_CARE_DEFAULTS, type CareDefaults } from "../input/fill.ts";
import { DEFAULT_ASSUMPTIONS, type WorkingHousehold } from "../input/household.ts";
import { STAGE_ORDER } from "../input/stages/index.ts";
import { isEmptyChoice, readItemChoice, type ItemChoice } from "../input/itemChoice.ts";
import { isEmptyLeverChoice, readLeverChoice, type LeverChoice } from "../plans/leverChoice.ts";
import { isEmptyPremiseChoice, isEmptySceneChoice, normalProtection, readPremiseChoice, readProtectionSetting, readSceneChoice, withProtection, type PremiseChoice, type ProtectionSetting, type SceneChoice } from "../contingency/premiseChoice.ts";
import { setOfficeNow, STANDARD_FEE_TABLE, type FeeTable } from "./current.ts";

export { STANDARD_FEE_TABLE, type FeeTable } from "./current.ts";

/** 前提条件の標準値にできる系列（新しい世帯に写す。値は小数の文字。例: "0.01"） */
export const OFFICE_ASSUMPTIONS = ["inflation", "wageGrowth", "investmentReturn", "pensionMacroSlide"] as const;
export type OfficeAssumption = (typeof OFFICE_ASSUMPTIONS)[number];

export const ASSUMPTION_LABELS: Readonly<Record<OfficeAssumption, string>> = {
  inflation: "物価上昇率（年）",
  wageGrowth: "賃金上昇率（年）",
  investmentReturn: "運用利回り（年）",
  pensionMacroSlide: "年金の調整率（マクロ経済スライド）",
};

/** 受け取る予定（相続・贈与）と相続で受け継ぐ借金の見込みの既定 */
export type InheritLikelihood = "likely" | "uncertain";

export interface OfficeSettings {
  /** 形の版（この画面の側の形。1 から） */
  version: 1;
  /** 入力項目の並び（null は標準） */
  layout: CardLayout | null;
  /** 新しい世帯で出す入力項目と、開いたときの入れ方（空は全部出す・全部標準。新しい世帯に写す） */
  items: ItemChoice;
  /** 対策に最初から出す項目（既定の組み合わせとの違いだけ。空は既定のまま。世帯には写さない。0084） */
  levers: LeverChoice;
  /** 万一のタブの想定の前提に最初から出す項目（場面ごと。既定の組み合わせとの違いだけ。世帯には写さない。0085） */
  premises: PremiseChoice;
  /** 万一のタブの場面の帯に並べる場面と、開いたときに選んでおく場面（世帯には写さない。0085） */
  scenes: SceneChoice;
  /** 必要保障額の数え方（いつまでの資金を数えるか・出し方。新しい世帯の万一の前提に写す。0085） */
  protection: ProtectionSetting;
  /** 本人・配偶者の介護を最初から目安で入れるか */
  care: CareDefaults;
  /** 受け取る予定の相続・贈与の見込みの既定（「当てにしない」〔値は uncertain〕なら、受け取る予定を基本の計算に入れないのが事務所の決まりになる） */
  inheritLikelihood: InheritLikelihood;
  /** 前提条件の標準値（無い系列は FPライズの標準） */
  assumptions: Partial<Record<OfficeAssumption, string>>;
  /** 相続税の目安の不動産の評価の割合（時価に掛ける。null は標準の80%） */
  realEstateRatio: string | null;
  /** FP顧問料の料金表（契約を足すときに写す。足した契約は後で料金表を変えても変わらない） */
  fee: FeeTable;
  /** 最後に変えた日（YYYY-MM-DD）。根拠の文の年月に使う */
  changedOn: string | null;
}

export const DEFAULT_OFFICE_SETTINGS: OfficeSettings = { version: 1, layout: null, items: {}, levers: {}, premises: {}, scenes: {}, protection: {}, care: DEFAULT_CARE_DEFAULTS, inheritLikelihood: "likely", assumptions: {}, realEstateRatio: null, fee: STANDARD_FEE_TABLE, changedOn: null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 料金表の額の上限（1回の額。1,000万円） */
export const FEE_MAX = 10_000_000;
/** 料金の段階の年目の上限 */
export const FEE_STEP_YEAR_MAX = 50;

const yenOk = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= FEE_MAX;

/** 料金表を読む（読めない所は標準。段階は年目の順に並べ、同じ年目は後の物を使う） */
export function readFeeTable(v: unknown): FeeTable {
  if (!isObj(v)) return STANDARD_FEE_TABLE;
  const per = v.per === "year" ? "year" : v.per === "month" ? "month" : STANDARD_FEE_TABLE.per;
  const amount = yenOk(v.amount) ? v.amount : per === STANDARD_FEE_TABLE.per ? STANDARD_FEE_TABLE.amount : STANDARD_FEE_TABLE.amount * 12;
  const byYear = new Map<number, number>();
  if (Array.isArray(v.steps))
    for (const x of v.steps) if (isObj(x) && Number.isInteger(x.year) && (x.year as number) >= 2 && (x.year as number) <= FEE_STEP_YEAR_MAX && yenOk(x.amount)) byYear.set(x.year as number, x.amount);
  const steps = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, a]) => ({ year, amount: a }));
  return { oneTime: yenOk(v.oneTime) ? v.oneTime : STANDARD_FEE_TABLE.oneTime, per, amount, steps, onContingency: v.onContingency === "continue" ? "continue" : "stop" };
}

const sameFee = (a: FeeTable, b: FeeTable) => JSON.stringify(a) === JSON.stringify(b);

/** 率の文字（-0.2〜0.3 の小数） */
const RATE = /^-?\d(\.\d{1,6})?$/;
const rateOk = (v: unknown, lo: number, hi: number): v is string => typeof v === "string" && RATE.test(v) && Number(v) >= lo && Number(v) <= hi;

/** 読んだ値から設定（読めない所は既定） */
export function readOfficeSettings(v: unknown): OfficeSettings {
  if (!isObj(v)) return DEFAULT_OFFICE_SETTINGS;
  const known = new Set<string>(STAGE_ORDER.map((s) => s.id));
  let layout: CardLayout | null = null;
  // 前の版の「最初の5枚」（layout.first）は読まない（なくした。あっても誤りにしない）
  if (isObj(v.layout) && Array.isArray(v.layout.order)) {
    const order = [...new Set(v.layout.order.filter((x): x is StageId => typeof x === "string" && known.has(x)))];
    if (order.length > 0) layout = { order };
  }
  const items = readItemChoice(v.items);
  // 対策に最初から出す項目（欄の無い古い事務所データは既定のまま。知らない種類は捨てる）
  const levers = readLeverChoice(v.levers);
  // 万一のタブの既定（0085。欄の無い古い事務所データは既定のまま）
  const premises = readPremiseChoice(v.premises);
  const scenes = readSceneChoice(v.scenes);
  const protection = readProtectionSetting(v.protection);
  const care: CareDefaults = isObj(v.care) && (v.care.selfAndSpouse === "fill" || v.care.selfAndSpouse === "warn") ? { selfAndSpouse: v.care.selfAndSpouse } : DEFAULT_CARE_DEFAULTS;
  const inheritLikelihood: InheritLikelihood = v.inheritLikelihood === "uncertain" ? "uncertain" : "likely";
  const assumptions: Partial<Record<OfficeAssumption, string>> = {};
  if (isObj(v.assumptions)) for (const k of OFFICE_ASSUMPTIONS) if (rateOk(v.assumptions[k], -0.05, 0.2)) assumptions[k] = v.assumptions[k] as string;
  const realEstateRatio = rateOk(v.realEstateRatio, 0, 1) ? (v.realEstateRatio as string) : null;
  const changedOn = typeof v.changedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.changedOn) ? v.changedOn : null;
  const fee = readFeeTable(v.fee);
  return { version: 1, layout, items, levers, premises, scenes, protection, care, inheritLikelihood, assumptions, realEstateRatio, fee, changedOn };
}

/** 並びの設定（無ければ標準） */
export const layoutOf = (s: OfficeSettings): CardLayout => s.layout ?? DEFAULT_LAYOUT;

/** 推定の根拠の文（例: 「事務所の標準（2026-10）」） */
export function officeBasis(s: OfficeSettings): string {
  return `事務所の標準（${(s.changedOn ?? "").slice(0, 7) || "設定"}）`;
}

/** 標準（FPライズの標準）と同じか（設定を保存するときに、標準と同じ値は持たない） */
export function isDefaultSettings(s: OfficeSettings): boolean {
  return s.layout === null && isEmptyChoice(s.items) && isEmptyLeverChoice(s.levers) && isEmptyPremiseChoice(s.premises) && isEmptySceneChoice(s.scenes) && Object.keys(normalProtection(s.protection)).length === 0 && s.care.selfAndSpouse === "warn" && s.inheritLikelihood === "likely" && Object.keys(s.assumptions).length === 0 && s.realEstateRatio === null && sameFee(s.fee, STANDARD_FEE_TABLE);
}

/**
 * 新しい世帯で出す入力項目と開いたときの入れ方だけを置き換える（入力のホームの「入力項目を選ぶ」の「この選び方を事務所の既定にする」と、その取り消し。0091）。
 * 最後に変えた日（changedOn）は変えない: 根拠の文「事務所の標準（年月）」は前提条件などの写す値の年月で、見せ方の選び方とは関係しない
 */
export const withOfficeItems = (s: OfficeSettings, items: ItemChoice): OfficeSettings => ({ ...s, items: readItemChoice(items) });

// ---- 画面の側の操作が読む今の設定（office/current.ts。アプリが開いている間） ----

/** 今の事務所の既定値を、操作のときに読む所（office/current.ts）へ入れる */
export function publishOfficeSettings(s: OfficeSettings): void {
  setOfficeNow({ inheritLikelihood: s.inheritLikelihood, assumptions: { ...s.assumptions }, basis: officeBasis(s), fee: s.fee });
}

// ---- 新しい世帯に写す ----

/**
 * 新しい世帯に事務所の既定値を写す（空の世帯を作るときだけ。古い世帯・見本には当てない）。写した値は推定の印（根拠「事務所の標準（年月）」）。
 * 本人・配偶者の介護は「最初から入れる」なら目安で入れる
 */
export function applyOfficeDefaults(wh: WorkingHousehold, s: OfficeSettings): WorkingHousehold {
  let w = applyCareDefaults(wh, s.care);
  // 出す入力項目と開いたときの入れ方（写した後は世帯ごとに直す。事務所の値を変えても作った世帯は変わらない）
  if (!isEmptyChoice(s.items)) w = { ...w, itemChoice: readItemChoice(s.items) };
  // 必要保障額の数え方（標準と違うときだけ。写した後は世帯の値のまま。万一のタブに事務所の値と違うと出る）
  if (Object.keys(normalProtection(s.protection)).length > 0) w = { ...w, contingency: withProtection(w.contingency, s.protection) };
  const basis = officeBasis(s);
  const entries = OFFICE_ASSUMPTIONS.filter((k) => s.assumptions[k] !== undefined);
  if (entries.length === 0 && s.realEstateRatio === null) return w;
  const request = structuredClone(w.request);
  const assumed = { ...w.assumed };
  const a = (request.input.assumptions ??= structuredClone(DEFAULT_ASSUMPTIONS)) as unknown as Record<string, { default: string } | undefined>;
  for (const k of entries) {
    a[k] = { ...(a[k] ?? {}), default: s.assumptions[k] as string };
    assumed[`assume/${k}`] = basis;
  }
  if (s.realEstateRatio !== null) {
    request.input.inheritanceTax = { ...(request.input.inheritanceTax ?? {}), realEstateRatio: s.realEstateRatio };
    assumed["inherit/tax/realEstateRatio"] = basis;
  }
  w = { ...w, request, assumed };
  return w;
}
