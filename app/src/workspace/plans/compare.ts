// 案の比較の数字（エンジンの出力の表から作る）と、比較の表の提示用の値（CompareTableModel）
import type { EngineRequest, TableCell } from "../../engine/types.ts";
import { group, man, manDiff } from "../../presentation/format.ts";
import type { CompareCell, CompareTableModel } from "../../presentation/model.ts";
import type { PlanPension } from "../input/pensionEstimate.ts";
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

/** 月額の万円（小数1桁。例: 「24.1」。年金のカードの見込みと同じ丸め） */
const monthlyMan = (v: number) => {
  const m = Math.round(v / 1000) / 10;
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
};

/**
 * 年金の見込みの行（0075）: 年金のカードの「年金の見込み」と同じ求め方（今の水準・65歳から）の世帯の合計の月額。受け取り開始を変えた
 * プランがあれば、受け取り開始からの月額の行も足す。差は「そのプラン−基準」の月額。年金が少ないことは「注意」にしない（働き方の違いの結果）
 */
function pensionRows(req: EngineRequest, ps: readonly (PlanPension | null)[], b: number): CompareTableModel["rows"] {
  const couple = roles(req).some((r) => r.key === "spouse");
  const who = couple ? "夫婦の" : "";
  const cells = (pick: (p: PlanPension) => number | null): CompareCell[] => {
    const bv = ps[b] === null || ps[b] === undefined ? null : pick(ps[b] as PlanPension);
    return ps.map((p, i) => {
      const v = p === null ? null : pick(p);
      if (v === null) return { text: p === null ? "計算しています…" : "—", diff: null, bad: false };
      const text = `月${monthlyMan(v)}万円`;
      if (i === b || bv === null) return { text, diff: null, bad: false };
      const d = Math.round((v - bv) / 1000) / 10;
      return { text, diff: d === 0 ? "±0万円" : `${d > 0 ? "+" : "▲"}${monthlyMan(Math.abs(v - bv))}万円`, bad: false };
    });
  };
  const allReceiving = ps.some((p) => p !== null) && ps.every((p) => p === null || p.receiving);
  const rows: CompareTableModel["rows"] = [{ key: "pension65", label: allReceiving ? `年金（${who}月額・今の水準。受け取り中）` : `65歳からの年金（${who}月額・今の水準）`, cells: cells((p) => p.std) }];
  if (ps.some((p) => p?.anyClaim === true)) rows.push({ key: "pensionClaimed", label: `受け取り開始からの年金（${who}月額・今の水準。繰下げ・繰上げを含む）`, cells: cells((p) => p.claimed) });
  return rows;
}

/**
 * 比較の数字の表（主画面の「比較の表を見る」）: 行＝主な数字、列＝現状と帯の案（最大6列）。
 * 案の列には基準の案（base 番目の列）との差を添える（差はいつも「その案−基準」）。
 * pensions を渡すと、年金の見込みの行（65歳からの月額）を足す（列と同じ並び。求めている間の列は null）
 */
export function compareTable(req: EngineRequest, columns: ComparedPlan[], targetAge: number, base = 0, pensions?: readonly (PlanPension | null)[] | null): CompareTableModel {
  const self = roles(req).find((r) => r.key === "self");
  const who = self?.label ?? "";
  const age = (y: number) => (self !== undefined ? `${who}${ageInYear(self.member, y)}歳` : `${y}年`);
  const cols = columns.slice(0, 6);
  const ms = cols.map((c) => metricsOf(req, c.table, targetAge));
  const b = Math.min(Math.max(0, base), cols.length - 1);
  const bm = ms[b] as PlanMetrics;
  const yen = (v: number) => `${man(v)}万円`;
  const diffYen = (v: number, x: number, higherIsBetter = true) => ({ diff: `${manDiff(v - x)}万円`, bad: higherIsBetter ? v < x : v > x });
  const tY = bm.targetYear;
  return {
    diffLabel: "基準より",
    columns: cols.map((c, i) => ({ name: c.name, style: i, ...(i === b ? { base: true } : {}) })),
    rows: [
      {
        key: "target",
        label: `${age(tY)}時点の金融資産`,
        cells: ms.map((m, i) => ({ text: yen(m.target), ...(i === b ? { diff: null, bad: m.target < 0 } : { ...diffYen(m.target, bm.target), bad: m.target < 0 || m.target < bm.target }) })),
      },
      {
        key: "depletion",
        label: "資産が尽きる年",
        cells: ms.map((m, i) => {
          const text = m.depletion === null ? "尽きない" : `${m.depletion}年（${age(m.depletion)}）`;
          if (i === b) return { text, diff: null, bad: m.depletion !== null };
          const d = m.depletion === null ? (bm.depletion === null ? null : "尽きなくなる") : bm.depletion === null ? "尽きるようになる" : m.depletion === bm.depletion ? "±0年" : `${m.depletion > bm.depletion ? "+" : "▲"}${group(Math.abs(m.depletion - bm.depletion))}年`;
          return { text, diff: d, bad: m.depletion !== null };
        }),
      },
      { key: "takeHome", label: "生涯の手取りの合計", cells: ms.map((m, i) => ({ text: yen(m.takeHome), ...(i === b ? { diff: null, bad: false } : diffYen(m.takeHome, bm.takeHome)) })) },
      { key: "expense", label: "生涯の支出の合計（税・社会保険料を除く）", cells: ms.map((m, i) => ({ text: yen(m.expense), ...(i === b ? { diff: null, bad: false } : diffYen(m.expense, bm.expense, false)) })) },
      { key: "min", label: "金融資産がいちばん少ない年", cells: ms.map((m, i) => ({ text: `${yen(m.min.amount)}（${m.min.year}年）`, ...(i === b ? { diff: null, bad: m.min.amount < 0 } : { ...diffYen(m.min.amount, bm.min.amount), bad: m.min.amount < 0 }) })) },
      ...(ms.some((m) => m.loan > 0)
        ? [{ key: "loan", label: "住宅ローンの返済の合計（繰上返済を含む）", cells: ms.map((m, i) => ({ text: yen(m.loan), ...(i === b ? { diff: null, bad: false } : diffYen(m.loan, bm.loan, false)) })) }]
        : []),
      ...(pensions != null && pensions.length >= cols.length ? pensionRows(req, pensions.slice(0, cols.length), b) : []),
    ],
  };
}
