// 7. 住まい・ローン（0052）: 住まい（賃貸・持ち家・家賃なし。住み始めと住み終わりは時点の部品）、持ち家の建て方・税・修繕・名義、
// 購入の予定と住宅資金の援助、住み終わりの後（そのまま持つ・売る）と譲渡所得の税の額（0053）、持ち家の評価、相続する家への切り替え、
// 住宅ローンとほかのローン（housingLoans.ts）。お金の行（補助金・売電・修繕）は moneyRows.ts の区画を後ろに置く（stages/index.ts）
import type { Debt, Household, Residence, YearSeries } from "../../../engine/types.ts";
import { addMonths } from "../../levers.ts";
import { afterWrite, byId, field, getPath, plain, removeAction, resolveTimepoint, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { confirmedBox, mutate, newId, presetBasis, standardBox, wrapBasis, type WorkingHousehold } from "../household.ts";
import { rentBasis, rentStandard } from "../fill.ts";
import { debtorsWithoutShare, dropProvisionalEvent, PRINCIPAL_ESTIMATE, principalKey, purchaseMonth, sharesByLoans, withProvisionalHousing } from "../housingCredit.ts";
import { applyPropertyTaxEstimate, hasAutoTaxStages, isAutoTax as isAutoBox, purchaseLoans, rememberDroppedTaxStage } from "../propertyTax.ts";
import { buildingPriceOf, CUSTOM_KEYS, customBuildNotes, isCustomBuild, landLoansOf, landMonthOf, startCustomBuild, stopCustomBuild } from "../customBuild.ts";
import { applyOwnedHomeTax, ownedHomeTaxEstimate, startsOwnedHomeTax } from "../ownedHomeTax.ts";
import { AS_OF_FOLLOWS, clearLand, clearPurchaseBasis, landOfShare, shareOfLand, dropAsOfFollow, followFromMonth, isCurrentOwned, landAmount, landEntered, markPurchaseBasis, ownedValueMode, putLand, totalOf } from "../ownedHomeValue.ts";
import { BUILDING_STRUCTURES, donorCandidates, donorOptions, HOUSING_EXEMPTION, memberLabel, memberOptions, RATE_TYPES, REPAYMENT_METHODS, TAX_METHODS, USEFUL_LIFE, VALUATION_DEFAULTS } from "../labels.ts";
import type { StateRow } from "../rows.ts";
import { formatYearMonth, formatYen } from "../units.ts";
import { rentGrowthStatistic } from "../../../../../hearing/src/housingEstimates.ts";
import { carLoanRateEstimate } from "../../../../../hearing/src/loanRates.ts";
import { pctText } from "../../../../../hearing/src/housingEstimates.ts";
import { presetNum, presetText } from "../../../../../hearing/src/presets.ts";
import { regulationEntries, regulationValue } from "../../../../../hearing/src/statistics.ts";
import { readGroup, readLine } from "../readLines.ts";
import { stagedBadge, stagedGroups, type StagedSpec } from "../staged.ts";
import { addHomeRefinance, at, creditLifeFields, creditLifeGroups, estRow, loanFields, loanMoreActions, loanTitle, LOAN_SUBTYPES, newMortgage, newOtherLoan, rateStepsView, otherLoanHeadFields, withEntry, MISC_SUBTYPES } from "./housingLoans.ts";
import { GROWTH_RANGE } from "../rateRanges.ts";
import { hasExecutive } from "../officer.ts";
import {
  addNextResidence,
  alignFromToPurchase,
  followPurchaseMonth,
  fromKey,
  heldFromHome,
  inheritFromAssumed,
  keepAsVacant,
  landShareByAge,
  loansOfHome,
  MOVE_OUT_ASSUMED,
  MOVE_OUT_RENT_ASSUMED,
  moveHeldStart,
  undoMoveOut,
  applyMoveOutAfter,
  purchaseFromGap,
  residenceNotes,
  toKey,
} from "../housingFollow.ts";
import { balanceAtMonth } from "./housingLoans.ts";
import { addOutside } from "./care.ts";

export { creditLifeFields, creditLifeGroups, loanFields };

type Obj = Record<string, unknown>;
const residences = (h: Household) => h.residences;

/** 万円の文字（「12万円」「1.5万円」） */
const manOf = (v: number | string) => `${formatYen(Number(v), "man")}万円`;
/** 目安のボタンの値（0041。推定の標準の値で入れる。値は presets.ts の目安） */
const TAX_PRESET = () => standardBox(presetNum("preset.housing.propertyTax"), presetBasis(presetText("preset.housing.propertyTax", (v) => `固定資産税・都市計画税 年${manOf(v)}`)));
const MAINT_PRESET = () => standardBox(presetNum("preset.housing.maintenance"), presetBasis(presetText("preset.housing.maintenance", (v) => `修繕費・管理費 月${manOf(v)}`)));
const PRICE_PRESET = () => presetNum("preset.housing.purchase.price");
/** 相続する家の築年数の目安（計算の基準の年の。建った年が分からないとき。2026-11-05） */
const INHERITED_AGE = () => presetNum("preset.housing.inheritedHomeAge");
const inheritedBuiltBasis = (built: number) => presetText("preset.housing.inheritedHomeAge", (v) => `相続する家の築年数の目安（いま築${String(v)}年とみなして${String(built)}年に建った。分かれば建った年を入れてください）`);
/** 頭金・諸費用の標準の割合（物件の価格に対する）。諸費用は購入の種類の新築・中古で分ける（選ぶ前は新築の割合。0052 の追記 2026-11-03） */
const DOWN_RATE = () => presetNum("preset.housing.purchase.downRate");
const costsRateId = (newBuild: boolean | undefined) => (newBuild === false ? "preset.housing.purchase.costsRate.used" : "preset.housing.purchase.costsRate");
const COSTS_RATE = (newBuild?: boolean) => presetNum(costsRateId(newBuild));
/** 割合の文字（1割・2割…は「割」、ほかは％） */
const shareText = (r: number) => (Math.abs(r * 10 - Math.round(r * 10)) < 1e-9 ? `${String(Math.round(r * 10))}割` : pctText(r));
const downBasis = (v: number) => presetText("preset.housing.purchase.downRate", (r) => `既定の値（物件の価格の${shareText(Number(r))}。${formatYen(v, "man")}万円）`);
const costsBasis = (v: number, newBuild?: boolean) =>
  presetText(costsRateId(newBuild), (r) => `既定の値（物件の価格の${pctText(r)}。${formatYen(v, "man")}万円。${newBuild === undefined ? "" : newBuild ? "新築の目安。" : "中古の目安。"}目安は新築で3〜7%、中古で6〜10%）`);
/** 購入の種類ごとの修繕費・管理費の目安（マンションは管理費・修繕積立金、戸建ては修繕の積み立て） */
const MAINT_OF = (condo: boolean) =>
  condo
    ? standardBox(presetNum("preset.housing.maintenance.condo"), presetBasis(presetText("preset.housing.maintenance.condo", (v) => `マンションの管理費・修繕積立金 月${manOf(v)}`)))
    : standardBox(presetNum("preset.housing.maintenance"), presetBasis(presetText("preset.housing.maintenance", (v) => `戸建ての修繕の積み立て 月${manOf(v)}`)));
const UNENTERED_GIFT = "未入力（援助の額を入れてください。0円で計算中）";

/** 物の値の状態の欄の行（物を直接書き換える） */
function setState(obj: Obj, key: string, row: StateRow | undefined): void {
  const states = (typeof obj.valueStates === "object" && obj.valueStates !== null ? obj.valueStates : {}) as Record<string, unknown>;
  if (row === undefined) delete states[key];
  else states[key] = row;
  if (Object.keys(states).length === 0) delete obj.valueStates;
  else obj.valueStates = states;
}
const stateOf = (obj: Obj | undefined, key: string): StateRow | undefined => ((obj?.valueStates as Record<string, StateRow> | undefined) ?? {})[key];
const isAutoEstimate = (r: StateRow | undefined): boolean => r?.state === "estimated" && r.origin.kind === "auto";

/**
 * 頭金の推定（2026-11-05 の追記）: 物件の価格×頭金の割合に、住宅資金の援助の額を足す（援助は購入の月に受け取り、頭金の一部として払う）。
 * 借入額の推定（物件の価格−頭金）は、援助の分だけ少なくなる。頭金が推定のまま（出どころ auto）のときだけ入れ直す。FP が入れた頭金は変えない
 */
function refreshDownEstimate(res: Residence | undefined): void {
  const p = res?.purchase;
  if (res === undefined || p === undefined || !isAutoEstimate(stateOf(res as unknown as Obj, "residence.purchase/downPayment"))) return;
  const own = Math.round((p.price * DOWN_RATE()) / 10000) * 10000;
  const gift = (p.gifts ?? []).reduce((s, g) => s + (g.amount > 0 ? g.amount : 0), 0);
  p.downPayment = own + gift;
  setState(res as unknown as Obj, "residence.purchase/downPayment", estRow("derived", gift > 0 ? `${downBasis(own)}＋住宅資金の援助${formatYen(gift, "man")}万円` : downBasis(own)));
}

// ---- 住まいの種類（賃貸・持ち家・家賃なし） ----

/** 家賃なし（実家・親の家・社宅の家賃なしなど）: 賃貸で家賃が該当なし */
const isFree = (r: Residence): boolean => r.kind === "rent" && (r.rent === undefined || r.rent.monthly.state === "notApplicable");
const RESIDENCE_CHOICES = [
  { value: "rent", label: "賃貸（社宅・寮を含む）" },
  { value: "own", label: "持ち家" },
  { value: "free", label: "家賃なし" },
];

/**
 * 種類を変える。形の違う値（賃貸の家賃・持ち家の税と修繕と評価）は消さずに残し、計算は種類に合う値だけを読む（隠すだけで消さない。0052 の3）。
 * 足りない値は目安のボタンの値（推定）で入れる
 */
function setKind(h: Household, res: Residence, v: string): void {
  const selfId = h.members.find((m) => m.kind === "self")?.id;
  if (v === "free") {
    res.kind = "rent";
    res.rent = { ...(res.rent ?? {}), monthly: { state: "notApplicable", origin: { kind: "manual" } } as never };
    return;
  }
  if (v === "rent") {
    res.kind = "rent";
    if (res.rent === undefined || res.rent.monthly.state === "notApplicable") res.rent = { ...(res.rent ?? {}), monthly: standardBox(rentStandard(), rentBasis()) };
    return;
  }
  res.kind = "own";
  res.propertyTax ??= { annual: TAX_PRESET() };
  res.maintenance ??= { monthly: MAINT_PRESET() };
  if (selfId !== undefined) res.ownership ??= [{ member: selfId, share: "1" }];
}

// ---- 建て方・名義 ----

/**
 * 毎月の修繕・管理の費用の欄の呼び方（建て方で変える。マンションは管理費と修繕積立金、戸建ては自分で積み立てる修繕の費用）。
 * 建て方が入っていなければ、どちらにも当てはまる呼び方にする
 */
export function maintenanceLabels(r: Pick<Residence, "style">): { amount: string; growth: string; what: string } {
  if (r.style === "condo") return { amount: "管理費・修繕積立金（毎月）", growth: "管理費・修繕積立金の伸び率（年）", what: "管理費・修繕積立金" };
  if (r.style === "house") return { amount: "修繕の積み立て（毎月）", growth: "修繕の積み立ての伸び率（年）", what: "修繕の積み立て" };
  return { amount: "修繕・管理の費用（毎月）", growth: "修繕・管理の費用の伸び率（年）", what: "修繕・管理の費用" };
}

const STYLES = [
  { value: "house", label: "戸建て" },
  { value: "condo", label: "マンション" },
];
const STRUCTURE_FROM_STYLE = "建て方から（マンションは鉄筋コンクリート造、戸建ては木造）";

function styleField(r: Residence, k: string): FieldDef {
  const find = byId(residences, r.id);
  return {
    ...field({
      key: `${k}/style`,
      item: "residence.style",
      label: "建て方",
      // 修繕費の目安と評価の構造にだけ使う（お金の流れには効かない）ので詳細。0078
      level: "detail",
      kind: "select",
      options: STYLES,
      sideEffects: "建物の構造が空か推定なら、建て方に合わせます",
      help: "修繕費の目安と建物の構造（評価の耐用年数）の目安に使います",
      get: (w) => {
        const x = find(w.request.input.household, w) as Residence | undefined;
        const v = x?.style ?? (x?.valuation?.structure === "rc" ? "condo" : "house");
        return { value: v, ...(x?.style === undefined ? { implicit: true } : {}) };
      },
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as Residence | undefined;
          if (x === undefined) return;
          x.style = v === "condo" ? "condo" : "house";
          // 構造が入っていないか、建て方からの推定なら、建て方に合わせる（推定）
          const key = "residence.valuation/structure";
          const cur = x.valuation?.structure;
          if (cur === undefined || isAutoEstimate(stateOf(x as unknown as Obj, key))) {
            x.valuation = { ...(x.valuation ?? {}), structure: x.style === "condo" ? "rc" : "wood" };
            setState(x as unknown as Obj, key, estRow("derived", STRUCTURE_FROM_STYLE));
          }
        }),
    }),
    address: () => at(r.id, "residence.style"),
  };
}

// ---- 住宅の購入の種類（0052 の追記 2026-11-03） ----

/** 住宅の購入の種類（新築マンション・中古マンション・新築戸建て・中古戸建て）。建て方 style と購入の新築か中古か purchase.newBuild の組で持つ */
export const PURCHASE_TYPES = [
  { value: "newCondo", label: "新築マンション" },
  { value: "usedCondo", label: "中古マンション" },
  { value: "newHouse", label: "新築戸建て" },
  { value: "usedHouse", label: "中古戸建て" },
  // 注文住宅（土地を買って建てる。0115）: 土地の決済・建物の引き渡しに分けて払う。世帯には購入の土地 purchase.land を持つ（土地があれば注文住宅）
  { value: "custom", label: "注文住宅（土地を買って建てる）" },
];
type PurchaseType = "newCondo" | "usedCondo" | "newHouse" | "usedHouse" | "custom";
const typeOf = (condo: boolean, newBuild: boolean): PurchaseType => (condo ? (newBuild ? "newCondo" : "usedCondo") : newBuild ? "newHouse" : "usedHouse");

/**
 * 購入の予定の種類（読めなければ null）。種類を選んだ購入は建て方と新築か中古か。前の版の購入の予定（新築か中古かを持たない）は、
 * 建て方（無ければ FP が入れた建物の構造）と、新築か中古か（FP が入れた建った年・つながるローンの FP が確定にした控除の新築か中古か）の
 * 両方が読めるときだけ見せる（世帯は書き換えない）
 */
export function purchaseTypeOf(wh: WorkingHousehold, r: Residence): { type: PurchaseType; stored: boolean } | null {
  if (r.purchase === undefined) return null;
  if (isCustomBuild(r)) return { type: "custom", stored: true };
  const h = wh.request.input.household;
  const o = r as unknown as Obj;
  const structure = r.valuation?.structure;
  const condo = r.style !== undefined ? r.style === "condo" : structure !== undefined && !isAutoEstimate(stateOf(o, "residence.valuation/structure")) ? structure === "rc" : null;
  if (r.purchase.newBuild !== undefined && r.style !== undefined) return { type: typeOf(r.style === "condo", r.purchase.newBuild), stored: true };
  const ym = purchaseMonth(h, r);
  const built = r.valuation?.builtYear;
  const confirmed = purchaseLoans(h, r).find((d) => d.housing !== undefined && wh.assumed[`housing/debt/${d.id}/credit`] === undefined);
  const newBuild = r.purchase.newBuild ?? (built !== undefined && ym !== null ? built >= Number(ym.slice(0, 4)) - 1 : confirmed?.housing !== undefined ? confirmed.housing.newBuild : null);
  return condo === null || newBuild === null ? null : { type: typeOf(condo, newBuild), stored: false };
}

/**
 * 購入の種類を選ぶ（h をそのまま書き換える）: 建て方と新築か中古かを入れ、推定のままの値（建物の構造・諸費用・修繕費・固定資産税）を
 * 種類に合わせる。FP が入れた値は変えない
 */
function applyPurchaseType(h: Household, req: WorkingHousehold["request"], r: Residence, t: PurchaseType): void {
  if (r.purchase === undefined) return;
  const condo = t === "newCondo" || t === "usedCondo";
  const newBuild = t === "newCondo" || t === "newHouse" || t === "custom";
  const o = r as unknown as Obj;
  r.style = condo ? "condo" : "house";
  r.purchase.newBuild = newBuild;
  // 注文住宅は土地を推定で足す（土地の代金・土地の決済の時期・頭金と諸費用の内訳）。ほかの種類にしたら土地と引き渡しの前の支払いを外す（0115）
  if (t === "custom") startCustomBuild(h, r, req.input.assumptions?.realEstateValuation?.landShare);
  else if (isCustomBuild(r)) stopCustomBuild(r);
  // 建物の構造（空か推定なら建て方から）
  const skey = "residence.valuation/structure";
  if (r.valuation?.structure === undefined || isAutoEstimate(stateOf(o, skey))) {
    r.valuation = { ...(r.valuation ?? {}), structure: condo ? "rc" : "wood" };
    setState(o, skey, estRow("derived", STRUCTURE_FROM_STYLE));
  }
  // 諸費用（推定のままなら新築・中古の割合で。注文住宅は土地と建物とつなぎ融資から。customBuild.ts）
  if (t !== "custom" && isAutoEstimate(stateOf(o, "residence.purchase/costs"))) {
    r.purchase.costs = Math.round((r.purchase.price * COSTS_RATE(newBuild)) / 10000) * 10000;
    setState(o, "residence.purchase/costs", estRow("standard", costsBasis(r.purchase.costs, newBuild)));
  }
  // 修繕費・管理費（推定のままなら建て方の目安で）
  if (r.maintenance === undefined || isAutoBox(r.maintenance.monthly)) r.maintenance = { ...(r.maintenance ?? {}), monthly: MAINT_OF(condo) };
  // 固定資産税（推定のままなら、購入の種類からの推定で。0112）
  applyPropertyTaxEstimate(h, r, req.input.endYear, req.input.assumptions?.realEstateValuation?.landShare, true);
}

function purchaseTypeField(r: Residence, k: string): FieldDef {
  const find = byId(residences, r.id);
  return {
    ...field({
      key: `${k}/purchase/type`,
      item: "residence.purchase",
      label: "購入の種類",
      level: "simple",
      kind: "select",
      options: PURCHASE_TYPES,
      structural: true,
      sideEffects: "推定のままの諸費用・修繕費・固定資産税・建物の構造を、種類に合わせます。注文住宅は土地の代金と土地の決済の時期を推定で足し、ほかの種類にすると外します",
      help: "諸費用・修繕費・固定資産税の目安と、住宅ローン控除の新築か中古かに使います。中古は建物が建った年も入れます。注文住宅は、土地の決済と建物の引き渡しに分けて払う形になります",
      get: (w) => {
        const x = find(w.request.input.household, w) as Residence | undefined;
        const t = x === undefined ? null : purchaseTypeOf(w, x);
        if (t === null) return { value: null, hint: "選ぶと、諸費用・修繕費・固定資産税の目安を種類に合わせます" };
        return { value: t.type, ...(t.stored ? {} : { implicit: true }) };
      },
      set: (w, v) =>
        mutate(w, (h, req) => {
          const x = find(h, { ...w, request: req }) as Residence | undefined;
          if (x !== undefined && typeof v === "string" && PURCHASE_TYPES.some((p) => p.value === v)) applyPurchaseType(h, req, x, v as PurchaseType);
        }),
    }),
    address: () => at(r.id, "residence.purchase", ["newBuild"]),
  };
}

function ownershipFields(wh: WorkingHousehold, r: Residence, k: string): FieldDef[] {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  const spouse = h.members.find((m) => m.kind === "spouse" && m.outside === undefined);
  const find = byId(residences, r.id);
  const own = (w: WorkingHousehold) => (find(w.request.input.household, w) as Residence | undefined)?.ownership ?? [];
  const pick = (o: { member: string; share: string }[]): string => (o.length > 1 ? "shared" : (o[0]?.member ?? ""));
  // 住宅ローンを借りる人に家の持分が無い（ペアローン・連帯債務）ときの知らせと、借入の割合で分ける直し方（2026-11-05 の追記）
  const missing = debtorsWithoutShare(h, r);
  const ownerWarn = (w: WorkingHousehold): string | null => {
    const hh = w.request.input.household;
    const x = find(hh, w) as Residence | undefined;
    const miss = x === undefined ? [] : debtorsWithoutShare(hh, x);
    return miss.length === 0 ? null : `住宅ローンを借りる${miss.map((m) => memberLabel(w, m)).join("・")}に、この家の持分がありません。持分の無い人は住宅ローン控除を受けられません（今は控除0円で計算しています）。ペアローン・連帯債務なら、借入と頭金の割合などに合わせて夫婦の共有にします`;
  };
  const splitFix = (w: WorkingHousehold) => {
    const hh = w.request.input.household;
    const x = find(hh, w) as Residence | undefined;
    const shares = x === undefined ? null : sharesByLoans(hh, x);
    return shares === null ? null : { label: "借入の割合で持分を分ける", run: (w2: WorkingHousehold) => setOwnershipByLoans(w2, r.id) };
  };
  const options = [...memberOptions(wh, (m) => m.kind === "self" || (m.kind === "spouse" && m.outside === undefined)).map((o) => ({ value: o.value, label: `${o.label}が100%` })), ...(spouse !== undefined ? [{ value: "shared", label: "夫婦の共有" }] : [])];
  const fields: FieldDef[] = [
    {
      ...field({
        key: `${k}/owner`,
        item: "residence.ownership",
        label: "名義と持分",
        level: missing.length > 0 ? "simple" : "detail",
        kind: "select",
        structural: true,
        options,
        help: "評価額を名義の人の資産として数えます。住宅ローン控除の持分もここから（持分の無い人の住宅ローンは控除がありません）",
        get: (w) => ({ value: pick(own(w)), warn: ownerWarn(w), warnFix: splitFix(w) }),
        set: (w, v) =>
          mutate(w, (hh) => {
            const x = find(hh, w) as Residence | undefined;
            if (x === undefined || self === undefined) return;
            if (v === "shared" && spouse !== undefined) x.ownership = [{ member: self.id, share: "0.5" }, { member: spouse.id, share: "0.5" }];
            else if (typeof v === "string" && v !== "") x.ownership = [{ member: v, share: "1" }];
          }),
      }),
      address: () => at(r.id, "residence.ownership"),
    },
  ];
  if ((r.ownership ?? []).length > 1 && self !== undefined)
    fields.push({
      ...field({
        key: `${k}/ownerShare`,
        item: "residence.ownership",
        label: "ご本人の持分",
        level: missing.length > 0 ? "simple" : "detail",
        kind: "pct",
        min: 0,
        max: 100,
        help: "残りが配偶者の持分",
        get: (w) => ({ value: own(w).find((o) => o.member === self.id)?.share ?? "0.5" }),
        set: (w, v) =>
          mutate(w, (hh) => {
            const x = find(hh, w) as Residence | undefined;
            if (x?.ownership === undefined) return;
            const s = Math.min(1, Math.max(0, Number(v ?? "0.5")));
            for (const o of x.ownership) o.share = String(Math.round((o.member === self.id ? s : 1 - s) * 1e6) / 1e6);
          }),
      }),
      address: () => at(r.id, "residence.ownership"),
    });
  return fields;
}

/** 家の名義と持分を、その家の住宅ローンの借入額（×負担の割合）の比で分ける（ペアローン・連帯債務。2026-11-05 の追記） */
export function setOwnershipByLoans(wh: WorkingHousehold, rid: string): WorkingHousehold {
  return withProvisionalHousing(
    mutate(wh, (h) => {
      const x = (h.residences ?? []).find((y) => y.id === rid);
      const shares = x === undefined ? null : sharesByLoans(h, x);
      if (x !== undefined && shares !== null) x.ownership = shares;
    }),
  );
}

// ---- 住まい ----

function residenceGroups(wh: WorkingHousehold, r: Residence, i: number): GroupDef[] {
  const find = byId(residences, r.id);
  const k = `housing/res/${r.id}`;
  const h0 = wh.request.input.household;
  const self = h0.members.find((m) => m.kind === "self");
  const ageOf = self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
  // 住み替え（住まいが2つ以上）か家賃なしの住まいなら、住み始め・住み終わりを標準でも出す（家賃なしは、ほかの欄が少ないため）
  const free = isFree(r);
  const showPeriod = (h0.residences ?? []).length > 1 || free;
  const ml = maintenanceLabels(r);
  // 購入の予定の持ち家（「住宅の購入」の1件）は、住まいの種類の欄を出さない（購入するなら持ち家。購入をやめるときは「外す」で1件を消す。0052 の追記（2026-11-02））
  const buying = r.kind === "own" && r.purchase !== undefined;
  // 相続する家（「この家を相続する」で足した、これから持ち始める持ち家）は見出しに相続と時期を出す
  const inheritedFrom = isInheritedHome(wh, r) ? resolveTimepoint(h0, r.from) : null;
  const fields: FieldDef[] = [
    {
      ...field({
        key: `${k}/kind`,
        item: "residence.kind",
        label: "住まい",
        level: "simple",
        kind: "select",
        options: RESIDENCE_CHOICES,
        structural: true,
        get: (w) => {
          const x = find(w.request.input.household, w) as Residence | undefined;
          return { value: x === undefined ? null : isFree(x) ? "free" : x.kind };
        },
        set: (w, v) =>
          mutate(w, (h) => {
            const x = find(h, w) as Residence | undefined;
            if (x !== undefined && typeof v === "string") setKind(h, x, v);
          }),
      }),
      address: () => at(r.id, "residence.kind"),
    },
  ].filter(() => !buying);
  // 住み始め・住み終わりの仮の印（相続する家の住み始め・住み替えで前の持ち家を終えた月。印は WorkingHousehold.assumed。直すと外れる）
  // 画面の時点の部品は time.setWhen で書く（field の書き方を通らない）ので、値が変わったら印もそこで外す（段4の確かめ。打っても「推定」が残っていた）
  const marked = (f: FieldDef): FieldDef => {
    const g = field({ ...f, get: (w) => ({ ...f.get(w), assumed: w.assumed[f.key] ?? null }) });
    const time = g.time;
    if (time === undefined) return g;
    const setWhen = (w: WorkingHousehold, tp: Parameters<typeof time.setWhen>[1], how: "auto" | "this"): WorkingHousehold => {
      const next = time.setWhen(w, tp, how);
      if (next === w || w.assumed[f.key] === undefined || next.assumed[f.key] !== w.assumed[f.key] || g.get(next).value === g.get(w).value) return next;
      const { [f.key]: _gone, ...rest } = next.assumed;
      void _gone;
      return { ...next, assumed: rest };
    };
    return { ...g, time: { ...time, setWhen } };
  };
  // 購入の1件は住み始めを出さない（購入の時期〔注文住宅は建物の引き渡しの時期〕に住み始める。ずれていれば購入の時期の欄に知らせ。0052 の追記 2026-11-07）
  // 今住んでいる持ち家を買った値段から推計するときは、住み始めを「買った年月（住み始め）」として標準に出す（評価の時点がついてくる。0176）
  const base = wh.request.input.baseMonth;
  const ownNow = r.kind === "own" && !buying && isCurrentOwned(h0, r, base);
  const byPrice = ownNow && ownedValueMode(r, base) === "purchase";
  if (!buying) {
    const fromField = marked(
      timepointField({
        key: `${k}/from`,
        item: "residence.from",
        label: byPrice ? "買った年月（住み始め）" : "住み始め",
        level: showPeriod || byPrice ? "simple" : "detail",
        find,
        path: ["from"],
        mode: "ym",
        anchor: "moveIn",
        ...ageOf,
        ...(byPrice ? { help: "家を買って住み始めた年月です。買った値段をこの時点の額として、今と先の年の評価額（土地は上昇率で動かし、建物は古くなった分を減らす）と固定資産税の目安を出します" } : {}),
      }),
    );
    fields.push(
      ownNow
        ? afterWrite(fromField, (w0, w1) => {
            const x0 = find(w0.request.input.household, w0) as Residence | undefined;
            const old = x0 === undefined ? null : resolveTimepoint(w0.request.input.household, x0.from);
            return mutate(w1, (h, req) => {
              followFromMonth(h, r.id, old, req.input.baseMonth);
              // 買った年月は固定資産税の目安の元（未入力か推定のままの欄に推定を入れる。0112 の追記）
              const x = (h.residences ?? []).find((y) => y.id === r.id);
              if (x?.valuation?.value !== undefined) applyOwnedHomeTax(h, x, req.input.baseMonth, req.input.endYear, req.input.assumptions?.realEstateValuation?.landShare, true);
            });
          })
        : fromField,
    );
  }
  const toField = marked(timepointField({ key: `${k}/to`, item: "residence.to", label: "住み終わり", level: showPeriod ? "simple" : "detail", find, path: ["to"], startPath: ["from"], optional: true, nullText: "最後まで住む", ...ageOf }));
  // 住み終わりを直したら、空き家として持ち続ける不動産の持ち始めも住み終わりの翌月に合わせる
  // （画面の時点の欄は time.setWhen で書くので、afterWrite で set と両方を包む）
  fields.push(
    afterWrite(toField, (w, next) => {
        const held = (() => {
          const x = find(w.request.input.household, w) as Residence | undefined;
          return x === undefined ? undefined : heldFromHome(w.request.input.household, x);
        })();
        if (held === undefined || next === w) return next;
        return mutate(next, (h) => {
          const x = (h.residences ?? []).find((y) => y.id === r.id);
          const a = (h.accounts ?? []).find((y) => y.id === held.id);
          const end = x?.to == null ? null : resolveTimepoint(h, x.to);
          if (a === undefined || end === null) return;
          moveHeldStart(a, end);
        });
    }),
  );
  // 固定資産税・都市計画税の欄（額と伸び率）
  const taxFields: FieldDef[] =
    r.kind !== "own"
      ? []
      : [
          yenBox({
            key: `${k}/tax`,
            item: "residence.propertyTax",
            label: "固定資産税・都市計画税",
            level: "detail",
            basis: "annual",
            find,
            path: ["propertyTax", "annual"],
            // 今住んでいる持ち家は、空にしたら持ち家の評価の欄からの推定（評価額が無ければ目安のボタンの値。0112 の追記 2026-11-03）
            ...(buying
              ? {}
              : {
                  estimate: (_h: Household, w: WorkingHousehold) => ownedHomeTaxEstimate(w, r.id) ?? { value: presetNum("preset.housing.propertyTax"), basis: TAX_PRESET().estimate.basis },
                  help: "納税通知書の額（固定資産税と都市計画税の合計）を入れます。入れなければ、持ち家の評価の元（買った値段と買った年月・土地の値段・建物の構造・建った年。今の時価で入れた家は評価額）から、住宅用地の特例・新築の軽減・税率（固定資産税1.4%・都市計画税0.3%）を当てた目安を出します（推定）。評価替え（3年ごと）で建物の分が下がる段も入れます",
                }),
          }),
          {
            ...plain({
              key: `${k}/taxGrowth`,
              item: "residence.propertyTax",
              label: "固定資産税の伸び率（年）",
              level: "detail",
              kind: "pct",
              ...GROWTH_RANGE,
              find,
              path: ["propertyTax", "growth"],
              optional: true,
              fallback: "0",
              // 推定の段（新築の軽減の終わり・評価替え）があるときは、段と率の関係を書く。計算は段の額に、計算の基準の年からの年数分この率を掛ける（housing.residence）
              help: hasAutoTaxStages(h0, r)
                ? "固定資産税の推定の段（新築の軽減の終わり・評価替え）で額を動かしています。伸び率を入れると、段の額にさらに毎年この率を掛けます（評価替えの下がり方は段に入っているので、ふつうは入れません）"
                : "入れなければ変えません。建物の評価が下がる分は、「＋ 固定資産税の変化」で入れられます",
              hint: (_v, w) => {
                const x = find(w.request.input.household, w) as Residence | undefined;
                return x !== undefined && x.propertyTax?.growth === undefined && hasAutoTaxStages(w.request.input.household, x) ? "下の推定の段で動かしています（伸び率は入れなくて構いません）" : null;
              },
            }),
            address: () => at(r.id, "residence.propertyTax", ["growth"]),
          },
        ];
  if (r.kind === "rent" && !free) {
    fields.push(
      yenBox({
        key: `${k}/rent`,
        item: "residence.rent",
        label: "家賃（管理費込み）",
        level: "simple",
        basis: "monthly",
        // 住み始めが計算の基準の月より前なら、今の家賃（計算エンジンは基準の月より後の更新から変動率を当てる。housing.residence の改訂4）
        help: "今払っている家賃です。前から住んでいる家は、住み始めたときの額ではなく今の額を入れます（増減率は、これから来る更新の月から使います）",
        find,
        path: ["rent", "monthly"],
      }),
      plain({
        key: `${k}/rentGrowth`,
        item: "residence.rent",
        // 年率。計算エンジンは更新の月に、前の更新から経った年数分をまとめて上げ下げする。計算基準月より前の更新は入れた額に含まれるとみなす（housing.residence の改訂4）
        label: "家賃の増減率（年）",
        level: "detail",
        kind: "pct",
        ...GROWTH_RANGE,
        find,
        path: ["rent", "growth"],
        optional: true,
        fallback: "0",
        // 目安の統計の長い文は「?」の中へ（欄の下は空欄の意味の1行まで。0130）
        help: (() => {
          const st = rentGrowthStatistic();
          return `年あたりの率です。更新の年に、その間の年数分をまとめて上げ下げします。入れなければ変えません${st !== null ? `（目安: ${st.text}。変えないときはこれに近い計算です）` : ""}`;
        })(),
      }),
      plain({ key: `${k}/renewalFee`, item: "residence.rent", label: "更新料（家賃の何か月分）", level: "detail", kind: "decimal", suffix: "か月分", find, path: ["rent", "renewalFee"], optional: true, fallback: "0" }),
      { ...plain({ key: `${k}/renewalEvery`, item: "residence.rent", label: "更新の間隔", level: "detail", kind: "int", suffix: "か月ごと", min: 1, max: 120, find, path: ["rent", "renewalEveryMonths"], optional: true, fallback: 24 }), address: () => at(r.id, "residence.rent", ["renewalEveryMonths"]) },
    );
  } else if (r.kind === "own") {
    fields.push(
      // 今住んでいる持ち家は、買った値段（合計・うち土地・うち建物）を標準に出す（評価額は推計。0176）
      ...(byPrice ? ownedPriceFields(wh, r, k) : []),
      // 購入の予定の持ち家は、建て方を購入の種類で決める（欄を重ねない。0052 の追記 2026-11-03）
      ...(buying ? [] : [startsOwnedHomeTax(styleField(r, k), r.id)]),
      yenBox({
        key: `${k}/maint`,
        item: "residence.maintenance",
        label: ml.amount,
        level: "simple",
        basis: "monthly",
        find,
        path: ["maintenance", "monthly"],
        help:
          r.style === "condo"
            ? "管理組合に払う管理費と修繕積立金の合計です"
            : r.style === "house"
              ? "将来の修繕のために毎月積み立てておく額です"
              : // 購入の1件には建て方の欄が無い（購入の種類で決まる）
                buying
                ? "マンションなら管理費と修繕積立金の合計、戸建てなら将来の修繕のための毎月の積み立てです（購入の種類を選ぶと、呼び方と目安が変わります）"
                : "マンションなら管理費と修繕積立金の合計、戸建てなら将来の修繕のための毎月の積み立てです（建て方は「詳細」で選べます）",
      }),
      plain({ key: `${k}/maintGrowth`, item: "residence.maintenance", label: ml.growth, level: "detail", kind: "pct", ...GROWTH_RANGE, find, path: ["maintenance", "growth"], optional: true, help: "入れなければ変えません。外壁・屋根などの大きな修繕は、下の「出るお金」の修繕・リフォームの行で入れます" }),
      ...ownershipFields(wh, r, k),
    );
    // 固定資産税の欄: 今住んでいる持ち家は「固定資産税・都市計画税」の中枠に分ける（詳細の欄が多く、何の欄か分かりにくかった。0176）。購入の予定は今のまま
    if (!ownNow) fields.splice(fields.findIndex((f) => f.key === `${k}/maint`), 0, ...taxFields);
  }
  // 家賃・修繕費・固定資産税の段階と例外の年（0040。詳細）
  const staged = (part: "rent" | "maintenance" | "propertyTax", what: string, basis: StagedSpec["basis"], value: (x: Residence) => number | null, yearly = false): GroupDef[] =>
    stagedGroups(wh, {
      key: `${k}/${part}`,
      find,
      target: { object: r.id },
      stages: { path: [part, "stages"], item: `residence.${part}`, at: ["stages"] },
      exceptions: { path: [part, "exceptions"], item: `residence.${part}`, at: ["exceptions"] },
      basis,
      what,
      base: (h) => {
        const x = (h.residences ?? []).find((y) => y.id === r.id);
        return x === undefined ? null : value(x);
      },
      ...ageOf,
      ...(yearly ? { yearly: true } : {}),
      // 固定資産税の推定の段を外したら覚える（入れ直しで足し直さない。0112）
      ...(part === "propertyTax" ? { onRemoveStage: (h: Household, sid: string) => rememberDroppedTaxStage(h, r.id, sid), autoWhat: r.purchase?.newBuild === false ? "3年ごとの評価替え" : "新築の軽減の終わり・3年ごとの評価替え" } : {}),
      flow: "out",
      // 額の変化は、その額の欄（と変動率の欄）のすぐ後に並べる
      // 今住んでいる持ち家の固定資産税の変化は「固定資産税・都市計画税」の中枠の中に（0176）
      place: { group: ownNow && part === "propertyTax" ? `${k}/taxes` : ownNow && part === "maintenance" ? `${k}/home` : k, after: `${k}/${part === "rent" ? "rentGrowth" : part === "maintenance" ? "maintGrowth" : "taxGrowth"}` },
    });
  const stagedParts = r.kind === "rent" ? (r.rent !== undefined && !free ? [["rent", "家賃"]] : []) : [...(r.maintenance !== undefined ? [["maintenance", ml.what]] : []), ...(r.propertyTax !== undefined ? [["propertyTax", "固定資産税"]] : [])];
  const badges = stagedParts.map(([part, what]) => {
    return stagedBadge(r as unknown as Record<string, unknown>, [part as string, "stages"], [part as string, "exceptions"], what as string);
  }).filter((x) => x !== null);
  const actions: ActionDef[] = [
    {
      ...removeAction(`${k}/remove`, "外す", "simple", () => undefined),
      // 住み替えの購入を外すときは、その購入のために住み終わりにした今の住まいを戻す（仮の印のままの物だけ。0161）
      run: (w) => {
        let drop: string[] = [];
        const next = mutate(w, (h) => {
          const x = (h.residences ?? []).find((y) => y.id === r.id);
          if (x !== undefined) drop = undoMoveOut(h, w.assumed, x);
          h.residences = (h.residences ?? []).filter((y) => y.id !== r.id);
        });
        return drop.length === 0 ? next : { ...next, assumed: Object.fromEntries(Object.entries(next.assumed).filter(([key]) => !drop.includes(key))) };
      },
    },
  ];
  if (free && r.to === null) actions.unshift({ key: `${k}/inherit`, label: "この家を相続する", help: "住まいを持ち家に切り替えます", level: "simple", run: (w) => inheritHome(w, r.id) });
  // 住宅ローンを借りる人に家の持分が無い（ペアローンなど）: 借入の割合で持分を分ける（2026-11-05 の追記）
  if (r.kind === "own" && debtorsWithoutShare(wh.request.input.household, r).length > 0 && sharesByLoans(wh.request.input.household, r) !== null)
    actions.unshift({ key: `${k}/shareByLoans`, label: "借入の割合で持分を分ける", help: "この家の住宅ローンの借入額（連帯債務は負担の割合）の比で、家の名義と持分を夫婦の共有にします。頭金の割合も入れるなら「名義と持分」のご本人の持分を直してください", level: "simple", run: (w) => setOwnershipByLoans(w, r.id) });
  // 購入の予定の持ち家は「住宅の購入」の1件（購入の欄を頭に、住まいの欄をその後に。別の住まいを足したように見せない）
  if (buying) fields.unshift(...purchaseFields(wh, r, k));
  // 今住んでいる持ち家の詳細の欄（建て方・住み終わり・修繕の伸び率・名義）は中枠「建て方・名義など」に分ける（開いた欄が中枠ごとに並ぶ。0176）
  const homeDetail = ownNow ? fields.filter((f) => f.level !== "simple") : [];
  if (ownNow) fields.splice(0, fields.length, ...fields.filter((f) => f.level === "simple"));
  const groups: GroupDef[] = [
    {
      key: k,
      title: buying ? "住宅の購入" : `住まい ${i + 1}（${free ? "家賃なし" : r.kind === "rent" ? "賃貸" : inheritedFrom !== null ? `相続する家・${formatYearMonth(inheritedFrom)}から` : "持ち家"}）`,
      ...(badges.length > 0
        ? { note: `${badges.join("、")}（「詳細」で直せます）` }
        : free
          ? { note: "家賃はかかりません。住んでいる家を相続するなら、「この家を相続する」で持ち家に切り替えます（貯蓄・運用の不動産には入れません）。住まずに持つ実家（空き家）・土地は、貯蓄・運用の「貸していない不動産」で入れます" }
          : {}),
      level: "simple",
      // 「▸ 続きを見る」の文（0078 の追記 2026-11-01）: 住まいの種類で開く欄が違う
      moreLabel: buying ? "名義・固定資産税などを入れる" : free ? "住む期間を入れる" : r.kind === "rent" ? "更新料・家賃の変化を入れる" : ownNow ? "固定資産税・名義などを入れる" : "評価額・固定資産税などを入れる",
      fields,
      actions,
    },
  ];
  if (r.kind === "rent" && r.rent !== undefined && !free) groups.push(...staged("rent", "家賃", "monthly", (x) => x.rent?.monthly.value ?? null));
  if (r.kind === "own") {
    if (r.maintenance !== undefined) groups.push(...staged("maintenance", ml.what, "monthly", (x) => x.maintenance?.monthly.value ?? null));
    // 今住んでいる持ち家の固定資産税は中枠に分ける（何のための欄か分かる見出しと1行の説明。0176）
    if (ownNow && homeDetail.length > 0)
      groups.push({
        key: `${k}/home`,
        title: "建て方・名義など",
        summary: "マンションか戸建て・住み終わり・修繕の費用の変わり方・家の名義と持分",
        level: "detail",
        band: true,
        fields: homeDetail,
        actions: [],
      });
    if (ownNow)
      groups.push({
        key: `${k}/taxes`,
        title: "固定資産税・都市計画税",
        summary: "納税通知書の額。入れなければ持ち家の評価の元から目安（推定）",
        note: "毎年の固定資産税と都市計画税の合計です。納税通知書の額が分かれば入れます。入れなければ、買った値段（土地と建物）・買った年月・建物の構造・建った年から、固定資産税の評価額の目安（土地は価格の7割・建物は価格の6割）に住宅用地の特例・新築の軽減・税率を当てた目安を出し、3年ごとの評価替えで建物の分が下がる段も入れます",
        level: "detail",
        band: true,
        fields: taxFields,
        actions: [],
      });
    if (r.propertyTax !== undefined) groups.push(...staged("propertyTax", "固定資産税", "annual", (x) => x.propertyTax?.annual.value ?? null, true));
  }
  if (buying) groups.push(...customPaymentGroups(wh, r, k), ...giftGroups(wh, r, k));
  // 住宅ローンを使う購入は、この家の住宅ローンの欄を住宅の購入の中に続けて出す（「住宅ローン」の区画には出さない。0175）
  if (buying) {
    const loans = purchaseLoans(h0, r);
    groups.push(...loans.flatMap((d, j) => loanGroups(wh, d, j, `この家の住宅ローン${loans.length > 1 ? ` ${j + 1}` : ""}`)));
  }
  if (r.kind === "own") groups.push(...valuationGroups(wh, r, k));
  // 現金で買う形の購入は、どの欄・ボタンから合計（物件の価格・土地と建物の代金・購入の種類）が変わっても、頭金を合計についていかせる（0175）
  return buying ? groups.map((g) => (g.key === k || g.key.startsWith(`${k}/`) ? keepCashGroup(g, r.id) : g)) : groups;
}

/**
 * 現金で買う形（purchaseFunding が cash）だった購入で、書き込みの後に住宅ローンがつながらず、頭金が物件の価格（注文住宅は合計）と違えば、
 * 頭金を合計に合わせる（現金で買うなら合計の全額を払う。合計が変わって「まだ選んでいない」に戻らないように。0175）
 */
export function keepCash(before: WorkingHousehold, after: WorkingHousehold, rid: string): WorkingHousehold {
  if (after === before) return after;
  const hb = before.request.input.household;
  const rb = (hb.residences ?? []).find((y) => y.id === rid);
  if (rb === undefined || purchaseFunding(hb, rb) !== "cash") return after;
  const ha = after.request.input.household;
  const ra = (ha.residences ?? []).find((y) => y.id === rid);
  if (ra?.purchase === undefined || purchaseLoans(ha, ra).length > 0 || ra.purchase.downPayment === ra.purchase.price) return after;
  return mutate(after, (h) => {
    const x = (h.residences ?? []).find((y) => y.id === rid);
    if (x?.purchase !== undefined) x.purchase.downPayment = x.purchase.price;
  });
}

function keepCashGroup(g: GroupDef, rid: string): GroupDef {
  const tidy = (b: WorkingHousehold, a: WorkingHousehold) => keepCash(b, a, rid);
  return {
    ...g,
    fields: g.fields.map((f) => afterWrite(f, tidy)),
    ...(g.openFields !== undefined ? { openFields: g.openFields.map((f) => afterWrite(f, tidy)) } : {}),
    actions: g.actions.map((a) => ({ ...a, run: (w: WorkingHousehold) => tidy(w, a.run(w)) })),
  };
}

/**
 * この家を相続する（0052。家賃なしの住まいに住んでいて、その家を相続する）: 家賃なしの住まいを相続の時点で終え、同じ家の持ち家を翌月から足す。
 * 時点は、相続・贈与のカードの受け取る相続の行があればその月、無ければ10年後（直してください）。評価額は未入力（相続の見込みの額を入れる）、
 * 税・修繕は目安のボタンの値。貯蓄・運用に別の不動産は作らない（二重にしない）。
 * 建物が建った年は、相続する家の築年数の目安（計算の基準の年に築30年。事務所の推定の値）で推定に入れる（空欄だと相続の年に新築とみなして、
 * 建物の評価と固定資産税の目安が新築の家の額になるため。2026-11-05 の追記）
 */
export function inheritHome(wh: WorkingHousehold, id: string): WorkingHousehold {
  let nextId: string | null = null;
  let linked = false;
  const out = mutate(wh, (h, req) => {
    const r = (h.residences ?? []).find((x) => x.id === id);
    const self = h.members.find((m) => m.kind === "self");
    if (r === undefined || self === undefined) return;
    const flow = (h.incomeFlows ?? []).find((f) => f.kind === "inheritance");
    const when = (flow !== undefined ? resolveTimepoint(h, flow.from) : null) ?? addMonths(req.input.baseMonth, 120);
    r.to = { at: addMonths(when, -1) };
    const baseYear = Number(req.input.baseMonth.slice(0, 4));
    const built = baseYear - INHERITED_AGE();
    const next: Residence = { id: newId(), kind: "own", from: { at: when }, to: null, propertyTax: { annual: TAX_PRESET() }, maintenance: { monthly: MAINT_PRESET() }, ownership: [{ member: self.id, share: "1" }], valuation: { asOf: when, builtYear: built } };
    setState(next as unknown as Obj, "residence.valuation/builtYear", estRow("standard", inheritedBuiltBasis(built)));
    (h.residences ??= []).push(next);
    nextId = next.id;
    linked = flow !== undefined && resolveTimepoint(h, flow.from) !== null;
  });
  // 住み始めは推定の印（受け取る相続の行があればその月に合わせ続ける。housingFollow.ts の followInheritedHome）
  return nextId === null ? out : { ...out, assumed: { ...out.assumed, [fromKey(nextId)]: inheritFromAssumed(linked) } };
}

// ---- 購入の予定と住宅資金の援助 ----

/** 購入の予定の欄（「住宅の購入」の1件の頭に並べる。欄のキーは前の版の購入のまとまりと同じ <住まい>/purchase/…） */
/**
 * 住宅購入の予定に住宅ローンがつながっていないときの、物件の価格−頭金（払い方が入っていない額。0161）。つながるローンがあるか、0円以下なら null。
 * 計算は購入の月に頭金と諸費用だけを払い、残りは住宅ローンで払う前提（ローンが無いと、残りは借入にも預金からの払いにも入らない）。
 * つながるローンの借入額の合計が足りないときは、ローンの借入額の欄の知らせ（principalMismatch）
 */
export function unfundedPurchase(h: Household, r: Residence): number | null {
  if (r.kind !== "own" || r.purchase === undefined || purchaseLoans(h, r).length > 0) return null;
  const left = r.purchase.price - (r.purchase.downPayment ?? 0);
  return left > 0 ? left : null;
}

/**
 * 購入の予定にローンが無いときの知らせ（物件の価格の欄の warn と、確かめの一覧の確かめの注意。無ければ null）。
 * 「＋ 住宅ローン」は最後に足した購入の予定とつなぐので、ボタンはその購入が最後のときだけ添える
 */
export function unfundedPurchaseNotice(wh: WorkingHousehold, rid: string): { fieldKey: string; detail: string; fix: { label: string; run: (w: WorkingHousehold) => WorkingHousehold } | null } | null {
  const h = wh.request.input.household;
  const r = (h.residences ?? []).find((y) => y.id === rid);
  const left = r === undefined ? null : unfundedPurchase(h, r);
  if (r === undefined || left === null) return null;
  // 「どう買うか」（現金で買う・住宅ローンを使う）をまだ選んでいない。選ぶのはその欄で（0175。前の「＋ 住宅ローンを足す」のボタンは欄の選び方に替えた）
  return { fieldKey: fundingKey(rid), detail: unfundedPurchaseText(left, isCustomBuild(r)), fix: null };
}

/** 購入の予定にローンが無いときの知らせの文（「どう買うか」の欄の未入力の印の文。0175） */
export const unfundedPurchaseText = (left: number, custom: boolean): string =>
  `未入力（${custom ? "土地と建物の合計" : "物件の価格"}−頭金（${manOf(left)}）の払い方が入っていません。借入にも預金からの払いにも入らず、計算に入っていません。「どう買うか」で、現金で買うか住宅ローンを使うかを選んでください）`;

// ---- どう買うか（現金で買う・住宅ローンを使う。0175） ----

const fundingKey = (rid: string): string => `housing/res/${rid}/purchase/funding`;

/**
 * 住宅の購入の「どう買うか」（0175）。世帯ファイルには持たず、今の形から読む（形式の版を変えない）:
 * つながる住宅ローンがあれば住宅ローンを使う、ローンが無く頭金が物件の価格（注文住宅は合計）以上なら現金で買う、どちらでもなければまだ選んでいない（null）
 */
export function purchaseFunding(h: Household, r: Residence): "cash" | "loan" | null {
  if (r.kind !== "own" || r.purchase === undefined) return null;
  if (purchaseLoans(h, r).length > 0) return "loan";
  return r.purchase.price - (r.purchase.downPayment ?? 0) <= 0 ? "cash" : null;
}

const FUNDING_OPTIONS = [
  { value: "cash", label: "現金で買う（住宅ローンなし）" },
  { value: "loan", label: "住宅ローンを使う" },
];

/** 現金で買う: この家の住宅ローン（つながるローン）を外し、頭金を物件の価格と同じにする（物件の価格と諸費用を購入の月に手元のお金から払う） */
function buyWithCash(wh: WorkingHousehold, rid: string): WorkingHousehold {
  let entries: string[] = [];
  const next = mutate(wh, (h) => {
    const r = (h.residences ?? []).find((y) => y.id === rid);
    if (r?.purchase === undefined) return;
    const loans = purchaseLoans(h, r);
    const gone = new Set(loans.map((d) => d.id));
    for (const d of loans) dropProvisionalEvent(h, d, wh);
    h.debts = (h.debts ?? []).filter((d) => !gone.has(d.id));
    for (const d of h.debts) if (d.pairWith !== undefined && gone.has(d.pairWith)) delete d.pairWith;
    if (h.debts.length === 0) delete h.debts;
    entries = [...gone];
    r.purchase.downPayment = r.purchase.price;
    // 頭金は推定の目安でなく、現金で払う額（物件の価格に合わせる。推定の行は外す）
    setState(r as unknown as Obj, "residence.purchase/downPayment", undefined);
  });
  return withProvisionalHousing(entries.reduce((w, id) => withEntry(w, id, undefined), next));
}

/** 住宅ローンを使う: 頭金が物件の価格（現金で買う形）なら目安に戻し、物件の価格−頭金を借りる住宅ローンをこの購入とつないで足す */
function buyWithLoan(wh: WorkingHousehold, rid: string): WorkingHousehold {
  const h0 = wh.request.input.household;
  const r0 = (h0.residences ?? []).find((y) => y.id === rid);
  if (r0 === undefined || purchaseLoans(h0, r0).length > 0) return wh;
  const down = mutate(wh, (h) => {
    const r = (h.residences ?? []).find((y) => y.id === rid);
    if (r?.purchase === undefined || r.purchase.price - (r.purchase.downPayment ?? 0) > 0) return;
    setState(r as unknown as Obj, "residence.purchase/downPayment", estRow("derived", downBasis(0)));
    refreshDownEstimate(r);
  });
  return withProvisionalHousing(newMortgage(down, undefined, rid));
}

/** 「どう買うか」の欄（物件の価格の次。0175） */
function fundingField(r: Residence, k: string): FieldDef {
  const custom = isCustomBuild(r);
  return field({
    key: `${k}/purchase/funding`,
    item: "residence.purchase",
    label: "どう買うか",
    level: "simple",
    kind: "select",
    options: FUNDING_OPTIONS,
    structural: true,
    help: `現金で買うなら、${custom ? "土地と建物の合計" : "物件の価格"}と諸費用を購入の月に手元のお金から払います（頭金とローンの欄は出しません）。住宅ローンを使うなら、頭金と、この家の住宅ローンの欄を続けて出します`,
    sideEffects: "現金で買うにすると、この家の住宅ローンを外します。住宅ローンを使うにすると、物件の価格−頭金を借りる住宅ローンを足します",
    get: (w) => {
      const h = w.request.input.household;
      const x = (h.residences ?? []).find((y) => y.id === r.id);
      const v = x === undefined ? null : purchaseFunding(h, x);
      const left = x === undefined ? null : unfundedPurchase(h, x);
      if (v !== null || left === null) return { value: v };
      // 未入力の印と、欄の下の知らせ（印だけでは理由が見えない。通しの入力の確かめ）
      const text = unfundedPurchaseText(left, x !== undefined && isCustomBuild(x));
      return { value: v, estimated: text, warn: text.replace(/^未入力（/, "").replace(/）$/, "") };
    },
    set: (w, v) => (v === "cash" ? buyWithCash(w, r.id) : v === "loan" ? buyWithLoan(w, r.id) : w),
  });
}

function purchaseFields(wh: WorkingHousehold, r: Residence, k: string): FieldDef[] {
  const find = byId(residences, r.id);
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  const ageOf = self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
  const kp = `${k}/purchase`;
  // 注文住宅（土地を買って建てる。0115）: 合計の額と引き渡しの時期だけでも動く（土地の代金・土地の決済の時期・内訳は推定）
  const custom = isCustomBuild(r);
  const price = plain({
    key: `${kp}/price`,
    item: "residence.purchase",
    label: custom ? "土地と建物の合計" : "物件の価格",
    level: "simple",
    kind: "yen",
    basis: "once",
    find,
    path: ["purchase", "price"],
    help: custom
      ? "土地の代金と建物の代金（請負の工事の代金）の合計です。土地の代金を入れていなければ、合計に合わせて目安を出し直します"
      : "頭金・諸費用を入れていなければ、価格に合わせて目安を出し直します",
    // 頭金・諸費用が推定（出どころ auto）なら、価格に合わせて入れ直す（注文住宅の諸費用は土地と建物とつなぎ融資から入れ直す。customBuild.ts）。
    // 現金で買う形（0175）の頭金は、住宅の購入の欄すべてを包む keepCash で合わせる
    after: (_h, target, v) => {
      const res = target as unknown as Residence & Obj;
      if (res.purchase === undefined || typeof v !== "number") return;
      refreshDownEstimate(res);
      if (!isCustomBuild(res) && isAutoEstimate(stateOf(res, "residence.purchase/costs"))) {
        const nb = res.purchase.newBuild;
        res.purchase.costs = Math.round((v * COSTS_RATE(nb)) / 10000) * 10000;
        setState(res, "residence.purchase/costs", estRow("standard", costsBasis(res.purchase.costs, nb)));
      }
    },
  });
  // 購入にローンが無いと、物件の価格−頭金は払いにも借入にも入らない（0161）。知らせは「どう買うか」の欄の未入力の印で出す（0175）
  const cash = purchaseFunding(wh.request.input.household, r) === "cash";
  const used = purchaseTypeOf(wh, r)?.type.startsWith("used") === true;
  // 長期優良住宅か（固定資産税の新築の軽減の年数。0112）: つながる住宅ローンに控除の条件があれば、控除の住宅の種類で選ぶので出さない
  const h0 = wh.request.input.household;
  const viaCredit = purchaseLoans(h0, r).some((d) => d.housing !== undefined);
  const notes = custom ? customBuildNotes(h0, r) : [];
  return [
    purchaseTypeField(r, k),
    purchaseAtField(wh, r, kp, custom, ageOf),
    price,
    fundingField(r, k),
    ...(custom ? customLandFields(wh, r, k, ageOf) : []),
    // 中古は建物が建った年を標準に出す（評価の建物の目減りと固定資産税の目安に使う。新築は購入の年に完成とみなすので「持ち家の評価」の詳細の欄）
    ...(used ? [builtYearField(wh, r, k)] : []),
    // 頭金・諸費用は空にできない（計算エンジンの入力で必須。空にすると欄を消して、計算が止まっていた）。無いときは 0 を入れる。
    // 現金で買う形では頭金の欄を出さない（頭金＝物件の価格。0175）
    ...(cash ? [] : [plain({
      key: `${kp}/down`,
      item: "residence.purchase",
      label: custom ? "頭金（合計）" : "頭金",
      level: "simple",
      kind: "yen",
      basis: "once",
      find,
      path: ["purchase", "downPayment"],
      help: custom ? "自己資金で払う額の合計です。土地の決済・建物の代金の支払い（「詳細」）で払う分の残りを、引き渡しの月に払います。無ければ 0 を入れます" : "頭金が無ければ 0 を入れます",
    })]),
    ...(custom && !cash
      ? [
          {
            ...plain({ key: `${kp}/land/down`, item: "residence.purchase", label: "頭金のうち土地の決済で払う額", level: "detail", kind: "yen", basis: "once", find, path: ["purchase", "land", "downPayment"], optional: true, fallback: 0, help: "入れなければ、頭金のうち土地の代金までを土地の決済で払うとみなします" }),
            address: () => at(r.id, "residence.purchase", ["land", "downPayment"]),
          },
        ]
      : []),
    // 諸費用は購入の月の出費として大きいので標準に出す（物件の価格の数%。「▸ 詳しく」に隠さない）
    plain({
      key: `${kp}/costs`,
      item: "residence.purchase",
      label: custom ? "諸費用（合計）" : "諸費用",
      level: "simple",
      kind: "yen",
      basis: "once",
      find,
      path: ["purchase", "costs"],
      help: custom
        ? "土地の諸費用（仲介手数料・登記など）と建物の諸費用（登記・ローンの手数料・火災保険など）、つなぎ融資の利息と手数料の合計です。土地の諸費用は土地の決済の月、残りは引き渡しの月に払います。無ければ 0 を入れます"
        : "登記・ローンの手数料・保険料・税など。目安は新築で価格の3〜7%、中古で6〜10%。無ければ 0 を入れます",
      ...(notes.length > 0 ? { hint: () => notes.join("。") } : {}),
    }),
    ...(custom
      ? [
          {
            ...plain({ key: `${kp}/land/costs`, item: "residence.purchase", label: "諸費用のうち土地の決済で払う額", level: "detail", kind: "yen", basis: "once", find, path: ["purchase", "land", "costs"], optional: true, fallback: 0, help: "仲介手数料・所有権の移転の登記・印紙・固定資産税の精算など。目安は土地の代金の5〜8%" }),
            address: () => at(r.id, "residence.purchase", ["land", "costs"]),
          },
        ]
      : []),
    // 土地をいくらで買うか（割合でなく金額で。詳細。注文住宅は「土地の代金」の欄。0176）
    ...(custom ? [] : [purchaseLandField(wh, r, k)]),
    ...(viaCredit
      ? []
      : [
          plain({
            key: `${kp}/longLife`,
            item: "residence.purchase",
            label: "長期優良住宅（認定）",
            level: "detail",
            kind: "bool",
            find,
            path: ["purchase", "longLife"],
            optional: true,
            fallback: false,
            help: "認定長期優良住宅なら、固定資産税の新築の軽減が長くなります（戸建て5年・マンション7年）。住宅ローンを組むときは、住宅ローン控除の住宅の種類で選びます",
          }),
        ]),
  ];
}

/** 購入の予定の「うち土地の値段」（詳細。世帯ファイルには土地の割合＝土地÷物件の価格で書く。0176） */
function purchaseLandField(wh: WorkingHousehold, r: Residence, k: string): FieldDef {
  const find = byId(residences, r.id);
  const shareSetting = (w: WorkingHousehold): string => w.request.input.assumptions?.realEstateValuation?.landShare ?? VALUATION_DEFAULTS.landShare;
  return {
    ...field({
      key: `${k}/purchase/landPrice`,
      item: "residence.valuation",
      label: "うち土地の値段",
      level: "detail",
      kind: "yen",
      basis: "once",
      optional: true,
      help: "物件の価格のうち、土地をいくらで買うかです（売買契約書・重要事項説明書の内訳など）。土地は前提条件の上昇率で動かし、建物（残り）は耐用年数で古くなった分を減らします。固定資産税の目安にも使います。分からなければ空欄のまま、目安の割合で分けます",
      get: (w) => {
        const x = find(w.request.input.household, w) as Residence | undefined;
        const price = x?.purchase?.price;
        if (x === undefined || price === undefined) return { value: null };
        if (x.valuation?.landShare !== undefined) return { value: landOfShare(price, x.valuation.landShare) };
        const est = landOfShare(price, shareSetting(w));
        return { value: null, hint: `空欄なら物件の価格の${String(Math.round(Number(shareSetting(w)) * 100))}%（約${formatYen(Math.round(est / 10000) * 10000, "man")}万円）で計算します` };
      },
      set: (w, v) =>
        mutate(w, (h, req) => {
          const x = (h.residences ?? []).find((y) => y.id === r.id);
          if (x?.purchase === undefined) return;
          if (v === null || v === "") {
            if (x.valuation !== undefined) {
              const { landShare: _drop, ...rest } = x.valuation;
              void _drop;
              if (Object.keys(rest).length === 0) delete x.valuation;
              else x.valuation = rest;
            }
          } else if (typeof v === "number" && x.purchase.price > 0) {
            x.valuation = { ...(x.valuation ?? {}), landShare: shareOfLand(Math.min(Math.max(0, v), x.purchase.price), x.purchase.price) };
          } else return;
          // 推定のままの固定資産税は、土地の値段に合わせて入れ直す（0112）
          applyPropertyTaxEstimate(h, x, req.input.endYear, req.input.assumptions?.realEstateValuation?.landShare);
        }),
    }),
    address: () => at(r.id, "residence.valuation", ["landShare"]),
  };
}

/**
 * 購入の時期（注文住宅は建物の引き渡しの時期）。直したら、前の購入の月と同じだった物（この家の住み始め・前の住まいの住み終わり・購入の住宅ローンの
 * 借入の年月と金利の段・控除の入居）を一緒に動かす（0052 の追記 2026-11-07）。住み始めがずれている前の版の世帯には、知らせと「購入の時期に合わせる」
 */
function purchaseAtField(wh: WorkingHousehold, r: Residence, kp: string, custom: boolean, ageOf: { ageOf?: (h: Household) => Household["members"][number] | undefined }): FieldDef {
  const find = byId(residences, r.id);
  const inner = timepointField({
    key: `${kp}/at`,
    item: "residence.purchase",
    label: custom ? "建物の引き渡しの時期" : "購入の時期",
    level: "simple",
    find,
    path: ["purchase", "at"],
    mode: "ym",
    ...ageOf,
    help: custom
      ? "建物が完成して引き渡しを受け、住宅ローン（本融資）を借りる月です。残りの頭金と諸費用をこの月に払います。この月から住みます"
      : "この月から住みます。直すと、前の住まいの住み終わり・この家の住宅ローンの借入の年月・控除の入居も一緒に動きます",
    warn: (w) => {
      const x = find(w.request.input.household, w) as Residence | undefined;
      return x === undefined ? null : purchaseFromGap(w.request.input.household, x);
    },
  });
  const month = (w: WorkingHousehold): string | null => {
    const h = w.request.input.household;
    const x = (h.residences ?? []).find((y) => y.id === r.id);
    return x === undefined ? null : purchaseMonth(h, x);
  };
  // 画面の時点の欄は time.setWhen で書く（set を通らない）ので、afterWrite で両方を包む（段4の確かめで、画面のキー入力では連動が抜けていた）
  const follow = afterWrite(
    field({
      ...inner,
      sideEffects: "前の住まいの住み終わり・この家の住宅ローンの借入の年月と金利の段・控除の入居も一緒に動かします",
      get: (w) => {
        const st = inner.get(w);
        const x = find(w.request.input.household, w) as Residence | undefined;
        const gap = x === undefined ? null : purchaseFromGap(w.request.input.household, x);
        return gap === null ? st : { ...st, warnFix: { label: "購入の時期に合わせる", run: (w2: WorkingHousehold) => mutate(w2, (h) => alignFromToPurchase(h, r.id)) } };
      },
    }),
    (w0, w1) => {
      const old = month(w0);
      const now = month(w1);
      return old === null || now === null || now === old ? w1 : withProvisionalHousing(mutate(w1, (h) => followPurchaseMonth(h, r.id, old, now)));
    },
  );
  return { ...follow, address: () => at(r.id, "residence.purchase", ["at"]) };
}

/** 注文住宅の土地の欄（土地の決済の時期・土地の代金〔標準〕、建物の代金〔詳細。合計−土地の代金を直す〕。0115） */
function customLandFields(wh: WorkingHousehold, r: Residence, k: string, ageOf: { ageOf?: (h: Household) => Household["members"][number] | undefined }): FieldDef[] {
  const find = byId(residences, r.id);
  const kp = `${k}/purchase`;
  return [
    {
      ...timepointField({
        key: `${kp}/land/at`,
        item: "residence.purchase",
        label: "土地の決済の時期",
        level: "simple",
        find,
        path: ["purchase", "land", "at"],
        mode: "ym",
        ...ageOf,
        help: "土地の代金を払って引き渡しを受ける月です。土地の頭金・諸費用をこの月に払い、土地をこの月から資産に数えます",
      }),
      address: () => at(r.id, "residence.purchase", ["land", "at"]),
    },
    {
      ...plain({ key: `${kp}/land/price`, item: "residence.purchase", label: "土地の代金", level: "simple", kind: "yen", basis: "once", find, path: ["purchase", "land", "price"], help: "土地と建物の合計のうちの土地の分です。入れなければ、合計に土地の割合の目安（全国の土地付注文住宅で約3割）を掛けます" }),
      address: () => at(r.id, "residence.purchase", ["land", "price"]),
    },
    {
      ...field({
        key: `${kp}/building`,
        item: "residence.purchase",
        label: "建物の代金",
        level: "detail",
        kind: "yen",
        basis: "once",
        help: "請負の工事の代金（本体・付帯工事）です。直すと、土地と建物の合計を土地の代金＋建物の代金にします",
        get: (w) => {
          const x = find(w.request.input.household, w) as Residence | undefined;
          return { value: x === undefined ? null : buildingPriceOf(x) };
        },
        set: (w, v) =>
          mutate(w, (h) => {
            const x = find(h, w) as Residence | undefined;
            if (x?.purchase?.land === undefined || typeof v !== "number") return;
            // 土地と建物を分けて入れたので、土地の代金は推定のまま合計についていかないようにする（今の額のまま FP の値にする）
            setState(x as unknown as Obj, CUSTOM_KEYS.price, undefined);
            x.purchase.price = x.purchase.land.price + Math.max(0, v);
          }),
      }),
      address: () => at(r.id, "residence.purchase", ["price"]),
    },
  ];
}

/** 引き渡しの前に頭金から払う建物の代金（契約金・着工金・中間金。注文住宅の詳細。0115）と、土地の分のローンのボタン */
const PAYMENT_KINDS = [
  { value: "contract", label: "契約金" },
  { value: "start", label: "着工金" },
  { value: "interim", label: "中間金" },
  { value: "other", label: "その他" },
];
function customPaymentGroups(wh: WorkingHousehold, r: Residence, k: string): GroupDef[] {
  if (!isCustomBuild(r)) return [];
  const find = byId(residences, r.id);
  const kp = `${k}/purchase`;
  const h0 = wh.request.input.household;
  const groups: GroupDef[] = (r.purchase?.payments ?? []).map((pmt, j) => {
    const findP: Finder = (h, w) => ((find(h, w) as Residence | undefined)?.purchase?.payments ?? []).find((x) => x.id === pmt.id) as unknown as Record<string, unknown> | undefined;
    const kg = `${kp}/payment/${pmt.id}`;
    return {
      key: kg,
      title: `建物の代金の支払い ${j + 1}（頭金から）`,
      level: "detail",
      fields: [
        { ...plain({ key: `${kg}/kind`, item: "residence.purchase", label: "支払い", level: "detail", kind: "select", options: PAYMENT_KINDS, find: findP, path: ["kind"], optional: true, fallback: "other" }), address: () => at(r.id, "residence.purchase", ["payments", pmt.id, "kind"]) },
        { ...timepointField({ key: `${kg}/at`, item: "residence.purchase", label: "払う時期", level: "detail", find: findP, path: ["at"], mode: "ym" }), address: () => at(r.id, "residence.purchase", ["payments", pmt.id, "at"]) },
        { ...plain({ key: `${kg}/amount`, item: "residence.purchase", label: "頭金から払う額", level: "detail", kind: "yen", basis: "once", find: findP, path: ["amount"], help: "頭金（合計）のうち、この月に払う額です。つなぎ融資・分割の融資で払う分は入れません" }), address: () => at(r.id, "residence.purchase", ["payments", pmt.id, "amount"]) },
      ],
      actions: [
        removeAction(`${kg}/remove`, "外す", "detail", (h, w) => {
          const res = find(h, w) as Residence | undefined;
          if (res?.purchase?.payments === undefined) return;
          res.purchase.payments = res.purchase.payments.filter((x) => x.id !== pmt.id);
          if (res.purchase.payments.length === 0) delete res.purchase.payments;
        }),
      ],
    };
  });
  const hasLandLoan = landLoansOf(h0, r).length > 0;
  groups.push({
    key: `${kp}/customActions`,
    level: "detail",
    fields: [],
    actions: [
      {
        key: `${kp}/addPayment`,
        label: "＋ 建物の代金の支払い（契約金・着工金・中間金）",
        level: "detail",
        help: "引き渡しの前に頭金から払う分です。頭金の合計は変えず、払う時期を分けます",
        run: (w) =>
          mutate(w, (h) => {
            const res = find(h, w) as Residence | undefined;
            const landAt = res === undefined ? null : landMonthOf(h, res);
            if (res?.purchase === undefined || landAt === null) return;
            (res.purchase.payments ??= []).push({ id: newId(), at: { at: addMonths(landAt, 3) }, amount: 0, kind: "start" });
          }),
      },
      ...(hasLandLoan
        ? []
        : [
            {
              key: `${kp}/addLandLoan`,
              label: "＋ 土地の分のローン（土地先行融資）",
              level: "detail" as const,
              help: "土地と建物で住宅ローンを分けて借りるときに足します（土地の決済の月に借りる）。足さなければ、引き渡しまでの支払いはつなぎ融資で払い、引き渡しの月に住宅ローンを1本借りるとみなします",
              run: (w: WorkingHousehold) => newLandLoan(w, r.id),
            },
          ]),
    ],
  });
  return groups;
}

/**
 * 土地の分のローン（土地先行融資。0115）を足す: 住宅ローンを1本足し、借入の年月を土地の決済の月に、借入額を土地の代金−土地の決済で払う頭金の推定にする。
 * 引き渡しのローンの推定の借入額は、合計−頭金からこのローンの分を引いた額に入れ直る（housingCredit.ts の estimatedPrincipal）
 */
export function newLandLoan(wh: WorkingHousehold, rid: string): WorkingHousehold {
  const before = new Set((wh.request.input.household.debts ?? []).map((d) => d.id));
  let w = newMortgage(wh);
  const added = (w.request.input.household.debts ?? []).find((d) => !before.has(d.id));
  if (added === undefined) return wh;
  w = mutate(w, (h) => {
    const res = (h.residences ?? []).find((x) => x.id === rid);
    const d = (h.debts ?? []).find((x) => x.id === added.id);
    const landAt = res === undefined ? null : landMonthOf(h, res);
    if (res?.purchase?.land === undefined || d === undefined || landAt === null) return;
    d.start = { at: landAt };
    const first = d.rateSchedule[0];
    if (first !== undefined) first.from = { at: landAt };
    d.principal = Math.max(0, res.purchase.land.price - (res.purchase.land.downPayment ?? 0));
  });
  return withProvisionalHousing({ ...w, assumed: { ...w.assumed, [principalKey(added.id)]: PRINCIPAL_ESTIMATE } });
}

/** 建物が建った年の欄（持ち家の評価の欄と同じ値。中古の購入の予定は住宅の購入の頭に、ほかは持ち家の評価に出す） */
/** これから持ち始める持ち家（購入の予定でなく、住み始めが計算の基準の月より後。「この家を相続する」で足した家） */
export function isInheritedHome(wh: WorkingHousehold, r: Residence): boolean {
  if (r.kind !== "own" || r.purchase !== undefined) return false;
  const from = resolveTimepoint(wh.request.input.household, r.from);
  return from !== null && from > wh.request.input.baseMonth;
}

function builtYearField(wh: WorkingHousehold, r: Residence, k: string): FieldDef {
  const find = byId(residences, r.id);
  const bought = r.purchase !== undefined;
  const inherited = isInheritedHome(wh, r);
  const used = bought && purchaseTypeOf(wh, r)?.type.startsWith("used") === true;
  // 評価の時点の省略はエンジンと同じ: 購入の月（購入の時点が空なら住み始め）、購入が無ければ計算基準月（housing.valuation。0164）
  const asOf = r.valuation?.asOf ?? (r.purchase !== undefined ? resolveTimepoint(wh.request.input.household, r.purchase.at ?? r.from) : null) ?? wh.request.input.baseMonth;
  const asOfYear = Number(asOf.slice(0, 4));
  return plain({
    key: `${k}/valuation/builtYear`,
    item: "residence.valuation",
    // 購入の予定は、これから建つ（完成する）年。中古と今住んでいる家は建った年
    label: bought && !used ? "建物が完成する年" : "建物が建った年",
    level: used ? "simple" : "detail",
    kind: "int",
    suffix: "年",
    min: 1900,
    max: 2200,
    find,
    path: ["valuation", "builtYear"],
    optional: true,
    // 購入の予定の新築は、空欄を購入の年（その額の時点の年）の新築として見せる。中古と今住んでいる持ち家は空欄のまま見せる（購入の年を建った年と見せない）
    ...(bought && !used ? { fallback: asOfYear } : {}),
    help: used
      ? "中古の建物が建った年です。持ち家の評価（建物の目減り）と固定資産税の目安に使います。入れるまでは、購入の年に建ったとみなして評価します"
      : bought
        ? "入れなければ、その額の時点の年（購入の年）に完成する新築とみなします"
        : inherited
          ? `相続する家が建った年です。建物の評価（古くなった分の目減り）と固定資産税の目安に使います。分からなければ、相続する家の築年数の目安（いま築${String(INHERITED_AGE())}年）の推定のままにします。空欄にすると、その額の時点（${asOfYear}年）に新築とみなします`
          : `入れなければ、その額の時点（${asOfYear}年）に新築とみなします。わかれば建った年を入れてください`,
  });
}

// ---- 住宅取得等資金の贈与税の非課税の期限（2026-11-05 の追記） ----

const EXEMPTION_IDS = { energySaving: "giftTax.housingFunds.exemption.energySaving", other: "giftTax.housingFunds.exemption.other" } as const;
type ExemptionKind = keyof typeof EXEMPTION_IDS;
const isExemptionKind = (v: unknown): v is ExemptionKind => v === "energySaving" || v === "other";

/** その月の贈与に住宅取得等資金の非課税があるか（制度データの写し。期限の後は「制度なし」。計算エンジンの gift.tax と同じ値） */
export function exemptionOpen(kind: ExemptionKind, ym: string): boolean {
  const v = regulationValue(EXEMPTION_IDS[kind], `${ym}-01`);
  return typeof v === "number" && v > 0;
}

/** 非課税の期限の文（値のある最後の行の終わりの日。例「2026年12月31日」。期限が無ければ null） */
export function exemptionDeadline(kind: ExemptionKind): string | null {
  const to = regulationEntries(EXEMPTION_IDS[kind]).filter((r) => typeof r.value === "number" && r.value > 0).at(-1)?.to ?? null;
  if (to === null) return null;
  const [y, m, d] = to.split("-").map(Number) as [number, number, number];
  return `${String(y)}年${String(m)}月${String(d)}日`;
}

/** 援助の非課税の選択が、受け取る月（購入の月）に使えないときの知らせ（使えれば null） */
export function exemptionWarn(kind: unknown, ym: string | null): string | null {
  if (ym === null || !isExemptionKind(kind) || exemptionOpen(kind, ym)) return null;
  const dl = exemptionDeadline(kind);
  return `受け取る月（${ym.slice(0, 4)}年${String(Number(ym.slice(5, 7)))}月）は、住宅取得等資金の非課税の期限${dl === null ? "" : `（${dl}までの贈与）`}の後なので、非課税なしで贈与税を計算しています。延長が決まれば、制度データを新しくしたときに計算に入ります`;
}

/** 非課税の選択肢（期限を添える） */
const exemptionOptions = () =>
  HOUSING_EXEMPTION.map((o) => {
    const dl = isExemptionKind(o.value) ? exemptionDeadline(o.value) : null;
    return dl === null ? o : { ...o, label: `${o.label}（${dl}までの贈与）` };
  });

/** 援助する人を、その場で世帯の外の家族（親・祖父母）として足し、その援助の援助する人にする（介護・親の項目の足し方と同じ） */
export function donorHere(wh: WorkingHousehold, rid: string, j: number, kind: "parent" | "grandparent"): WorkingHousehold {
  const before = new Set(wh.request.input.household.members.map((m) => m.id));
  const added = addOutside(wh, kind);
  const m = added.request.input.household.members.find((x) => !before.has(x.id));
  if (m === undefined) return wh;
  return mutate(added, (h) => {
    const g = (h.residences ?? []).find((x) => x.id === rid)?.purchase?.gifts?.[j];
    if (g === undefined) return;
    g.donor = m.id;
    g.giver = kind;
  });
}

/** 住宅資金の援助（購入の予定の「住宅の購入」の1件の中に描く。キーが <住まい>/purchase/gift/… なので、その枠の中のまとまりになる） */
function giftGroups(wh: WorkingHousehold, r: Residence, k: string): GroupDef[] {
  const find = byId(residences, r.id);
  const kp = `${k}/purchase`;
  const groups: GroupDef[] = [];
  const giftMonth = purchaseMonth(wh.request.input.household, r);
  const noDonor = donorCandidates(wh).length === 0;
  (r.purchase?.gifts ?? []).forEach((g, j) => {
    const findG: Finder = (h, w) => (getPath(find(h, w), ["purchase", "gifts", String(j)]) as Record<string, unknown> | undefined) ?? undefined;
    const kg = `${kp}/gift/${j}`;
    const gid = g.id as string | undefined;
    const amount = plain({
      key: `${kg}/amount`,
      item: "residence.purchase",
      label: "援助の額",
      level: "simple",
      kind: "yen",
      basis: "once",
      find: findG,
      path: ["amount"],
      help: "目安は作りません（外れると結果を大きく誤らせるため）。受け取る予定の額を入れてください。援助は頭金の一部として払います（頭金が推定のままなら、援助の額を頭金に足します）",
      after: (h, _t, _v, w) => refreshDownEstimate(find(h, w) as Residence | undefined),
    });
    // 非課税の期限の後の贈与（2026-11-05 の追記。計算エンジンは期限の後を非課税なしで計算する）
    const late = exemptionWarn(g.housingExemption ?? "other", giftMonth);
    const exempt = plain({ key: `${kg}/exempt`, item: "residence.purchase", label: "住宅取得等資金の非課税", level: late !== null ? "simple" : "detail", kind: "select", options: exemptionOptions(), find: findG, path: ["housingExemption"], optional: true, fallback: "other", help: "親・祖父母から住宅の購入の資金をもらうときの贈与税の非課税です。期限の後の贈与は非課税なしで計算します（延長が決まれば、制度データを新しくしたときに計算に入ります）" });
    groups.push({
      key: kg,
      title: `住宅資金の援助 ${j + 1}`,
      note: [g.donor !== undefined ? "贈与する人から出すので、援助の額は世帯の資産から出しません。受け取るのは購入の月です" : "受け取るのは購入の月です", ...(late !== null ? [late] : [])].join("。"),
      level: "simple",
      moreLabel: "受け取る人・課税の方法を入れる",
      fields: [
        plain({
          key: `${kg}/donor`,
          item: "residence.purchase",
          label: "援助する人",
          level: "simple",
          kind: "select",
          options: donorOptions(wh),
          find: findG,
          path: ["donor"],
          optional: true,
          fallback: "",
          help: "介護・親の項目で足した親・祖父母（世帯の外の家族）から選びます。いなければ下の「＋ 親を足す」「＋ 祖父母を足す」で、ここから足せます（生年月・亡くなる見込みは介護・親の項目で直します）",
        }),
        gid === undefined ? amount : { ...amount, address: () => at(r.id, "residence.purchase", ["gifts", gid, "amount"]) },
        plain({ key: `${kg}/recipient`, item: "residence.purchase", label: "受け取る人", level: "detail", kind: "select", options: memberOptions(wh, (m) => m.kind === "self" || m.kind === "spouse"), find: findG, path: ["recipient"] }),
        plain({ key: `${kg}/tax`, item: "residence.purchase", label: "贈与税の課税方法", level: "detail", kind: "select", options: TAX_METHODS, find: findG, path: ["taxMethod"], optional: true, fallback: "calendar" }),
        { ...exempt, get: (w: WorkingHousehold) => ({ ...exempt.get(w), warn: exemptionWarn((getPath(findG(w.request.input.household, w), ["housingExemption"]) as string | undefined) ?? "other", purchaseMonth(w.request.input.household, find(w.request.input.household, w) as unknown as Residence)) }) },
      ],
      actions: [
        // 援助する人の候補がいないときは、その場で世帯の外の家族（親・祖父母）を足して、この援助の援助する人にする
        ...(noDonor
          ? (["parent", "grandparent"] as const).map(
              (kind): ActionDef => ({
                key: `${kg}/addDonor/${kind}`,
                label: kind === "parent" ? "＋ 親を足す" : "＋ 祖父母を足す",
                help: "世帯の外の家族として足し、この援助の援助する人にします。生年月・亡くなる見込みは介護・親の項目で直します",
                level: "simple",
                run: (w) => donorHere(w, r.id, j, kind),
              }),
            )
          : []),
        removeAction(`${kg}/remove`, "外す", "simple", (h, w) => {
          const res = find(h, w) as Residence | undefined;
          if (res?.purchase?.gifts !== undefined) {
            if (gid !== undefined) setState(res as unknown as Obj, `residence.purchase/gifts/${gid}/amount`, undefined);
            res.purchase.gifts = res.purchase.gifts.filter((_, x) => x !== j);
            if (res.purchase.gifts.length === 0) delete res.purchase.gifts;
            refreshDownEstimate(res);
          }
        }),
      ],
    });
  });
  groups.push({
    key: `${kp}/addGift`,
    level: "simple",
    fields: [],
    actions: [
      {
        key: `${kp}/addGiftAction`,
        label: "＋ 親・祖父母からの住宅資金の援助",
        level: "simple",
        // 額は目安を作らず未入力（0円で計算中）にする（0052 の2）
        run: (w) =>
          mutate(w, (h) => {
            const res = find(h, w) as Residence | undefined;
            const self2 = h.members.find((m) => m.kind === "self");
            const donor = (h.donors ?? [])[0];
            if (res?.purchase === undefined || self2 === undefined) return;
            const id = newId();
            // 非課税の既定は省エネ等住宅。受け取る月（購入の月）が非課税の期限の後なら「使わない」（期限の後は制度が無い。2026-11-05 の追記）
            const ym = purchaseMonth(h, res);
            const exemption = ym === null || exemptionOpen("energySaving", ym) ? "energySaving" : "none";
            (res.purchase.gifts ??= []).push({ id, recipient: self2.id, giver: donor?.kind ?? "parent", ...(donor !== undefined ? { donor: donor.id } : {}), amount: 0, housingExemption: exemption });
            setState(res as unknown as Obj, `residence.purchase/gifts/${id}/amount`, estRow("standard", UNENTERED_GIFT));
          }),
      },
    ],
  });
  return groups;
}

// ---- 持ち家の評価と売却 ----

const seriesAt = (v: YearSeries | undefined, year: number): number | null => {
  const r = v?.byYear?.[String(year)] ?? v?.default;
  return r === undefined ? null : Number(r);
};

/**
 * 今住んでいる持ち家の、計算基準年の評価額の目安（その額の時点が前の年のとき。計算エンジンの housing.valuation と同じ決まり:
 * 土地は前提の上昇率（空欄なら物価上昇率）で毎年伸ばし、建物は構造の耐用年数で定額で減らして下限より下げない）。画面の補助なので、端数の扱いは目安
 */
export function valuationHint(wh: WorkingHousehold, r: Residence): string | null {
  const v = r.valuation;
  const value = v?.value?.value;
  if (r.purchase !== undefined || value == null || v?.asOf === undefined) return null;
  const base = wh.request.input.baseMonth;
  const baseYear = Number(base.slice(0, 4));
  // 買った年月が住み始めについてくる家は、今の住み始めで読む（入力のパネルで住み始めを直した直後も合うように。0176）
  const followed = stateOf(r as unknown as Obj, "residence.valuation/asOf")?.estimate?.basis === AS_OF_FOLLOWS;
  const from = followed ? resolveTimepoint(wh.request.input.household, r.from) : null;
  const asOf = from !== null && from < base ? from : v.asOf;
  const y0 = Number(asOf.slice(0, 4));
  if (y0 >= baseYear) return null;
  const a = wh.request.input.assumptions;
  const setting = a?.realEstateValuation;
  const share = Number(v.landShare ?? setting?.landShare ?? VALUATION_DEFAULTS.landShare);
  let land = Math.floor(value * share);
  const building0 = value - land;
  for (let y = y0 + 1; y <= baseYear; y++) land = Math.floor(land * (1 + (seriesAt(setting?.landGrowth, y) ?? seriesAt(a?.inflation, y) ?? 0)));
  const structure = v.structure ?? "wood";
  const life = (setting?.usefulLife as Record<string, number> | undefined)?.[structure] ?? USEFUL_LIFE[structure] ?? 22;
  const floor = Number(setting?.residualFloor ?? VALUATION_DEFAULTS.residualFloor);
  const built = v.builtYear ?? y0;
  const f = (age: number) => (age <= 0 ? 1 : Math.max(floor, 1 - age / life));
  const f0 = f(y0 - built);
  const building = f0 === 0 || f(baseYear - built) === f0 ? building0 : Math.floor((building0 * f(baseYear - built)) / f0);
  return `${baseYear}年の評価額の目安（推定）: 約${formatYen(Math.round((land + building) / 10000) * 10000, "man")}万円（土地 ${formatYen(Math.round(land / 10000) * 10000, "man")}万円・建物 ${formatYen(Math.round(building / 10000) * 10000, "man")}万円）`;
}

// 「売らない」は計算の扱いのまま書く（住み終わりの年で資産・固定資産税・修繕費から外れる。持ち続けるなら空き家の不動産を作る。0052 の追記 2026-11-07）
/** 売る家に評価額も売却価格も入っていないときの知らせ（空欄の売却価格は評価額で読むので、0円で売ることになる。住み替えで売るとみなしたとき〔0136 の 2026-11-07 の追記〕に気づけるように） */
export const SALE_NO_VALUE = "評価額が入っていないので、売却価格0円で計算しています。評価額か売却価格を入れてください";

function withNoValueWarn(f: FieldDef, r: Residence): FieldDef {
  return {
    ...f,
    get: (w) => {
      const s = f.get(w);
      const x = (w.request.input.household.residences ?? []).find((y) => y.id === r.id);
      const noValue = x?.sale !== undefined && x.sale.price == null && x.valuation?.value === undefined;
      return noValue && s.warn == null ? { ...s, warn: SALE_NO_VALUE } : s;
    },
  };
}

const AFTER_CHOICES = [
  { value: "keep", label: "売らない（住み終わりで計算から外す）" },
  { value: "sell", label: "住み終わりの月に売る" },
];
/** 評価の基にする額の入れ方（今の時価で／買った値段で。0025 の追記 2026-11-07） */
const VALUE_BASES = [
  { value: "purchase", label: "買った値段で" },
  { value: "market", label: "今の時価で" },
];
/**
 * 評価の入れ方（入れていなければ、評価額が無いか、その額の時点が計算の基準の月より前なら買った値段、評価額があって時点が今なら今の時価。
 * 評価額の無い家は、標準の「買った値段」で入れる。0176）
 */
const valueBasisOf = ownedValueMode;

/** 土地の割合の推定の根拠の頭（今の時価で入れた家の、建った年からの目安） */
const LAND_SHARE_BY_AGE = "建った年からの目安";
const landShareBasis = (share: number, builtYear: number) =>
  `${LAND_SHARE_BY_AGE}（${builtYear}年に建った家の今の時価のうち土地 ${Math.round(share * 100)}%。新築のときの土地の割合のまま、建物だけが耐用年数で古くなったとみなします。直してください）`;

/** 今の時価で入れた家の土地の割合の推定を入れ直す（FP が入れた割合は変えない。建った年が無ければ外す） */
function refreshLandShare(wh: WorkingHousehold, h: Household, rid: string): void {
  const r = (h.residences ?? []).find((x) => x.id === rid);
  if (r === undefined || r.kind !== "own" || r.purchase !== undefined) return;
  const row = stateOf(r as unknown as Obj, "residence.valuation/landShare");
  const ours = row?.state === "estimated" && (row.estimate?.basis ?? "").startsWith(LAND_SHARE_BY_AGE);
  if (r.valuation?.landShare !== undefined && !ours) return;
  const base = wh.request.input.baseMonth;
  const share = valueBasisOf(r, base) === "market" ? landShareByAge({ ...wh, request: { ...wh.request, input: { ...wh.request.input, household: h } } }, r, Number(base.slice(0, 4))) : null;
  if (share === null || r.valuation?.builtYear === undefined || r.valuation.value === undefined) {
    if (ours && r.valuation !== undefined) {
      const { landShare: _drop, ...rest } = r.valuation;
      if (Object.keys(rest).length === 0) delete r.valuation;
      else r.valuation = rest;
      setState(r as unknown as Obj, "residence.valuation/landShare", undefined);
    }
    return;
  }
  r.valuation = { ...r.valuation, landShare: String(share) };
  setState(r as unknown as Obj, "residence.valuation/landShare", estRow("standard", landShareBasis(share, r.valuation.builtYear as number)));
}

/** 評価の欄を直した後に、土地の割合の推定を入れ直す */
function followsLandShare(f: FieldDef, rid: string): FieldDef {
  if (f.key.endsWith("/valuation/landShare")) return f;
  const after = (before: WorkingHousehold, next: WorkingHousehold): WorkingHousehold => (next === before ? next : mutate(next, (h) => refreshLandShare(next, h, rid)));
  return { ...f, set: (wh, v) => after(wh, f.set(wh, v)), ...(f.write !== undefined ? { write: (wh: WorkingHousehold, v: Parameters<FieldDef["set"]>[1]) => after(wh, f.write!(wh, v)) } : {}), ...(f.boxed !== undefined ? { boxed: { ...f.boxed, write: (wh: WorkingHousehold, box: Record<string, unknown> | undefined) => after(wh, f.boxed!.write(wh, box)) } } : {}) };
}

/**
 * 今住んでいる持ち家の評価の入れ方（今の時価で／買った値段で。0025 の追記 2026-11-07）: 今の時価は時点を今月にし、建物は建った年から古くなった値、
 * 土地の割合は建った年からの目安（推定）。買った値段は時点を買った年月（住み始め）にする
 */
function valueBasisField(wh: WorkingHousehold, r: Residence, kv: string): FieldDef {
  const find = byId(residences, r.id);
  return {
    ...field({
      key: `${kv}/basis`,
      item: "residence.valuation",
      label: "評価の入れ方",
      level: "detail",
      kind: "select",
      options: VALUE_BASES,
      structural: true,
      help: "ふつうは「買った値段で」のまま、標準の買った値段と買った年月から今と先の年の評価額を推計します（土地は上昇率で動かし、建物は古くなった分を減らす）。査定などで今の時価が分かるときは「今の時価で」にして評価額を入れます",
      get: (w) => {
        const x = find(w.request.input.household, w) as Residence | undefined;
        const b = x === undefined ? null : valueBasisOf(x, w.request.input.baseMonth);
        const warn = b === "market" && x?.valuation?.value !== undefined && x.valuation.builtYear === undefined ? "建物が建った年を入れてください（空欄だと、今の時価を新築の家の値として建物を減らします）" : null;
        return { value: b, warn };
      },
      set: (w, v) => {
        if (v !== "market" && v !== "purchase") return w;
        return mutate(w, (h, req) => {
          const x = find(h, w) as Residence | undefined;
          if (x === undefined) return;
          // 買った値段: その額の時点を買った年月（住み始め）にし、住み始めについてくる印を付ける。今の時価: 時点は今月（0176）
          if (v === "purchase") markPurchaseBasis(h, x, req.input.baseMonth);
          else {
            x.valuation = { ...(x.valuation ?? {}), basis: v, asOf: req.input.baseMonth };
            dropAsOfFollow(x);
          }
          refreshLandShare({ ...w, request: req }, h, x.id);
        });
      },
    }),
    address: () => at(r.id, "residence.valuation", ["basis"]),
  };
}

/**
 * 持ち家の評価（資産と負債の推移・提案書のバランスシート・相続税の目安に使う）と、住み終わりの後（そのまま持つ・売る）。
 * 購入の予定がある持ち家は物件の価格から、今住んでいる持ち家は評価額（または購入の価格と時点）から評価する。評価額が無い今の持ち家は未入力の警告
 */
/** 今の時価で入れた評価額の「?」: 先の年でどう変わるか（建物・土地）と数字の例（0176。利用者の判断 2026-11-08） */
export const MARKET_VALUE_HELP =
  "今売るといくらかの見込み（査定・近くの売り出しの値段など）を、土地と建物の合計で入れます。先の年は、土地と建物に分けて動かします。\n" +
  "・建物: 建物が建った年から、構造の耐用年数（木造22年・軽量鉄骨19年・重量鉄骨34年・鉄筋コンクリート47年）で毎年同じ額ずつ下げ、新築のときの値の20%で止めます。今の額は、建った年から今までに下がった後の値として読みます\n" +
  "・土地: 前提条件の「土地の上昇率（年）」で毎年増減します（入れていなければ物価上昇率）\n" +
  "例: 2016年に建った木造の家を、今の時価3,500万円（土地の割合50%）で入れると、建物1,750万円は毎年約146万円ずつ下がり、2034年（築18年）に約640万円で止まります。土地1,750万円は、増減が年1%なら10年後に約1,930万円です";

/** 今住んでいる持ち家の買った値段の欄（合計・うち土地・うち建物。標準。0176）。どちらの組み合わせ（合計と土地・土地と建物・合計と建物）でも入れられる */
function ownedPriceFields(wh: WorkingHousehold, r: Residence, k: string): FieldDef[] {
  const find = byId(residences, r.id);
  const kv = `${k}/valuation`;
  const shareSetting = (w: WorkingHousehold): string => w.request.input.assumptions?.realEstateValuation?.landShare ?? VALUATION_DEFAULTS.landShare;
  const cur = (w: WorkingHousehold): Residence | undefined => find(w.request.input.household, w) as Residence | undefined;
  const pctOfShare = (w: WorkingHousehold) => `${String(Math.round(Number(shareSetting(w)) * 100))}%`;
  const afterPrice = (f: FieldDef): FieldDef => startsOwnedHomeTax(f, r.id);
  // 合計: 書いたら評価の入れ方を買った値段に。FP が入れた土地の値段はそのまま（割合を入れ直す）
  const total = afterWrite(
    yenBox({
      key: `${kv}/value`,
      item: "residence.valuation",
      label: "買った値段（土地と建物の合計）",
      level: "simple",
      basis: "once",
      find,
      path: ["valuation", "value"],
      help: "家を買ったときの値段（土地と建物の合計。諸費用は入れません）。買った年月の額として、今と先の年の評価額を推計します: 土地は前提条件の上昇率（入れていなければ物価上昇率）で動かし、建物は構造の耐用年数で古くなった分を減らします（住宅の購入の予定と同じ推計）。固定資産税の目安にも使います",
      hint: (w) => {
        const x = cur(w);
        return x === undefined ? null : valuationHint(w, x);
      },
    }),
    (w0, w1) => {
      // 合計を直したときは、土地と建物を同じ割合のままにする。片方だけ入れていた（土地から・建物から入れて合計がその額の）ときは、入れた額のまま
      const x0 = cur(w0);
      const t0 = x0 === undefined ? null : totalOf(x0);
      const s0 = x0?.valuation?.landShare;
      const keepLand = t0 !== null && s0 === "1" ? t0 : null;
      const keepBuilding = t0 !== null && s0 === "0" ? t0 : null;
      return mutate(w1, (h, req) => {
        const x = (h.residences ?? []).find((y) => y.id === r.id);
        if (x === undefined) return;
        const t = totalOf(x);
        // 空にした: 足した入れ方と時点（印のある物）も外す
        if (x.valuation?.value === undefined) return clearPurchaseBasis(x);
        markPurchaseBasis(h, x, req.input.baseMonth);
        if (t !== null && keepLand !== null) putLand(x, keepLand);
        if (t !== null && keepBuilding !== null) putLand(x, Math.max(0, t - keepBuilding));
      });
    },
  );
  const land = field({
    key: `${kv}/land`,
    item: "residence.valuation",
    label: "うち土地の値段",
    level: "simple",
    kind: "yen",
    basis: "once",
    optional: true,
    help: "買った値段のうちの土地の分です（売買契約書・重要事項説明書の内訳など）。建物の値段が分かるなら、建物の値段を入れても構いません（合計−建物を土地とします）。分からなければ空欄のまま、合計の目安の割合で分けます",
    get: (w) => {
      const x = cur(w);
      if (x === undefined) return { value: null };
      if (landEntered(x)) return { value: landAmount(x, shareSetting(w)) };
      const est = landAmount(x, shareSetting(w));
      return { value: null, hint: est === null ? null : `空欄なら合計の${pctOfShare(w)}（約${formatYen(Math.round(est / 10000) * 10000, "man")}万円）で計算します` };
    },
    set: (w, v) =>
      mutate(w, (h, req) => {
        const x = (h.residences ?? []).find((y) => y.id === r.id);
        if (x === undefined) return;
        // 空にする: 土地だけを入れていた（合計＝土地）なら合計も外す（入れる前の形に戻す）。ほかは目安の割合に戻す
        if (v === null || v === "") return x.valuation?.landShare === "1" ? dropTotal(x) : clearLand(x);
        if (typeof v !== "number") return;
        const t = totalOf(x);
        const was = landEntered(x) ? landAmount(x, shareSetting(w)) : null;
        // 合計がまだ無い（土地から入れる）・土地が0（建物から入れた）・合計より大きい: 建物をそのままにして合計を土地＋建物にする
        if (t === null || was === 0 || v > t) {
          const building = t === null ? 0 : t - (was ?? landOfDefault(t, shareSetting(w)));
          x.valuation = { ...(x.valuation ?? {}), value: confirmedBox(v + Math.max(0, building)) };
        }
        markPurchaseBasis(h, x, req.input.baseMonth);
        putLand(x, v);
      }),
  });
  const building = field({
    key: `${kv}/building`,
    item: "residence.valuation",
    label: "うち建物の値段",
    level: "simple",
    kind: "yen",
    basis: "once",
    optional: true,
    help: "買った値段のうちの建物の分です（消費税を含む）。土地の値段を入れていれば合計を土地＋建物に、入れていなければ合計−建物を土地とします",
    get: (w) => {
      const x = cur(w);
      const t = x === undefined ? null : totalOf(x);
      if (x === undefined || t === null) return { value: null };
      const l = landAmount(x, shareSetting(w)) ?? 0;
      return landEntered(x) ? { value: t - l } : { value: null, hint: `空欄なら合計の残り（約${formatYen(Math.round((t - l) / 10000) * 10000, "man")}万円）で計算します` };
    },
    set: (w, v) =>
      mutate(w, (h, req) => {
        const x = (h.residences ?? []).find((y) => y.id === r.id);
        if (x === undefined) return;
        // 空にする: 建物だけを入れていた（土地が0）なら合計も外す。ほかは目安の割合に戻す
        if (v === null || v === "") return x.valuation?.landShare === "0" ? dropTotal(x) : clearLand(x);
        if (typeof v !== "number") return;
        const b = Math.max(0, v);
        const t = totalOf(x);
        if (landEntered(x) && t !== null) {
          const l = landAmount(x, shareSetting(w)) ?? 0;
          x.valuation = { ...(x.valuation ?? {}), value: confirmedBox(l + b) };
          markPurchaseBasis(h, x, req.input.baseMonth);
          putLand(x, l);
          return;
        }
        // 土地を入れていない: 合計があれば合計−建物を土地に。合計も無ければ、合計を建物の値段にして土地を0に（後から土地を入れると足す）
        if (t === null || b > t) x.valuation = { ...(x.valuation ?? {}), value: confirmedBox(b) };
        markPurchaseBasis(h, x, req.input.baseMonth);
        putLand(x, Math.max(0, (totalOf(x) ?? b) - b));
      }),
  });
  return [total, land, building].map((f) => ({ ...afterPrice(f), address: () => at(r.id, "residence.valuation", f === total ? ["value"] : ["landShare"]) }));
}

/** 片方だけで入れた買った値段を外す（合計・土地の割合・足した入れ方と時点） */
function dropTotal(x: Residence): void {
  if (x.valuation === undefined) return;
  const { value: _v, ...rest } = x.valuation;
  void _v;
  x.valuation = rest;
  clearLand(x);
  if (x.valuation !== undefined) clearPurchaseBasis(x);
}

/** 合計×目安の割合の土地（土地の値段を入れていないとき） */
const landOfDefault = (t: number, share: string): number => Math.floor(t * Number(share));

/** 今住んでいる持ち家の「持ち家の評価」の中枠（詳細。評価の入れ方・今の時価・建物の構造・建った年。0176） */
function ownedValuationGroup(wh: WorkingHousehold, r: Residence, k: string): GroupDef {
  const find = byId(residences, r.id);
  const kv = `${k}/valuation`;
  const base = wh.request.input.baseMonth;
  const setting = wh.request.input.assumptions?.realEstateValuation;
  const market = valueBasisOf(r, base) === "market";
  const est = valuationHint(wh, r);
  const fields: FieldDef[] = [
    valueBasisField(wh, r, kv),
    ...(market
      ? [
          yenBox({ key: `${kv}/value`, item: "residence.valuation", label: "評価額", level: "detail", basis: "once", find, path: ["valuation", "value"], help: MARKET_VALUE_HELP, hint: (w) => valuationHint(w, r) }),
          // その額の時点は今月（今の時価にしたときに入れる）。前の版で別の月の家だけ出す
          ...(r.valuation?.asOf !== undefined && r.valuation.asOf !== base
            ? [plain({ key: `${kv}/asOf`, item: "residence.valuation", label: "その額の時点", level: "detail", kind: "ym", find, path: ["valuation", "asOf"], optional: true, fallback: base, help: "評価額がいつの時点の額かです。今の時価なら今月にします" })]
            : []),
        ]
      : []),
    {
      ...plain({ key: `${kv}/structure`, item: "residence.valuation", label: "建物の構造", level: "detail", kind: "select", options: BUILDING_STRUCTURES, find, path: ["valuation", "structure"], optional: true, fallback: "wood", help: "建物を耐用年数（木造22年・軽量鉄骨19年・重量鉄骨34年・鉄筋コンクリート47年）で減らします。建て方から目安を出します" }),
      address: () => at(r.id, "residence.valuation", ["structure"]),
    },
    builtYearField(wh, r, k),
    // 今の時価は土地の値段が分からないことが多いので、割合（建った年からの目安）で分ける
    ...(market
      ? [
          plain({
            key: `${kv}/landShare`,
            item: "residence.valuation",
            label: "土地の割合",
            level: "detail",
            kind: "pct",
            min: 0,
            max: 100,
            find,
            path: ["valuation", "landShare"],
            optional: true,
            fallback: setting?.landShare ?? VALUATION_DEFAULTS.landShare,
            help: "今の時価のうちの土地の割合です。入れなければ、建った年からの目安（建物が古くなった分だけ土地の割合が大きくなる）で分けます",
          }),
        ]
      : []),
  ].map((f) => startsOwnedHomeTax(followsLandShare(f, r.id), r.id));
  return {
    key: kv,
    title: "持ち家の評価",
    summary: market ? "資産・相続税の目安に使う家の値段（今の時価で入れる）" : `資産・相続税の目安に使う家の値段。標準の買った値段から推計${est !== null ? `（${est.replace(/^(\d+年)の評価額の目安（推定）: (約[^（]+)（.*$/u, "$1 $2")}・推定）` : ""}`,
    note: "資産と負債の推移・提案書のバランスシート・相続税の目安に入る家の値段です。ふつうは標準の「買った値段」と「買った年月（住み始め）」から推計します（推定。土地は上昇率で動かし、建物は古くなった分を減らす）。査定などで今の時価が分かるときは、評価の入れ方を「今の時価で」にして評価額を入れます",
    level: "detail",
    band: true,
    fields,
    actions: [],
  };
}

function valuationGroups(wh: WorkingHousehold, r: Residence, k: string): GroupDef[] {
  const find = byId(residences, r.id);
  const kv = `${k}/valuation`;
  const bought = r.purchase !== undefined;
  const base = wh.request.input.baseMonth;
  const setting = wh.request.input.assumptions?.realEstateValuation;
  // 評価の時点の省略はエンジンと同じ（購入の時点が空なら住み始め。0164）
  const asOf = r.valuation?.asOf ?? (r.purchase !== undefined ? resolveTimepoint(wh.request.input.household, r.purchase.at ?? r.from) : null) ?? base;
  const inherited = isInheritedHome(wh, r);
  // 今住んでいる持ち家は、評価の入れ方・今の時価・建物の構造・建った年の中枠（買った値段は住まいの標準の欄。0176）
  const ownNow = !bought && !inherited && isCurrentOwned(wh.request.input.household, r, base);
  const groups: GroupDef[] = ownNow
    ? [ownedValuationGroup(wh, r, k)]
    : [
    {
      key: kv,
      title: "持ち家の評価",
      // 純資産と相続税の目安にだけ効き、お金の流れには効かないので詳細（0078）
      level: "detail",
      ...(!bought && r.valuation?.value === undefined ? { note: "評価額を入れると、資産と負債の推移・提案書のバランスシート・相続税の目安に不動産として入ります（今は0円で数えています）" } : {}),
      fields: [
        ...(bought || inherited ? [] : [valueBasisField(wh, r, kv)]),
        {
          ...yenBox({
          key: `${kv}/value`,
          item: "residence.valuation",
          label: bought ? "買った直後の評価額" : inherited || valueBasisOf(r, base) === "market" ? "評価額" : "買った値段（土地と建物）",
          level: "detail",
          basis: "once",
          find,
          path: ["valuation", "value"],
          // 今の持ち家で評価額が無ければ未入力の警告（購入の予定は物件の価格を使うので空欄でよい）
          optional: bought,
          help: bought
            ? "入れなければ、物件の価格を購入の月の評価額にし、土地と建物に分けて（土地は住宅の購入の「うち土地の値段」。空欄なら目安の割合）、建物は構造の耐用年数で毎年減らします（土地は前提条件の上昇率で動きます）。新築の値段の上乗せ分などで買った直後の売値が下がると見込むなら、その額を入れます"
            : inherited
              ? "相続する家の、相続の時点の見込みの額（土地と建物の合計）です。相続税の目安・資産と負債の推移・固定資産税の目安に使います"
              : valueBasisOf(r, base) === "market"
                ? "今売るといくらかの見込み（査定・近くの売り出しの値段など）。建物は「建った年」から古くなった分を減らした値として読みます"
                : "買ったときの値段（土地と建物の合計）。その額の時点（買った年月）から、建物を構造の耐用年数で減らします",
          hint: (w) => valuationHint(w, r),
          }),
          // 購入の予定は、空欄なら物件の価格を買った直後の評価額にする
          ...(bought ? { blankMeans: "物件の価格" } : {}),
        },
        plain({
          key: `${kv}/asOf`,
          item: "residence.valuation",
          label: bought ? "その額の時点" : inherited ? "その額の時点（相続の年月）" : valueBasisOf(r, base) === "market" ? "その額の時点（今月）" : "その額の時点（買った年月）",
          level: "detail",
          kind: "ym",
          find,
          path: ["valuation", "asOf"],
          optional: true,
          fallback: asOf,
          ...(inherited ? { help: "相続の見込みの額の時点です。多くは相続の年月（住み始め）のままにします" } : {}),
        }),
        {
          ...plain({ key: `${kv}/structure`, item: "residence.valuation", label: "建物の構造", level: "detail", kind: "select", options: BUILDING_STRUCTURES, find, path: ["valuation", "structure"], optional: true, fallback: "wood", help: "建物を耐用年数（木造22年・軽量鉄骨19年・重量鉄骨34年・鉄筋コンクリート47年）で減らします。建て方から目安を出します" }),
          address: () => at(r.id, "residence.valuation", ["structure"]),
        },
        // 建物が建った年（中古の購入の予定は住宅の購入の頭に出すので、ここには出さない）
        ...(bought && purchaseTypeOf(wh, r)?.type.startsWith("used") === true ? [] : [builtYearField(wh, r, k)]),
        // 注文住宅は土地の代金で土地と建物を分ける（土地の割合の欄は出さない。0115。評価の基にする額を入れたときは割合で分けるので出す）。
        // ほかの購入の予定は、住宅の購入の「うち土地の値段」で入れる（割合の欄は出さない。0176）
        ...((isCustomBuild(r) && r.valuation?.value === undefined) || (bought && !isCustomBuild(r))
          ? []
          : [
              plain({
                key: `${kv}/landShare`,
                item: "residence.valuation",
                label: "土地の割合",
                level: "detail",
                kind: "pct",
                min: 0,
                max: 100,
                find,
                path: ["valuation", "landShare"],
                optional: true,
                fallback: setting?.landShare ?? VALUATION_DEFAULTS.landShare,
                help: "入れなければ前提条件の値。土地は前提条件の上昇率（入れていなければ物価上昇率）で動きます。今の時価で入れた古い家は、建物が古くなった分だけ土地の割合が大きくなります",
              }),
            ]),
        // 今住んでいる持ち家は、評価の欄を直したら、未入力か推定のままの固定資産税に推定を入れる（0112 の追記 2026-11-03）。
        // 今の時価で入れたら、土地の割合の推定を建った年から入れ直す（0025 の追記 2026-11-07）
      ].map((f) => (bought ? f : startsOwnedHomeTax(followsLandShare(f, r.id), r.id))),
      actions: [],
    },
      ];
  if (r.to !== null) {
    const ks = `${k}/sale`;
    // 売る月に残る住宅ローンの残高の目安（売る予定のときだけ）
    const saleYm = r.sale === undefined ? null : resolveTimepoint(wh.request.input.household, r.to);
    const left = saleYm === null ? 0 : Math.round(loansOfHome(wh.request.input.household, r).reduce((s, d) => s + balanceAtMonth(wh.request.input.household, d, saleYm), 0) / 10000) * 10000;
    const fields: FieldDef[] = [
      field({
        key: `${k}/after`,
        item: "residence.sale",
        label: "住み終わりの後",
        level: "simple",
        kind: "select",
        options: AFTER_CHOICES,
        structural: true,
        help: "売ると、売却価格から売却の費用を引いた手取りが預金に入り、その年から不動産は無くなります。住宅ローンが残っていれば売る月に返します。売らないと、住み終わりの年で資産・固定資産税・修繕費から外れます（持ち続けるなら「空き家として持ち続ける」、人に貸すなら作った不動産を「収益不動産へ移す」）",
        get: (w) => {
          const x = find(w.request.input.household, w) as Residence | undefined;
          const held = x?.sale !== undefined ? heldFromHome(w.request.input.household, x) : undefined;
          return {
            value: x?.sale !== undefined ? "sell" : "keep",
            // 住み替えで住み終わりにしたときの初めの値の仮の印（選び直すと外れる）
            assumed: w.assumed[`${k}/after`] ?? null,
            ...(held !== undefined
              ? {
                  warn: "空き家として持ち続けるために作った貸していない不動産（貯蓄・運用）が残っています。売るなら外してください（二重に数えます）",
                  warnFix: { label: "作った空き家を外す", run: (w2: WorkingHousehold) => mutate(w2, (h) => void (h.accounts = (h.accounts ?? []).filter((a) => a.id !== held.id))) },
                }
              : {}),
          };
        },
        set: (w, v) =>
          mutate(w, (h) => {
            const x = find(h, w) as Residence | undefined;
            if (x === undefined) return;
            if (v === "sell") x.sale ??= {};
            else delete x.sale;
          }),
      }),
    ];
    if (r.sale !== undefined)
      fields.push(
        withNoValueWarn(plain({
          key: `${ks}/price`,
          item: "residence.sale",
          label: "売却価格",
          level: "simple",
          kind: "yen",
          basis: "once",
          find,
          path: ["sale", "price"],
          optional: true,
          help: "入れなければ、その年の評価額で売るとみなします",
          // 売る月に住宅ローンが残るなら知らせ（返すかどうかで文を変える。計算エンジンの debt.schedule が売る月に返す）
          ...(left > 0 ? { hint: () => (r.sale?.repayLoan === false ? `売る月に住宅ローンが約${formatYen(left, "man")}万円残ります（返さないので、売った後も返済が続きます）` : `売る月に住宅ローンが約${formatYen(left, "man")}万円残ります（売った月に一括で返します）`) } : {}),
        }), r),
        plain({ key: `${ks}/cost`, item: "residence.sale", label: "売却の費用（売却価格に対する割合）", level: "detail", kind: "pct", find, path: ["sale", "costRate"], optional: true, fallback: setting?.saleCostRate ?? VALUATION_DEFAULTS.saleCostRate, help: "仲介手数料・印紙税など" }),
        ...(left > 0
          ? [
              {
                ...plain({
                  key: `${ks}/repayLoan`,
                  item: "residence.sale",
                  label: "売ったときに住宅ローンを返す",
                  level: "detail" as const,
                  kind: "bool" as const,
                  find,
                  path: ["sale", "repayLoan"],
                  optional: true,
                  fallback: true,
                  help: "住宅ローンが残る家は、抵当権を外さないと売れないので、ふつうは売る月に残りを返します（返さないときは、売った後も返済が続きます）",
                }),
                address: () => at(r.id, "residence.sale", ["repayLoan"]),
              },
            ]
          : []),
        {
          ...yenBox({
            key: `${ks}/tax`,
            item: "residence.sale",
            label: "売ったときの税（譲渡所得の税）",
            level: "simple",
            basis: "once",
            find,
            path: ["sale", "tax"],
            help: "売って得た利益にかかる所得税・住民税の合計です。入れた額を売った月に払います。税理士の試算などの額を入れてください。自宅を売って3,000万円の特別控除で税が出ないなら0円",
          }),
          address: () => at(r.id, "residence.sale", ["tax"]),
        },
      );
    // 売らない家: 住み終わりの年で計算から外れる。持ち続けるなら空き家の不動産を作る（人に貸すなら、作った不動産を収益不動産へ移す）
    const h0 = wh.request.input.household;
    const held = r.sale === undefined ? heldFromHome(h0, r) : undefined;
    const end = resolveTimepoint(h0, r.to);
    const movedByPurchase = wh.assumed[toKey(r.id)] === MOVE_OUT_ASSUMED;
    const keepNote =
      end === null
        ? undefined
        : r.sale !== undefined
          ? movedByPurchase
            ? // 住み替えで住み終わりにした家を売るとみなしたとき（初めの値。0136 の 2026-11-07 の追記）
              `住み替えで住み終わりにした家です。住み終わりの月（${formatYearMonth(end)}）に売るとみなしています（売却価格が空欄なら、その年の評価額）。持ち続けるなら「住み終わりの後」を「売らない」にして「空き家として持ち続ける」を押します`
            : undefined
          : held !== undefined
          ? `住み終わりの翌月（${formatYearMonth(addMonths(end, 1))}）から、貯蓄・運用の貸していない不動産（空き家）で持ち続けます。人に貸すなら、その不動産の「収益不動産へ移す」で移します`
          : movedByPurchase
            ? // 住み替えで住み終わりにした家（段4の確かめ: 家の価値が資産から消えることが分かりにくかった）
              `住み替えで住み終わりにした家です。売らないので、住み終わりの年（${end.slice(0, 4)}年）で資産・固定資産税・修繕費から外しています（家の価値も売った代金も入りません）。売るなら「住み終わりの後」を「住み終わりの月に売る」に、持ち続けるなら「空き家として持ち続ける」を押します`
            : `売らない家は、住み終わりの年（${end.slice(0, 4)}年）で資産・固定資産税・修繕費から外しています。持ち続けるなら「空き家として持ち続ける」で、貯蓄・運用に貸していない不動産を作ります（人に貸すなら、作った不動産を「収益不動産へ移す」）`;
    const keepActions: ActionDef[] =
      r.sale === undefined && end !== null && held === undefined
        ? [{ key: `${k}/keepVacant`, label: "空き家として持ち続ける", help: "住み終わりの翌月から持ち始める貸していない不動産（空き家）を、貯蓄・運用に作ります。評価額は住み終わりの年の評価額の目安（推定）、建った年・構造・名義を写します", level: "simple", run: (w) => keepAsVacant(w, r.id) }]
        : [];
    // 住み終わりのすぐ下に並べる（持ち家の評価・名義の「▸」の後ろに離れないように）
    // 売るときは詳細の欄（売却の費用・ローンを返すか）があるので「▸」の文を付ける（住み替えで売るとみなしたときにも出る）
    groups.push({ key: ks, title: "住み終わりの後", level: "simple", ...(keepNote !== undefined ? { note: keepNote } : {}), ...(r.sale !== undefined ? { moreLabel: left > 0 ? "売却の費用・ローンの返し方を入れる" : "売却の費用を入れる" } : {}), fields, actions: keepActions, placeIn: { group: k, after: `${k}/to` } });
  }
  return groups;
}

// ---- ローン ----

/**
 * ローンの金利の段階・繰上返済（・借り換え）のまとまり（詳細）。住まい・ローンのカードと、収益不動産の物件のローンで同じ欄。
 * rates は金利の段階の出し方（hide: 全期間固定の当初の引き下げで入れるので出さない、simple: 「金利の段階で入れる」を選んだので標準でも出す。0052 の追記 2026-11-02）
 */
export function loanStepGroups(d: Debt, k: string, o: { refinance?: boolean; rates?: "hide" | "simple" | "detail" } = {}): GroupDef[] {
  const groups: GroupDef[] = [];
  const lv = o.rates === "simple" ? "simple" : "detail";
  if (o.rates !== "hide")
    d.rateSchedule.slice(1).forEach((_, j) => {
      const idx = j + 1;
      const findR: Finder = (h) => (getPath((h.debts ?? []).find((x) => x.id === d.id), ["rateSchedule", String(idx)]) as Record<string, unknown> | undefined) ?? undefined;
      groups.push({
        key: `${k}/rate/${idx}`,
        title: `金利の段階 ${idx + 1}`,
        level: lv,
        fields: [
          timepointField({ key: `${k}/rate/${idx}/from`, item: "debt.rateSchedule", label: "この金利になる年月", level: lv, find: findR, path: ["from"] }),
          plain({ key: `${k}/rate/${idx}/rate`, item: "debt.rateSchedule", label: "金利（年）", level: lv, kind: "pct", find: findR, path: ["rate"] }),
          plain({ key: `${k}/rate/${idx}/type`, item: "debt.rateSchedule", label: "金利の種類", level: lv, kind: "select", options: [{ value: "variable", label: "変動金利" }, { value: "fixedPeriod", label: "固定期間選択型" }, { value: "fixed", label: "全期間固定" }], find: findR, path: ["type"] }),
        ],
        actions: [removeAction(`${k}/rate/${idx}/remove`, "外す", lv, (h) => void ((h.debts ?? []).find((x) => x.id === d.id) as Debt).rateSchedule.splice(idx, 1))],
      });
    });
  (d.prepayments ?? []).forEach((_, j) => {
    const findP: Finder = (h) => (getPath((h.debts ?? []).find((x) => x.id === d.id), ["prepayments", String(j)]) as Record<string, unknown> | undefined) ?? undefined;
    groups.push({
      key: `${k}/prepay/${j}`,
      title: `繰上返済 ${j + 1}`,
      level: "detail",
      fields: [
        timepointField({ key: `${k}/prepay/${j}/at`, item: "debt.prepayments", label: "年月", level: "detail", find: findP, path: ["at"] }),
        plain({ key: `${k}/prepay/${j}/amount`, item: "debt.prepayments", label: "額", level: "detail", kind: "yen", basis: "once", find: findP, path: ["amount"] }),
        plain({
          key: `${k}/prepay/${j}/mode`,
          item: "debt.prepayments",
          label: "方法",
          level: "detail",
          kind: "select",
          options: [
            { value: "shortenTerm", label: "期間短縮型" },
            { value: "reducePayment", label: "返済額軽減型" },
          ],
          find: findP,
          path: ["mode"],
        }),
      ],
      actions: [removeAction(`${k}/prepay/${j}/remove`, "外す", "detail", (h) => void ((h.debts ?? []).find((x) => x.id === d.id) as Debt).prepayments?.splice(j, 1))],
    });
  });
  if (o.refinance === true) groups.push(...refinanceGroups(d, k));
  return groups;
}

/** 借り換え（その月に残高を新しいローンで返す。新しいローンの金利は1つの段で入れる。0080） */
function refinanceGroups(d: Debt, k: string): GroupDef[] {
  const addr = () => at(d.id, "debt.refinance");
  return (d.refinance ?? []).map((_, j) => {
    const findR: Finder = (h) => (getPath((h.debts ?? []).find((x) => x.id === d.id), ["refinance", String(j)]) as Record<string, unknown> | undefined) ?? undefined;
    const findRate: Finder = (h) => (getPath((h.debts ?? []).find((x) => x.id === d.id), ["refinance", String(j), "rateSchedule", "0"]) as Record<string, unknown> | undefined) ?? undefined;
    const kr = `${k}/refinance/${j}`;
    const withA = (f: FieldDef): FieldDef => ({ ...f, address: addr });
    return {
      key: kr,
      title: `借り換え ${j + 1}`,
      level: "detail",
      fields: [
        withA(
          // 新しいローンの金利の始まりも同じ月にそろえる（画面の時点の欄は time.setWhen で書くので、afterWrite で set と両方を包む）
          afterWrite(timepointField({ key: `${kr}/at`, item: "debt.refinance", label: "借り換えの年月", level: "detail", find: findR, path: ["at"], mode: "ym" }), (w, next) =>
            mutate(next, (h, req) => {
              const r = findR(h, { ...w, request: req }) as { at?: unknown; rateSchedule?: { from: unknown }[] } | undefined;
              const first = r?.rateSchedule?.[0];
              if (r?.at !== undefined && first !== undefined) first.from = structuredClone(r.at);
            }),
          ),
        ),
        withA(plain({ key: `${kr}/rate`, item: "debt.refinance", label: "新しい金利（年）", level: "detail", kind: "pct", find: findRate, path: ["rate"] })),
        withA(plain({ key: `${kr}/rateType`, item: "debt.refinance", label: "新しい金利の種類", level: "detail", kind: "select", options: RATE_TYPES, find: findRate, path: ["type"] })),
        withA(plain({ key: `${kr}/term`, item: "debt.refinance", label: "新しい返済期間", level: "detail", kind: "int", suffix: "か月", min: 1, max: 600, find: findR, path: ["termMonths"] })),
        withA(plain({ key: `${kr}/method`, item: "debt.refinance", label: "新しい返済の方法", level: "detail", kind: "select", options: REPAYMENT_METHODS, find: findR, path: ["method"], optional: true, fallback: d.repayment.method })),
        withA(plain({ key: `${kr}/costs`, item: "debt.refinance", label: "借り換えの費用", level: "detail", kind: "yen", basis: "once", find: findR, path: ["costs"], optional: true, help: "保証料・事務手数料・登記の費用などの合計です" })),
        withA(plain({ key: `${kr}/financed`, item: "debt.refinance", label: "費用を新しいローンに含める", level: "detail", kind: "bool", find: findR, path: ["costsFinanced"], optional: true, fallback: false, help: "含めないときは、借り換えの月に費用を払います" })),
      ],
      actions: [removeAction(`${kr}/remove`, "外す", "detail", (h) => void ((h.debts ?? []).find((x) => x.id === d.id) as Debt).refinance?.splice(j, 1))],
    };
  });
}

/** 住宅ローンの1件の中枠（band。0077 の追記）: 欄のキーの末尾（物のキーの後）→ 中枠。どれにも当たらない欄は「借入の内容」 */
const LOAN_BANDS: readonly { id: string; title: string; keys: readonly string[] }[] = [
  { id: "loan", title: "借入の内容", keys: ["entry", "principal", "start", "balance", "balanceAsOf", "product", "debtors", "share", "pair"] },
  { id: "rate", title: "金利", keys: ["rateType", "rate", "rateOutlook", "rateCutPeriod", "rateCut", "rateSteps"] },
  { id: "repay", title: "返済", keys: ["payment", "term", "payoff", "method", "bonus", "fiveYear", "cap125"] },
  { id: "prepay", title: "繰上返済", keys: [] },
  { id: "refinance", title: "借り換え", keys: [] },
  { id: "creditLife", title: "団体信用生命保険", keys: ["creditLife", "clHigh", "clIncapacity", "clDisease", "clMonths", "clRatio", "clJoint"] },
  { id: "credit", title: "住宅ローン控除", keys: ["creditSummary", "credit"] },
];
/** ボタンの置き場所の中枠（ボタンのキーの末尾 → 中枠） */
const LOAN_BAND_ACTIONS: Readonly<Record<string, string>> = { addPair: "loan", addRate: "rate", addPrepay: "prepay", addRefinance: "refinance", creditNa: "credit" };

/**
 * 住宅ローン1件を中枠に分ける（借入の内容・金利・返済・繰上返済・団体信用生命保険・住宅ローン控除。0077 の追記）。
 * 欄とボタンのキー・中身は今のまま、まとまりだけを分ける。金利の段階・繰上返済のまとまりは、それぞれの中枠の中（partOf）に描く。
 * 中枠の欄・ボタンが詳細だけなら、中枠も詳細（標準では物の「▸ 詳しく」で開く）
 */
function mortgageBands(wh: WorkingHousehold, d: Debt, k: string): GroupDef[] {
  const bandOfKey = (key: string): string => {
    const tail = key.slice(k.length + 1).split("/")[0] ?? "";
    return LOAN_BANDS.find((b) => b.keys.includes(tail))?.id ?? "loan";
  };
  const fields = loanFields(wh, d, k);
  // 借り換え（収益不動産のローンと同じ欄。控除は借り換えの後も当初の入居から、対象は借り換えの直前の残高まで。0052 の追記 2026-11-07）
  const actions: ActionDef[] = [
    ...loanMoreActions(wh, d, k),
    { key: `${k}/addRefinance`, label: "＋ 借り換え", level: "detail", help: "その月に残りの残高を新しいローンで返します（新しい金利・期間・費用を入れます）。住宅ローン控除は、借り換えの後も入居の年からの期間の残りを受けます", run: (w) => addHomeRefinance(w, d.id) },
  ];
  const steps = loanStepGroups(d, k, { rates: rateStepsView(wh, d), refinance: true });
  const out: GroupDef[] = [];
  for (const b of LOAN_BANDS) {
    const bk = `${k}/band/${b.id}`;
    const fs = fields.filter((f) => bandOfKey(f.key) === b.id);
    const as = actions.filter((a) => LOAN_BAND_ACTIONS[a.key.slice(k.length + 1)] === b.id);
    const inner = steps
      .filter((g) => (b.id === "rate" && g.key.startsWith(`${k}/rate/`)) || (b.id === "prepay" && g.key.startsWith(`${k}/prepay/`)) || (b.id === "refinance" && g.key.startsWith(`${k}/refinance/`)))
      .map((g) => ({ ...g, partOf: bk }));
    if (fs.length === 0 && as.length === 0 && inner.length === 0) continue;
    const simple = fs.some((f) => f.level === "simple") || as.some((a) => a.level === "simple");
    out.push({ key: bk, title: b.title, band: true, level: simple ? "simple" : "detail", fields: fs, actions: as }, ...inner);
  }
  return out;
}

function loanGroups(wh: WorkingHousehold, d: Debt, i: number, name?: string): GroupDef[] {
  const k = `housing/debt/${d.id}`;
  const debtor = d.debtors.find((x) => x.role === "primary") ?? d.debtors[0];
  const title = d.kind === "mortgage" ? `${name ?? `住宅ローン ${i + 1}`}（${memberLabel(wh, debtor?.member)}）` : `${loanTitle(d)}（${memberLabel(wh, debtor?.member)}）`;
  // 住まいの住宅ローン（ペアローンの2本目も同じ）は欄が多いので、1件の枠の中を中枠に分ける
  const banded = d.kind === "mortgage" && d.property === undefined;
  const groups: GroupDef[] = [
    {
      key: k,
      title,
      level: "simple",
      // 「▸ 続きを見る」の文（0078 の追記 2026-11-01）: 住宅ローンは団信・控除の中枠まで開く。ほかのローン・自動車ローンは金利と返済
      moreLabel: banded ? "団信・住宅ローン控除などを入れる" : "金利・返済方法を入れる",
      fields: banded ? [] : [...otherLoanHeadFields(wh, d, k), ...loanFields(wh, d, k)],
      actions: [
        removeAction(`${k}/remove`, "外す", "simple", (h, w) => {
          h.debts = (h.debts ?? []).filter((x) => x.id !== d.id);
          for (const x of h.debts) if (x.pairWith === d.id) delete x.pairWith;
          dropProvisionalEvent(h, d, w);
          return withProvisionalHousing(withEntry({ ...w, request: { ...w.request, input: { ...w.request.input, household: h } } }, d.id, undefined));
        }),
      ],
    },
  ];
  if (banded) return [...groups, ...mortgageBands(wh, d, k)];
  groups.push(...loanStepGroups(d, k));
  const more = loanMoreActions(wh, d, k);
  const simpleMore = more.filter((a) => a.level === "simple");
  if (simpleMore.length > 0) groups.push({ key: `${k}/simpleActions`, level: "simple", fields: [], actions: simpleMore });
  groups.push({ key: `${k}/more`, level: "detail", fields: [], actions: more.filter((a) => a.level !== "simple") });
  return groups;
}

/** 今返している自動車ローンのまとまり（車のカードに出す。0069）。欄はほかのローンと同じ */
export const carLoanGroups = (wh: WorkingHousehold, d: Debt, i: number): GroupDef[] => loanGroups(wh, d, i);

/** 自動車ローン（今返している分。車のカードで入れる。0069）。目安のボタンの値は推定（0041） */
export function newCarLoan(wh: WorkingHousehold): WorkingHousehold {
  const base = wh.request.input.baseMonth;
  return mutate(wh, (hh) => {
    const self = hh.members.find((m) => m.kind === "self");
    if (self === undefined) return;
    const id = newId();
    const rid = newId();
    const term = presetNum("preset.car.loan.termMonths");
    const d: Debt = { id, kind: "car", debtors: [{ member: self.id, role: "primary" }], principal: presetNum("preset.car.loan.principal"), start: { at: base }, rateSchedule: [{ id: rid, from: { at: base }, type: "fixed", rate: carLoanRateEstimate().rate }], repayment: { method: "equalPayment", termMonths: term } };
    const o = d as unknown as Obj;
    setState(o, "debt.principal", estRow("standard", presetBasis(presetText("preset.car.loan.principal", (v) => `借入額 ${manOf(v)}`))));
    // 金利は車の入力項目の自動車ローンと同じ目安（マスタデータ master.loanRates）
    setState(o, `debt.rateSchedule/${rid}/rate`, estRow("standard", presetBasis(wrapBasis(carLoanRateEstimate().basis, (b) => `固定金利 ${b}`))));
    setState(o, "debt.repayment/termMonths", estRow("standard", presetBasis(presetText("preset.car.loan.termMonths", (v) => (Number(v) % 12 === 0 ? `返済期間${String(Number(v) / 12)}年` : `返済期間${String(v)}か月`)))));
    (hh.debts ??= []).push(d);
  });
}

/** 子の教育ローン・貸与の奨学金（子ども・教育のカードで入れる。ここは読むだけの1行） */
function educationDebtLines(wh: WorkingHousehold): GroupDef[] {
  let loans = 0;
  let scholarships = 0;
  for (const g of wh.request.input.household.goals ?? []) {
    loans += (g.education?.loans ?? []).length;
    scholarships += (g.education?.scholarships ?? []).filter((x) => x.repaidBy === "household").length;
  }
  // 今返している自動車ローンは車のカードで入れる（0069）
  const carLoans = (wh.request.input.household.debts ?? []).filter((d) => d.kind === "car" && d.property === undefined && d.inheritedFrom === undefined).length;
  const lines = [
    ...(carLoans > 0 ? [readLine("housing/carLoans", "自動車ローン", `${carLoans}件`, "車")] : []),
    ...(loans > 0 ? [readLine("housing/eduLoans", "教育ローン", `${loans}件`, "子ども・教育")] : []),
    ...(scholarships > 0 ? [readLine("housing/eduScholarships", "子の貸与の奨学金（世帯で返す）", `${scholarships}件`, "子ども・教育")] : []),
  ];
  const g = readGroup("housing/eduDebts", undefined, lines);
  return g === null ? [] : [g];
}

export function housingStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const selfId = h.members.find((m) => m.kind === "self")?.id;
  const base = wh.request.input.baseMonth;
  // 住まいの重なり・住まいの無い期間の知らせ（0052 の追記 2026-11-07）。住まいの無い期間には次の住まいを足すボタン
  const resNotes = residenceNotes(h, base, wh.request.input.endYear);
  const gapActions: ActionDef[] = resNotes.some((t) => t.includes("先の住まいが入っていません"))
    ? [
        { key: "housing/addNextRent", label: "＋ 次の住まい（賃貸）", level: "simple", run: (w) => mutate(w, (hh, req) => addNextResidence(hh, req.input.endYear, "rent", () => standardBox(rentStandard(), rentBasis()))) },
        { key: "housing/addNextFree", label: "＋ 次の住まい（家賃なし）", level: "simple", run: (w) => mutate(w, (hh, req) => addNextResidence(hh, req.input.endYear, "free", () => standardBox(rentStandard(), rentBasis()))) },
      ]
    : [];
  const resSection: SectionDef = {
    key: "housing/residences",
    title: "住まい",
    note: ["住居費（家賃・固定資産税・修繕費・ローン）はここで入れ、基本生活費には含めません", ...resNotes].join("。"),
    level: "simple",
    groups: (h.residences ?? []).flatMap((r, i) => residenceGroups(wh, r, i)),
    actions: [
      ...gapActions,
      { key: "housing/addRent", label: "＋ 賃貸", level: "simple", run: (w) => mutate(w, (hh) => void (hh.residences ??= []).push({ id: newId(), kind: "rent", from: { at: base }, to: null, rent: { monthly: standardBox(rentStandard(), rentBasis()) } })) },
      {
        key: "housing/addOwn",
        label: "＋ 持ち家（今住んでいる）",
        level: "simple",
        run: (w) => mutate(w, (hh) => void (hh.residences ??= []).push({ id: newId(), kind: "own", from: { at: base }, to: null, propertyTax: { annual: TAX_PRESET() }, maintenance: { monthly: MAINT_PRESET() }, ...(selfId !== undefined ? { ownership: [{ member: selfId, share: "1" }] } : {}) })),
      },
      {
        key: "housing/addFree",
        label: "＋ 家賃なし", help: "実家・親の家など、家賃のかからない住まいです",
        level: "simple",
        run: (w) => mutate(w, (hh) => void (hh.residences ??= []).push({ id: newId(), kind: "rent", from: { at: base }, to: null, rent: { monthly: { state: "notApplicable", origin: { kind: "manual" } } as never } })),
      },
      {
        key: "housing/addPurchase",
        label: "＋ 住宅購入の予定",
        level: "simple",
        run: (w) => {
          const at24 = addMonths(base, presetNum("preset.housing.purchase.afterMonths"));
          // 今の持ち家（住み終わりが空）も購入の前の月で住み終わる（住み替え。推定の印。売る・持ち続けるは「住み終わりの後」で選ぶ。0052 の追記 2026-11-07）
          const movedOut = (w.request.input.household.residences ?? []).filter((r) => r.kind === "own" && r.to === null && (resolveTimepoint(w.request.input.household, r.from) ?? base) < at24).map((r) => r.id);
          let afterMarks: Record<string, string> = {};
          // 住み終わりにした今の賃貸（購入の予定を外すと戻す。0161）
          const rentEnded: string[] = [];
          const added = mutate(w, (hh, req) => {
            // 今の住まい（賃貸・家賃なし・持ち家）は購入の前の月で終える。住み終わりにした持ち家の「住み終わりの後」は初めの値（MOVE_OUT_AFTER）と仮の印
            for (const r of hh.residences ?? [])
              if (r.to === null && (r.kind === "rent" || movedOut.includes(r.id))) {
                r.to = { at: addMonths(at24, -1) };
                if (r.kind === "rent") rentEnded.push(r.id);
              }
            afterMarks = applyMoveOutAfter(hh, movedOut);
            const price = PRICE_PRESET();
            const down = Math.round((price * DOWN_RATE()) / 10000) * 10000;
            const costs = Math.round((price * COSTS_RATE()) / 10000) * 10000;
            const res: Residence = {
              id: newId(),
              kind: "own",
              from: { at: at24 },
              to: null,
              purchase: { at: { at: at24 }, price, downPayment: down, costs },
              propertyTax: { annual: TAX_PRESET() },
              maintenance: { monthly: MAINT_PRESET() },
              ...(selfId !== undefined ? { ownership: [{ member: selfId, share: "1" }] } : {}),
            };
            const o = res as unknown as Obj;
            setState(o, "residence.purchase/price", estRow("standard", presetBasis(presetText("preset.housing.purchase.price", (v) => `物件の価格 ${manOf(v)}`))));
            setState(o, "residence.purchase/downPayment", estRow("derived", downBasis(down)));
            setState(o, "residence.purchase/costs", estRow("standard", costsBasis(costs)));
            setState(o, "residence.purchase/at", estRow("standard", presetText("preset.housing.purchase.afterMonths", (v) => `既定の値（${Number(v) % 12 === 0 ? `${String(Number(v) / 12)}年後` : `${String(v)}か月後`}。直してください）`)));
            (hh.residences ??= []).push(res);
            // 固定資産税は、物件の価格などからの推定（最初の年の額と変化の段。購入の種類を選ぶと入れ直す。0112）
            applyPropertyTaxEstimate(hh, res, req.input.endYear, req.input.assumptions?.realEstateValuation?.landShare, true);
          });
          if (movedOut.length === 0 && rentEnded.length === 0) return added;
          return { ...added, assumed: { ...added.assumed, ...Object.fromEntries(rentEnded.map((id) => [toKey(id), MOVE_OUT_RENT_ASSUMED])), ...Object.fromEntries(movedOut.map((id) => [toKey(id), MOVE_OUT_ASSUMED])), ...afterMarks } };
        },
      },
    ],
  };
  // 住宅購入の予定につながる住宅ローンは、住宅の購入の中に出す（0175）。ここはそれ以外（今の家のローンなど）
  const inPurchase = new Set((h.residences ?? []).filter((r) => r.kind === "own" && r.purchase !== undefined).flatMap((r) => purchaseLoans(h, r).map((d) => d.id)));
  const mortgages = (h.debts ?? []).filter((d) => d.kind === "mortgage" && d.property === undefined && !inPurchase.has(d.id));
  // 住まい以外の不動産のローン（debt.property）は、その不動産の欄（貯蓄・運用）で入れる
  // 今返している自動車ローンは車のカード（0069。ここは読むだけの1行）
  const others = (h.debts ?? []).filter((d) => d.kind !== "mortgage" && d.kind !== "car" && d.property === undefined && d.inheritedFrom === undefined);
  const inherited = (h.debts ?? []).filter((d) => d.kind !== "mortgage" && d.property === undefined && d.inheritedFrom !== undefined);
  const loanSection: SectionDef = {
    key: "housing/loans",
    title: "住宅ローン",
    ...(inPurchase.size > 0 ? { note: "住宅購入の予定の住宅ローンは、住まいの「住宅の購入」の中に出しています" } : {}),
    level: "simple",
    groups: mortgages.flatMap((d, i) => loanGroups(wh, d, i)),
    actions: [{ key: "housing/addMortgage", label: "＋ 住宅ローン", level: "simple", run: (w) => withProvisionalHousing(newMortgage(w)) }],
  };
  const otherSection: SectionDef = {
    key: "housing/otherDebts",
    title: "ほかのローン（カードローン・奨学金など）",
    ...(inherited.length > 0 ? { note: `相続で受け継ぐ借金（${inherited.length}件）の返済の欄もここに出します。元の借り手と見込みは相続・贈与の項目で直します` } : {}),
    level: "simple",
    groups: [...[...others, ...inherited].flatMap((d, i) => loanGroups(wh, d, i)), ...educationDebtLines(wh)],
    actions: [
      // ボタンはカードローン・リボ、奨学金の返済、リフォームローン、そのほかのローン（種類を選んで足す）。0052 の追記 2026-11-08
      // リフォームローンは持ち家（購入の予定を含む）がある世帯だけ
      ...LOAN_SUBTYPES.filter((s) => s.value === "cardLoan" || s.value === "scholarship" || (s.value === "renovation" && (h.residences ?? []).some((r) => r.kind === "own"))).map((s) => ({ key: `housing/add/${s.value}`, label: `＋ ${s.value === "scholarship" ? "奨学金の返済" : s.label}`, level: s.value === "renovation" ? ("detail" as const) : ("simple" as const), run: (w: WorkingHousehold) => newOtherLoan(w, s.value) })),
      // 会社からの借入金は役員のいる世帯だけ（そのときはボタンを標準に出す。0105）
      ...MISC_SUBTYPES.filter((v) => v !== "companyLoan" || hasExecutive(h)).map((v) => ({
        key: `housing/add/${v}`,
        label: LOAN_SUBTYPES.find((s) => s.value === v)?.label ?? v,
        level: hasExecutive(h) ? ("simple" as const) : ("detail" as const),
        choice: { key: "housing/add/misc", label: "＋ そのほかのローン", help: "種類を選んで足します。足した後も「種類」の欄で選び直せます" },
        run: (w: WorkingHousehold) => newOtherLoan(w, v),
      })),
    ],
  };
  return { id: "housing", label: "住まい・ローン", lead: "賃貸か持ち家か、購入の予定、住宅ローンとほかのローン。", sections: [resSection, loanSection, otherSection] };
}
