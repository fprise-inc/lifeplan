// 空欄を補う目安の値（0008 の2 の「推定」。出どころは auto、estimate に統計名と年度を書く）。
// 目安の数と純粋な計算は、ヒアリングシートの取り込みと同じ hearing/src/estimates.ts（正本は data/ の YAML の写し。0008 の追記 2026-10-26）。
// ここには世帯（Household）を見て当てる部分と、元の入力が変わったときの入れ直しだけを置く
import type { Box, EmploymentPeriod, Household, LivingExpense, Member } from "../../engine/types.ts";
import { ageAt } from "../levers.ts";
import { refreshClaims } from "./claims.ts";
import { refreshEducation } from "./fill.ts";
import { refreshRetirement } from "./retirementBenefits.ts";
import { applyAutoStages, countAt } from "./livingStages.ts";
import {
  livingEstimate as livingBySize,
  residentTaxEstimate,
  splitLiving,
  residentTaxYear,
  salaryEstimate,
  smrEstimate as smrBoxes,
  type Estimate,
} from "../../../../hearing/src/estimates.ts";

export type { Estimate };
export { businessEstimate, careerStartMonth, CAR_ESTIMATE, residentTaxEstimate, residentTaxYear, salaryEstimate } from "../../../../hearing/src/estimates.ts";

/**
 * 今（計算基準月）世帯で暮らしている人の数（生活費の人数）。予定の子・生年月が計算基準月より後の子・離れた人・自宅外の在学中の子・施設の介護の人は数えない。
 * 世帯の外の家族は、家計を1つにする期間で生活費の人数に入れる（living）ときだけ数える（0035 の4・0049）
 */
export function householdSize(h: Household, baseMonth: string): number {
  return countAt(h, baseMonth, { now: true });
}

export function livingEstimate(h: Household, baseMonth: string): Estimate {
  return livingBySize(householdSize(h, baseMonth));
}

/** 給与の推定に使う年齢: その期間の始まりと計算基準月の遅いほうの月の年齢 */
export function salaryAge(m: Member, p: Pick<EmploymentPeriod, "from">, baseMonth: string): number {
  return ageAt(m, smrMonth(p, baseMonth));
}

/** 年齢の目安の文（画面の補助） */
export function ageNote(h: Household, memberId: string, month: string): string | null {
  const m = h.members.find((x) => x.id === memberId);
  return m === undefined ? null : `${ageAt(m, month)}歳`;
}

/** 標準報酬月額の目安（年収÷12 を、その月の等級表に当てた額。hearing/src/estimates.ts の smrEstimate） */
export function smrEstimate(annual: number, month: string): { health: Box<number>; pension: Box<number> } {
  return smrBoxes(annual, month) as { health: Box<number>; pension: Box<number> };
}

/** 標準報酬月額の目安の等級表を引く月: その期間の始まりと計算基準月の遅いほう */
export function smrMonth(p: Pick<EmploymentPeriod, "from">, baseMonth: string): string {
  const at = p.from.at;
  return at !== undefined && at > baseMonth ? at : baseMonth;
}

const isAuto = (b: Box<number> | undefined) => b !== undefined && b.state === "estimated" && b.origin.kind === "auto";

/** わからない（unknown）の代わりの値が、統計の推定のまま（入れ直す対象。0035 の3。FP の前の値を代わりにしたものは入れ直さない） */
const statSubstitute = (b: Box<number> | undefined): Box<number> | undefined => {
  if (b === undefined || b.state !== "unknown") return undefined;
  const sub = (b as { substitute?: Box<number> & { estimate?: { method?: string } } }).substitute;
  return sub !== undefined && sub.origin.kind === "auto" && sub.estimate?.method === "statistic" ? sub : undefined;
};

/**
 * 自動で入れた推定の値を、ほかの入力に合わせて入れ直す（FP が入れた値・確定の値は変えない）。
 * 「推定は入力の時点で世帯に入れ、元の入力が変わったら入れ直す」（0008 の未確定の決定）
 */
export function refreshEstimates(h: Household, baseMonth: string, endYear?: number): void {
  for (const l of h.livingExpenses ?? []) {
    refreshSplit(h, baseMonth, l);
    if (l.mode === "total" && isAuto(l.monthly)) {
      const e = livingEstimate(h, baseMonth);
      l.monthly = { ...(l.monthly as Box<number>), value: e.value, estimate: { method: "statistic", basis: e.basis } } as Box<number>;
    } else if (l.mode === "total" && statSubstitute(l.monthly) !== undefined) {
      // わからないの代わりの値も、推定のままなら入れ直す（わからないの印は残す）
      const e = livingEstimate(h, baseMonth);
      l.monthly = { ...(l.monthly as Box<number>), substitute: { ...(statSubstitute(l.monthly) as Box<number>), value: e.value, estimate: { method: "statistic", basis: e.basis } } } as Box<number>;
    }
  }
  // 給与・賞与の統計の推定（年齢・性別・働き方の種類で決まる。統計の目安が新しくなったときも入れ直す）
  for (const p of h.employmentPeriods ?? []) {
    const m = h.members.find((x) => x.id === p.member);
    if (m === undefined || p.salary === undefined) continue;
    const est = salaryEstimate(p.type, m.sex, { age: salaryAge(m, p, baseMonth) });
    if (est === null) continue;
    const redo = (b: Box<number> | undefined, e: Estimate): Box<number> | undefined => {
      const cur = (b as { estimate?: { method?: string; basis?: string } } | undefined)?.estimate;
      return b !== undefined && isAuto(b) && cur?.method === "statistic" && (b.value !== e.value || cur.basis !== e.basis) ? ({ ...b, value: e.value, estimate: { method: "statistic", basis: e.basis } } as Box<number>) : b;
    };
    const annual = redo(p.salary.annual, est.annual) as Box<number>;
    const bonus = redo(p.salary.bonus, est.bonus);
    if (annual !== p.salary.annual || bonus !== p.salary.bonus) p.salary = { ...p.salary, annual, ...(bonus !== undefined ? { bonus } : {}) };
  }
  const fy = residentTaxYear(baseMonth);
  for (const a of (h.residentTaxAssessments ?? []) as { member: string; fiscalYear?: number; amount: Box<number> }[]) {
    if (!isAuto(a.amount)) continue;
    const inc = incomeBefore(h, a.member, baseMonth);
    const e = residentTaxEstimate(inc.salary, inc.business, (a.fiscalYear ?? fy) - 1);
    if (a.amount.value !== e.value) a.amount = { ...a.amount, value: e.value };
  }
  // 推定のままの子の進路（標準の進路の型。fill.ts）は、子の生年月・計算基準月に合わせて入れ直す
  refreshEducation(h, baseMonth);
  // 推定のままの退職給付（退職一時金の目安・見込みの計算の最終の月給と理由）は、勤続・辞め方・学歴・年収に合わせて入れ直す（0057）
  refreshRetirement(h);
  // 生活費の推定の段階（人数の変化と年齢から。推定のままの段だけ。livingStages.ts）。進路の後に（自宅外の在学を読むため）
  const last = endYear ?? Number(baseMonth.slice(0, 4)) + 80;
  for (const l of h.livingExpenses ?? []) applyAutoStages(h, baseMonth, last, l);
  // 推定（おまかせ）のままの失業給付・高年齢雇用継続給付を受け取るかは、期間の終わり・次の期間・年齢に合わせて入れ直す（claims.ts）
  refreshClaims(h);
  for (const p of h.employmentPeriods ?? []) {
    const smr = (p as EmploymentPeriod).standardMonthlyRemuneration;
    const annual = p.salary?.annual.value;
    if (smr !== undefined && annual != null && isAuto(smr.health) && isAuto(smr.pension)) {
      const e = smrEstimate(annual, smrMonth(p, baseMonth));
      if (smr.health.value !== e.health.value || smr.pension.value !== e.pension.value) p.standardMonthlyRemuneration = e;
    }
  }
}

// ---- 費目の按分（総額を家計調査の同じ人数の世帯の割合で分けた推定。0048）----

/** 按分の推定の根拠の文の頭（この頭の箱を「按分のまま」と読む） */
export const SPLIT_BASIS = "総額を費目に分けた目安";
/** 9費目の並び（家計調査の区分。仕送りは0円の推定） */
export const LIVING_CATEGORY_ORDER = ["food", "utilities", "furniture", "clothing", "health", "transport", "recreation", "otherConsumption", "allowance"] as const;
const splitBox = (value: number, basis: string): Box<number> => ({ value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis } }) as Box<number>;

/** 総額（月額）を9費目に分けた推定の箱（仕送りは0円。端は「その他の消費」） */
export function splitCategories(h: Household, baseMonth: string, total: number, id: () => string, keep?: readonly { id?: string; category: string }[]): { id: string; category: string; monthly: Box<number> }[] {
  const size = householdSize(h, baseMonth);
  const sp = splitLiving(total, size);
  const basis = `${SPLIT_BASIS}（${sp?.basis ?? "割合の表がありません"}）`;
  return LIVING_CATEGORY_ORDER.map((category) => {
    const v = category === "allowance" ? 0 : sp === null ? (category === "otherConsumption" ? total : 0) : sp.parts[category];
    const old = keep?.find((c) => c.category === category)?.id;
    return { id: old ?? id(), category, monthly: splitBox(v, category === "allowance" ? `${SPLIT_BASIS}（仕送りは子ども・教育、介護・親のカードで入れるので0円）` : basis) };
  });
}

/** 費目がどれも按分の推定のまま（FP が直していない）か */
export function isPureSplit(l: Pick<LivingExpense, "categories">): boolean {
  const cs = l.categories ?? [];
  return cs.length > 0 && cs.every((c) => c.monthly.state === "estimated" && c.monthly.origin.kind === "auto" && ((c.monthly as { estimate?: { basis?: string } }).estimate?.basis ?? "").startsWith(SPLIT_BASIS));
}

/** 費目で入れていて、費目が按分のまま・総額が統計の推定のままなら、総額と按分を入れ直す（人数が変わったとき） */
function refreshSplit(h: Household, baseMonth: string, l: LivingExpense): void {
  if (l.mode !== "byCategory" || !isPureSplit(l) || !isAuto(l.monthly)) return;
  const e = livingEstimate(h, baseMonth);
  l.monthly = { ...(l.monthly as Box<number>), value: e.value, estimate: { method: "statistic", basis: e.basis } } as Box<number>;
  const next = splitCategories(h, baseMonth, e.value, () => crypto.randomUUID(), l.categories);
  if (JSON.stringify(next) !== JSON.stringify(l.categories)) l.categories = next;
}

/** 推定を入れ直した世帯（変わらなければ同じものを返す） */
export function withRefreshedEstimates<T extends { request: { input: { household: Household; baseMonth: string } } }>(wh: T): T {
  const h = structuredClone(wh.request.input.household);
  refreshEstimates(h, wh.request.input.baseMonth, (wh.request.input as { endYear?: number }).endYear);
  if (JSON.stringify(h) === JSON.stringify(wh.request.input.household)) return wh;
  return { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: h } } };
}

// ---- 住民税（今年度の決定額。置き換え口 residentTaxAssessments）----

/** その人の今の収入（給与は賞与込み・事業所得）。計算基準月の前の年にかかる期間から */
function incomeBefore(h: Household, memberId: string, baseMonth: string): { salary: number; business: number; any: boolean } {
  const y = Number(baseMonth.slice(0, 4)) - 1;
  let salary = 0;
  let business = 0;
  let any = false;
  for (const p of h.employmentPeriods ?? []) {
    if (p.member !== memberId) continue;
    const from = p.from.at ?? "0000-01";
    const to = p.to?.at ?? "9999-12";
    if (from > `${y}-12` || to < `${y}-01`) continue;
    any = true;
    salary = Math.max(salary, (p.salary?.annual.value ?? 0) + (p.salary?.bonus?.value ?? 0));
    business = Math.max(business, p.business?.income.value ?? 0);
  }
  return { salary, business, any };
}

/**
 * 計算基準月の前の年に働いていた人に、今年度の住民税（決定額）が無ければ、概算の推定を入れる。
 * 計算エンジンは決定額が無いと前の年の所得から計算し直すが、その年の社会保険の制度データ（2025年より前）が無いと止まるため（PR に書いた残り）
 */
export function ensureResidentTax(h: Household, memberId: string, baseMonth: string, id: () => string): void {
  const fy = residentTaxYear(baseMonth);
  const list = (h.residentTaxAssessments ?? []) as { member: string; fiscalYear: number }[];
  if (list.some((a) => a.member === memberId && a.fiscalYear === fy)) return;
  const inc = incomeBefore(h, memberId, baseMonth);
  if (!inc.any) return;
  const e = residentTaxEstimate(inc.salary, inc.business, fy - 1);
  h.residentTaxAssessments ??= [];
  (h.residentTaxAssessments as unknown[]).push({ id: id(), member: memberId, fiscalYear: fy, amount: { value: e.value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: e.basis } } });
}
