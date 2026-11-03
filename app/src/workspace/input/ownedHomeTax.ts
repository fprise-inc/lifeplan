// 今住んでいる持ち家の固定資産税・都市計画税の推定（0112 の追記 2026-11-03）: 購入の予定でない持ち家で、固定資産税の欄が未入力・目安のボタンの値・
// この推定のままのとき、持ち家の評価の欄（評価額とその額の時点・土地の割合・建物の構造・建った年・建て方）から、計算の基準の年の額と
// 「固定資産税の変化」の段を推定で入れる。式・目安の値・法令の値・段の置き方は購入の予定の推定（propertyTax.ts）と同じ。違いは次のとおり
// - 最初の年は計算の基準の年（欄の額はその年の額。計算エンジンは計算の基準の年から欄の額を払う）
// - 評価額は「その額の時点」の値（多くは購入の価格と購入の年月）。建物はその時点の評価額から、評価替えごとに築年数の分だけ下げる。土地はその時点の価格のまま
// - 建った年が空欄なら、その額の時点の年に建ったとみなす（持ち家の評価と同じ）。そのときは新築の軽減を当てない（分からない軽減で税を少なく見せない）
// - 入れる時: 持ち家の評価の欄を直したとき（FP が推定の元を入れたとき）と、固定資産税の欄を空にしたとき（「推定に戻す」「わからない」の代わりの値）。
//   その後は推定のままの欄と推定の段だけを、入力を直すたびに入れ直す（refreshEstimates）。目安のボタンの値は、評価の欄を直すまで変えない（ひな形）
import type { AmountStage, Box, Household, Residence } from "../../engine/types.ts";
import type { FieldDef } from "./form.ts";
import { mutate, presetBasis, standardBox, type WorkingHousehold } from "./household.ts";
import { VALUATION_DEFAULTS } from "./labels.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { putRow, rowAt, type StateRow } from "./rows.ts";
import { presetNum, presetText } from "../../../../hearing/src/presets.ts";
import {
  isAutoTax,
  isAutoTaxStage,
  isEstimatedTax,
  manOf,
  pctOf,
  PROPERTY_TAX_BASIS,
  PROPERTY_TAX_LAW,
  ratioPct,
  ratioText,
  reassessYear,
  reliefYears,
  round100,
  taxGuide as guide,
  taxStageId,
  type PropertyTaxPlan,
  type PropertyTaxStage,
} from "./propertyTax.ts";

type Obj = Record<string, unknown>;
const METHOD = "derived";
const STRUCTURE_NAMES: Record<string, string> = { wood: "木造", lightSteel: "軽量鉄骨造", steel: "重量鉄骨造", rc: "鉄筋コンクリート造" };

export interface OwnedHomeTaxInputs {
  /** 評価額（土地と建物の合計） */
  value: number;
  /** その額の時点の年 */
  valueYear: number;
  landShare: string;
  structure: string;
  condo: boolean;
  /** 建った年（空欄なら undefined） */
  builtYear?: number;
  longLife: boolean;
  /** 計算の基準の年（最初の年） */
  baseYear: number;
  /** 段を作る最後の年（住み終わりの年と計算の最後の年の早いほう） */
  lastYear: number;
}

/**
 * 推定の計算（純粋な関数）。L＝評価額×土地の割合×土地の評価額の割合、B＝評価額×(1−土地の割合)×建物の評価額の割合（その額の時点の評価額）。
 * B(年)＝B×g(その年に効いている評価替えの年−建った年)÷g(その額の時点に効いている評価替えの年−建った年)。税の式・g は購入の予定と同じ（0112 の2）
 */
export function ownedHomeTaxPlan(o: OwnedHomeTaxInputs): PropertyTaxPlan {
  const law = PROPERTY_TAX_LAW;
  const cp = guide.cityPlanningRate;
  const floor = guide.buildingFloor;
  const span = guide.years(o.structure);
  const share = Number(o.landShare);
  const land0 = o.value * share * guide.landRatio;
  const building0 = o.value * (1 - share) * guide.buildingRatio;
  const landTax = land0 * law.landFixedShare * law.standardRate + land0 * law.landCityShare * cp;
  const known = o.builtYear !== undefined;
  const built = o.builtYear ?? o.valueYear;
  const years = reliefYears(o.condo, o.longLife);
  const g = (a: number): number => Math.max(floor, 1 - ((1 - floor) * Math.max(0, a)) / span);
  const gRef = g(reassessYear(o.valueYear) - built);
  const buildingIn = (y: number): number => (gRef <= 0 ? building0 : (building0 * g(reassessYear(y) - built)) / gRef);
  // 新築の軽減は建った年が分かるときだけ（建った年の翌年から）
  const inRelief = (y: number): boolean => known && y >= built + 1 && y <= built + years;
  const taxIn = (y: number): number => {
    const b = buildingIn(y);
    return round100(landTax + b * law.standardRate * (inRelief(y) ? law.newRelief : 1) + b * cp);
  };
  const firstYear = o.baseYear;
  const first = taxIn(firstYear);
  const age = firstYear - built;
  const kind = `${o.condo ? "マンション" : "戸建て"}（${STRUCTURE_NAMES[o.structure] ?? "木造"}${o.longLife ? "・長期優良住宅" : ""}）`;
  const parts = [
    `${String(firstYear)}年の額`,
    `評価額${manOf(o.value)}（${String(o.valueYear)}年）・土地の割合${pctOf(share)}・${kind}・${known ? `${String(built)}年に建った（築${String(Math.max(0, age))}年）` : "建った年は空欄"}`,
    `評価額は土地が価格の${pctOf(guide.landRatio)}・建物が価格の${pctOf(guide.buildingRatio)}の目安で、建物は評価替えごとに古くなった分だけ下げた（下限は${pctOf(floor)}）。土地は${String(o.valueYear)}年の価格のまま`,
    `住宅用地の特例${inRelief(firstYear) ? `・新築の軽減（建物の分が半分。${String(built + years)}年まで）` : ""}を当て、都市計画税${pctOf(cp)}を含む`,
    ...(!known ? [`建った年が分からないので、${String(built)}年に建ったとみなし、新築の軽減は当てない`] : []),
  ];
  const basis = `${PROPERTY_TAX_BASIS}（${parts.join("。")}）`;
  const stages: PropertyTaxStage[] = [];
  let prev = "1";
  for (let y = firstYear + 1; y <= o.lastYear; y++) {
    const ratio = first > 0 ? ratioText(taxIn(y) / first) : "1";
    if (ratio === prev) continue;
    const why: string[] = [];
    if (inRelief(y - 1) && !inRelief(y)) why.push("新築の軽減が終わり、建物の分が元に戻る");
    if (reassessYear(y) === y && buildingIn(y) !== buildingIn(y - 1)) {
      const atFloor = g(y - built) <= floor;
      why.push(`${String(y)}年度の評価替えで、建物の評価額が築${String(y - built)}年の分だけ下がる${atFloor ? `（下限の${pctOf(floor)}で止まる）` : ""}`);
    }
    // 根拠の文に割合を入れる（購入の予定の推定と同じ。値だけ変わって文が同じ行は、編集のときに FP が直したとみなされるため）
    stages.push({ year: y, amount: round100(first * Number(ratio)), ratio, basis: `${PROPERTY_TAX_BASIS}（${why.join("。") || "評価額の見直し"}。固定資産税の欄の額の${ratioPct(ratio)}）` });
    prev = ratio;
  }
  return { first, firstYear, basis, stages };
}

// ---- 世帯から推定の元を読む ----

/** 長期優良住宅か: この家につながる住宅ローンの控除の条件の住宅の種類が認定住宅か */
function longLifeOf(h: Household, r: Residence): boolean {
  return (h.debts ?? []).some((d) => d.kind === "mortgage" && d.housing?.residence === r.id && d.housing.propertyType === "certified");
}

/** 推定の元（今住んでいる持ち家で、評価額が入っていなければ null） */
export function ownedHomeTaxInputs(h: Household, r: Residence, baseMonth: string, endYear: number, landShareSetting?: string): OwnedHomeTaxInputs | null {
  if (r.kind !== "own" || r.purchase !== undefined) return null;
  const v = r.valuation;
  const box = v?.value as (Box<number> & { substitute?: Box<number> }) | undefined;
  const value = box === undefined || box.state === "notApplicable" ? null : (box.value ?? (box.state === "unknown" ? (box.substitute?.value ?? null) : null));
  if (value === null || !(value > 0)) return null;
  const baseYear = Number(baseMonth.slice(0, 4));
  const toYm = r.to === null ? null : resolveTimepoint(h, r.to);
  const lastYear = Math.min(endYear, toYm === null ? endYear : Number(toYm.slice(0, 4)));
  if (lastYear < baseYear) return null;
  const structure = v?.structure ?? (r.style === "condo" ? "rc" : "wood");
  const built = v?.builtYear;
  return {
    value,
    valueYear: Number((v?.asOf ?? baseMonth).slice(0, 4)),
    landShare: v?.landShare ?? landShareSetting ?? VALUATION_DEFAULTS.landShare,
    structure,
    condo: r.style !== undefined ? r.style === "condo" : structure === "rc",
    ...(built !== undefined ? { builtYear: built } : {}),
    longLife: longLifeOf(h, r),
    baseYear,
    lastYear,
  };
}

// ---- 推定の印と入れ直し（段の印は購入の予定の推定と同じ。propertyTax.ts） ----

const wrap = (h: Household): Obj => ({ household: h });
const ratioAddress = (rid: string, sid: string) => ({ target: { object: rid }, item: "residence.propertyTax", at: ["stages", sid, "ratio"] });
const dropAddress = (rid: string, sid: string) => ({ target: { object: rid }, item: "residence.propertyTax", at: ["stages", sid] });
const autoRow = (basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method: METHOD, basis } });
const isOurs = (basis: unknown): boolean => typeof basis === "string" && basis.startsWith(PROPERTY_TAX_BASIS);
type SubBox = Box<number> & { substitute?: Box<number> & { estimate?: { basis?: string } } };
/** 「わからない」（書類待ち）で、代わりの値がこの推定のままか */
const isOursSubstitute = (b: SubBox | undefined): boolean => b?.state === "unknown" && b.substitute?.origin.kind === "auto" && isOurs(b.substitute.estimate?.basis);

/** 目安のボタンの値（評価額が無くなったときに戻す。stages/housing.ts の目安と同じ） */
const taxPreset = (): Box<number> => standardBox(presetNum("preset.housing.propertyTax"), presetBasis(presetText("preset.housing.propertyTax", (v) => `固定資産税・都市計画税 年${manOf(Number(v))}`)));

/**
 * 推定を入れる・入れ直す（h をそのまま書き換える）。start が true なら、固定資産税の欄が未入力か推定のまま（目安のボタンの値を含む）のときに入れる
 * （評価の欄を直したとき）。start でなければ、この推定のままの欄（「わからない」の代わりの値を含む）と推定の段だけを入れ直す。変われば true
 */
export function applyOwnedHomeTax(h: Household, r: Residence, baseMonth: string, endYear: number, landShareSetting?: string, start = false): boolean {
  if (r.kind !== "own" || r.purchase !== undefined) return false;
  const annual = r.propertyTax?.annual as SubBox | undefined;
  const stages: AmountStage[] = r.propertyTax?.stages ?? [];
  const autoStage = (id: string | undefined): boolean => id !== undefined && isAutoTaxStage(h, r.id, id);
  const annualOurs = isEstimatedTax(annual) || isOursSubstitute(annual);
  const empty = annual === undefined || (annual.state !== "notApplicable" && annual.state !== "unknown" && annual.value === null);
  const startable = start && (empty || isAutoTax(annual));
  if (!annualOurs && !startable && !stages.some((s) => autoStage(s.id))) return false;
  const before = JSON.stringify(r);
  const o = ownedHomeTaxInputs(h, r, baseMonth, endYear, landShareSetting);
  const input = wrap(h);
  const kept = stages.filter((s) => {
    if (!autoStage(s.id)) return true;
    putRow(input, ratioAddress(r.id, s.id), undefined);
    return false;
  });
  if (o === null) {
    // 評価額が無くなった: この推定のままの欄は目安のボタンの値に戻し、推定の段は外す（FP が直した段は残す）
    if (r.propertyTax !== undefined) {
      if (isEstimatedTax(annual)) r.propertyTax.annual = taxPreset();
      else if (isOursSubstitute(annual)) (annual as SubBox).substitute = { ...taxPreset() };
      if (kept.length > 0) r.propertyTax.stages = kept;
      else delete r.propertyTax.stages;
    }
    return JSON.stringify(r) !== before;
  }
  const plan = ownedHomeTaxPlan(o);
  const est = { value: plan.first, state: "estimated", origin: { kind: "auto" }, estimate: { method: METHOD, basis: plan.basis } } as Box<number>;
  if (isOursSubstitute(annual)) (annual as SubBox).substitute = est;
  else if (annualOurs || startable) r.propertyTax = { ...(r.propertyTax ?? {}), annual: est };
  const tax = r.propertyTax!;
  for (const s of plan.stages) {
    const id = taxStageId(r.id, s.year);
    if (kept.some((x) => x.id === id) || rowAt(input, dropAddress(r.id, id))?.state === "notApplicable") continue;
    kept.push({ id, at: { at: `${String(s.year)}-01` }, ratio: s.ratio });
    putRow(input, ratioAddress(r.id, id), autoRow(s.basis));
  }
  const yearOf = (s: AmountStage): string => resolveTimepoint(h, s.at) ?? "9999-12";
  kept.sort((a, b) => yearOf(a).localeCompare(yearOf(b)));
  if (kept.length > 0) tax.stages = kept;
  else delete tax.stages;
  return JSON.stringify(r) !== before;
}

/** 世帯の今住んでいる持ち家の推定を入れ直す（refreshEstimates から） */
export function refreshOwnedHomeTax(h: Household, baseMonth: string, endYear: number, landShareSetting?: string): void {
  for (const r of h.residences ?? []) applyOwnedHomeTax(h, r, baseMonth, endYear, landShareSetting);
}

/** 固定資産税の欄を空にしたときの推定（今住んでいる持ち家で評価額があるとき。無ければ null） */
export function ownedHomeTaxEstimate(wh: WorkingHousehold, rid: string): { value: number; basis: string } | null {
  const input = wh.request.input;
  const r = (input.household.residences ?? []).find((x) => x.id === rid);
  if (r === undefined) return null;
  const o = ownedHomeTaxInputs(input.household, r, input.baseMonth, input.endYear, input.assumptions?.realEstateValuation?.landShare);
  if (o === null) return null;
  const plan = ownedHomeTaxPlan(o);
  return { value: plan.first, basis: plan.basis };
}

/**
 * 持ち家の評価の欄（推定の元）を直したら、固定資産税の欄が未入力か推定のまま（目安のボタンの値を含む）なら推定を入れる（今住んでいる持ち家だけ）。
 * 欄の書き込み（set と write）を包む
 */
export function startsOwnedHomeTax(f: FieldDef, rid: string): FieldDef {
  const after = (before: WorkingHousehold, next: WorkingHousehold): WorkingHousehold =>
    next === before
      ? next
      : mutate(next, (h, req) => {
          const r = (h.residences ?? []).find((x) => x.id === rid);
          if (r !== undefined) applyOwnedHomeTax(h, r, req.input.baseMonth, req.input.endYear, req.input.assumptions?.realEstateValuation?.landShare, true);
        });
  return {
    ...f,
    set: (wh, v) => after(wh, f.set(wh, v)),
    ...(f.write !== undefined ? { write: (wh: WorkingHousehold, v: Parameters<FieldDef["set"]>[1]) => after(wh, f.write!(wh, v)) } : {}),
    ...(f.boxed !== undefined ? { boxed: { ...f.boxed, write: (wh: WorkingHousehold, box: Record<string, unknown> | undefined) => after(wh, f.boxed!.write(wh, box)) } } : {}),
  };
}
