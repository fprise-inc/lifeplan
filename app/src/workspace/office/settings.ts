// 事務所の既定値（0073）: 事務所全体で使う既定を、事務所データ（暗号化。0011 の6）に持つ。世帯ファイルには入れない。
// - 新しい世帯を作るときに写す（前提条件の標準値〔預金の利回り・貸していない不動産の値動きを含む〕・本人と配偶者の介護を最初から入れるか・不動産の評価の割合）。写した値は推定の印で、
//   根拠「事務所の標準（年月）」。後で事務所の値を変えても、作った世帯は黙って変わらない（確かめの一覧に「事務所の新しい値があります」）
// - 新しい世帯に写す、入力項目の選び方（出す入力項目と開いたときの入れ方。input/itemChoice.ts）。作った世帯の選び方は世帯ごとに直す
// - 画面の側で読むだけの既定（入力項目の並び・対策に最初から出す項目・万一のタブの想定の前提に最初から出す項目と場面の帯の並べ方・
//   受け取る予定の相続・贈与の見込みの既定・FP顧問料の料金表）は、その操作のときに読む。
//   対策に最初から出す項目（plans/leverChoice.ts。0084）と万一のタブの見せ方（contingency/premiseChoice.ts。0085）は見せ方だけなので世帯に写さず、
//   変えるとどの世帯にもすぐ効く
// - 新しい世帯に写す、必要保障額の数え方（いつまでの資金を数えるか・出し方。0085。世帯の万一の前提に写す。作った世帯は世帯の値のまま）
// - 法人経営者向けの機能（features。0107）: 会社と合わせたバランスシート（合算BS）を使うか。既定は使わない（ふつうの FP・世帯には出さない）。
//   見せ方だけで計算の結果は変えないので世帯には写さず、変えるとどの世帯にもすぐ効く
// - 事務所の推定の値（estimates。0111）: 空欄・「わからない」を補う推定の元のマスタデータの値と、推定で埋めない入力欄。推定の元なので世帯には写さず、
//   推定の目安と計算の要求にその場で入れる（office/estimates.ts）
// - 読むときは形を確かめ、読めない値は既定（既定の値）にする
import type { StageId } from "../input/form.ts";
import { DEFAULT_LAYOUT, type CardLayout } from "../input/items.ts";
import { applyCareDefaults, DEFAULT_CARE_DEFAULTS, type CareDefaults } from "../input/fill.ts";
import { DEFAULT_ASSUMPTIONS, END_AGES, endYearForAge, STANDARD_END_AGE, type WorkingHousehold } from "../input/household.ts";
import { STAGE_ORDER } from "../input/stages/index.ts";
import { isEmptyChoice, readItemChoice, type ItemChoice } from "../input/itemChoice.ts";
import { isEmptyLeverChoice, readLeverChoice, type LeverChoice } from "../plans/leverChoice.ts";
import { isEmptyPremiseChoice, isEmptySceneChoice, normalProtection, readPremiseChoice, readProtectionSetting, readSceneChoice, withProtection, type PremiseChoice, type ProtectionSetting, type SceneChoice } from "../contingency/premiseChoice.ts";
import { NESTED_OFFICE_ASSUMPTIONS, setOfficeNow, STANDARD_FEE_TABLE, type FeeTable } from "./current.ts";
import { GROWTH_RANGE, RETURN_RANGE, SLIDE_RANGE, type PctRange } from "../input/rateRanges.ts";
import { readLivingLayout, setLivingLayoutNow, type LivingLayout } from "./livingLayout.ts";
import type { OfficeHost } from "../../engine/host.ts";
import type { FeatureStatus } from "./featureCodes.ts";
import { isEmptyEstimates, publishOfficeEstimates, readOfficeEstimates, type OfficeEstimates } from "./estimates.ts";
import { cleanTopics, readHearingTemplates, readHearingTopics, type HearingTemplate } from "../hearing/web.ts";

export { STANDARD_FEE_TABLE, type FeeTable } from "./current.ts";

/**
 * 前提条件の標準値にできる系列（新しい世帯に写す。値は小数の文字。例: "0.01"）。系列の名前はふつう前提条件の年ごとの列の名前（assumptions.<名前>）で、
 * 前提条件の欄のキー assume/<名前> と仮の印のキーが同じ。前提条件の年ごとの列でない物（貸していない不動産の値動き）は、置き場所と欄のキーを
 * office/current.ts の NESTED_OFFICE_ASSUMPTIONS に持つ。足すときは、ここに名前を1つ足し、範囲・名前・既定の値の表に1行ずつ添える（0073 の追記 2026-11-07）
 */
export const OFFICE_ASSUMPTIONS = ["inflation", "wageGrowth", "investmentReturn", "depositReturn", "pensionMacroSlide", "heldEstateGrowth"] as const;
export type OfficeAssumption = (typeof OFFICE_ASSUMPTIONS)[number];

/** 前提条件の標準値の欄の範囲（パーセント。入力の画面の前提条件の欄と同じ。0098）。事務所データを読むときも、この範囲の外の値は読まない */
export const ASSUMPTION_RANGES: Readonly<Record<OfficeAssumption, PctRange>> = {
  inflation: GROWTH_RANGE,
  wageGrowth: GROWTH_RANGE,
  investmentReturn: RETURN_RANGE,
  depositReturn: RETURN_RANGE,
  pensionMacroSlide: SLIDE_RANGE,
  // 入力の画面の「資産の種類ごとの利回り」の不動産と同じ範囲
  heldEstateGrowth: RETURN_RANGE,
};

export const ASSUMPTION_LABELS: Readonly<Record<OfficeAssumption, string>> = {
  inflation: "物価上昇率（年）",
  wageGrowth: "賃金上昇率（年）",
  investmentReturn: "運用利回り（年）",
  depositReturn: "預金の利回り（年）",
  pensionMacroSlide: "年金の調整率（マクロ経済スライド）",
  heldEstateGrowth: "貸していない不動産（空き家・土地・別荘）の値動き（年）",
};

/**
 * 前提条件の標準値の既定の値（入れなければこの値。前提条件の年ごとの列は新しい世帯の DEFAULT_ASSUMPTIONS から。貸していない不動産の値動きは、
 * 計算が資産の種類ごとの利回りの不動産の無いときに使う0%）
 */
export const ASSUMPTION_STANDARDS: Readonly<Record<OfficeAssumption, string>> = {
  inflation: DEFAULT_ASSUMPTIONS.inflation.default,
  wageGrowth: DEFAULT_ASSUMPTIONS.wageGrowth.default,
  investmentReturn: DEFAULT_ASSUMPTIONS.investmentReturn.default,
  depositReturn: DEFAULT_ASSUMPTIONS.depositReturn.default,
  pensionMacroSlide: DEFAULT_ASSUMPTIONS.pensionMacroSlide.default,
  heldEstateGrowth: "0",
};

/** 前提条件の標準値の系列の、前提条件の中の置き場所（道）と、欄のキー・仮の印のキー */
export const assumptionPlace = (k: OfficeAssumption): { path: readonly string[]; key: string } => NESTED_OFFICE_ASSUMPTIONS[k] ?? { path: [k], key: `assume/${k}` };

/** 法人経営者向けの機能（既定はどれも使わない。0107） */
export interface OfficeFeatures {
  /** 会社と合わせたバランスシート（合算BS）: 役員として働く人のいる世帯で、資産と負債のタブの見るものと提案書の章に出す */
  combinedBs: boolean;
}

export const DEFAULT_FEATURES: OfficeFeatures = { combinedBs: false };

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
  /** 前提条件の標準値（無い系列は 既定の値） */
  assumptions: Partial<Record<OfficeAssumption, string>>;
  /** 相続税の目安の不動産の評価の割合（時価に掛ける。null は標準の80%） */
  realEstateRatio: string | null;
  /**
   * 表の最後の年の既定の年齢（若い方の大人がこの年齢になる年まで。90・95・105。無ければ提供元の既定の100歳）。新しい世帯の表の最後の年に写し、
   * 前提条件の欄の「既定」もこの年齢にする（作った世帯の表の最後の年は変えない。0073 の追記 2026-11-05）
   */
  endAge?: number;
  /** FP顧問料の料金表（契約を足すときに写す。足した契約は後で料金表を変えても変わらない） */
  fee: FeeTable;
  /** 法人経営者向けの機能（既定は使わない。世帯には写さない。0107） */
  features: OfficeFeatures;
  /** 最後に変えた日（YYYY-MM-DD）。根拠の文の年月に使う */
  changedOn: string | null;
  /** 基本生活費の内訳の並べ方（0109。無ければ標準。世帯には写さない。下の「基本生活費の内訳の並べ方」の区切り） */
  living?: LivingLayout;
  /** 事務所の推定の値と推定で埋めない入力欄（0111。無ければ公式の統計の値・全部推定で埋める。世帯には写さない。office/estimates.ts） */
  estimates?: OfficeEstimates;
  /** Web のヒアリングの事務所のひな形（聞く項目・並び・独自の質問・頼む書類の組み合わせ。0125。世帯には写さない） */
  hearingTemplates?: HearingTemplate[];
  /** Web のヒアリングの「ご相談したいこと」の話題の事務所の既定値（無ければ標準の9つ。依頼ごとにも直せる。0192。世帯には写さない） */
  hearingTopics?: string[];
}

export const DEFAULT_OFFICE_SETTINGS: OfficeSettings = { version: 1, layout: null, items: {}, levers: {}, premises: {}, scenes: {}, protection: {}, care: DEFAULT_CARE_DEFAULTS, inheritLikelihood: "likely", assumptions: {}, realEstateRatio: null, fee: STANDARD_FEE_TABLE, features: DEFAULT_FEATURES, changedOn: null };

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
/** 前提条件の標準値の率か（系列ごとの欄の範囲の中。画面で保存できる値と同じ範囲） */
const assumptionOk = (k: OfficeAssumption, v: unknown): v is string => rateOk(v, ASSUMPTION_RANGES[k].min / 100, ASSUMPTION_RANGES[k].max / 100);

/** 読んだ値から設定（読めない所は既定。基本生活費の内訳の並べ方は下の readOfficeSettings で足す） */
function readCoreSettings(v: unknown): OfficeSettings {
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
  if (isObj(v.assumptions)) for (const k of OFFICE_ASSUMPTIONS) if (assumptionOk(k, v.assumptions[k])) assumptions[k] = v.assumptions[k] as string;
  const realEstateRatio = rateOk(v.realEstateRatio, 0, 1) ? (v.realEstateRatio as string) : null;
  // 表の最後の年の既定の年齢（選び方の年齢だけ。100歳は既定と同じなので持たない）
  const endAge = typeof v.endAge === "number" && END_AGES.includes(v.endAge) && v.endAge !== STANDARD_END_AGE ? v.endAge : undefined;
  const changedOn = typeof v.changedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.changedOn) ? v.changedOn : null;
  const fee = readFeeTable(v.fee);
  // 法人経営者向けの機能（欄の無い古い事務所データ・読めない値は使わない）
  const features: OfficeFeatures = { combinedBs: isObj(v.features) && v.features.combinedBs === true };
  return { version: 1, layout, items, levers, premises, scenes, protection, care, inheritLikelihood, assumptions, realEstateRatio, fee, features, changedOn, ...(endAge !== undefined ? { endAge } : {}) };
}

/** 並びの設定（無ければ標準） */
export const layoutOf = (s: OfficeSettings): CardLayout => s.layout ?? DEFAULT_LAYOUT;

/** 推定の根拠の文（例: 「事務所の標準（2026-10）」） */
export function officeBasis(s: OfficeSettings): string {
  return `事務所の既定値（${(s.changedOn ?? "").slice(0, 7) || "設定"}）`;
}

/** 起動したときに読む、事務所の既定値と機能を有効にするコード（0110）の状態。読めなかったものは null */
export interface OfficeStart {
  settings: OfficeSettings | null;
  features: FeatureStatus | null;
}

/**
 * 事務所の既定値と、機能を有効にするコードの状態を読む。**両方を読み終わってから**返す（片方が読めなくても待つ。読めないものは null）。
 * 事務所の既定値のパネルは、これを待ってから出す（読み終わる前に出すと、パネルが最初の値〔既定〕で欄と印を作ってしまい、
 * 保存してある合算BS の「使う」の印などが外れて見える。URL の #officedefaults で起動直後に開いたとき）
 */
export async function loadOfficeStart(office: Pick<OfficeHost, "defaults" | "featureStatus">): Promise<OfficeStart> {
  const [d, f] = await Promise.allSettled([office.defaults(), office.featureStatus()]);
  return { settings: d.status === "fulfilled" ? readOfficeSettings(d.value) : null, features: f.status === "fulfilled" ? f.value : null };
}

/** 標準（既定の値）と同じか（基本生活費の内訳の並べ方の分は下の isDefaultSettings で見る） */
function isDefaultCore(s: OfficeSettings): boolean {
  return s.layout === null && isEmptyChoice(s.items) && isEmptyLeverChoice(s.levers) && isEmptyPremiseChoice(s.premises) && isEmptySceneChoice(s.scenes) && Object.keys(normalProtection(s.protection)).length === 0 && s.care.selfAndSpouse === "warn" && s.inheritLikelihood === "likely" && Object.keys(s.assumptions).length === 0 && s.realEstateRatio === null && s.endAge === undefined && sameFee(s.fee, STANDARD_FEE_TABLE) && !s.features.combinedBs;
}

/**
 * 新しい世帯で出す入力項目と開いたときの入れ方だけを置き換える（入力のホームの「入力項目を選ぶ」の「この選び方を事務所の既定にする」と、その取り消し。0091）。
 * 最後に変えた日（changedOn）は変えない: 根拠の文「事務所の標準（年月）」は前提条件などの写す値の年月で、見せ方の選び方とは関係しない
 */
export const withOfficeItems = (s: OfficeSettings, items: ItemChoice): OfficeSettings => ({ ...s, items: readItemChoice(items) });

// ---- 画面の側の操作が読む今の設定（office/current.ts。アプリが開いている間） ----

/** 今の事務所の既定値を、操作のときに読む所（office/current.ts）へ入れる（基本生活費の内訳の並べ方は下の publishOfficeSettings で入れる） */
function publishCore(s: OfficeSettings): void {
  setOfficeNow({ inheritLikelihood: s.inheritLikelihood, assumptions: { ...s.assumptions }, basis: officeBasis(s), fee: s.fee, endAge: s.endAge ?? null });
}

// ---- 新しい世帯に写す ----

/**
 * 新しい世帯に事務所の既定値を写す（空の世帯を作るときだけ。古い世帯・見本には当てない）。写した値は推定の印（根拠「事務所の標準（年月）」）。
 * 本人・配偶者の介護は「最初から入れる」なら目安で入れる
 */
export function applyOfficeDefaults(wh: WorkingHousehold, s: OfficeSettings): WorkingHousehold {
  let w = applyCareDefaults(wh, s.care);
  // 基本生活費を推定で埋めない欄にした事務所（0111）: 空の世帯の推定の基本生活費を入れない（確かめの一覧の未入力に出る。「推定で埋める」で入れられる）
  if ((s.estimates?.noFill ?? []).includes("livingExpense.monthly")) w = withoutAutoLiving(w);
  // 出す入力項目と開いたときの入れ方（写した後は世帯ごとに直す。事務所の値を変えても作った世帯は変わらない）
  if (!isEmptyChoice(s.items)) w = { ...w, itemChoice: readItemChoice(s.items) };
  // 必要保障額の数え方（標準と違うときだけ。写した後は世帯の値のまま。万一のタブに事務所の値と違うと出る）
  if (Object.keys(normalProtection(s.protection)).length > 0) w = { ...w, contingency: withProtection(w.contingency, s.protection) };
  // 表の最後の年の既定の年齢（若い方の大人がその年齢になる年。家族を直すと、その年齢のまま付いていく。input/household.ts の followStandards）
  if (s.endAge !== undefined) {
    const end = endYearForAge(w.request.input.household, s.endAge, w.request.input.baseMonth);
    if (Number.isFinite(end) && end !== w.request.input.endYear) {
      const request = structuredClone(w.request);
      request.input.endYear = end;
      w = { ...w, request };
    }
  }
  const basis = officeBasis(s);
  const entries = OFFICE_ASSUMPTIONS.filter((k) => s.assumptions[k] !== undefined);
  if (entries.length === 0 && s.realEstateRatio === null) return w;
  const request = structuredClone(w.request);
  const assumed = { ...w.assumed };
  const a = (request.input.assumptions ??= structuredClone(DEFAULT_ASSUMPTIONS)) as unknown as Record<string, unknown>;
  for (const k of entries) {
    // 置き場所（前提条件の年ごとの列か、資産の種類ごとの利回りの不動産）に既定の値を書く。例外の年は残す
    const { path, key } = assumptionPlace(k);
    let holder = a;
    for (const p of path.slice(0, -1)) holder = (holder[p] ??= {}) as Record<string, unknown>;
    const last = path[path.length - 1] as string;
    holder[last] = { ...((holder[last] as object | undefined) ?? {}), default: s.assumptions[k] as string };
    assumed[key] = basis;
  }
  if (s.realEstateRatio !== null) {
    request.input.inheritanceTax = { ...(request.input.inheritanceTax ?? {}), realEstateRatio: s.realEstateRatio };
    assumed["inherit/tax/realEstateRatio"] = basis;
  }
  w = { ...w, request, assumed };
  return w;
}

/** 推定のまま（出どころ auto）の基本生活費を外した世帯（空の世帯の推定の基本生活費。FP が入れた基本生活費は残す） */
function withoutAutoLiving(wh: WorkingHousehold): WorkingHousehold {
  const ls = wh.request.input.household.livingExpenses ?? [];
  const keep = ls.filter((l) => !(l.monthly?.state === "estimated" && l.monthly.origin.kind === "auto"));
  if (keep.length === ls.length) return wh;
  const request = structuredClone(wh.request);
  request.input.household.livingExpenses = keep;
  return { ...wh, request };
}

// ---- 基本生活費の内訳の並べ方（0109。office/livingLayout.ts）----
// 事務所データの defaults.living（足すだけの欄）。見せ方だけなので世帯には写さず、変えるとどの世帯の内訳の行にもすぐ効く。
// 欄の無い古い事務所データ・読めない値・標準と同じ並べ方は「標準」（欄を持たない）

/** 読んだ値から設定（読めない所は既定） */
export function readOfficeSettings(v: unknown): OfficeSettings {
  const s = readCoreSettings(v);
  const living = readLivingLayout(isObj(v) ? v.living : undefined);
  // 事務所の推定の値（0111。欄の無い古い事務所データ・空なら持たない）
  const estimates = readOfficeEstimates(isObj(v) ? v.estimates : undefined);
  // Web のヒアリングの事務所のひな形（0125。欄の無い古い事務所データ・空なら持たない）
  const hearingTemplates = readHearingTemplates(isObj(v) ? v.hearingTemplates : undefined);
  // ご相談したいことの話題（0192。欄の無い古い事務所データ・読めない値は標準の話題）
  const hearingTopics = readHearingTopics(isObj(v) ? v.hearingTopics : undefined);
  return { ...s, ...(living !== null ? { living } : {}), ...(!isEmptyEstimates(estimates) ? { estimates } : {}), ...(hearingTemplates.length > 0 ? { hearingTemplates } : {}), ...(hearingTopics !== null ? { hearingTopics } : {}) };
}

/** Web のヒアリングの「ご相談したいこと」の話題の事務所の既定値を置き換えた設定（null なら欄を外して標準に戻す。空の一覧は「話題を出さない」。0192） */
export function withHearingTopics(s: OfficeSettings, list: readonly string[] | null): OfficeSettings {
  const { hearingTopics: _old, ...rest } = s;
  void _old;
  return list === null ? rest : { ...rest, hearingTopics: cleanTopics(list) };
}

/** Web のヒアリングの事務所のひな形を置き換えた設定（空なら欄を外す。0125） */
export function withHearingTemplates(s: OfficeSettings, list: readonly HearingTemplate[]): OfficeSettings {
  const { hearingTemplates: _old, ...rest } = s;
  void _old;
  return list.length === 0 ? rest : { ...rest, hearingTemplates: [...list] };
}

/** 標準（既定の値）と同じか（設定を保存するときに、標準と同じ値は持たない） */
export const isDefaultSettings = (s: OfficeSettings): boolean => isDefaultCore(s) && readLivingLayout(s.living) === null && isEmptyEstimates(s.estimates) && (s.hearingTemplates ?? []).length === 0 && s.hearingTopics === undefined;

/** 今の事務所の既定値を、操作のときに読む所へ入れる（内訳の並べ方は office/livingLayout.ts へ、推定の値は推定の目安と計算の要求へ） */
export function publishOfficeSettings(s: OfficeSettings): void {
  publishCore(s);
  setLivingLayoutNow(readLivingLayout(s.living));
  publishOfficeEstimates(s.estimates);
}

/** 事務所の推定の値を置き換えた設定（空なら欄を外す。0111） */
export function withEstimates(s: OfficeSettings, e: OfficeEstimates): OfficeSettings {
  const { estimates: _old, ...rest } = s;
  void _old;
  return isEmptyEstimates(e) ? rest : { ...rest, estimates: e };
}

/** 内訳の並べ方を置き換えた設定（標準なら欄を外す） */
export function withLivingLayout(s: OfficeSettings, l: LivingLayout | null | undefined): OfficeSettings {
  const { living: _old, ...rest } = s;
  void _old;
  const next = readLivingLayout(l);
  return next === null ? rest : { ...rest, living: next };
}

/** 編集中の内訳の並べ方を置いた設定（整えない。保存・読み込みのときに readLivingLayout で整える） */
export function withLivingDraft(s: OfficeSettings, l: LivingLayout | undefined): OfficeSettings {
  const { living: _old, ...rest } = s;
  void _old;
  return l === undefined ? rest : { ...rest, living: l };
}
