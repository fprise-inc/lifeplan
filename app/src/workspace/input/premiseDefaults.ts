// 前提条件の事務所の既定値（0214）: 前提条件の欄のうち既定の値のある物の表（PREMISE_DEFS）と、世帯での見せ方の判定。
// - 事務所の既定値の画面・世帯の前提条件の欄・確かめの一覧・前提と推定の一覧・AI接続口の説明は、この表から作る（欄を足すときは表に1行足す）
// - 世帯の値が事務所の既定値（事務所で決めていなければ提供元の既定の値）と同じなら「事務所の既定値」（決まった値。推定にしない）、
//   この世帯だけ違う値なら「この世帯だけ」（事務所の既定値に戻すリンク）、事務所の既定値を使っていた値で、その後に事務所の既定値が
//   変わった物は「事務所の既定値が変わりました（前→今）」（確かめの一覧の知らせ。値は黙って変えない。0073 の3）
// - 「事務所の既定値を使っていた」は、写したときの仮の印（assumed[欄のキー] が「事務所の既定値（年月）」）か、提供元の既定の値のまま触っていない欄
// - 世帯ファイルは書き換えない（読むときに判定するだけ。計算の要求は変わらない）。例外は下の3つの欄の写し（fillLivePremises）
// - 土地の割合・建物の残りの価値の下限・売却の費用（live）は、事務所データの置き場所が事務所の推定の値（0111）で、世帯に値が無いと計算は
//   その場の事務所の値を使う。ほかの欄と同じく作った世帯を黙って変えないため、世帯には必ず値を書く: 新しい世帯は作るとき、値の無い世帯は
//   開いたときに、その時点の事務所の値を写す（計算に使う値は写す前と同じ。0217）。空欄にしても値を外さず、事務所の今の値を書く
import { officeNow } from "../office/current.ts";
import { presetIsOffice } from "../../../../hearing/src/presets.ts";
import { pctText } from "../plans/decimal.ts";
import type { Address } from "../store/readings.ts";
import { getPath, setPath, type PremiseMark } from "./form.ts";
import { DEFAULT_ASSUMPTIONS, mutate, type WorkingHousehold } from "./household.ts";
import { ASSET_CLASSES, BUILDING_STRUCTURES, USEFUL_LIFE, VALUATION_DEFAULTS } from "./labels.ts";
import { GROWTH_RANGE, RETURN_RANGE, SLIDE_RANGE } from "./rateRanges.ts";
import { putRow, rowAt } from "./rows.ts";
import { sameRate } from "./units.ts";

type Obj = Record<string, unknown>;
type Assumptions = NonNullable<WorkingHousehold["request"]["input"]["assumptions"]>;

/** 区画（事務所の既定値の画面と世帯の前提条件で同じ並び） */
export type PremiseSection = "economy" | "realEstate" | "assetReturns";

export const PREMISE_SECTION_LABELS: Readonly<Record<PremiseSection, string>> = {
  economy: "経済の前提",
  realEstate: "不動産の評価（持ち家・収益不動産など）",
  assetReturns: "資産の種類ごとの利回り",
};

export interface PremiseDef {
  /** 前提条件の id（事務所データ・AI接続口の名前。使い回さない。例: inflation・realEstateValuation.landShare・assetReturns.equity.global） */
  id: string;
  /** 世帯の前提条件の欄のキー */
  key: string;
  /** 欄の名前（世帯の欄の名前と同じ） */
  label: string;
  /** 事務所の既定値の画面の欄の名前（無ければ label） */
  officeLabel?: string;
  section: PremiseSection;
  /** pct は率（min・max はパーセント）、int は年の数 */
  kind: "pct" | "int";
  min: number;
  max: number;
  /** 世帯の前提条件（assumptions）の中の置き場所 */
  path: readonly string[];
  /** 置き場所が年ごとの列（default と例外の年）か */
  series: boolean;
  /** 提供元の既定の値（null は入れない＝ほかの値と同じ・計算の決まりの値） */
  standard: string | null;
  /** 世帯に値が無いとき計算が使う決まった値（無ければ null。ほかの値と同じになる物・決まらない物） */
  absent: () => string | null;
  /** 値が無いときにほかの値と同じになる物の言葉と、その値（「物価上昇率と同じ」） */
  follows?: { text: string; value: (a: Assumptions | undefined) => string | null };
  /**
   * 事務所の推定の値（0111）の値ID。ある物は、事務所の既定値の置き場所が事務所の推定の値で、世帯に値が無いと計算がその場の事務所の値を使う。
   * そのため世帯には必ず値を書く（新しい世帯・値の無い世帯を開いたとき。fillLivePremises。0217）
   */
  live?: string;
}

const seriesDefault = (a: Assumptions | undefined, name: string): string | null => (getPath(a, [name, "default"]) as string | undefined) ?? null;
const followsOf = (name: string, text: string) => ({ text, value: (a: Assumptions | undefined) => seriesDefault(a, name) });

/** 経済の前提（年ごとの列 assumptions.<名前>） */
const ECONOMY: PremiseDef[] = [
  { id: "inflation", key: "assume/inflation", label: "物価上昇率（年）", section: "economy", kind: "pct", ...GROWTH_RANGE, path: ["inflation"], series: true, standard: DEFAULT_ASSUMPTIONS.inflation.default, absent: () => null },
  { id: "wageGrowth", key: "assume/wageGrowth", label: "賃金上昇率（年）", section: "economy", kind: "pct", ...GROWTH_RANGE, path: ["wageGrowth"], series: true, standard: DEFAULT_ASSUMPTIONS.wageGrowth.default, absent: () => null },
  { id: "investmentReturn", key: "assume/investmentReturn", label: "運用利回り（年）", section: "economy", kind: "pct", ...RETURN_RANGE, path: ["investmentReturn"], series: true, standard: DEFAULT_ASSUMPTIONS.investmentReturn.default, absent: () => null },
  { id: "depositReturn", key: "assume/depositReturn", label: "預金の利回り（年）", section: "economy", kind: "pct", ...RETURN_RANGE, path: ["depositReturn"], series: true, standard: DEFAULT_ASSUMPTIONS.depositReturn.default, absent: () => null },
  { id: "educationInflation", key: "assume/educationInflation", label: "教育費の上昇率（年）", section: "economy", kind: "pct", ...GROWTH_RANGE, path: ["educationInflation"], series: true, standard: null, absent: () => null, follows: followsOf("inflation", "物価上昇率と同じ") },
  { id: "pensionMacroSlide", key: "assume/pensionMacroSlide", label: "年金の調整率（基礎年金・年）", section: "economy", kind: "pct", ...SLIDE_RANGE, path: ["pensionMacroSlide"], series: true, standard: DEFAULT_ASSUMPTIONS.pensionMacroSlide.default, absent: () => null },
  { id: "pensionMacroSlideEmployee", key: "assume/pensionMacroSlideEmployee", label: "年金の調整率（厚生年金・年）", section: "economy", kind: "pct", ...SLIDE_RANGE, path: ["pensionMacroSlideEmployee"], series: true, standard: null, absent: () => null, follows: followsOf("pensionMacroSlide", "基礎年金の調整率と同じ") },
];

const R = "realEstateValuation";
/** 不動産の評価（assumptions.realEstateValuation） */
const REAL_ESTATE: PremiseDef[] = [
  { id: `${R}.landGrowth`, key: "assume/realEstate/landGrowth", label: "土地の上昇率（年）", section: "realEstate", kind: "pct", ...GROWTH_RANGE, path: [R, "landGrowth"], series: true, standard: null, absent: () => null, follows: followsOf("inflation", "物価上昇率と同じ") },
  { id: `${R}.landShare`, key: "assume/realEstate/landShare", label: "土地の割合", section: "realEstate", kind: "pct", min: 0, max: 100, path: [R, "landShare"], series: false, standard: "0.3", absent: () => VALUATION_DEFAULTS.landShare, live: "preset.realEstate.landShare" },
  ...BUILDING_STRUCTURES.map(
    (o): PremiseDef => ({
      id: `${R}.usefulLife.${o.value}`,
      key: `assume/realEstate/life/${o.value}`,
      label: `耐用年数: ${o.label}`,
      section: "realEstate",
      kind: "int",
      min: 1,
      max: 100,
      path: [R, "usefulLife", o.value],
      series: false,
      standard: String(USEFUL_LIFE[o.value] ?? 22),
      absent: () => String(USEFUL_LIFE[o.value] ?? 22),
    }),
  ),
  { id: `${R}.residualFloor`, key: "assume/realEstate/floor", label: "建物の残りの価値の下限", section: "realEstate", kind: "pct", min: 0, max: 100, path: [R, "residualFloor"], series: false, standard: "0.2", absent: () => VALUATION_DEFAULTS.residualFloor, live: "preset.realEstate.residualFloor" },
  { id: `${R}.saleCostRate`, key: "assume/realEstate/saleCost", label: "売却の費用（売却価格に対する割合）", section: "realEstate", kind: "pct", min: 0, max: 100, path: [R, "saleCostRate"], series: false, standard: "0.04", absent: () => VALUATION_DEFAULTS.saleCostRate, live: "preset.realEstate.saleCostRate" },
];

/** 預金の種類（空欄なら預金の利回り） */
const isDepositClass = (cls: string) => cls.startsWith("cash.");

/** 資産の種類ごとの利回り（assumptions.assetReturns.<種類>）。空欄は計算と同じ: 預金・外貨預金は預金の利回り、不動産は0%、ほかは運用利回り */
const ASSET_RETURNS: PremiseDef[] = ASSET_CLASSES.map(
  (o): PremiseDef => ({
    id: `assetReturns.${o.value}`,
    key: `assume/assetReturns/${o.value}/default`,
    label: o.label,
    ...(o.value === "realEstate" ? { officeLabel: "不動産（貸していない不動産の値動き）" } : {}),
    section: "assetReturns",
    kind: "pct",
    ...RETURN_RANGE,
    path: ["assetReturns", o.value],
    series: true,
    standard: o.value === "realEstate" ? "0" : null,
    absent: () => (o.value === "realEstate" ? "0" : null),
    ...(o.value === "realEstate"
      ? {}
      : isDepositClass(o.value)
        ? { follows: { text: "預金の利回りと同じ", value: (a: Assumptions | undefined) => seriesDefault(a, "depositReturn") ?? seriesDefault(a, "investmentReturn") } }
        : { follows: followsOf("investmentReturn", "運用利回りと同じ") }),
  }),
);

/** 前提条件の既定の値のある欄の全部（区画の順） */
export const PREMISE_DEFS: readonly PremiseDef[] = [...ECONOMY, ...REAL_ESTATE, ...ASSET_RETURNS];

const BY_KEY = new Map(PREMISE_DEFS.map((d) => [d.key, d]));
const BY_ID = new Map(PREMISE_DEFS.map((d) => [d.id, d]));

/** 欄のキー → 前提条件の欄の定義（無ければ undefined） */
export const premiseOfKey = (key: string): PremiseDef | undefined => BY_KEY.get(key);
/** id → 前提条件の欄の定義 */
export const premiseOfId = (id: string): PremiseDef | undefined => BY_ID.get(id);

/** 持ち家・購入の予定・収益不動産・貸していない不動産のどれかを持つ世帯か（無ければ不動産の評価の区画を出さない） */
export const ownsRealEstate = (w: WorkingHousehold): boolean => (w.request.input.household.residences ?? []).some((r) => r.kind === "own") || (w.request.input.household.accounts ?? []).some((x) => x.kind === "realEstate");

/** 「事務所の既定値（年月）」の仮の印か（前の版の「事務所の標準（年月）」も） */
export const isOfficeMark = (basis: string | null | undefined): boolean => typeof basis === "string" && (basis.startsWith("事務所の既定値") || basis.startsWith("事務所の標準"));

const same = (d: PremiseDef, a: string, b: string): boolean => (d.kind === "int" ? Number(a) === Number(b) : sameRate(a, b));

const assumptionsOf = (wh: WorkingHousehold): Assumptions | undefined => wh.request.input.assumptions;

/** 世帯の値（無ければ null。年ごとの列は default） */
export function premiseValue(d: PremiseDef, wh: WorkingHousehold): string | null {
  const v = getPath(assumptionsOf(wh), d.path);
  if (d.series) return ((v as { default?: string } | undefined)?.default ?? null) as string | null;
  return v === undefined || v === null ? null : String(v);
}

/** 世帯で計算に使っている値（無ければ、無いときの決まった値か、ほかの値と同じになる物は null） */
const effective = (d: PremiseDef, wh: WorkingHousehold): string | null => premiseValue(d, wh) ?? d.absent();

/** 事務所の今の既定値（事務所で決めていなければ提供元の既定の値。null はほかの値と同じ・入れない） */
export function officeDefault(d: PremiseDef): string | null {
  // 事務所の推定の値の物: 事務所の値（決めていなければ提供元の既定の値）
  if (d.live !== undefined) return d.absent();
  return officeNow().premises[d.id] ?? d.standard;
}

/** 事務所で決めた値か（決めていなければ提供元の既定の値） */
export const officeDecided = (d: PremiseDef): boolean => (d.live !== undefined ? presetIsOffice(d.live) : officeNow().premises[d.id] !== undefined);

const officeEffective = (d: PremiseDef): string | null => officeDefault(d) ?? d.absent();

const equalValues = (d: PremiseDef, a: string | null, b: string | null): boolean => (a === null || b === null ? a === b : same(d, a, b));

/** 値の状態の行の当て先（年ごとの列は default） */
export const premiseAddress = (d: PremiseDef): Address => ({ target: { plan: "assumptions" }, item: `assumptions.${d.path[0] as string}`, at: [...d.path.slice(1), ...(d.series ? ["default"] : [])] });

const rowOf = (d: PremiseDef, wh: WorkingHousehold) => rowAt(wh.request.input as unknown as Obj, premiseAddress(d));

/** 値の言葉（null はほかの値と同じ: 「物価上昇率と同じ」。無ければ「入れない」） */
export function premiseText(d: PremiseDef, v: string | null): string {
  if (v === null) return d.follows?.text ?? "入れない";
  return d.kind === "int" ? `${v}年` : pctText(v);
}

/** 提供元の既定の値のまま、FP が触っていない欄か（年ごとの列で既定の値のある物は既定と同じ値で行が無い。ほかは値が無い） */
function untouched(d: PremiseDef, wh: WorkingHousehold): boolean {
  const cur = premiseValue(d, wh);
  if (d.series && d.standard !== null) return cur !== null && same(d, cur, d.standard) && rowOf(d, wh) === undefined;
  return cur === null;
}

export type PremiseState = PremiseMark["state"];

/**
 * 世帯での見せ方（0214 の4〜6）。仮の印が事務所の既定値でない物（資産配分の期待リターンの目安など、推定の目安から書いた値）は null
 * （今までどおり推定として見せる）
 */
export function premiseState(d: PremiseDef, wh: WorkingHousehold): { state: PremiseState; was: string | null; now: string | null } | null {
  const mark = wh.assumed[d.key];
  if (mark !== undefined && !isOfficeMark(mark)) return null;
  const eff = effective(d, wh);
  const off = officeEffective(d);
  if (equalValues(d, eff, off)) return { state: "office", was: null, now: off };
  const followed = mark !== undefined || untouched(d, wh);
  return { state: followed ? "officeChanged" : "household", was: eff, now: off };
}

/** 置き場所に書く（null は外す。年ごとの列の例外の年は残し、ほかの値と同じになる列は例外の年が無ければ列ごと外す） */
function writeValue(d: PremiseDef, wh: WorkingHousehold, v: string | null): WorkingHousehold {
  return mutate(wh, (_h, req) => {
    const a = (req.input.assumptions ??= structuredClone(DEFAULT_ASSUMPTIONS) as Assumptions) as unknown as Obj;
    if (d.series) {
      const cur = getPath(a, d.path) as { default?: string; byYear?: Record<string, string> } | undefined;
      if (v !== null) return setPath(a, d.path, { ...(cur ?? {}), default: v });
      if (cur?.byYear !== undefined) return setPath(a, d.path, { ...cur, default: d.follows?.value(a as unknown as Assumptions) ?? d.absent() ?? "0" });
      return removeAt(a, d.path);
    }
    if (v === null) return removeAt(a, d.path);
    setPath(a, d.path, d.kind === "int" ? Number(v) : v);
  });
}

/** 道の先を外し、空になった入れ物も外す */
function removeAt(o: Obj, path: readonly string[]): void {
  const chain: Obj[] = [o];
  for (const p of path.slice(0, -1)) {
    const next = chain[chain.length - 1]?.[p];
    if (typeof next !== "object" || next === null) return;
    chain.push(next as Obj);
  }
  delete (chain[chain.length - 1] as Obj)[path[path.length - 1] as string];
  for (let i = chain.length - 1; i > 0; i--) if (Object.keys(chain[i] as Obj).length === 0) delete (chain[i - 1] as Obj)[path[i - 1] as string];
}

const withoutMark = (wh: WorkingHousehold, key: string): WorkingHousehold => (wh.assumed[key] === undefined ? wh : { ...wh, assumed: Object.fromEntries(Object.entries(wh.assumed).filter(([k]) => k !== key)) });
const withMark = (wh: WorkingHousehold, key: string): WorkingHousehold => ({ ...wh, assumed: { ...wh.assumed, [key]: officeNow().basis } });
const withRow = (d: PremiseDef, wh: WorkingHousehold, row: Parameters<typeof putRow>[2]): WorkingHousehold =>
  rowOf(d, wh) === row ? wh : mutate(wh, (_h, req) => void putRow(req.input as unknown as Obj, premiseAddress(d), row));

/**
 * 世帯の値を打った値にする（欄の set）。事務所の既定値と同じ値なら「事務所の既定値に戻す」と同じ（後で事務所の既定値が変わると知らせが出る）、
 * 違えば印を外す（この世帯だけ）。違う値で、提供元の既定の値と同じ値は、触っていない欄と見分けるために打った確定の行を書く
 */
export function typePremise(d: PremiseDef, wh: WorkingHousehold, v: string): WorkingHousehold {
  let w = writeValue(d, withoutMark(wh, d.key), v);
  w = withRow(d, w, undefined);
  // 事務所の既定値と同じ値: 「事務所の既定値に戻す」と同じ形にする（値の無いときと同じになる物は値を外し、要るときだけ印を付ける）
  if (equalValues(d, effective(d, w), officeEffective(d))) return resetPremise(d, wh);
  if (d.series && d.standard !== null && same(d, v, d.standard)) return withRow(d, w, { state: "confirmed", origin: { kind: "manual" } });
  return w;
}

/** 事務所の今の既定値にする（「事務所の既定値に戻す」「今の既定値にする」・確かめの一覧の「この世帯に当てる」・欄を空にしたとき） */
export function resetPremise(d: PremiseDef, wh: WorkingHousehold): WorkingHousehold {
  const off = officeDefault(d);
  let w = withRow(d, withoutMark(wh, d.key), undefined);
  // ほかの値と同じになる物・無いときの値と同じ物は、値を外す（無いときの決まりで同じ値になる）。
  // 事務所の推定の値の物は外さない（無いと計算がその場の事務所の値を使い、後で事務所の値を変えると黙って変わる。0217）
  if (d.live === undefined && (off === null || equalValues(d, off, d.absent()))) return writeValue(d, w, null);
  w = writeValue(d, w, off);
  // 提供元の既定の値のまま触っていない形になったら印は要らない（後で事務所の既定値が変わると、どちらでも知らせが出る）
  return untouched(d, w) ? w : withMark(w, d.key);
}

/** 欄に添える見せ方（FieldState.premise）。推定として見せる物は null */
export function premiseMark(d: PremiseDef, wh: WorkingHousehold): PremiseMark | null {
  const s = premiseState(d, wh);
  if (s === null) return null;
  return { id: d.id, state: s.state, officeText: premiseText(d, s.now), ...(s.state !== "office" ? { wasText: premiseText(d, s.was) } : {}), decided: officeDecided(d), reset: resetterOf(d) };
}

/** 欄ごとに1つの「事務所の既定値にする」（同じ欄の見せ方を比較できるように、毎回作らない） */
const RESETTERS = new Map<string, (wh: WorkingHousehold) => WorkingHousehold>();
function resetterOf(d: PremiseDef): (wh: WorkingHousehold) => WorkingHousehold {
  let r = RESETTERS.get(d.id);
  if (r === undefined) {
    r = (w) => resetPremise(d, w);
    RESETTERS.set(d.id, r);
  }
  return r;
}

/** 世帯に出している前提条件の欄か（不動産の評価は不動産を持つ世帯だけ） */
export const shownPremise = (d: PremiseDef, wh: WorkingHousehold): boolean => d.section !== "realEstate" || ownsRealEstate(wh);

/** たたんだ1行の数（この世帯だけ・事務所の既定値が変わった所） */
export function premiseCounts(wh: WorkingHousehold): { own: number; changed: number } {
  let own = 0;
  let changed = 0;
  for (const d of PREMISE_DEFS) {
    if (!shownPremise(d, wh)) continue;
    const s = premiseState(d, wh);
    if (s?.state === "household") own++;
    else if (s?.state === "officeChanged") changed++;
  }
  return { own, changed };
}

/** たたんだ1行の文（「前提条件: 事務所の既定値どおり（この世帯だけ変えた所 0件）」） */
export function premiseSummary(wh: WorkingHousehold): string {
  const { own, changed } = premiseCounts(wh);
  const moved = changed > 0 ? `事務所の既定値が変わった所 ${changed}件` : null;
  if (own === 0) return `前提条件: 事務所の既定値どおり（この世帯だけ変えた所 0件${moved !== null ? `・${moved}` : ""}）`;
  return `前提条件: 事務所の既定値と、この世帯だけ変えた所 ${own}件${moved !== null ? `（${moved}）` : ""}`;
}

/** 新しい世帯に、事務所で決めた前提条件を写す（写した欄に「事務所の既定値（年月）」の印。0073 の3・0214 の6） */
export function copyOfficePremises(wh: WorkingHousehold, values: Readonly<Record<string, string>>, basis: string): WorkingHousehold {
  let w = wh;
  for (const d of PREMISE_DEFS) {
    const v = values[d.id];
    if (v === undefined) continue;
    w = writeValue(d, w, v);
    w = { ...w, assumed: { ...w.assumed, [d.key]: basis } };
  }
  return w;
}

/** 欄に見せる値（世帯の値か、無いときの決まった値。ほかの値と同じになる物は null で、言葉は followsHint） */
export function premiseShown(d: PremiseDef, wh: WorkingHousehold): string | null {
  return premiseValue(d, wh) ?? d.absent();
}

/** ほかの値と同じになる物の、値が無いときの欄の横の言葉（「物価上昇率と同じ（1.0%）」。値があれば null） */
export function followsHint(d: PremiseDef, wh: WorkingHousehold): string | null {
  if (d.follows === undefined || premiseValue(d, wh) !== null) return null;
  const v = d.follows.value(assumptionsOf(wh));
  return v === null ? d.follows.text : `${d.follows.text}（${pctText(v)}）`;
}


/**
 * 土地の割合・建物の残りの価値の下限・売却の費用（事務所の推定の値の物）で世帯に値の無い欄に、今の事務所の値を写し、「事務所の既定値（年月）」の印を
 * 付ける（0217）。新しい世帯を作るとき（事務所の既定値の写し）と、世帯を開いたとき（値の無い前の世帯）に当てる。値の無い欄は計算がその場の
 * 事務所の値を使っているので、写しても計算の結果は変わらない。写した後に事務所の値を変えても世帯は変わらず、確かめの一覧に
 * 「事務所の既定値が変わりました」と出る（ほかの前提条件と同じ）。値のある欄・変えなかった世帯は同じものを返す。
 * value は事務所の値（新しい世帯に写すときの事務所データの値。省けば今の事務所の値）
 */
export function fillLivePremises(wh: WorkingHousehold, basis: string = officeNow().basis, value: (d: PremiseDef) => string | null = (d) => d.absent()): WorkingHousehold {
  let w = wh;
  for (const d of PREMISE_DEFS) {
    if (d.live === undefined || premiseValue(d, w) !== null) continue;
    const v = value(d) ?? d.absent();
    if (v === null) continue;
    w = writeValue(d, w, v);
    w = { ...w, assumed: { ...w.assumed, [d.key]: basis } };
  }
  return w;
}
