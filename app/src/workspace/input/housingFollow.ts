// 住まいの時期のつながり（0052 の追記 2026-11-07）:
// - 購入の時期を直したら、前の購入の月と同じだった物（この家の住み始め・前の住まいの住み終わり・購入の住宅ローンの借入の年月と金利の段・控除の入居）を一緒に動かす
// - 住まいの重なり・住まいの無い期間の知らせ
// - 住み終わって売らない持ち家を「空き家として持ち続ける」（貯蓄・運用の貸していない不動産を作る）
// - 相続する家の住み始めの推定を、受け取る相続の時期に合わせる
import type { Account, Debt, Household, Residence, YearSeries } from "../../engine/types.ts";
import { addMonths } from "../levers.ts";
import { monthsBetween } from "../timepoint.ts";
import { resolveTimepoint } from "./form.ts";
import { newId, type WorkingHousehold } from "./household.ts";
import { USEFUL_LIFE, VALUATION_DEFAULTS } from "./labels.ts";
import { formatYearMonth, formatYen } from "./units.ts";
import { isCustomBuild, landMonthOf } from "./customBuild.ts";
import { homeLoansOf } from "./housingCredit.ts";
export { followInheritedHome, inheritFromAssumed } from "./housingCredit.ts";

const isHomeLoan = (d: Debt): boolean => d.kind === "mortgage" && d.property === undefined;
const tp = (ym: string) => ({ at: ym });

/** 時点の欄の仮の印の鍵（住まいの住み始め・住み終わり） */
export const fromKey = (rid: string): string => `housing/res/${rid}/from`;
export const toKey = (rid: string): string => `housing/res/${rid}/to`;

/** 住み替えで今の持ち家を購入の前の月で住み終わらせたときの印 */
export const MOVE_OUT_ASSUMED = "住み替え: 購入の前の月で住み終わるとみなしています（売る・持ち続けるは「住み終わりの後」で選びます。直してください）";

export const afterKey = (rid: string): string => `housing/res/${rid}/after`;

/**
 * 住み替え（「＋ 住宅購入の予定」）で住み終わりにした今の持ち家の「住み終わりの後」の初めの値。keep は売らない（住み終わりの年で計算から外す）、
 * sell は住み終わりの月に売る（売却価格は空欄＝その年の評価額。住宅ローンが残れば売る月に返す）。
 * 利用者の判断（2026-11-07）で sell（住み替えの多くは前の家を売るので。売らないと家の価値が資産から消え、売った代金も入らない）。
 * 足すときの初めの値と仮の印の文だけが変わる（今ある世帯は書き換えない。0136 の追記）
 */
export const MOVE_OUT_AFTER: "keep" | "sell" = "sell";

/** 住み替えで住み終わりにした今の持ち家の「住み終わりの後」の仮の印 */
export const moveOutAfterMark = (after: "keep" | "sell"): string =>
  after === "sell"
    ? "住み替え: 住み終わりの月に売るとみなしています（売却価格は空欄なら評価額。持ち続けるなら「売らない」を選んで「空き家として持ち続ける」）"
    : "住み替え: 売らないとみなしています（家の価値も売った代金も、住み終わりの後は計算に入りません。売るなら「住み終わりの月に売る」を選んでください）";

/** 住み替えで住み終わりにした今の持ち家に「住み終わりの後」の初めの値を入れる（h を書き換える）。返すのは仮の印（欄のキー → 文） */
export function applyMoveOutAfter(h: Household, ids: readonly string[], after: "keep" | "sell" = MOVE_OUT_AFTER): Record<string, string> {
  for (const r of h.residences ?? []) if (ids.includes(r.id) && after === "sell") r.sale ??= {};
  return Object.fromEntries(ids.map((id) => [afterKey(id), moveOutAfterMark(after)]));
}

/**
 * 購入の時期を old から next に直した後の世帯に、前の購入の月と同じだった物をついてこさせる（h を書き換える）:
 * - この家の住み始め（old と同じなら。購入の1件の住み始めは購入の時期と同じ）
 * - 前の住まいの住み終わり（old の前の月なら next の前の月へ）
 * - 借入の年月が old か、控除の条件の住まいがこの家の住宅ローン（ペアローンの2本とも・注文住宅の引き渡しのローン。土地の分のローンは除く）:
 *   借入の年月を next にし、年月で入れた金利の段（最初の段・当初の引き下げの終わり・金利の見込みの段）を同じだけずらす。控除の入居が old ならそれも
 */
export function followPurchaseMonth(h: Household, rid: string, old: string, next: string): void {
  if (old === next) return;
  const r = (h.residences ?? []).find((x) => x.id === rid);
  if (r === undefined) return;
  if (resolveTimepoint(h, r.from) === old) r.from = r.purchase !== undefined ? structuredClone(r.purchase.at) : tp(next);
  const prevEnd = addMonths(old, -1);
  for (const x of h.residences ?? []) if (x.id !== rid && x.to != null && resolveTimepoint(h, x.to) === prevEnd) x.to = tp(addMonths(next, -1));
  const land = r.purchase !== undefined && isCustomBuild(r) ? landMonthOf(h, r) : null;
  for (const d of h.debts ?? []) {
    if (!isHomeLoan(d)) continue;
    const start = resolveTimepoint(h, d.start);
    // 借入の年月が前の購入の月のローンと、控除の条件の住まいがこの家のローン（借入の年月が少しずれていても）。土地の分のローンは土地の決済の時期のまま
    if (start === null || start === land || (start !== old && d.housing?.residence !== rid)) continue;
    const by = monthsBetween(next, start);
    d.start = tp(next);
    for (const s of d.rateSchedule) {
      if (s.from.at === undefined) continue;
      s.from = tp(s.from.at <= start ? next : addMonths(s.from.at, by));
    }
    const ev = (h.events ?? []).find((e) => e.id === d.housing?.moveIn);
    if (ev !== undefined && resolveTimepoint(h, ev.at) === old) ev.at = tp(next);
  }
}

/** 購入の1件の住み始めが購入の時期とずれているときの知らせ（前の版の世帯・ほかの欄で直した世帯） */
export function purchaseFromGap(h: Household, r: Residence): string | null {
  if (r.purchase === undefined) return null;
  const at = resolveTimepoint(h, r.purchase.at);
  const from = resolveTimepoint(h, r.from);
  if (at === null || from === null || at === from) return null;
  return `住み始め（${formatYearMonth(from)}）と${isCustomBuild(r) ? "建物の引き渡しの時期" : "購入の時期"}（${formatYearMonth(at)}）が違います。購入した家には購入の月から住むとみなすので、住み始めを合わせます`;
}

/** 住み始めを購入の時期に合わせる */
export function alignFromToPurchase(h: Household, rid: string): void {
  const r = (h.residences ?? []).find((x) => x.id === rid);
  if (r?.purchase !== undefined) r.from = structuredClone(r.purchase.at);
}

/**
 * 購入の家の住宅ローンで、借入の年月が購入の時期（注文住宅は土地の決済か引き渡しの月）と違うもの（FP が借入の年月を手で変えたなど）。
 * 控除の条件の住まいがその購入の家のローンだけを見る
 */
export function loanPurchaseGap(h: Household, d: Debt): { residence: Residence; purchase: string; start: string } | null {
  if (!isHomeLoan(d) || d.housing?.residence === undefined) return null;
  const r = (h.residences ?? []).find((x) => x.id === d.housing?.residence && x.kind === "own" && x.purchase !== undefined);
  if (r?.purchase === undefined) return null;
  const purchase = resolveTimepoint(h, r.purchase.at);
  const start = resolveTimepoint(h, d.start);
  if (purchase === null || start === null || start === purchase || start === landMonthOf(h, r)) return null;
  return { residence: r, purchase, start };
}

/** 借入の年月を購入の時期に合わせる（金利の段も同じだけずらす） */
export function alignLoanToPurchase(h: Household, debtId: string): void {
  const d = (h.debts ?? []).find((x) => x.id === debtId);
  const g = d === undefined ? null : loanPurchaseGap(h, d);
  if (d === undefined || g === null) return;
  const shift = monthsBetween(g.purchase, g.start);
  d.start = tp(g.purchase);
  for (const s of d.rateSchedule) if (s.from.at !== undefined) s.from = tp(s.from.at <= g.start ? g.purchase : addMonths(s.from.at, shift));
  const ev = (h.events ?? []).find((e) => e.id === d.housing?.moveIn);
  if (ev !== undefined && resolveTimepoint(h, ev.at) === g.start) ev.at = tp(g.purchase);
}

/**
 * その持ち家の住宅ローン（計算エンジンの debt.schedule の売ったときに返すローンと同じ見分け方）: 控除の条件の住まいがその家か購入でつながるローン、
 * 控除の条件の無いローン（今の残高から入れた）は借入の月にその家に住んでいるもの
 */
export function loansOfHome(h: Household, r: Residence): Debt[] {
  const linked = homeLoansOf(h, r);
  const from = resolveTimepoint(h, r.from);
  const to = r.to == null ? null : resolveTimepoint(h, r.to);
  const living = (h.debts ?? []).filter((d) => {
    if (!isHomeLoan(d) || d.inheritedFrom !== undefined || d.housing !== undefined || linked.includes(d)) return false;
    const s = resolveTimepoint(h, d.start);
    return s !== null && from !== null && from <= s && (to === null || s <= to);
  });
  return [...linked, ...living];
}

// ---- 住まいの重なり・住まいの無い期間 ----

interface Span {
  r: Residence;
  from: string;
  to: string | null;
}
function spans(h: Household): Span[] {
  return (h.residences ?? [])
    .map((r) => ({ r, from: resolveTimepoint(h, r.from), to: r.to == null ? null : resolveTimepoint(h, r.to) }))
    .filter((x): x is Span => x.from !== null)
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** 住まいが2つ重なる最初の月（今より前の重なりは今から。重なりが無ければ null） */
export function overlapFrom(h: Household, base: string): string | null {
  const rs = spans(h);
  let first: string | null = null;
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i] as Span;
      const b = rs[j] as Span;
      const from = a.from > b.from ? a.from : b.from;
      const aEnd = a.to ?? "9999-12";
      const bEnd = b.to ?? "9999-12";
      const to = aEnd < bEnd ? aEnd : bEnd;
      if (from > to || to < base) continue;
      const m = from > base ? from : base;
      if (first === null || m < first) first = m;
    }
  return first;
}

/** 最後の住まいの住み終わりの翌月（表の最後の年より前に住まいが無くなるとき。無くならなければ null） */
export function gapFrom(h: Household, endYear: number): string | null {
  const rs = spans(h);
  if (rs.length === 0) return null;
  const last = rs.reduce((x, y) => ((y.to ?? "9999-12") > (x.to ?? "9999-12") ? y : x));
  if (last.to === null || Number(last.to.slice(0, 4)) >= endYear) return null;
  return addMonths(last.to, 1);
}

/** 住まいの区画の知らせ（重なり・住まいの無い期間。無ければ空） */
export function residenceNotes(h: Household, base: string, endYear: number): string[] {
  const out: string[] = [];
  const o = overlapFrom(h, base);
  if (o !== null) out.push(`${formatYearMonth(o)}から住まいが2つ重なっています（住居費を両方払っています）。住み替えなら前の住まいの住み終わりを直します。二拠点で暮らすなら、そのままで構いません`);
  const g = gapFrom(h, endYear);
  if (g !== null) out.push(`${formatYearMonth(g)}から先の住まいが入っていません（住居費0円で計算中）。次の住まいを足します。施設に入る予定は、介護・親の項目で入れます`);
  return out;
}

/** 住まいの無い期間の次の住まいを足す（賃貸か家賃なし。gap の月から最後まで） */
export function addNextResidence(h: Household, endYear: number, kind: "rent" | "free", rent: () => NonNullable<Residence["rent"]>["monthly"]): void {
  const g = gapFrom(h, endYear);
  if (g === null) return;
  (h.residences ??= []).push({
    id: newId(),
    kind: "rent",
    from: tp(g),
    to: null,
    rent: kind === "rent" ? { monthly: rent() } : { monthly: { state: "notApplicable", origin: { kind: "manual" } } as never },
  });
}

// ---- 持ち家の評価の目安 ----

const seriesAt = (v: YearSeries | undefined, year: number): number | null => {
  const r = v?.byYear?.[String(year)] ?? v?.default;
  return r === undefined ? null : Number(r);
};

/**
 * 持ち家のその年の評価額の目安（計算エンジンの housing.valuation と同じ決まり: 評価の基にする額〔無ければ購入の価格〕を土地の割合で分け、
 * 土地は前提の上昇率〔空欄なら物価上昇率〕で毎年伸ばし、建物は構造の耐用年数で定額で減らして下限より下げない）。画面の目安なので端数は丸めない
 */
export function homeValueAt(wh: WorkingHousehold, r: Residence, year: number): { land: number; building: number } | null {
  const h = wh.request.input.household;
  const v = r.valuation;
  const value = v?.value?.value ?? r.purchase?.price;
  if (value == null) return null;
  const asOf = v?.asOf ?? (r.purchase !== undefined ? resolveTimepoint(h, r.purchase.at) : null) ?? wh.request.input.baseMonth;
  const y0 = Number(asOf.slice(0, 4));
  const a = wh.request.input.assumptions;
  const setting = a?.realEstateValuation;
  const share = Number(v?.landShare ?? setting?.landShare ?? VALUATION_DEFAULTS.landShare);
  let land = Math.floor(value * share);
  const building0 = value - land;
  for (let y = y0 + 1; y <= year; y++) land = Math.floor(land * (1 + (seriesAt(setting?.landGrowth, y) ?? seriesAt(a?.inflation, y) ?? 0)));
  const structure = v?.structure ?? "wood";
  const life = (setting?.usefulLife as Record<string, number> | undefined)?.[structure] ?? USEFUL_LIFE[structure] ?? 22;
  const floor = Number(setting?.residualFloor ?? VALUATION_DEFAULTS.residualFloor);
  const built = v?.builtYear ?? y0;
  const f = (age: number) => (age <= 0 ? 1 : Math.max(floor, 1 - age / life));
  const f0 = f(y0 - built);
  const building = f0 === 0 || f(year - built) === f0 ? building0 : Math.floor((building0 * f(year - built)) / f0);
  return { land, building };
}

/**
 * 建った年から見た今の土地の割合の目安（今の時価で入れるとき）: 新築のときの土地の割合（前提条件か目安）のまま、建物だけが耐用年数で減ったとみなす。
 * 割合 s0、建物の残り f なら s0 ÷（s0 ＋（1−s0）× f）
 */
export function landShareByAge(wh: WorkingHousehold, r: Residence, year: number): number | null {
  const v = r.valuation;
  if (v?.builtYear === undefined) return null;
  const setting = wh.request.input.assumptions?.realEstateValuation;
  const s0 = Number(setting?.landShare ?? VALUATION_DEFAULTS.landShare);
  const structure = v.structure ?? "wood";
  const life = (setting?.usefulLife as Record<string, number> | undefined)?.[structure] ?? USEFUL_LIFE[structure] ?? 22;
  const floor = Number(setting?.residualFloor ?? VALUATION_DEFAULTS.residualFloor);
  const age = year - v.builtYear;
  const f = age <= 0 ? 1 : Math.max(floor, 1 - age / life);
  return Math.round((s0 / (s0 + (1 - s0) * f)) * 100) / 100;
}

// ---- 空き家として持ち続ける ----

/** 住み終わった持ち家から作った貸していない不動産（空き家）。住み終わりの翌月から持ち始める空き家で、建った年・構造が同じもの */
export function heldFromHome(h: Household, r: Residence): Account | undefined {
  const end = r.to == null ? null : resolveTimepoint(h, r.to);
  if (end === null) return undefined;
  const start = addMonths(end, 1);
  return (h.accounts ?? []).find((a) => a.kind === "realEstate" && a.property === undefined && a.subtype === "vacantHouse" && a.holdFrom !== undefined && resolveTimepoint(h, a.holdFrom) === start);
}

/**
 * 空き家として持ち続ける: 住み終わりの翌月から持ち始める貸していない不動産（中身: 空き家）を貯蓄・運用に作る。評価額は住み終わりの年の評価額の目安（推定）、
 * 建った年・構造・名義（持分の大きい人）を写す。住まいは住み終わりで計算から外れたまま（二重にしない）
 */
export function keepAsVacant(wh: WorkingHousehold, rid: string): WorkingHousehold {
  const request = structuredClone(wh.request);
  const h = request.input.household;
  const r = (h.residences ?? []).find((x) => x.id === rid);
  const end = r?.to == null ? null : resolveTimepoint(h, r.to);
  if (r === undefined || end === null || heldFromHome(h, r) !== undefined) return wh;
  const start = addMonths(end, 1);
  const year = Number(end.slice(0, 4));
  const v = homeValueAt(wh, r, year);
  const value = v === null ? 0 : Math.round((v.land + v.building) / 10000) * 10000;
  const owners = [...(r.ownership ?? [])].sort((a, b) => Number(b.share) - Number(a.share));
  const owner = owners[0]?.member ?? h.members.find((m) => m.kind === "self")?.id;
  if (owner === undefined) return wh;
  const shared = owners.filter((o) => Number(o.share) > 0).length > 1;
  const basis = v === null ? "未入力（住み終わったときの評価額を入れてください。0円で計算中）" : `住まいの評価から出した${year}年の評価額の目安（${formatYen(value, "man")}万円。${shared ? "共有の家は持分の大きい人の名義にしています。" : ""}直してください）`;
  const a: Account = {
    id: newId(),
    kind: "realEstate",
    subtype: "vacantHouse",
    owner,
    marketValue: { value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis } } as never,
    asOf: start,
    contributions: [],
    holdFrom: tp(start),
    ...(r.valuation?.builtYear !== undefined ? { builtYear: r.valuation.builtYear } : r.purchase !== undefined ? { builtYear: Number((resolveTimepoint(h, r.purchase.at) ?? start).slice(0, 4)) } : {}),
    ...(r.valuation?.structure !== undefined ? { structure: r.valuation.structure } : r.style === "condo" ? { structure: "rc" } : {}),
  };
  (h.accounts ??= []).push(a);
  return { ...wh, request };
}
