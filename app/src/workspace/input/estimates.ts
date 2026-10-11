// 空欄を補う目安の値（0008 の2 の「推定」。出どころは auto、estimate に統計名と年度を書く）。
// どれも原本での確かめの前の仮の値で、画面には「推定」の印と根拠の文を出す。
// 制度データ・マスタデータ（0007）に移すまでの置き場所（形は値と根拠の文だけ）
import type { Box, EmploymentPeriod, Household } from "../../engine/types.ts";
import { ageAt } from "../levers.ts";

export interface Estimate {
  value: number;
  basis: string;
}

/** 基本生活費の目安（月額・円）。住居費・教育費・保険料・車両費を除く。世帯の人数ごと */
const LIVING_BY_SIZE: readonly number[] = [0, 140000, 250000, 280000, 300000];
const LIVING_BASIS = "家計調査（総務省）2024年の消費支出から住居・教育を除いた目安（仮の値。原本での確かめ前）";

/** 今（計算基準月）世帯にいる人の数 */
export function householdSize(h: Household, baseMonth: string): number {
  return h.members.filter((m) => {
    if (m.expected === true) return false;
    const leaves = m.leaves?.at;
    return leaves === undefined || leaves > baseMonth;
  }).length;
}

export function livingEstimate(h: Household, baseMonth: string): Estimate {
  const n = Math.max(1, householdSize(h, baseMonth));
  const value = LIVING_BY_SIZE[Math.min(n, LIVING_BY_SIZE.length - 1)] as number;
  return { value, basis: `${LIVING_BASIS}・${n >= 4 ? "4人以上" : `${n}人`}の世帯` };
}

/** 給与（賞与を除く年額）と賞与の目安。性別・雇用の形ごと（年齢・企業規模の区分は昇給カーブのマスタができてから） */
const SALARY: Record<string, { male: [number, number]; female: [number, number] }> = {
  regular: { male: [4300000, 1000000], female: [3300000, 700000] },
  civilServant: { male: [4500000, 1600000], female: [4000000, 1400000] },
  contract: { male: [3200000, 300000], female: [2600000, 200000] },
  partTime: { male: [1500000, 0], female: [1000000, 0] },
  executive: { male: [6000000, 0], female: [4800000, 0] },
};
const SALARY_BASIS = "賃金構造基本統計調査（厚生労働省）2024年の平均の目安（仮の値。原本での確かめ前）";

export function salaryEstimate(type: string, sex: string): { annual: Estimate; bonus: Estimate } | null {
  const row = SALARY[type];
  if (row === undefined) return null;
  const [annual, bonus] = sex === "female" ? row.female : row.male;
  const label = `${SALARY_BASIS}・${sex === "female" ? "女性" : "男性"}`;
  return { annual: { value: annual, basis: label }, bonus: { value: bonus, basis: label } };
}

/** 自営業の事業所得の目安 */
export function businessEstimate(): Estimate {
  return { value: 3000000, basis: "個人企業経済調査（総務省）の営業利益の目安（仮の値。原本での確かめ前）" };
}

/** 今の年齢から見た、ふつうの働き始め（22歳）。過去の期間の始まりの目安 */
export function careerStartMonth(birthYearMonth: string): string {
  const [y] = birthYearMonth.split("-");
  return `${Number(y) + 22}-04`;
}

/** 年齢の目安の文（画面の補助） */
export function ageNote(h: Household, memberId: string, month: string): string | null {
  const m = h.members.find((x) => x.id === memberId);
  return m === undefined ? null : `${ageAt(m, month)}歳`;
}

const SMR_BASIS = "年収（賞与を除く）÷12 からの目安";

/** 標準報酬月額の目安（等級表で決まる額は計算エンジンが丸める前の近似。給与の入力から） */
export function smrEstimate(annual: number): { health: Box<number>; pension: Box<number> } {
  const v = Math.max(58000, Math.round(annual / 12 / 1000) * 1000);
  const box = () => ({ value: v, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: SMR_BASIS } });
  return { health: box(), pension: box() };
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
  for (const a of (h.residentTaxAssessments ?? []) as { member: string; amount: Box<number> }[]) {
    if (!isAuto(a.amount)) continue;
    const inc = incomeBefore(h, a.member, baseMonth);
    const e = residentTaxEstimate(inc.salary, inc.business);
    if (a.amount.value !== e.value) a.amount = { ...a.amount, value: e.value };
  }
  for (const p of h.employmentPeriods ?? []) {
    const smr = (p as EmploymentPeriod).standardMonthlyRemuneration;
    const annual = p.salary?.annual.value;
    if (smr !== undefined && annual != null && isAuto(smr.health) && isAuto(smr.pension)) {
      const e = smrEstimate(annual);
      if (smr.health.value !== e.health.value) p.standardMonthlyRemuneration = e;
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

/** 計算基準月が入る住民税の年度（6月から翌年5月） */
export function residentTaxYear(baseMonth: string): number {
  const [y, m] = baseMonth.split("-").map(Number) as [number, number];
  return m >= 6 ? y : y - 1;
}

const RESIDENT_BASIS = "前の年の給与・事業の所得からの概算（住民税の決定通知書の年税額を入れると置き換わります）";

/** 給与（賞与込み）または事業所得からの住民税の概算（所得割10%＋均等割。社会保険料は収入の15%とみなす） */
export function residentTaxEstimate(salary: number, business: number): Estimate {
  const s = salary;
  const ded = s <= 1625000 ? 550000 : s <= 1800000 ? s * 0.4 - 100000 : s <= 3600000 ? s * 0.3 + 80000 : s <= 6600000 ? s * 0.2 + 440000 : s <= 8500000 ? s * 0.1 + 1100000 : 1950000;
  const income = Math.max(0, s - ded) + business;
  const taxable = income - 430000 - (s + business) * 0.15;
  const value = taxable <= 0 ? 0 : Math.round((taxable * 0.1 + 5000) / 100) * 100;
  return { value, basis: RESIDENT_BASIS };
}

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
  const e = residentTaxEstimate(inc.salary, inc.business);
  h.residentTaxAssessments ??= [];
  (h.residentTaxAssessments as unknown[]).push({ id: id(), member: memberId, fiscalYear: fy, amount: { value: e.value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: e.basis } } });
}
