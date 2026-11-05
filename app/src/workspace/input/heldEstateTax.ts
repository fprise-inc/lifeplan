// 貸していない不動産の毎年の費用（0123）: 貯蓄・運用の「貸していない不動産」（中身 property の無い不動産の器）に、物の ID でつないだ
// 出るお金の行（種類 assetCost・object＝器の ID・表の行 cf.expense.other.realEstate・毎年・伸ばさない）を1つ持つ。計算エンジンは、器に
// 売る予定があれば売る月から払わない（expense.periodic）。
// - 固定資産税・都市計画税の目安は 0112 の式（評価額の目安の割合・税率・都市計画税の税率）を流用する（propertyTax.ts の taxGuide）:
//   土地の評価額 L＝評価額×土地の割合×土地の評価額の割合、建物の評価額 B＝評価額×(1−土地の割合)×建物の評価額の割合（その額の時点）。
//   - 空き家（住宅が建っている）: 住宅用地の特例を当てる（L×1/6×1.4%＋L×1/3×都市計画税率）
//   - 別荘・土地（更地）: 住宅用地の特例は当たらない（別荘は地方税法349条の3の2・施行令52条の11で住宅から除く）。課税標準は評価額の70%
//     （商業地等の負担水準の上限。地方税法附則18条）とみなす（L×70%×1.4%＋L×70%×都市計画税率）
//   - 建物: B×1.4%＋B×都市計画税率（建った年が分からないので、古くなった分の下がり・新築の軽減は入れない）。土地（更地）は土地の割合100%
//   - 山林・農地は評価の仕方が違う（農地としての価格など）ので目安を出さない。中身の無い（その他の）不動産も出さない
// - いつ入れるか（0112 と同じ考え）: 中身（土地・別荘・空き家）を選んだときと評価額・時点を直したときに、行が無いか推定のままなら入れる。
//   その後は推定のままの行だけを入力を直すたびに入れ直す（refreshEstimates）。FP が額を入れたら（管理費を足した額など）その額のまま
//   （値の状態の決まり）。欄を空にしたら目安に戻す（目安が出なければ行を外す）。目安が出なくなった推定のままの行は外す
import type { Account, Box, Household, PeriodicExpense } from "../../engine/types.ts";
import type { FieldDef } from "./form.ts";
import { mutate, newId, type WorkingHousehold } from "./household.ts";
import { VALUATION_DEFAULTS } from "./labels.ts";
import { manOf, pctOf, PROPERTY_TAX_LAW, round100, taxGuide as guide } from "./propertyTax.ts";

/**
 * 法令で決まる値（事務所で変えられない）: 商業地等（住宅用地でない宅地。別荘の敷地・更地）の固定資産税・都市計画税の課税標準の上限は、
 * 評価額の70%（負担水準の上限。地方税法附則第18条第5項・第25条）。住宅用地の特例・税率は PROPERTY_TAX_LAW（propertyTax.ts）
 */
export const HELD_ESTATE_LAW = { nonResidentialCap: 0.7 } as const;

/** 推定の根拠の文の頭（この頭の推定を、毎年の費用の目安の印として読む） */
export const HELD_ESTATE_TAX_BASIS = "固定資産税の目安";
/** つながる行の名前 */
export const HELD_COST_LABEL = "固定資産税・管理費など";

type Kind = "vacantLand" | "villa" | "vacantHouse";
const KIND_NAMES: Record<Kind, string> = { vacantLand: "土地（更地）", villa: "別荘", vacantHouse: "空き家" };

export interface HeldEstateTaxInputs {
  value: number;
  /** その額の時点の年 */
  valueYear: number;
  kind: Kind;
  /** 土地の割合（土地〔更地〕は1） */
  landShare: number;
}

/** 目安の計算（純粋な関数） */
export function heldEstateTax(o: HeldEstateTaxInputs): { value: number; basis: string } {
  const law = PROPERTY_TAX_LAW;
  const cp = guide.cityPlanningRate;
  const land = o.value * o.landShare * guide.landRatio;
  const building = o.value * (1 - o.landShare) * guide.buildingRatio;
  const housing = o.kind === "vacantHouse";
  const landTax = housing ? land * law.landFixedShare * law.standardRate + land * law.landCityShare * cp : land * HELD_ESTATE_LAW.nonResidentialCap * (law.standardRate + cp);
  const value = round100(landTax + building * (law.standardRate + cp));
  const parts = [
    `評価額${manOf(o.value)}（${String(o.valueYear)}年）・${KIND_NAMES[o.kind]}${o.kind === "vacantLand" ? "" : `・土地の割合${pctOf(o.landShare)}`}`,
    `評価額は土地が価格の${pctOf(guide.landRatio)}${o.kind === "vacantLand" ? "" : `・建物が価格の${pctOf(guide.buildingRatio)}`}の目安`,
    housing ? `住宅用地の特例を当て、都市計画税${pctOf(cp)}を含む` : `${o.kind === "villa" ? "別荘の土地" : "更地"}は住宅用地の特例が当たらないので、課税標準を評価額の${pctOf(HELD_ESTATE_LAW.nonResidentialCap)}とし、都市計画税${pctOf(cp)}を含む`,
    ...(o.kind === "vacantLand" ? [] : ["建物の古くなった分の下がりは入れていない"]),
    "管理費などは含まない",
  ];
  return { value, basis: `${HELD_ESTATE_TAX_BASIS}（${parts.join("。")}）` };
}

/** 貸していない不動産か（中身 property の無い不動産の器） */
export const isHeldEstate = (a: Pick<Account, "kind" | "property">): boolean => a.kind === "realEstate" && a.property === undefined;

/** 目安の元（目安を出せない器・中身・評価額なら null） */
export function heldEstateTaxInputs(a: Account, baseMonth: string, landShareSetting?: string): HeldEstateTaxInputs | null {
  if (!isHeldEstate(a)) return null;
  const kind = a.subtype;
  if (kind !== "vacantLand" && kind !== "villa" && kind !== "vacantHouse") return null;
  const value = a.marketValue?.value;
  if (typeof value !== "number" || !(value > 0)) return null;
  return { value, valueYear: Number((a.asOf ?? baseMonth).slice(0, 4)), kind, landShare: kind === "vacantLand" ? 1 : Number(landShareSetting ?? VALUATION_DEFAULTS.landShare) };
}

/** 器につながる毎年の費用の行 */
export const heldCostRow = (h: Household, aid: string): PeriodicExpense | undefined => (h.periodicExpenses ?? []).find((p) => p.kind === "assetCost" && p.object === aid);

const isOurs = (b: Box<number> | undefined): boolean => b !== undefined && b.state === "estimated" && b.origin.kind === "auto" && ((b as { estimate?: { basis?: string } }).estimate?.basis ?? "").startsWith(HELD_ESTATE_TAX_BASIS);
const estBox = (e: { value: number; basis: string }): Box<number> => ({ value: e.value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: e.basis } }) as Box<number>;

/** 新しいつながる行（毎年・計算の基準の月から・伸ばさない） */
export function newHeldCostRow(aid: string, baseMonth: string, amount: Box<number>): PeriodicExpense {
  return { id: newId(), kind: "assetCost", object: aid, label: HELD_COST_LABEL, row: "cf.expense.other.realEstate", from: { at: baseMonth }, to: null, everyYears: 1, amount, growth: { kind: "none" } };
}

/** 器につながる行を外す（器を外したとき・種類を変えたとき・収益不動産へ移したとき） */
export function dropHeldCostRows(h: Household, aid: string): void {
  if ((h.periodicExpenses ?? []).some((p) => p.object === aid)) h.periodicExpenses = (h.periodicExpenses ?? []).filter((p) => p.object !== aid);
}

/**
 * 目安を入れる・入れ直す（h をそのまま書き換える）。start なら、行が無いか推定のままのときに入れる（中身・評価額を直したとき）。
 * start でなければ、推定のままの行だけを入れ直す。目安が出なくなった推定のままの行は外す
 */
export function applyHeldEstateCost(h: Household, a: Account, baseMonth: string, landShareSetting?: string, start = false): void {
  const row = heldCostRow(h, a.id);
  if (row !== undefined && !isOurs(row.amount)) return;
  if (row === undefined && !start) return;
  const o = heldEstateTaxInputs(a, baseMonth, landShareSetting);
  if (o === null) {
    if (row !== undefined) dropHeldCostRows(h, a.id);
    return;
  }
  const e = heldEstateTax(o);
  if (row === undefined) (h.periodicExpenses ??= []).push(newHeldCostRow(a.id, baseMonth, estBox(e)));
  else if (row.amount.value !== e.value || (row.amount as { estimate?: { basis?: string } }).estimate?.basis !== e.basis) row.amount = estBox(e);
}

/** 世帯の貸していない不動産の毎年の費用の目安を入れ直す（refreshEstimates から） */
export function refreshHeldEstateCost(h: Household, baseMonth: string, landShareSetting?: string): void {
  for (const a of h.accounts ?? []) if (isHeldEstate(a) && heldCostRow(h, a.id) !== undefined) applyHeldEstateCost(h, a, baseMonth, landShareSetting);
  // 器が無くなった・収益不動産になった行は外す
  const held = new Set((h.accounts ?? []).filter(isHeldEstate).map((a) => a.id));
  if ((h.periodicExpenses ?? []).some((p) => p.kind === "assetCost" && (p.object === undefined || !held.has(p.object)))) h.periodicExpenses = (h.periodicExpenses ?? []).filter((p) => p.kind !== "assetCost" || (p.object !== undefined && held.has(p.object)));
}

/** 欄を直したら目安を入れる（中身・評価額・時点の欄の書き込みを包む） */
export function startsHeldEstateCost(f: FieldDef, aid: string): FieldDef {
  const after = (before: WorkingHousehold, next: WorkingHousehold): WorkingHousehold =>
    next === before
      ? next
      : mutate(next, (h, req) => {
          const a = (h.accounts ?? []).find((x) => x.id === aid);
          if (a !== undefined) applyHeldEstateCost(h, a, req.input.baseMonth, req.input.assumptions?.realEstateValuation?.landShare, true);
        });
  return {
    ...f,
    set: (wh, v) => after(wh, f.set(wh, v)),
    ...(f.write !== undefined ? { write: (wh: WorkingHousehold, v: Parameters<FieldDef["set"]>[1]) => after(wh, f.write!(wh, v)) } : {}),
    ...(f.boxed !== undefined ? { boxed: { ...f.boxed, write: (wh: WorkingHousehold, box: Record<string, unknown> | undefined) => after(wh, f.boxed!.write(wh, box)) } } : {}),
  };
}

/** 欄を空にしたときの目安（出せなければ null） */
export function heldEstateCostEstimate(wh: WorkingHousehold, aid: string): { value: number; basis: string } | null {
  const input = wh.request.input;
  const a = (input.household.accounts ?? []).find((x) => x.id === aid);
  if (a === undefined) return null;
  const o = heldEstateTaxInputs(a, input.baseMonth, input.assumptions?.realEstateValuation?.landShare);
  return o === null ? null : heldEstateTax(o);
}
