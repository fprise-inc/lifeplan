// 注文住宅（土地を買って建てる。0115）: 住宅の購入の種類の「注文住宅」。世帯には購入の土地 purchase.land（土地の決済の月・土地の代金・
// その月に払う頭金と諸費用。どれも購入の合計の内数）と、引き渡しの前に頭金から払う建物の代金 purchase.payments（契約金・着工金・中間金）で持つ。
// 計算エンジン（housing.residence 改訂5・housing.valuation 改訂3）は、内数をそれぞれの月に払い、土地を決済の月から評価する。
// ここは画面の側の推定（0008 の2）: 合計の額（物件の価格・頭金・諸費用）と引き渡しの時期だけでも動くように、推定のままの値を入れ直す。
// - 土地の代金: 物件の価格×土地の割合（持ち家の評価の土地の割合。空なら前提条件の値か目安。フラット35利用者調査の土地付注文住宅の割合）
// - 土地の決済の時期: 引き渡しの何か月前（目安）
// - 土地の決済で払う頭金: 頭金のうち土地の代金まで（自己資金は先に来る支払いに充てる）
// - 土地の諸費用: 土地の代金×土地の諸費用の割合（目安）
// - 諸費用（合計）: 土地の諸費用＋建物の諸費用（建物の代金×新築の諸費用の割合）＋つなぎ融資の利息と手数料（住宅ローンを組むときだけ。
//   土地の分のローン〔土地先行融資〕が無ければ土地の代金の借りる分を土地の決済から引き渡しまで、着工金・中間金の借りる分を平均の月数だけ借りるとみなす）
// FP が入れた値は変えない（推定のままの値だけ。0041）。根拠の文には値を入れる（値だけ変わって文が同じ行は FP が直したとみなされるため）
import type { Debt, Household, Residence } from "../../engine/types.ts";
import { addMonths } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { presetNum } from "../../../../hearing/src/presets.ts";
import { pctText } from "../../../../hearing/src/housingEstimates.ts";
import { VALUATION_DEFAULTS } from "./labels.ts";
import { monthsBetween } from "./loanMath.ts";
import type { StateRow } from "./rows.ts";
import { formatYen } from "./units.ts";

type Obj = Record<string, unknown>;

/** 値の状態の行の鍵（物の valueStates の「入力項目ID/場所」） */
export const CUSTOM_KEYS = {
  at: "residence.purchase/land/at",
  price: "residence.purchase/land/price",
  down: "residence.purchase/land/downPayment",
  landCosts: "residence.purchase/land/costs",
  costs: "residence.purchase/costs",
} as const;

const man = (v: number): string => `${formatYen(Math.round(v / 10000) * 10000, "man")}万円`;
const round10k = (v: number): number => Math.round(v / 10000) * 10000;
const ymText = (ym: string): string => `${String(Number(ym.slice(0, 4)))}年${String(Number(ym.slice(5, 7)))}月`;
const row = (method: string, basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method, basis } });

const statesOf = (r: Residence): Record<string, StateRow> => ((r as unknown as Obj).valueStates as Record<string, StateRow> | undefined) ?? {};
const stateOf = (r: Residence, key: string): StateRow | undefined => statesOf(r)[key];
function setState(r: Residence, key: string, v: StateRow | undefined): void {
  const o = r as unknown as Obj;
  const states = { ...statesOf(r) };
  if (v === undefined) delete states[key];
  else states[key] = v;
  if (Object.keys(states).length === 0) delete o.valueStates;
  else o.valueStates = states;
}
/** 推定のまま（出どころ auto）の値か */
export const isAuto = (r: Residence, key: string): boolean => {
  const s = stateOf(r, key);
  return s?.state === "estimated" && s.origin.kind === "auto";
};

/** 注文住宅（購入の予定で土地を持つ）か */
export const isCustomBuild = (r: Residence): boolean => r.kind === "own" && r.purchase?.land !== undefined;

/** 購入の月（建物の引き渡し。省略は住み始め） */
const handoverOf = (h: Household, r: Residence): string | null => (r.purchase === undefined ? null : resolveTimepoint(h, r.purchase.at ?? r.from));
/** 土地の決済の月 */
export const landMonthOf = (h: Household, r: Residence): string | null => (r.purchase?.land === undefined ? null : resolveTimepoint(h, r.purchase.land.at));

/** 住まいの住宅ローン（住まい以外の不動産のローンを除く） */
const isHomeLoan = (d: Debt): boolean => d.kind === "mortgage" && d.property === undefined;

/** 土地の分のローン（土地先行融資。借入の年月が土地の決済の月の住宅ローン） */
export function landLoansOf(h: Household, r: Residence): Debt[] {
  const ym = landMonthOf(h, r);
  if (ym === null || ym === handoverOf(h, r)) return [];
  return (h.debts ?? []).filter((d) => isHomeLoan(d) && resolveTimepoint(h, d.start) === ym);
}

/** この購入につながる住宅ローン（借入の年月が引き渡しの月か土地の決済の月、または控除の条件の住まいがこの家） */
function loansOf(h: Household, r: Residence): Debt[] {
  const months = [handoverOf(h, r), landMonthOf(h, r)].filter((x): x is string => x !== null);
  return (h.debts ?? []).filter((d) => isHomeLoan(d) && (d.housing?.residence === r.id || months.includes(resolveTimepoint(h, d.start) ?? "")));
}

/** 土地の割合（持ち家の評価の欄 → 前提条件 → 目安） */
const landShareOf = (r: Residence, setting?: string): number => Number(r.valuation?.landShare ?? setting ?? VALUATION_DEFAULTS.landShare);

/** 建物の代金（合計−土地の代金。0円より下げない） */
export const buildingPriceOf = (r: Residence): number => Math.max(0, (r.purchase?.price ?? 0) - (r.purchase?.land?.price ?? 0));

// ---- 推定の値 ----

/** 土地の代金の推定 */
function landPriceEstimate(r: Residence, setting?: string): { value: number; basis: string } {
  const share = landShareOf(r, setting);
  const value = round10k((r.purchase?.price ?? 0) * share);
  return { value, basis: `既定の値（物件の価格の${pctText(share)}。${man(value)}。土地付注文住宅の土地の割合の目安。土地の代金がわかれば直してください）` };
}

/** 土地の決済の時期の推定（引き渡しの何か月前） */
function landAtEstimate(h: Household, r: Residence): { value: string; basis: string } | null {
  const handover = handoverOf(h, r);
  if (handover === null) return null;
  const lead = presetNum("preset.housing.purchase.custom.landLeadMonths");
  const value = addMonths(handover, -lead);
  return { value, basis: `既定の値（建物の引き渡しの${String(lead)}か月前。${ymText(value)}。直してください）` };
}

/** 土地の決済で払う頭金の推定（頭金のうち土地の代金まで） */
function landDownEstimate(r: Residence): { value: number; basis: string } {
  const value = Math.min(r.purchase?.downPayment ?? 0, r.purchase?.land?.price ?? 0);
  return { value, basis: `頭金のうち、先に来る土地の決済で払う分（土地の代金まで。${man(value)}）` };
}

/** 土地の諸費用の推定 */
function landCostsEstimate(r: Residence): { value: number; basis: string } {
  const rate = presetNum("preset.housing.purchase.costsRate.land");
  const value = round10k((r.purchase?.land?.price ?? 0) * rate);
  return { value, basis: `既定の値（土地の代金の${pctText(rate)}。${man(value)}。仲介手数料・登記・印紙・固定資産税の精算など。目安は5〜8%）` };
}

/** つなぎ融資の利息と手数料の推定（住宅ローンを組まなければ0） */
export function bridgeCost(h: Household, r: Residence): { value: number; text: string } {
  const p = r.purchase;
  const land = p?.land;
  const handover = handoverOf(h, r);
  const landYm = landMonthOf(h, r);
  if (p === undefined || land === undefined || handover === null || landYm === null || loansOf(h, r).length === 0) return { value: 0, text: "" };
  const rate = presetNum("preset.housing.purchase.custom.bridgeRate");
  const months = Math.max(0, monthsBetween(landYm, handover));
  const landBorrow = landLoansOf(h, r).length > 0 ? 0 : Math.max(0, land.price - (land.downPayment ?? 0));
  const paid = (p.payments ?? []).reduce((s, x) => s + x.amount, 0);
  const interimBorrow = Math.max(0, buildingPriceOf(r) * presetNum("preset.housing.purchase.custom.interimShare") - paid);
  const interimMonths = Math.min(months, presetNum("preset.housing.purchase.custom.interimMonths"));
  if (landBorrow + interimBorrow <= 0 || months <= 0) return { value: 0, text: "" };
  const interest = (landBorrow * rate * months + interimBorrow * rate * interimMonths) / 12;
  const value = round10k(interest + presetNum("preset.housing.purchase.custom.bridgeFee"));
  const parts = [
    ...(landBorrow > 0 ? [`土地の代金の借りる分${man(landBorrow)}を${String(months)}か月`] : []),
    ...(interimBorrow > 0 ? [`着工金・中間金${man(interimBorrow)}を平均${String(interimMonths)}か月`] : []),
  ];
  return { value, text: `つなぎ融資の利息と手数料 ${man(value)}（${parts.join("、")}、年${pctText(rate)}で借りるとみなし、手数料を足した）` };
}

/** 諸費用（合計）の推定: 土地の諸費用＋建物の諸費用＋つなぎ融資 */
function costsEstimate(h: Household, r: Residence): { value: number; basis: string } {
  const landCosts = r.purchase?.land?.costs ?? 0;
  const rate = presetNum("preset.housing.purchase.costsRate");
  const building = round10k(buildingPriceOf(r) * rate);
  const bridge = bridgeCost(h, r);
  const value = landCosts + building + bridge.value;
  const parts = [`土地の諸費用 ${man(landCosts)}`, `建物の諸費用 ${man(building)}（建物の代金の${pctText(rate)}。登記・ローンの手数料・火災保険など）`, ...(bridge.value > 0 ? [bridge.text] : [])];
  return { value, basis: `既定の値（${man(value)}: ${parts.join("、")}）` };
}

// ---- 入れる・入れ直す ----

/**
 * 注文住宅にする（購入の種類で選んだとき。h をそのまま書き換える）: 土地が無ければ推定で足し、推定のままの値を入れ直す
 */
export function startCustomBuild(h: Household, r: Residence, landShareSetting?: string): void {
  const p = r.purchase;
  if (p === undefined) return;
  if (p.land === undefined) {
    const at = landAtEstimate(h, r);
    const price = landPriceEstimate(r, landShareSetting);
    if (at === null) return;
    p.land = { at: { at: at.value }, price: price.value };
    setState(r, CUSTOM_KEYS.at, row("standard", at.basis));
    setState(r, CUSTOM_KEYS.price, row("standard", price.basis));
    const down = landDownEstimate(r);
    p.land.downPayment = down.value;
    setState(r, CUSTOM_KEYS.down, row("derived", down.basis));
    const lc = landCostsEstimate(r);
    p.land.costs = lc.value;
    setState(r, CUSTOM_KEYS.landCosts, row("standard", lc.basis));
  }
  refreshOne(h, r, landShareSetting);
}

/** 注文住宅をやめる（ほかの種類を選んだとき）: 土地と引き渡しの前の支払いと、その値の状態の行を外す */
export function stopCustomBuild(r: Residence): void {
  if (r.purchase === undefined) return;
  delete r.purchase.land;
  delete r.purchase.payments;
  for (const k of Object.keys(statesOf(r))) if (k.startsWith("residence.purchase/land/") || k.startsWith("residence.purchase/payments/")) setState(r, k, undefined);
}

/** 1件の推定のままの値を入れ直す。変われば true */
function refreshOne(h: Household, r: Residence, landShareSetting?: string): boolean {
  const p = r.purchase;
  const land = p?.land;
  if (p === undefined || land === undefined) return false;
  const before = JSON.stringify(r);
  if (isAuto(r, CUSTOM_KEYS.price)) {
    const e = landPriceEstimate(r, landShareSetting);
    land.price = e.value;
    setState(r, CUSTOM_KEYS.price, row("standard", e.basis));
  }
  if (isAuto(r, CUSTOM_KEYS.at)) {
    const e = landAtEstimate(h, r);
    if (e !== null) {
      land.at = { at: e.value };
      setState(r, CUSTOM_KEYS.at, row("standard", e.basis));
    }
  }
  if (isAuto(r, CUSTOM_KEYS.down)) {
    const e = landDownEstimate(r);
    land.downPayment = e.value;
    setState(r, CUSTOM_KEYS.down, row("derived", e.basis));
  }
  if (isAuto(r, CUSTOM_KEYS.landCosts)) {
    const e = landCostsEstimate(r);
    land.costs = e.value;
    setState(r, CUSTOM_KEYS.landCosts, row("standard", e.basis));
  }
  if (isAuto(r, CUSTOM_KEYS.costs)) {
    const e = costsEstimate(h, r);
    p.costs = e.value;
    setState(r, CUSTOM_KEYS.costs, row("standard", e.basis));
  }
  return JSON.stringify(r) !== before;
}

/** 世帯の注文住宅の推定のままの値を入れ直す（refreshEstimates から。固定資産税の推定より前に） */
export function refreshCustomBuild(h: Household, landShareSetting?: string): void {
  for (const r of h.residences ?? []) if (isCustomBuild(r)) refreshOne(h, r, landShareSetting);
}

/**
 * 注文住宅の知らせ（入力の欄の下に出す。無ければ null）: 土地の決済が引き渡しより後、土地の分のローンが住宅ローン控除の対象になる条件（新築の日前2年以内の土地）、
 * 引き渡しの前の年の土地の固定資産税（計算に入れていない）、内数が合計を超える
 */
export function customBuildNotes(h: Household, r: Residence): string[] {
  const p = r.purchase;
  const land = p?.land;
  const handover = handoverOf(h, r);
  const landYm = landMonthOf(h, r);
  if (p === undefined || land === undefined || handover === null || landYm === null) return [];
  const out: string[] = [];
  const gap = monthsBetween(landYm, handover);
  if (gap < 0) out.push("土地の決済が建物の引き渡しより後になっています。土地の決済の時期を直してください");
  if (gap > 24 && landLoansOf(h, r).length > 0) out.push("土地の決済から引き渡しまで2年を超えるので、土地の分のローンは住宅ローン控除の対象にしていません（家屋の新築の日前2年以内に取得した敷地の借入金が対象）");
  const landYear = Number(landYm.slice(0, 4));
  const handoverYear = Number(handover.slice(0, 4));
  if (handoverYear - landYear >= 2) out.push(`${String(landYear + 1)}年から引き渡しの前の年までの土地の固定資産税（建物が無い土地の分）は計算に入れていません。わかれば「出るお金」の行で入れてください`);
  const paid = (land.downPayment ?? 0) + (p.payments ?? []).reduce((s, x) => s + x.amount, 0);
  if (paid > (p.downPayment ?? 0)) out.push(`土地の決済と引き渡しの前に払う頭金（${man(paid)}）が、頭金の合計（${man(p.downPayment ?? 0)}）を超えています。超える分は計算に入りません（頭金の合計を直してください）`);
  if ((land.costs ?? 0) > (p.costs ?? 0)) out.push(`土地の諸費用（${man(land.costs ?? 0)}）が諸費用の合計（${man(p.costs ?? 0)}）を超えています。超える分は計算に入りません`);
  if (land.price > p.price) out.push(`土地の代金（${man(land.price)}）が土地と建物の合計（${man(p.price)}）を超えています`);
  return out;
}

/** 土地の分のローン（土地先行融資）が住宅ローン控除の対象になるか: 土地の決済から建物の引き渡しまで2年以内（措置法施行令26条の家屋の新築の日前2年以内に取得した敷地） */
export function landLoanCreditable(h: Household, r: Residence): boolean {
  const handover = handoverOf(h, r);
  const landYm = landMonthOf(h, r);
  return handover !== null && landYm !== null && monthsBetween(landYm, handover) <= 24;
}

/** 土地の分のローンの購入（借入の年月がどれかの注文住宅の土地の決済の月） */
export function customOfLandLoan(h: Household, d: Debt): Residence | undefined {
  if (!isHomeLoan(d)) return undefined;
  const ym = resolveTimepoint(h, d.start);
  if (ym === null) return undefined;
  return (h.residences ?? []).find((r) => isCustomBuild(r) && landMonthOf(h, r) === ym && handoverOf(h, r) !== ym);
}
