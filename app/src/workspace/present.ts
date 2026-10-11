// 計算結果と世帯から、提示用の値（PresentationModel。0016 の2）を作る。許可した項目だけを選んで写す
import type { EngineRequest, PreviewResult, TableCell } from "../engine/types.ts";
import { ROW_LABELS } from "../generated/labels.ts";
import type { CashflowTableModel, ChartModel, Depletion, EventChip, EventIcon, GoalCard, GoalsModel, Headline, PresentationModel, TableRowModel, Verdict, YearDetail } from "../presentation/model.ts";
import { man } from "../presentation/format.ts";
import { addMonths, ageReachedMonth, parseYm, readLevers } from "./levers.ts";
import { ageInYear, leaveYear, roles, type Role } from "./roles.ts";

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");

/** 表に出す年: 計算基準月が年の途中なら翌年から（その年は数か月分しかないため）、表の最後の年まで */
export function displayYears(req: EngineRequest): number[] {
  const { y, m } = parseYm(req.input.baseMonth);
  const out: number[] = [];
  for (let year = m > 1 ? y + 1 : y; year <= req.input.endYear; year++) out.push(year);
  return out;
}

/** 条件に合うマスを年ごとに合計する */
export function sumByYear(table: readonly TableCell[], pred: (c: TableCell) => boolean): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of table) if (pred(c)) out.set(c.year, (out.get(c.year) ?? 0) + c.amount);
  return out;
}

export const financialOf = (t: readonly TableCell[]) => sumByYear(t, (c) => c.row === "cf.balance.financial");

/** 資産が尽きる年（金融資産がはじめてマイナスになる年）。尽きなければ null */
export function depletionYear(table: readonly TableCell[], years: readonly number[]): number | null {
  const fin = financialOf(table);
  for (const y of years) if ((fin.get(y) ?? 0) < 0) return y;
  return null;
}

/** 表の行の決め方。key は提示層に渡す鍵（物の ID を含まない） */
export interface RowDef {
  key: string;
  label: string;
  group: "income" | "expense" | "net" | "assets";
  kind: "value" | "total";
  match: (c: TableCell) => boolean;
  /** 根拠を出せる行（お金の動きか年に1回決まる行から来る行） */
  evidence: boolean;
}

export function rowDefs(req: EngineRequest): RowDef[] {
  const rs = roles(req);
  const defs: RowDef[] = [];
  const byMember = (prefix: string, role: Role) => (c: TableCell) => under(c.row, prefix) && c.member === role.member.id;
  for (const r of rs) defs.push({ key: `salary:${r.key}`, label: `${r.label}の給与`, group: "income", kind: "value", match: byMember("cf.income.salary", r), evidence: true });
  for (const r of rs) defs.push({ key: `pension:${r.key}`, label: `${r.label}の年金`, group: "income", kind: "value", match: byMember("cf.income.pension", r), evidence: true });
  const ids = new Set(rs.map((r) => r.member.id));
  const known = (c: TableCell, p: string) => under(c.row, p) && c.member !== undefined && ids.has(c.member);
  defs.push(
    { key: "retirement", label: "退職金", group: "income", kind: "value", match: (c) => under(c.row, "cf.income.lumpSum.retirement"), evidence: true },
    { key: "benefit", label: "児童手当・修学支援", group: "income", kind: "value", match: (c) => under(c.row, "cf.income.benefit"), evidence: true },
    {
      key: "incomeOther",
      label: "その他の収入",
      group: "income",
      kind: "value",
      match: (c) => under(c.row, "cf.income") && !known(c, "cf.income.salary") && !known(c, "cf.income.pension") && !under(c.row, "cf.income.lumpSum.retirement") && !under(c.row, "cf.income.benefit"),
      evidence: true,
    },
    { key: "incomeTotal", label: "収入合計", group: "income", kind: "total", match: (c) => under(c.row, "cf.income"), evidence: false },
    { key: "living", label: ROW_LABELS["cf.expense.living"] ?? "基本生活費", group: "expense", kind: "value", match: (c) => under(c.row, "cf.expense.living"), evidence: true },
    { key: "housing", label: "住居費（ローン・税・修繕）", group: "expense", kind: "value", match: (c) => under(c.row, "cf.expense.housing"), evidence: true },
    { key: "education", label: "教育費", group: "expense", kind: "value", match: (c) => under(c.row, "cf.expense.education"), evidence: true },
    { key: "insurance", label: "保険料", group: "expense", kind: "value", match: (c) => under(c.row, "cf.expense.insurance"), evidence: true },
    { key: "lumpSum", label: "一時的な支出（旅行など）", group: "expense", kind: "value", match: (c) => under(c.row, "cf.expense.lumpSum"), evidence: true },
    {
      key: "expenseOther",
      label: "その他の支出",
      group: "expense",
      kind: "value",
      match: (c) => under(c.row, "cf.expense") && !["cf.expense.living", "cf.expense.housing", "cf.expense.education", "cf.expense.insurance", "cf.expense.lumpSum"].some((p) => under(c.row, p)),
      evidence: true,
    },
    { key: "taxSi", label: "税・社会保険料", group: "expense", kind: "value", match: (c) => under(c.row, "cf.taxSi"), evidence: true },
    { key: "expenseTotal", label: "支出合計", group: "expense", kind: "total", match: (c) => under(c.row, "cf.expense") || under(c.row, "cf.taxSi"), evidence: false },
    { key: "net", label: "年間収支", group: "net", kind: "total", match: (c) => c.row === "cf.net", evidence: false },
    { key: "nisaIn", label: "NISAへの積立", group: "assets", kind: "value", match: (c) => under(c.row, "cf.transfer.nisa"), evidence: true },
    { key: "financial", label: "金融資産残高", group: "assets", kind: "total", match: (c) => c.row === "cf.balance.financial", evidence: true },
    { key: "debt", label: "住宅ローン残高", group: "assets", kind: "value", match: (c) => under(c.row, "cf.balance.debt"), evidence: true },
  );
  return defs;
}

const STAGE_AGE: Record<string, number> = { elementary: 6, juniorHigh: 12, highSchool: 15, university: 18 };
const STAGE_NAME: Record<string, string> = { elementary: "小学校", juniorHigh: "中学校", highSchool: "高校", university: "大学" };
const SECTOR: Record<string, string> = { public: "公立", private: "私立", national: "国立" };
const FIELD: Record<string, string> = { humanities: "文系", science: "理系" };
const LIVING: Record<string, string> = { away: "自宅外", home: "自宅" };

/** 学校に入る年（表示のための目安。4月2日〜翌年4月1日生まれが同じ学年） */
export function schoolEntryYear(birthYearMonth: string, bornOnFirst: boolean, stage: string): number | null {
  const age = STAGE_AGE[stage];
  if (age === undefined) return null;
  const { y, m } = parseYm(birthYearMonth);
  const early = m < 4 || (m === 4 && bornOnFirst);
  return y + age + (early ? 0 : 1);
}

function events(req: EngineRequest, proposed: readonly TableCell[], years: readonly number[]): EventChip[] {
  const rs = roles(req);
  const h = req.input.household;
  const first = years[0] ?? 0;
  const last = years.at(-1) ?? 0;
  const out: EventChip[] = [];
  const add = (year: number, icon: EventIcon, text: string, short = false) => {
    if (year >= first && year <= last) out.push({ year, icon, text, short });
  };
  for (const g of h.goals ?? []) {
    const role = rs.find((r) => r.member.id === g.owner);
    if (g.kind !== "education" || role === undefined) continue;
    for (const s of g.education?.stages ?? []) {
      if (s.stage !== "highSchool" && s.stage !== "university") continue;
      const y = schoolEntryYear(role.member.birth.birthYearMonth, role.member.birth.bornOnFirst, s.stage);
      if (y === null) continue;
      const detail = [s.sector !== undefined ? SECTOR[s.sector] : "", s.field !== undefined ? FIELD[s.field] : ""].join("") + (s.living !== undefined ? `・${LIVING[s.living] ?? ""}` : "");
      add(y, "学", `${role.label} ${STAGE_NAME[s.stage]}入学${detail !== "" ? `（${detail}）` : ""}（${role.label}${ageInYear(role.member, y)}歳）`);
    }
  }
  for (const r of rs) {
    const ly = leaveYear(r.member);
    if (ly !== null && r.member.kind === "child") add(ly, "独", `${r.label} 独立（${r.label}${ageInYear(r.member, ly)}歳）`);
  }
  const lv = (r: Role) => readLevers(req, r.member.id);
  for (const r of rs.filter((x) => x.key === "self" || x.key === "spouse")) {
    const v = lv(r);
    if (v.retireAge !== undefined) {
      const y = parseYm(ageReachedMonth(r.member, v.retireAge)).y;
      if (y <= req.input.endYear) add(y, "退", `${r.label} 退職（${r.label}${v.retireAge}歳）`);
    }
    if (v.pensionAge !== undefined) {
      const y = parseYm(addMonths(ageReachedMonth(r.member, v.pensionAge), 1)).y;
      add(y, "年", `${r.label} 年金の受け取り開始（${v.pensionAge}歳）`);
    }
  }
  const loan = sumByYear(proposed, (c) => under(c.row, "cf.expense.housing.loan"));
  const paid = [...loan.entries()].filter(([, v]) => v > 0).map(([y]) => y).sort((a, b) => a - b).at(-1);
  const self = rs.find((r) => r.key === "self");
  if (paid !== undefined && paid < req.input.endYear) add(paid, "家", `住宅ローン完済${self !== undefined ? `（${self.label}${ageInYear(self.member, paid)}歳）` : ""}`);
  const dep = depletionYear(proposed, years);
  if (dep !== null) add(dep, "！", `資産が尽きる${self !== undefined ? `（${self.label}${ageInYear(self.member, dep)}歳）` : ""}`, true);
  return out.sort((a, b) => a.year - b.year || a.icon.localeCompare(b.icon));
}

function verdict(self: Role | undefined, depP: number | null, depC: number | null, endAge: number | null): Verdict {
  const who = self?.label ?? "";
  const age = (y: number) => (self !== undefined ? ageInYear(self.member, y) : y);
  const until = endAge !== null ? `${endAge}歳まで` : "最後まで";
  if (depP === null && depC !== null)
    return { tone: "up", parts: [{ text: "↑ 資産が " }, { text: `${until}尽きなく`, strong: true }, { text: `なりました（現状は${who} ${age(depC)}歳で不足）` }] };
  if (depP === null && depC === null) return { tone: "flat", parts: [{ text: "現状も提案も、" }, { text: `${until}資産が尽きません`, strong: true }] };
  if (depP !== null && depC === null) return { tone: "down", parts: [{ text: "↓ 提案では " }, { text: `${who}${age(depP)}歳で資産が不足`, strong: true }, { text: "します（現状は不足しません）" }] };
  const p = depP as number;
  const c = depC as number;
  if (p === c) return { tone: "flat", parts: [{ text: "資産が尽きる時期は変わりません（" }, { text: `${who}${age(p)}歳`, strong: true }, { text: "）" }] };
  const later = p > c;
  return {
    tone: later ? "up" : "down",
    parts: [{ text: `${later ? "↑" : "↓"} 資産が尽きる年が ` }, { text: `${Math.abs(p - c)}年${later ? "遅く" : "早く"}`, strong: true }, { text: `なりました（${who}${age(c)}歳→${age(p)}歳）` }],
  };
}

function goals(req: EngineRequest, proposed: readonly TableCell[], years: readonly number[], depP: number | null): GoalsModel {
  const rs = roles(req);
  const h = req.input.household;
  const self = rs.find((r) => r.key === "self");
  const cards: GoalCard[] = [];
  const status = (endYear: number): Pick<GoalCard, "ready" | "shortNote"> =>
    depP === null || depP > endYear ? { ready: true, shortNote: null } : { ready: false, shortNote: `${depP}年から資金が不足` };
  for (const g of h.goals ?? []) {
    const role = rs.find((r) => r.member.id === g.owner);
    if (g.kind !== "education" || role === undefined) continue;
    const uni = g.education?.stages.find((s) => s.stage === "university");
    const edu = sumByYear(proposed, (c) => under(c.row, "cf.expense.education") && c.member === role.member.id);
    let y0: number;
    let y1: number;
    let title: string;
    let detail = "";
    if (uni !== undefined) {
      y0 = schoolEntryYear(role.member.birth.birthYearMonth, role.member.birth.bornOnFirst, "university") as number;
      y1 = y0 + 3;
      title = `${role.label}の大学`;
      detail = (uni.sector !== undefined ? SECTOR[uni.sector] ?? "" : "") + (uni.field !== undefined ? FIELD[uni.field] ?? "" : "") + (uni.living !== undefined ? `・${LIVING[uni.living] ?? ""}` : "");
    } else {
      const ys = [...edu.entries()].filter(([, v]) => v > 0).map(([y]) => y).sort((a, b) => a - b);
      if (ys.length === 0) continue;
      y0 = ys[0] as number;
      y1 = ys.at(-1) as number;
      title = `${role.label}の教育`;
    }
    let amount = 0;
    for (let y = y0; y <= y1; y++) amount += edu.get(y) ?? 0;
    cards.push({
      category: "教育",
      priority: g.priority === "want" ? "希望" : g.priority === "wish" ? "夢" : "必要",
      title,
      when: `${y0}〜${y1}年（${ageInYear(role.member, y0)}〜${ageInYear(role.member, y1)}歳）${detail}`,
      amount,
      ...status(y1),
    });
  }
  const loan = sumByYear(proposed, (c) => under(c.row, "cf.expense.housing.loan"));
  const paid = [...loan.entries()].filter(([, v]) => v > 0).map(([y]) => y).sort((a, b) => a - b).at(-1);
  if ((h.debts ?? []).some((d) => d.kind === "mortgage") && paid !== undefined)
    cards.push({ category: "住宅", priority: "必要", title: "住宅ローンの完済", when: `${paid}年${self !== undefined ? `（${self.label}${ageInYear(self.member, paid)}歳）` : ""}`, amount: null, ...status(paid) });
  const last = years.at(-1) ?? req.input.endYear;
  cards.push({ category: "退職", priority: "必要", title: "老後の生活資金", when: self !== undefined ? `${self.label}${ageInYear(self.member, last)}歳まで` : `${last}年まで`, amount: null, ...status(last) });
  for (const p of h.periodicExpenses ?? []) {
    const amount = p.amount.value ?? 0;
    const to = (p as { to?: { at?: string } }).to?.at;
    cards.push({ category: "その他", priority: "希望", title: ROW_LABELS[p.row] === undefined || p.row === "cf.expense.lumpSum.other" ? "定期的な支出（旅行など）" : (ROW_LABELS[p.row] as string), when: `${p.everyYears}年ごとに ${man(amount)}万円`, amount: null, ...status(to !== undefined ? parseYm(to).y : last) });
  }
  cards.push({ category: "夢", priority: "夢", title: "まだ入れていません", when: "例: 夫婦で海外旅行、車の買い替え", amount: null, ready: null, shortNote: null });
  const need = cards.filter((c) => c.priority === "必要");
  return { needTotal: need.length, needReady: need.filter((c) => c.ready === true).length, cards };
}

export interface PresentInput {
  /** 現状の要求 */
  base: EngineRequest;
  /** 提案の要求（打ち手を当てたもの） */
  proposal: EngineRequest;
  current: PreviewResult;
  proposed: PreviewResult;
  targetAge: number;
  selectedYear: number | null;
  provisional: boolean;
}

export function toPresentation(input: PresentInput): PresentationModel {
  const { base, proposal, current, proposed } = input;
  const years = displayYears(base);
  const rs = roles(base);
  const self = rs.find((r) => r.key === "self");
  const finP = financialOf(proposed.table);
  const finC = financialOf(current.table);
  const depP = depletionYear(proposed.table, years);
  const depC = depletionYear(current.table, years);
  const lastYear = years.at(-1) ?? base.input.endYear;
  const endAge = self !== undefined ? ageInYear(self.member, lastYear) : null;

  const targetYear = self !== undefined ? Math.min(lastYear, parseYm(self.member.birth.birthYearMonth).y + input.targetAge) : lastYear;
  const age = (y: number) => (self !== undefined ? ageInYear(self.member, y) : null);
  const headline: Headline = {
    label: `${self !== undefined ? `${self.label}${age(targetYear)}歳` : `${targetYear}年`}時点の金融資産（提案）`,
    amount: finP.get(targetYear) ?? 0,
    currentAmount: finC.get(targetYear) ?? 0,
    diff: (finP.get(targetYear) ?? 0) - (finC.get(targetYear) ?? 0),
    currentNote: depC !== null ? `${self?.label ?? ""}${age(depC) ?? depC}歳で不足` : null,
  };

  const depletions: Depletion[] = [];
  if (depC !== null) depletions.push({ series: "current", year: depC, label: `現状 ${age(depC) ?? depC}歳で不足` });
  if (depP !== null) depletions.push({ series: "proposal", year: depP, label: `提案 ${age(depP) ?? depP}歳で不足` });
  const chart: ChartModel = {
    years,
    ages: years.map((y) => age(y)),
    proposal: years.map((y) => finP.get(y) ?? 0),
    current: years.map((y) => finC.get(y) ?? 0),
    depletions,
  };

  const selectedYear = input.selectedYear !== null && years.includes(input.selectedYear) ? input.selectedYear : (years[Math.min(4, years.length - 1)] ?? lastYear);
  const present = (r: Role, y: number) => ageInYear(r.member, y) >= 0 && (leaveYear(r.member) === null || y <= (leaveYear(r.member) as number));
  const sumYear = (pred: (c: TableCell) => boolean, y: number) => proposed.table.reduce((s, c) => (c.year === y && pred(c) ? s + c.amount : s), 0);
  const yearDetail: YearDetail = {
    year: selectedYear,
    members: rs.filter((r) => present(r, selectedYear)).map((r) => `${r.label}${ageInYear(r.member, selectedYear)}歳`).join("・"),
    income: sumYear((c) => under(c.row, "cf.income"), selectedYear),
    expense: sumYear((c) => under(c.row, "cf.expense") || under(c.row, "cf.taxSi"), selectedYear),
    net: sumYear((c) => c.row === "cf.net", selectedYear),
    financial: finP.get(selectedYear) ?? 0,
  };

  const evs = events(proposal, proposed.table, years);
  const rows: TableRowModel[] = rs.map((r) => ({ kind: "age", key: `age:${r.key}`, label: r.label, ages: years.map((y) => (present(r, y) ? ageInYear(r.member, y) : null)) }));
  rows.push({ kind: "events", key: "events", label: "ライフイベント", icons: years.map((y) => evs.filter((e) => e.year === y).map((e) => e.icon)) });
  const groupLabel: Record<RowDef["group"], string> = { income: "収入", expense: "支出", net: "", assets: "貯蓄・資産" };
  let lastGroup: RowDef["group"] | null = null;
  for (const d of rowDefs(proposal)) {
    const sums = sumByYear(proposed.table, d.match);
    const cells = years.map((y) => {
      const v = sums.get(y);
      return { amount: v === undefined ? null : v, ...(d.key === "financial" && (v ?? 0) < 0 ? { short: true } : {}) };
    });
    if (d.kind === "value" && cells.every((c) => (c.amount ?? 0) === 0)) continue;
    if (d.group !== lastGroup && groupLabel[d.group] !== "") rows.push({ kind: "group", key: `group:${d.group}`, label: groupLabel[d.group] });
    lastGroup = d.group;
    rows.push({ kind: d.kind, key: d.key, label: d.label, cells, evidence: d.evidence });
  }
  const table: CashflowTableModel = { title: "生涯キャッシュフロー表（提案）", years, rows };

  const { y: by, m: bm } = parseYm(base.input.baseMonth);
  return {
    members: rs.filter((r) => present(r, by)).map((r) => ({ label: r.label, age: ageInYear(r.member, by) })),
    asOf: `${by}年${bm}月時点`,
    headline,
    verdict: verdict(self, depP, depC, endAge),
    chart,
    selectedYear,
    yearDetail,
    events: evs,
    table,
    goals: goals(proposal, proposed.table, years, depP),
    provisional: input.provisional,
  };
}
