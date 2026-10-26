// 空欄を補う目安の値（0008 の2 の「推定」。出どころは auto、estimate に統計名と年度を書く）。
// 目安の数と純粋な計算は、ヒアリングシートの取り込みと同じ hearing/src/estimates.ts（正本は data/ の YAML の写し。0008 の追記 2026-10-26）。
// ここには世帯（Household）を見て当てる部分と、元の入力が変わったときの入れ直しだけを置く
import type { Box, EmploymentPeriod, Household, Member } from "../../engine/types.ts";
import { ageAt } from "../levers.ts";
import {
  livingEstimate as livingBySize,
  residentTaxEstimate,
  residentTaxYear,
  salaryEstimate,
  smrEstimate as smrBoxes,
  type Estimate,
} from "../../../../hearing/src/estimates.ts";

export type { Estimate };
export { businessEstimate, careerStartMonth, CAR_ESTIMATE, residentTaxEstimate, residentTaxYear, salaryEstimate } from "../../../../hearing/src/estimates.ts";

/** 今（計算基準月）世帯にいる人の数 */
export function householdSize(h: Household, baseMonth: string): number {
  return h.members.filter((m) => {
    if (m.expected === true) return false;
    const leaves = m.leaves?.at;
    return leaves === undefined || leaves > baseMonth;
  }).length;
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

/**
 * 自動で入れた推定の値を、ほかの入力に合わせて入れ直す（FP が入れた値・確定の値は変えない）。
 * 「推定は入力の時点で世帯に入れ、元の入力が変わったら入れ直す」（0008 の未確定の決定）
 */
export function refreshEstimates(h: Household, baseMonth: string): void {
  for (const l of h.livingExpenses ?? []) {
    if (l.mode === "total" && isAuto(l.monthly)) {
      const e = livingEstimate(h, baseMonth);
      l.monthly = { ...(l.monthly as Box<number>), value: e.value, estimate: { method: "statistic", basis: e.basis } } as Box<number>;
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
  for (const p of h.employmentPeriods ?? []) {
    const smr = (p as EmploymentPeriod).standardMonthlyRemuneration;
    const annual = p.salary?.annual.value;
    if (smr !== undefined && annual != null && isAuto(smr.health) && isAuto(smr.pension)) {
      const e = smrEstimate(annual, smrMonth(p, baseMonth));
      if (smr.health.value !== e.health.value || smr.pension.value !== e.pension.value) p.standardMonthlyRemuneration = e;
    }
  }
}

/** 推定を入れ直した世帯（変わらなければ同じものを返す） */
export function withRefreshedEstimates<T extends { request: { input: { household: Household; baseMonth: string } } }>(wh: T): T {
  const h = structuredClone(wh.request.input.household);
  refreshEstimates(h, wh.request.input.baseMonth);
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
