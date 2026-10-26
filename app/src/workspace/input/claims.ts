// 雇用保険の給付を受け取るか（0037 の欄。0047）: 働き方の期間の「失業給付を受け取る」（employment.unemploymentClaim）と
// 「高年齢雇用継続給付を受け取る」（employment.elderlyContinuationClaim）。
// - エンジンは欄が無ければ受け取らない（開いた世帯を黙って変えない）。推定（おまかせ）は画面が新しく作った期間に入れる値で、
//   値と、期間の値の状態の行（推定・出どころ auto）の組で持つ。行のある値は、期間が変わったら入れ直す（refreshClaims）
// - 推定の決まりはエンジンの SDK の estimateUnemploymentClaim と同じ（65歳未満で辞め、次に働くまで3か月以上、休業のまま辞めるのでなければ受け取る）。
//   高年齢雇用継続給付は、60〜64歳の月を含む雇用保険の勤めの期間なら受け取る（要件と額はエンジンが判定する）
// - 古い世帯の期間（欄も行も無い）は、確かめの一覧に「失業給付を入れていません」を出す（fill.ts の gapsOf。推定で埋める・受け取らない）
import type { EmploymentPeriod, Household, Member } from "../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import type { WorkingHousehold } from "./household.ts";
import { isRow, type StateRow } from "./rows.ts";

type Obj = Record<string, unknown>;

/** 失業給付を受け取ると推定する、辞めてから次に働くまでの月数（エンジンの UNEMPLOYMENT_ESTIMATE_MIN_IDLE_MONTHS と同じ） */
export const MIN_IDLE_MONTHS = 3;
/** 高年齢求職者給付金に変わる年齢（制度の値 employmentInsurance.basicAllowance.elderlyAge の今の値） */
export const ELDERLY_AGE = 65;

/** 辞めた後に失業給付の対象になりうる勤めの種類（雇用保険に入る型。公務員・役員・自営は入らない）と、休業 */
const UNEMPLOYMENT_TYPES = new Set(["regular", "contract", "partTime", "leave"]);
/** 高年齢雇用継続給付の対象になりうる勤めの種類 */
const CONTINUATION_TYPES = new Set(["regular", "contract", "partTime"]);

export const UNEMPLOYMENT_ITEM = "employment.unemploymentClaim";
export const CONTINUATION_ITEM = "employment.elderlyContinuationClaim";

export const UNEMPLOYMENT_BASIS = "65歳未満で辞め、次に働くまで3か月以上あれば受け取る";
export const CONTINUATION_BASIS = "60〜64歳で雇用保険に入って働く月は受け取る（要件と額は計算で判定）";

/** 辞め方（employment.endsWith）の省略のときの値（エンジンと同じ: 終わりの月に60歳に達しているか定年の出来事なら定年、ほかは自己都合） */
export function defaultEndsWith(h: Household, m: Member, p: EmploymentPeriod): string {
  const to = p.to === null ? null : resolveTimepoint(h, p.to);
  if (to !== null && to >= ageReachedMonth(m, 60)) return "retirement";
  if (p.to?.event !== undefined && (h.events ?? []).find((e) => e.id === p.to?.event)?.kind === "retirement") return "retirement";
  return "voluntary";
}

/** 辞めてから次に働くまでの月数（次の期間が無ければ無限）。次に働く期間は、終わりの後に始まる期間のうち無職でないもの */
function idleMonths(h: Household, p: EmploymentPeriod, to: string): number {
  let next: string | null = null;
  for (const q of h.employmentPeriods ?? []) {
    if (q.member !== p.member || q.id === p.id || q.type === "unemployed") continue;
    const from = resolveTimepoint(h, q.from);
    if (from === null || from <= to) continue;
    if (next === null || from < next) next = from;
  }
  if (next === null) return Number.POSITIVE_INFINITY;
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  const [ny, nm] = next.split("-").map(Number) as [number, number];
  return (ny - ty) * 12 + (nm - tm) - 1;
}

/** 失業給付の欄を出す期間か（終わりのある雇用保険の勤め・休業） */
export function unemploymentApplies(h: Household, p: EmploymentPeriod): boolean {
  return UNEMPLOYMENT_TYPES.has(p.type) && p.to !== null && resolveTimepoint(h, p.to) !== null;
}

/** 失業給付を受け取るかの推定（エンジンの estimateUnemploymentClaim と同じ決まり）。欄を出さない期間は false */
export function unemploymentEstimate(h: Household, p: EmploymentPeriod): boolean {
  const m = h.members.find((x) => x.id === p.member);
  const to = p.to === null ? null : resolveTimepoint(h, p.to);
  if (m === undefined || to === null || !unemploymentApplies(h, p)) return false;
  const endsWith = p.endsWith;
  return ageAt(m, to) < ELDERLY_AGE && idleMonths(h, p, to) >= MIN_IDLE_MONTHS && endsWith !== "sickLeave";
}

/** 高年齢雇用継続給付の欄を出す期間か（60〜64歳の月を含む雇用保険の勤め） */
export function continuationApplies(h: Household, p: EmploymentPeriod): boolean {
  const m = h.members.find((x) => x.id === p.member);
  if (m === undefined || !CONTINUATION_TYPES.has(p.type)) return false;
  const from = resolveTimepoint(h, p.from);
  const to = p.to === null ? "9999-12" : resolveTimepoint(h, p.to);
  if (from === null || to === null) return false;
  return from <= addMonths(ageReachedMonth(m, 65), -1) && to >= ageReachedMonth(m, 60);
}

const estimatedRow = (basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis } });

const rowOf = (p: EmploymentPeriod, item: string): StateRow | undefined => {
  const v = (p as unknown as Obj).valueStates;
  const r = v !== null && typeof v === "object" ? (v as Obj)[item] : undefined;
  return isRow(r) ? r : undefined;
};

/** 推定（おまかせ）のままの値か（期間の行が推定・出どころ auto） */
export const isEstimated = (p: EmploymentPeriod, item: string): boolean => {
  const r = rowOf(p, item);
  return r?.state === "estimated" && r.origin.kind === "auto";
};

/** 推定の値と行を書く（p をそのまま書き換える） */
export function putEstimate(p: EmploymentPeriod, item: string, value: boolean, basis: string): void {
  const o = p as unknown as Obj;
  o[item === UNEMPLOYMENT_ITEM ? "unemploymentClaim" : "elderlyContinuationClaim"] = value;
  const states = (o.valueStates !== null && typeof o.valueStates === "object" ? o.valueStates : (o.valueStates = {})) as Obj;
  states[item] = estimatedRow(basis);
}

/** 値と行を外す（p をそのまま書き換える） */
export function dropClaim(p: EmploymentPeriod, item: string): void {
  const o = p as unknown as Obj;
  delete o[item === UNEMPLOYMENT_ITEM ? "unemploymentClaim" : "elderlyContinuationClaim"];
  const states = o.valueStates as Obj | undefined;
  if (states !== undefined && states !== null) {
    delete states[item];
    if (Object.keys(states).length === 0) delete o.valueStates;
  }
}

/** 期間に推定（おまかせ）を入れる（欄を出す期間だけ。h の上でそのまま書き換える） */
export function estimateClaims(h: Household, p: EmploymentPeriod): void {
  if (unemploymentApplies(h, p)) putEstimate(p, UNEMPLOYMENT_ITEM, unemploymentEstimate(h, p), UNEMPLOYMENT_BASIS);
  if (continuationApplies(h, p)) putEstimate(p, CONTINUATION_ITEM, true, CONTINUATION_BASIS);
}

/** 推定（おまかせ）のままの値を、期間の今の形に合わせて入れ直す（h の上でそのまま書き換える。推定でない値・欄の無い期間は変えない） */
export function refreshClaims(h: Household): void {
  for (const p of h.employmentPeriods ?? []) {
    if (isEstimated(p, UNEMPLOYMENT_ITEM)) {
      const v = unemploymentEstimate(h, p);
      if (p.unemploymentClaim !== v) p.unemploymentClaim = v;
    }
    if (isEstimated(p, CONTINUATION_ITEM)) {
      const v = continuationApplies(h, p);
      if (p.elderlyContinuationClaim !== v) p.elderlyContinuationClaim = v;
    }
  }
}

/**
 * 画面で新しく作った期間に推定（おまかせ）を入れる（働き方と収入のカードの欄・ボタンの後）。新しく作った期間は、前の世帯に無い ID の期間と、
 * 前の世帯の同じ ID の期間が推定を持っていたのに、作り直されて欄も行も無くなった期間（定年後の期間を働く最後の年齢で作り直したとき）
 */
export function markNewPeriods(before: WorkingHousehold, after: WorkingHousehold): WorkingHousehold {
  if (before === after) return after;
  const hb = before.request.input.household;
  const ha = after.request.input.household;
  const old = new Map((hb.employmentPeriods ?? []).map((p) => [p.id, p]));
  const fresh = (p: EmploymentPeriod, item: string, value: unknown): boolean => {
    const was = old.get(p.id);
    if (value !== undefined || rowOf(p, item) !== undefined) return false;
    return was === undefined || isEstimated(was, item);
  };
  const want = (ha.employmentPeriods ?? []).filter((p) => fresh(p, UNEMPLOYMENT_ITEM, p.unemploymentClaim) || fresh(p, CONTINUATION_ITEM, p.elderlyContinuationClaim));
  if (want.length === 0) return after;
  const request = structuredClone(after.request);
  const h = request.input.household;
  for (const w of want) {
    const p = (h.employmentPeriods ?? []).find((x) => x.id === w.id) as EmploymentPeriod;
    if (fresh(p, UNEMPLOYMENT_ITEM, p.unemploymentClaim) && unemploymentApplies(h, p)) putEstimate(p, UNEMPLOYMENT_ITEM, unemploymentEstimate(h, p), UNEMPLOYMENT_BASIS);
    if (fresh(p, CONTINUATION_ITEM, p.elderlyContinuationClaim) && continuationApplies(h, p)) putEstimate(p, CONTINUATION_ITEM, true, CONTINUATION_BASIS);
  }
  return { ...after, request };
}

/** 古い世帯の、失業給付を入れていない期間（欄も行も無く、推定なら受け取る期間）。確かめの一覧に出す */
export function missingUnemployment(h: Household): EmploymentPeriod[] {
  return (h.employmentPeriods ?? []).filter((p) => {
    const m = h.members.find((x) => x.id === p.member);
    return m !== undefined && (m.kind === "self" || m.kind === "spouse") && p.unemploymentClaim === undefined && rowOf(p, UNEMPLOYMENT_ITEM) === undefined && unemploymentEstimate(h, p);
  });
}
