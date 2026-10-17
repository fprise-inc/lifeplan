// 案の比較の数字（エンジンの出力の表から作る）と、比較の提示用の値（CompareChartModel・CompareTableModel）
import type { EngineRequest, TableCell } from "../../engine/types.ts";
import { group, man, manDiff } from "../../presentation/format.ts";
import type { CompareChartModel, CompareTableModel } from "../../presentation/model.ts";
import { parseYm } from "../levers.ts";
import { depletionYear, displayYears, financialOf } from "../present.ts";
import { ageInYear, roles } from "../roles.ts";

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");

/** 案の主な数字 */
export interface PlanMetrics {
  /** 主役の年（本人の目標の年齢の年） */
  targetYear: number;
  /** その年の金融資産 */
  target: number;
  /** 資産が尽きる年（尽きなければ null） */
  depletion: number | null;
  /** 生涯の手取りの合計（収入−税・社会保険料。表に出す年の合計） */
  takeHome: number;
  /** 生涯の支出の合計（税・社会保険料を除く） */
  expense: number;
  /** 金融資産がいちばん少ない年とその額 */
  min: { year: number; amount: number };
  /** 住宅ローンの返済の合計（繰上返済・手数料を含む） */
  loan: number;
}

export function targetYearOf(req: EngineRequest, targetAge: number): number {
  const years = displayYears(req);
  const last = years.at(-1) ?? req.input.endYear;
  const self = roles(req).find((r) => r.key === "self");
  return self !== undefined ? Math.min(last, parseYm(self.member.birth.birthYearMonth).y + targetAge) : last;
}

export function metricsOf(req: EngineRequest, table: readonly TableCell[], targetAge: number): PlanMetrics {
  const years = displayYears(req);
  const ys = new Set(years);
  const fin = financialOf(table);
  let takeHome = 0;
  let expense = 0;
  let loan = 0;
  for (const c of table) {
    if (!ys.has(c.year)) continue;
    if (under(c.row, "cf.income")) takeHome += c.amount;
    else if (under(c.row, "cf.taxSi")) takeHome -= c.amount;
    else if (under(c.row, "cf.expense")) {
      expense += c.amount;
      if (under(c.row, "cf.expense.housing.loan")) loan += c.amount;
    }
  }
  let min = { year: years[0] ?? req.input.endYear, amount: Number.POSITIVE_INFINITY };
  for (const y of years) {
    const v = fin.get(y) ?? 0;
    if (v < min.amount) min = { year: y, amount: v };
  }
  if (!Number.isFinite(min.amount)) min = { ...min, amount: 0 };
  const targetYear = targetYearOf(req, targetAge);
  return { targetYear, target: fin.get(targetYear) ?? 0, depletion: depletionYear(table, years), takeHome, expense, min, loan };
}

export interface ComparedPlan {
  /** 列の名前（現状・案の名前） */
  name: string;
  table: readonly TableCell[];
}

/** 比較のグラフ: 現状（灰の破線）と案（最大5つ。線の形と印を変える） */
export function compareChart(req: EngineRequest, current: ComparedPlan, plans: ComparedPlan[]): CompareChartModel {
  const years = displayYears(req);
  const self = roles(req).find((r) => r.key === "self");
  const values = (t: readonly TableCell[]) => {
    const f = financialOf(t);
    return years.map((y) => f.get(y) ?? 0);
  };
  return {
    years,
    ages: years.map((y) => (self !== undefined ? ageInYear(self.member, y) : null)),
    series: [{ key: "current", name: current.name, style: 0, values: values(current.table) }, ...plans.slice(0, 5).map((p, i) => ({ key: `p${i + 1}`, name: p.name, style: i + 1, values: values(p.table) }))],
  };
}

/** 比較の数字の表: 行＝主な数字、列＝現状と案。案の列には現状との差を添える */
export function compareTable(req: EngineRequest, current: ComparedPlan, plans: ComparedPlan[], targetAge: number): CompareTableModel {
  const self = roles(req).find((r) => r.key === "self");
  const who = self?.label ?? "";
  const age = (y: number) => (self !== undefined ? `${who}${ageInYear(self.member, y)}歳` : `${y}年`);
  const cols = [current, ...plans.slice(0, 5)];
  const ms = cols.map((c) => metricsOf(req, c.table, targetAge));
  const base = ms[0] as PlanMetrics;
  const yen = (v: number) => `${man(v)}万円`;
  const diffYen = (v: number, b: number, higherIsBetter = true) => ({ diff: `${manDiff(v - b)}万円`, bad: higherIsBetter ? v < b : v > b });
  const tY = base.targetYear;
  return {
    columns: cols.map((c, i) => ({ name: c.name, style: i })),
    rows: [
      {
        key: "target",
        label: `${age(tY)}時点の金融資産`,
        cells: ms.map((m, i) => ({ text: yen(m.target), ...(i === 0 ? { diff: null, bad: m.target < 0 } : { ...diffYen(m.target, base.target), bad: m.target < 0 || m.target < base.target }) })),
      },
      {
        key: "depletion",
        label: "資産が尽きる年",
        cells: ms.map((m, i) => {
          const text = m.depletion === null ? "尽きない" : `${m.depletion}年（${age(m.depletion)}）`;
          if (i === 0) return { text, diff: null, bad: m.depletion !== null };
          const d = m.depletion === null ? (base.depletion === null ? null : "尽きなくなる") : base.depletion === null ? "尽きるようになる" : m.depletion === base.depletion ? "±0年" : `${m.depletion > base.depletion ? "+" : "▲"}${group(Math.abs(m.depletion - base.depletion))}年`;
          return { text, diff: d, bad: m.depletion !== null };
        }),
      },
      { key: "takeHome", label: "生涯の手取りの合計", cells: ms.map((m, i) => ({ text: yen(m.takeHome), ...(i === 0 ? { diff: null, bad: false } : diffYen(m.takeHome, base.takeHome)) })) },
      { key: "expense", label: "生涯の支出の合計（税・社会保険料を除く）", cells: ms.map((m, i) => ({ text: yen(m.expense), ...(i === 0 ? { diff: null, bad: false } : diffYen(m.expense, base.expense, false)) })) },
      { key: "min", label: "金融資産がいちばん少ない年", cells: ms.map((m, i) => ({ text: `${yen(m.min.amount)}（${m.min.year}年）`, ...(i === 0 ? { diff: null, bad: m.min.amount < 0 } : { ...diffYen(m.min.amount, base.min.amount), bad: m.min.amount < 0 }) })) },
      ...(ms.some((m) => m.loan > 0)
        ? [{ key: "loan", label: "住宅ローンの返済の合計（繰上返済を含む）", cells: ms.map((m, i) => ({ text: yen(m.loan), ...(i === 0 ? { diff: null, bad: false } : diffYen(m.loan, base.loan, false)) })) }]
        : []),
    ],
  };
}
