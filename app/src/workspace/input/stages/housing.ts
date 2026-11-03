// 7. 住まい・ローン（0052）: 住まい（賃貸・持ち家・家賃なし。住み始めと住み終わりは時点の部品）、持ち家の建て方・税・修繕・名義、
// 購入の予定と住宅資金の援助、住み終わりの後（そのまま持つ・売る）と譲渡所得の税の額（0053）、持ち家の評価、相続する家への切り替え、
// 住宅ローンとほかのローン（housingLoans.ts）。お金の行（補助金・売電・修繕）は moneyRows.ts の区画を後ろに置く（stages/index.ts）
import type { Debt, Household, Residence, YearSeries } from "../../../engine/types.ts";
import { addMonths } from "../../levers.ts";
import { byId, field, getPath, plain, removeAction, resolveTimepoint, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, presetBasis, standardBox, wrapBasis, type WorkingHousehold } from "../household.ts";
import { rentBasis, rentStandard } from "../fill.ts";
import { dropProvisionalEvent, PRINCIPAL_ESTIMATE, principalKey, purchaseMonth, withProvisionalHousing } from "../housingCredit.ts";
import { applyPropertyTaxEstimate, hasAutoTaxStages, isAutoTax as isAutoBox, purchaseLoans, rememberDroppedTaxStage } from "../propertyTax.ts";
import { buildingPriceOf, CUSTOM_KEYS, customBuildNotes, isCustomBuild, landLoansOf, landMonthOf, startCustomBuild, stopCustomBuild } from "../customBuild.ts";
import { BUILDING_STRUCTURES, donorOptions, HOUSING_EXEMPTION, memberLabel, memberOptions, RATE_TYPES, REPAYMENT_METHODS, TAX_METHODS, USEFUL_LIFE, VALUATION_DEFAULTS } from "../labels.ts";
import type { StateRow } from "../rows.ts";
import { formatYen } from "../units.ts";
import { rentGrowthStatistic } from "../../../../../hearing/src/housingEstimates.ts";
import { carLoanRateEstimate } from "../../../../../hearing/src/loanRates.ts";
import { pctText } from "../../../../../hearing/src/housingEstimates.ts";
import { presetNum, presetText } from "../../../../../hearing/src/presets.ts";
import { readGroup, readLine } from "../readLines.ts";
import { stagedBadge, stagedGroups, type StagedSpec } from "../staged.ts";
import { at, creditLifeFields, creditLifeGroups, estRow, loanFields, loanMoreActions, loanTitle, LOAN_SUBTYPES, newMortgage, newOtherLoan, rateStepsView, otherLoanHeadFields, withEntry } from "./housingLoans.ts";
import { GROWTH_RANGE } from "../rateRanges.ts";
import { hasExecutive } from "../officer.ts";

export { creditLifeFields, creditLifeGroups, loanFields };

type Obj = Record<string, unknown>;
const residences = (h: Household) => h.residences;

/** 万円の文字（「12万円」「1.5万円」） */
const manOf = (v: number | string) => `${formatYen(Number(v), "man")}万円`;
/** 目安のボタンの値（0041。推定の標準の値で入れる。値は presets.ts の目安） */
const TAX_PRESET = () => standardBox(presetNum("preset.housing.propertyTax"), presetBasis(presetText("preset.housing.propertyTax", (v) => `固定資産税・都市計画税 年${manOf(v)}`)));
const MAINT_PRESET = () => standardBox(presetNum("preset.housing.maintenance"), presetBasis(presetText("preset.housing.maintenance", (v) => `修繕費・管理費 月${manOf(v)}`)));
const PRICE_PRESET = () => presetNum("preset.housing.purchase.price");
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
  if (r.style === "condo") return { amount: "管理費・修繕積立金（毎月）", growth: "管理費・修繕積立金の変動率（年）", what: "管理費・修繕積立金" };
  if (r.style === "house") return { amount: "修繕の積み立て（毎月）", growth: "修繕の積み立ての変動率（年）", what: "修繕の積み立て" };
  return { amount: "修繕・管理の費用（毎月）", growth: "修繕・管理の費用の変動率（年）", what: "修繕・管理の費用" };
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
  const options = [...memberOptions(wh, (m) => m.kind === "self" || (m.kind === "spouse" && m.outside === undefined)).map((o) => ({ value: o.value, label: `${o.label}が100%` })), ...(spouse !== undefined ? [{ value: "shared", label: "夫婦の共有" }] : [])];
  const fields: FieldDef[] = [
    {
      ...field({
        key: `${k}/owner`,
        item: "residence.ownership",
        label: "名義と持分",
        level: "detail",
        kind: "select",
        structural: true,
        options,
        help: "評価額を名義の人の資産として数えます。住宅ローン控除の持分もここから",
        get: (w) => ({ value: pick(own(w)) }),
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
        label: "本人の持分",
        level: "detail",
        kind: "pct",
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
  fields.push(
    timepointField({ key: `${k}/from`, item: "residence.from", label: "住み始め", level: showPeriod ? "simple" : "detail", find, path: ["from"], mode: "ym", anchor: "moveIn", ...ageOf }),
    timepointField({ key: `${k}/to`, item: "residence.to", label: "住み終わり", level: showPeriod ? "simple" : "detail", find, path: ["to"], startPath: ["from"], optional: true, nullText: "最後まで住む", ...ageOf }),
  );
  if (r.kind === "rent" && !free) {
    fields.push(
      yenBox({
        key: `${k}/rent`,
        item: "residence.rent",
        label: "家賃（管理費込み）",
        level: "simple",
        basis: "monthly",
        // 住み始めが計算の基準の月より前なら、今の家賃（計算エンジンは基準の月より後の更新から変動率を当てる。housing.residence の改訂4）
        help: "今払っている家賃です。前から住んでいる家は、住み始めたときの額ではなく今の額を入れます（変動率は、これから来る更新の月から使います）",
        find,
        path: ["rent", "monthly"],
      }),
      plain({
        key: `${k}/rentGrowth`,
        item: "residence.rent",
        // 年率。計算エンジンは更新の月に、前の更新から経った年数分をまとめて上げ下げする。計算基準月より前の更新は入れた額に含まれるとみなす（housing.residence の改訂4）
        label: "家賃の変動率（年）",
        level: "detail",
        kind: "pct",
        ...GROWTH_RANGE,
        find,
        path: ["rent", "growth"],
        optional: true,
        fallback: "0",
        help: "年あたりの率です。更新の年に、その間の年数分をまとめて上げ下げします。入れなければ変えません",
        hint: (_v, w) => {
          const x = find(w.request.input.household, w) as Residence | undefined;
          const st = rentGrowthStatistic();
          return x?.rent?.growth === undefined && st !== null ? `目安: ${st.text}。入れないとき（変えない）はこれに近い計算です` : null;
        },
      }),
      plain({ key: `${k}/renewalFee`, item: "residence.rent", label: "更新料（家賃の何か月分）", level: "detail", kind: "decimal", suffix: "か月分", find, path: ["rent", "renewalFee"], optional: true, fallback: "0" }),
      { ...plain({ key: `${k}/renewalEvery`, item: "residence.rent", label: "更新の間隔", level: "detail", kind: "int", suffix: "か月ごと", min: 1, max: 120, find, path: ["rent", "renewalEveryMonths"], optional: true, fallback: 24 }), address: () => at(r.id, "residence.rent", ["renewalEveryMonths"]) },
    );
  } else if (r.kind === "own") {
    fields.push(
      // 購入の予定の持ち家は、建て方を購入の種類で決める（欄を重ねない。0052 の追記 2026-11-03）
      ...(buying ? [] : [styleField(r, k)]),
      yenBox({ key: `${k}/tax`, item: "residence.propertyTax", label: "固定資産税・都市計画税", level: "detail", basis: "annual", find, path: ["propertyTax", "annual"] }),
      {
        ...plain({
          key: `${k}/taxGrowth`,
          item: "residence.propertyTax",
          label: "固定資産税の変動率（年）",
          level: "detail",
          kind: "pct",
          ...GROWTH_RANGE,
          find,
          path: ["propertyTax", "growth"],
          optional: true,
          fallback: "0",
          // 推定の段（新築の軽減の終わり・評価替え）があるときは、段と率の関係を書く。計算は段の額に、計算の基準の年からの年数分この率を掛ける（housing.residence）
          help: hasAutoTaxStages(h0, r)
            ? "固定資産税の推定の段（新築の軽減の終わり・評価替え）で額を動かしています。変動率を入れると、段の額にさらに毎年この率を掛けます（評価替えの下がり方は段に入っているので、ふつうは入れません）"
            : "入れなければ変えません。建物の評価が下がる分は、「＋ 固定資産税の変化」で入れられます",
          hint: (_v, w) => {
            const x = find(w.request.input.household, w) as Residence | undefined;
            return x !== undefined && x.propertyTax?.growth === undefined && hasAutoTaxStages(w.request.input.household, x) ? "下の推定の段で動かしています（変動率は入れなくて構いません）" : null;
          },
        }),
        address: () => at(r.id, "residence.propertyTax", ["growth"]),
      },
      yenBox({
        key: `${k}/maint`,
        item: "residence.maintenance",
        label: ml.amount,
        level: "simple",
        basis: "monthly",
        find,
        path: ["maintenance", "monthly"],
        help: r.style === "condo" ? "管理組合に払う管理費と修繕積立金の合計です" : r.style === "house" ? "将来の修繕のために毎月積み立てておく額です" : "マンションなら管理費と修繕積立金の合計、戸建てなら将来の修繕のための毎月の積み立てです（建て方は「詳細」で選べます）",
      }),
      plain({ key: `${k}/maintGrowth`, item: "residence.maintenance", label: ml.growth, level: "detail", kind: "pct", ...GROWTH_RANGE, find, path: ["maintenance", "growth"], optional: true, help: "入れなければ変えません。外壁・屋根などの大きな修繕は、下の「出るお金」の修繕・リフォームの行で入れます" }),
      ...ownershipFields(wh, r, k),
    );
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
      ...(part === "propertyTax" ? { onRemoveStage: (h: Household, sid: string) => rememberDroppedTaxStage(h, r.id, sid) } : {}),
      flow: "out",
      // 額の変化は、その額の欄（と変動率の欄）のすぐ後に並べる
      place: { group: k, after: `${k}/${part === "rent" ? "rentGrowth" : part === "maintenance" ? "maintGrowth" : "taxGrowth"}` },
    });
  const stagedParts = r.kind === "rent" ? (r.rent !== undefined && !free ? [["rent", "家賃"]] : []) : [...(r.maintenance !== undefined ? [["maintenance", ml.what]] : []), ...(r.propertyTax !== undefined ? [["propertyTax", "固定資産税"]] : [])];
  const badges = stagedParts.map(([part, what]) => {
    return stagedBadge(r as unknown as Record<string, unknown>, [part as string, "stages"], [part as string, "exceptions"], what as string);
  }).filter((x) => x !== null);
  const actions: ActionDef[] = [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.residences = (h.residences ?? []).filter((x) => x.id !== r.id)))];
  if (free && r.to === null) actions.unshift({ key: `${k}/inherit`, label: "この家を相続する", help: "住まいを持ち家に切り替えます", level: "simple", run: (w) => inheritHome(w, r.id) });
  // 購入の予定の持ち家は「住宅の購入」の1件（購入の欄を頭に、住まいの欄をその後に。別の住まいを足したように見せない）
  if (buying) fields.unshift(...purchaseFields(wh, r, k));
  const groups: GroupDef[] = [
    {
      key: k,
      title: buying ? "住宅の購入" : `住まい ${i + 1}（${free ? "家賃なし" : r.kind === "rent" ? "賃貸" : "持ち家"}）`,
      ...(badges.length > 0 ? { note: `${badges.join("、")}（「詳細」で直せます）` } : free ? { note: "家賃はかかりません。住んでいる家を相続するなら、「この家を相続する」で持ち家に切り替えます（貯蓄・運用の不動産には入れません）" } : {}),
      level: "simple",
      // 「▸ 続きを見る」の文（0078 の追記 2026-11-01）: 住まいの種類で開く欄が違う
      moreLabel: buying ? "名義・固定資産税などを入れる" : free ? "住む期間を入れる" : r.kind === "rent" ? "更新料・家賃の変化を入れる" : "評価額・固定資産税などを入れる",
      fields,
      actions,
    },
  ];
  if (r.kind === "rent" && r.rent !== undefined && !free) groups.push(...staged("rent", "家賃", "monthly", (x) => x.rent?.monthly.value ?? null));
  if (r.kind === "own") {
    if (r.maintenance !== undefined) groups.push(...staged("maintenance", ml.what, "monthly", (x) => x.maintenance?.monthly.value ?? null));
    if (r.propertyTax !== undefined) groups.push(...staged("propertyTax", "固定資産税", "annual", (x) => x.propertyTax?.annual.value ?? null, true));
  }
  if (buying) groups.push(...customPaymentGroups(wh, r, k), ...giftGroups(wh, r, k));
  if (r.kind === "own") groups.push(...valuationGroups(wh, r, k));
  return groups;
}

/**
 * この家を相続する（0052。家賃なしの住まいに住んでいて、その家を相続する）: 家賃なしの住まいを相続の時点で終え、同じ家の持ち家を翌月から足す。
 * 時点は、相続・贈与のカードの受け取る相続の行があればその月、無ければ10年後（直してください）。評価額は未入力（相続の見込みの額を入れる）、
 * 税・修繕は目安のボタンの値。貯蓄・運用に別の不動産は作らない（二重にしない）
 */
export function inheritHome(wh: WorkingHousehold, id: string): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const r = (h.residences ?? []).find((x) => x.id === id);
    const self = h.members.find((m) => m.kind === "self");
    if (r === undefined || self === undefined) return;
    const flow = (h.incomeFlows ?? []).find((f) => f.kind === "inheritance");
    const when = (flow !== undefined ? resolveTimepoint(h, flow.from) : null) ?? addMonths(req.input.baseMonth, 120);
    r.to = { at: addMonths(when, -1) };
    const next: Residence = { id: newId(), kind: "own", from: { at: when }, to: null, propertyTax: { annual: TAX_PRESET() }, maintenance: { monthly: MAINT_PRESET() }, ownership: [{ member: self.id, share: "1" }], valuation: { asOf: when } };
    (h.residences ??= []).push(next);
  });
}

// ---- 購入の予定と住宅資金の援助 ----

/** 購入の予定の欄（「住宅の購入」の1件の頭に並べる。欄のキーは前の版の購入のまとまりと同じ <住まい>/purchase/…） */
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
    // 頭金・諸費用が推定（出どころ auto）なら、価格に合わせて入れ直す（注文住宅の諸費用は土地と建物とつなぎ融資から入れ直す。customBuild.ts）
    after: (_h, target, v) => {
      const res = target as unknown as Residence & Obj;
      if (res.purchase === undefined || typeof v !== "number") return;
      if (isAutoEstimate(stateOf(res, "residence.purchase/downPayment"))) {
        res.purchase.downPayment = Math.round((v * DOWN_RATE()) / 10000) * 10000;
        setState(res, "residence.purchase/downPayment", estRow("derived", downBasis(res.purchase.downPayment)));
      }
      if (!isCustomBuild(res) && isAutoEstimate(stateOf(res, "residence.purchase/costs"))) {
        const nb = res.purchase.newBuild;
        res.purchase.costs = Math.round((v * COSTS_RATE(nb)) / 10000) * 10000;
        setState(res, "residence.purchase/costs", estRow("standard", costsBasis(res.purchase.costs, nb)));
      }
    },
  });
  const used = purchaseTypeOf(wh, r)?.type.startsWith("used") === true;
  // 長期優良住宅か（固定資産税の新築の軽減の年数。0112）: つながる住宅ローンに控除の条件があれば、控除の住宅の種類で選ぶので出さない
  const h0 = wh.request.input.household;
  const viaCredit = purchaseLoans(h0, r).some((d) => d.housing !== undefined);
  const notes = custom ? customBuildNotes(h0, r) : [];
  return [
    purchaseTypeField(r, k),
    {
      ...timepointField({
        key: `${kp}/at`,
        item: "residence.purchase",
        label: custom ? "建物の引き渡しの時期" : "購入の時期",
        level: "simple",
        find,
        path: ["purchase", "at"],
        mode: "ym",
        ...ageOf,
        ...(custom ? { help: "建物が完成して引き渡しを受け、住宅ローン（本融資）を借りる月です。残りの頭金と諸費用をこの月に払います" } : {}),
      }),
      address: () => at(r.id, "residence.purchase", ["at"]),
    },
    price,
    ...(custom ? customLandFields(wh, r, k, ageOf) : []),
    // 中古は建物が建った年を標準に出す（評価の建物の目減りと固定資産税の目安に使う。新築は購入の年に完成とみなすので「持ち家の評価」の詳細の欄）
    ...(used ? [builtYearField(wh, r, k)] : []),
    // 頭金・諸費用は空にできない（計算エンジンの入力で必須。空にすると欄を消して、計算が止まっていた）。無いときは 0 を入れる
    plain({
      key: `${kp}/down`,
      item: "residence.purchase",
      label: custom ? "頭金（合計）" : "頭金",
      level: "simple",
      kind: "yen",
      basis: "once",
      find,
      path: ["purchase", "downPayment"],
      help: custom ? "自己資金で払う額の合計です。土地の決済・建物の代金の支払い（「詳細」）で払う分の残りを、引き渡しの月に払います。無ければ 0 を入れます" : "頭金が無ければ 0 を入れます",
    }),
    ...(custom
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
function builtYearField(wh: WorkingHousehold, r: Residence, k: string): FieldDef {
  const find = byId(residences, r.id);
  const bought = r.purchase !== undefined;
  const used = bought && purchaseTypeOf(wh, r)?.type.startsWith("used") === true;
  const asOf = r.valuation?.asOf ?? (r.purchase !== undefined ? resolveTimepoint(wh.request.input.household, r.purchase.at) : null) ?? wh.request.input.baseMonth;
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
        : `入れなければ、その額の時点（${asOfYear}年）に新築とみなします。わかれば建った年を入れてください`,
  });
}

/** 住宅資金の援助（購入の予定の「住宅の購入」の1件の中に描く。キーが <住まい>/purchase/gift/… なので、その枠の中のまとまりになる） */
function giftGroups(wh: WorkingHousehold, r: Residence, k: string): GroupDef[] {
  const find = byId(residences, r.id);
  const kp = `${k}/purchase`;
  const groups: GroupDef[] = [];
  (r.purchase?.gifts ?? []).forEach((g, j) => {
    const findG: Finder = (h, w) => (getPath(find(h, w), ["purchase", "gifts", String(j)]) as Record<string, unknown> | undefined) ?? undefined;
    const kg = `${kp}/gift/${j}`;
    const gid = g.id as string | undefined;
    const amount = plain({ key: `${kg}/amount`, item: "residence.purchase", label: "援助の額", level: "simple", kind: "yen", basis: "once", find: findG, path: ["amount"], help: "目安は作りません（外れると結果を大きく誤らせるため）。受け取る予定の額を入れてください" });
    groups.push({
      key: kg,
      title: `住宅資金の援助 ${j + 1}`,
      ...(g.donor !== undefined ? { note: "贈与する人から出すので、援助の額は世帯の資産から出しません。受け取るのは購入の月です" } : { note: "受け取るのは購入の月です" }),
      level: "simple",
      moreLabel: "受け取る人・課税の方法を入れる",
      fields: [
        plain({ key: `${kg}/donor`, item: "residence.purchase", label: "援助する人", level: "simple", kind: "select", options: donorOptions(wh), find: findG, path: ["donor"], optional: true, fallback: "", help: "家族の項目で足した親・祖父母（世帯の外の家族）から選びます" }),
        gid === undefined ? amount : { ...amount, address: () => at(r.id, "residence.purchase", ["gifts", gid, "amount"]) },
        plain({ key: `${kg}/recipient`, item: "residence.purchase", label: "受け取る人", level: "detail", kind: "select", options: memberOptions(wh, (m) => m.kind === "self" || m.kind === "spouse"), find: findG, path: ["recipient"] }),
        plain({ key: `${kg}/tax`, item: "residence.purchase", label: "贈与税の課税方法", level: "detail", kind: "select", options: TAX_METHODS, find: findG, path: ["taxMethod"], optional: true, fallback: "calendar" }),
        plain({ key: `${kg}/exempt`, item: "residence.purchase", label: "住宅取得等資金の非課税", level: "detail", kind: "select", options: HOUSING_EXEMPTION, find: findG, path: ["housingExemption"], optional: true, fallback: "none" }),
      ],
      actions: [
        removeAction(`${kg}/remove`, "外す", "simple", (h, w) => {
          const res = find(h, w) as Residence | undefined;
          if (res?.purchase?.gifts !== undefined) {
            if (gid !== undefined) setState(res as unknown as Obj, `residence.purchase/gifts/${gid}/amount`, undefined);
            res.purchase.gifts = res.purchase.gifts.filter((_, x) => x !== j);
            if (res.purchase.gifts.length === 0) delete res.purchase.gifts;
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
            (res.purchase.gifts ??= []).push({ id, recipient: self2.id, giver: donor?.kind ?? "parent", ...(donor !== undefined ? { donor: donor.id } : {}), amount: 0, housingExemption: "energySaving" });
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
  const y0 = Number(v.asOf.slice(0, 4));
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
  return `${baseYear}年の評価額の目安: 約${formatYen(Math.round((land + building) / 10000) * 10000, "man")}万円（土地 ${formatYen(Math.round(land / 10000) * 10000, "man")}万円・建物 ${formatYen(Math.round(building / 10000) * 10000, "man")}万円）`;
}

const AFTER_CHOICES = [
  { value: "keep", label: "そのまま持つ" },
  { value: "sell", label: "住み終わりの月に売る" },
];

/**
 * 持ち家の評価（資産と負債の推移・提案書のバランスシート・相続税の目安に使う）と、住み終わりの後（そのまま持つ・売る）。
 * 購入の予定がある持ち家は物件の価格から、今住んでいる持ち家は評価額（または購入の価格と時点）から評価する。評価額が無い今の持ち家は未入力の警告
 */
function valuationGroups(wh: WorkingHousehold, r: Residence, k: string): GroupDef[] {
  const find = byId(residences, r.id);
  const kv = `${k}/valuation`;
  const bought = r.purchase !== undefined;
  const base = wh.request.input.baseMonth;
  const setting = wh.request.input.assumptions?.realEstateValuation;
  const asOf = r.valuation?.asOf ?? (r.purchase !== undefined ? resolveTimepoint(wh.request.input.household, r.purchase.at) : null) ?? base;
  const groups: GroupDef[] = [
    {
      key: kv,
      title: "持ち家の評価",
      // 純資産と相続税の目安にだけ効き、お金の流れには効かないので詳細（0078）
      level: "detail",
      ...(!bought && r.valuation?.value === undefined ? { note: "評価額を入れると、資産と負債の推移・提案書のバランスシート・相続税の目安に不動産として入ります（今は0円で数えています）" } : {}),
      fields: [
        yenBox({
          key: `${kv}/value`,
          item: "residence.valuation",
          label: bought ? "評価の基にする額" : "評価額",
          level: "detail",
          basis: "once",
          find,
          path: ["valuation", "value"],
          // 今の持ち家で評価額が無ければ未入力の警告（購入の予定は物件の価格を使うので空欄でよい）
          optional: bought,
          help: bought
            ? "入れなければ、物件の価格を購入の月の評価額にし、土地の割合で土地と建物に分けて、建物は構造の耐用年数で毎年減らします（土地は前提条件の上昇率で動きます）。新築の値段の上乗せ分などで買った直後の売値が下がると見込むなら、その額を入れます"
            : "土地と建物の合計。わからなければ購入の価格を入れます。購入の価格を入れたときは、時点に購入の年月を入れます。相続する家は相続の見込みの額",
          hint: (w) => valuationHint(w, r),
        }),
        plain({ key: `${kv}/asOf`, item: "residence.valuation", label: bought ? "その額の時点" : "その額の時点（購入の年月）", level: "detail", kind: "ym", find, path: ["valuation", "asOf"], optional: true, fallback: asOf }),
        {
          ...plain({ key: `${kv}/structure`, item: "residence.valuation", label: "建物の構造", level: "detail", kind: "select", options: BUILDING_STRUCTURES, find, path: ["valuation", "structure"], optional: true, fallback: "wood", help: "建物を耐用年数（木造22年・軽量鉄骨19年・重量鉄骨34年・鉄筋コンクリート47年）で減らします。建て方から目安を出します" }),
          address: () => at(r.id, "residence.valuation", ["structure"]),
        },
        // 建物が建った年（中古の購入の予定は住宅の購入の頭に出すので、ここには出さない）
        ...(bought && purchaseTypeOf(wh, r)?.type.startsWith("used") === true ? [] : [builtYearField(wh, r, k)]),
        // 注文住宅は土地の代金で土地と建物を分ける（土地の割合の欄は出さない。0115。評価の基にする額を入れたときは割合で分けるので出す）
        ...(isCustomBuild(r) && r.valuation?.value === undefined
          ? []
          : [plain({ key: `${kv}/landShare`, item: "residence.valuation", label: "土地の割合", level: "detail", kind: "pct", min: 0, max: 100, find, path: ["valuation", "landShare"], optional: true, fallback: setting?.landShare ?? VALUATION_DEFAULTS.landShare, help: "入れなければ前提条件の値。土地は前提条件の上昇率（入れていなければ物価上昇率）で動きます" })]),
      ],
      actions: [],
    },
  ];
  if (r.to !== null) {
    const ks = `${k}/sale`;
    const fields: FieldDef[] = [
      field({
        key: `${k}/after`,
        item: "residence.sale",
        label: "住み終わりの後",
        level: "simple",
        kind: "select",
        options: AFTER_CHOICES,
        structural: true,
        help: "売ると、売却価格から売却の費用を引いた手取りが預金に入り、その年から不動産は無くなります。人に貸すときは、収益不動産の入力項目で入れます",
        get: (w) => ({ value: (find(w.request.input.household, w) as Residence | undefined)?.sale !== undefined ? "sell" : "keep" }),
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
        plain({ key: `${ks}/price`, item: "residence.sale", label: "売却価格", level: "simple", kind: "yen", basis: "once", find, path: ["sale", "price"], optional: true, help: "入れなければ、その年の評価額で売るとみなします" }),
        plain({ key: `${ks}/cost`, item: "residence.sale", label: "売却の費用（売却価格に対する割合）", level: "detail", kind: "pct", find, path: ["sale", "costRate"], optional: true, fallback: setting?.saleCostRate ?? VALUATION_DEFAULTS.saleCostRate, help: "仲介手数料・印紙税など。住宅ローンが残るときは、売る月の繰上返済で返します" }),
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
    groups.push({ key: ks, title: "住み終わりの後", level: "simple", fields, actions: [] });
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
          field({
            ...timepointField({ key: `${kr}/at`, item: "debt.refinance", label: "借り換えの年月", level: "detail", find: findR, path: ["at"], mode: "ym" }),
            // 新しいローンの金利の始まりも同じ月にそろえる
            set: (w, v) =>
              mutate(timepointField({ key: `${kr}/at`, item: "debt.refinance", label: "借り換えの年月", level: "detail", find: findR, path: ["at"], mode: "ym" }).set(w, v), (h, req) => {
                const r = findR(h, { ...w, request: req }) as { at?: unknown; rateSchedule?: { from: unknown }[] } | undefined;
                const first = r?.rateSchedule?.[0];
                if (r?.at !== undefined && first !== undefined) first.from = structuredClone(r.at);
              }),
          }),
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
  { id: "creditLife", title: "団体信用生命保険", keys: ["creditLife", "clHigh", "clIncapacity", "clDisease", "clMonths", "clRatio", "clJoint"] },
  { id: "credit", title: "住宅ローン控除", keys: ["creditSummary", "credit"] },
];
/** ボタンの置き場所の中枠（ボタンのキーの末尾 → 中枠） */
const LOAN_BAND_ACTIONS: Readonly<Record<string, string>> = { addPair: "loan", addRate: "rate", addPrepay: "prepay", creditNa: "credit" };

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
  const actions = loanMoreActions(wh, d, k);
  const steps = loanStepGroups(d, k, { rates: rateStepsView(wh, d) });
  const out: GroupDef[] = [];
  for (const b of LOAN_BANDS) {
    const bk = `${k}/band/${b.id}`;
    const fs = fields.filter((f) => bandOfKey(f.key) === b.id);
    const as = actions.filter((a) => LOAN_BAND_ACTIONS[a.key.slice(k.length + 1)] === b.id);
    const inner = steps.filter((g) => (b.id === "rate" && g.key.startsWith(`${k}/rate/`)) || (b.id === "prepay" && g.key.startsWith(`${k}/prepay/`))).map((g) => ({ ...g, partOf: bk }));
    if (fs.length === 0 && as.length === 0 && inner.length === 0) continue;
    const simple = fs.some((f) => f.level === "simple") || as.some((a) => a.level === "simple");
    out.push({ key: bk, title: b.title, band: true, level: simple ? "simple" : "detail", fields: fs, actions: as }, ...inner);
  }
  return out;
}

function loanGroups(wh: WorkingHousehold, d: Debt, i: number): GroupDef[] {
  const k = `housing/debt/${d.id}`;
  const debtor = d.debtors.find((x) => x.role === "primary") ?? d.debtors[0];
  const title = d.kind === "mortgage" ? `住宅ローン ${i + 1}（${memberLabel(wh, debtor?.member)}）` : `${loanTitle(d)}（${memberLabel(wh, debtor?.member)}）`;
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
  const resSection: SectionDef = {
    key: "housing/residences",
    title: "住まい",
    note: "住居費（家賃・固定資産税・修繕費・ローン）はここで入れ、基本生活費には含めません",
    level: "simple",
    groups: (h.residences ?? []).flatMap((r, i) => residenceGroups(wh, r, i)),
    actions: [
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
        run: (w) =>
          mutate(w, (hh, req) => {
            const at24 = addMonths(base, presetNum("preset.housing.purchase.afterMonths"));
            // 今の住まい（賃貸・家賃なし）は購入の前の月で終える
            for (const r of hh.residences ?? []) if (r.kind === "rent" && r.to === null) r.to = { at: addMonths(at24, -1) };
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
          }),
      },
    ],
  };
  const mortgages = (h.debts ?? []).filter((d) => d.kind === "mortgage" && d.property === undefined);
  // 住まい以外の不動産のローン（debt.property）は、その不動産の欄（貯蓄・運用）で入れる
  // 今返している自動車ローンは車のカード（0069。ここは読むだけの1行）
  const others = (h.debts ?? []).filter((d) => d.kind !== "mortgage" && d.kind !== "car" && d.property === undefined && d.inheritedFrom === undefined);
  const inherited = (h.debts ?? []).filter((d) => d.kind !== "mortgage" && d.property === undefined && d.inheritedFrom !== undefined);
  const loanSection: SectionDef = {
    key: "housing/loans",
    title: "住宅ローン",
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
      ...LOAN_SUBTYPES.filter((s) => s.value !== "policyLoan" && s.value !== "personal" && s.value !== "scholarshipFree" && (s.value !== "companyLoan" || hasExecutive(h))).map((s) => ({ key: `housing/add/${s.value}`, label: `＋ ${s.value === "scholarship" ? "奨学金の返済" : s.label}`, level: s.value === "cardLoan" || s.value === "scholarship" || s.value === "companyLoan" ? ("simple" as const) : ("detail" as const), run: (w: WorkingHousehold) => newOtherLoan(w, s.value) })),
    ],
  };
  return { id: "housing", label: "住まい・ローン", lead: "賃貸か持ち家か、購入の予定、住宅ローンとほかのローン。", sections: [resSection, loanSection, otherSection] };
}
