// 計算結果と世帯から、提示用の値（PresentationModel。0016 の2）を作る。許可した項目だけを選んで写す
import { advisoryFeeSummary, type EngineRequest, type PreviewResult, type TableCell } from "../engine/types.ts";
import { ROW_LABELS } from "../generated/labels.ts";
import type { BalanceChartModel, CashflowTableModel, ChartModel, Depletion, EventChip, EventIcon, FeeLine, FlowChartModel, GoalCard, GoalsModel, Headline, PresentationModel, ResultVerdict, SeriesNames, StackSeries, TableRowModel, Verdict, VerdictPart, YearDetail } from "../presentation/model.ts";
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

/** 年のライフイベント（案の要求と結果から。学校・独立・退職・年金・ローン完済・資産が尽きる年） */
export function eventsOf(req: EngineRequest, proposed: readonly TableCell[], years: readonly number[]): EventChip[] {
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

/**
 * 主画面の結論の1文: 「B案は100歳まで足ります」＋2行目「A案（基準）は80歳で資産が尽きます」。
 * 選んだ案が基準の案のときは「A案（基準）：80歳で資産が尽きます」の1行。○歳時点の資産は既定では出さない（表示の設定で足す）
 */
export function resultVerdict(names: SeriesNames, self: Role | undefined, depP: number | null, depC: number | null, endAge: number | null): ResultVerdict {
  const age = (y: number) => (self !== undefined ? ageInYear(self.member, y) : y);
  const until = endAge !== null ? `${endAge}歳まで足ります` : "最後まで足ります";
  const st = (d: number | null) => (d === null ? until : `${age(d)}歳で資産が尽きます`);
  if (names.same) return { tone: depP === null ? "up" : "down", parts: [{ text: `${names.selected}（基準）`, strong: true }, { text: "：" }, { text: st(depP), strong: true }], sub: [] };
  const better = depP === depC ? "flat" : depP === null ? "up" : depC === null ? "down" : depP > depC ? "up" : "down";
  return { tone: better, parts: [{ text: names.selected, strong: true }, { text: "は" }, { text: st(depP), strong: true }], sub: [{ text: `${names.base}（基準）は${st(depC)}` }] };
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

/** FP顧問料の ON/OFF の材料（顧問料の契約があるときだけ） */
export interface FeeInput {
  on: boolean;
  /** 顧問料を入れた案の要約（累計を出すため）。無ければ累計は出さない */
  withFee: PreviewResult | null;
  /** ON と OFF を入れ替えた案の結果（差を一文に出すため。まだ無ければ null） */
  alt: PreviewResult | null;
}

/** FP顧問料の一文: 「顧問料（累計○万円）を払っても、ご主人95歳時点の資産は現状より○万円多い」 */
export function feeLine(input: { fee: FeeInput; targetYear: number; targetLabel: string; finP: Map<number, number>; finC: Map<number, number>; baseLabel?: string }): FeeLine {
  const { fee, targetYear, targetLabel, finP, finC } = input;
  const than = input.baseLabel ?? "現状";
  const cum = fee.withFee === null ? null : (advisoryFeeSummary(fee.withFee)?.byYear.filter((b) => b.year <= targetYear).at(-1)?.cumulative ?? 0);
  const cumText = cum === null ? "" : `（${targetLabel}までの累計${man(cum)}万円）`;
  const diffOf = (fin: Map<number, number>) => (fin.get(targetYear) ?? 0) - (finC.get(targetYear) ?? 0);
  const word = (d: number) => `${man(Math.abs(d))}万円${d >= 0 ? "多い" : "少ない"}`;
  const alt = fee.alt === null ? null : diffOf(financialOf(fee.alt.table));
  const d = diffOf(finP);
  if (fee.on) {
    const parts: VerdictPart[] = [
      { text: `FP顧問料${cumText}を${d >= 0 ? "払っても" : "含めると"}、${targetLabel}時点の資産は${than}より ` },
      { text: word(d), strong: true },
    ];
    if (alt !== null) parts.push({ text: `（顧問料を除くと${word(alt)}）` });
    return { on: true, parts };
  }
  const parts: VerdictPart[] = [{ text: "FP顧問料を含めない試算です。" }];
  if (alt !== null) parts.push({ text: `含めると${cumText}、${targetLabel}時点の資産は${than}より ` }, { text: word(alt), strong: true });
  return { on: false, parts };
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
  /** FP顧問料の ON/OFF（契約が無ければ省略） */
  fee?: FeeInput;
  /** 線の呼び方（主画面: 選んだ案「B案」・基準の案「A案」）。省略は「提案」と「現状」 */
  names?: SeriesNames;
}

export function toPresentation(input: PresentInput): PresentationModel {
  const { base, proposal, current, proposed } = input;
  const names: SeriesNames = input.names ?? { selected: "提案", base: "現状", same: false };
  const custom = input.names !== undefined;
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
    label: `${self !== undefined ? `${self.label}${age(targetYear)}歳` : `${targetYear}年`}時点の金融資産（${names.selected}）`,
    amount: finP.get(targetYear) ?? 0,
    currentAmount: finC.get(targetYear) ?? 0,
    diff: (finP.get(targetYear) ?? 0) - (finC.get(targetYear) ?? 0),
    currentNote: depC !== null ? `${self?.label ?? ""}${age(depC) ?? depC}歳で不足` : null,
  };

  const depletions: Depletion[] = [];
  if (depC !== null) depletions.push({ series: "current", year: depC, label: `${custom ? "▲ " : ""}${names.base} ${age(depC) ?? depC}歳で不足` });
  if (depP !== null) depletions.push({ series: "proposal", year: depP, label: `${custom ? "▲ " : ""}${names.selected} ${age(depP) ?? depP}歳で不足` });
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

  const evs = eventsOf(proposal, proposed.table, years);
  const table = cashflowTable(proposal, proposed.table, years, custom ? "生涯キャッシュフロー表" : "生涯キャッシュフロー表（提案）", evs);
  const baseFlows = flowChart(base, current.table, years, "");
  const baseBalance = balanceChart(current.table, years, chart.ages, "");


  const { y: by, m: bm } = parseYm(base.input.baseMonth);
  return {
    members: rs.filter((r) => present(r, by)).map((r) => ({ label: r.label, age: ageInYear(r.member, by) })),
    asOf: `${by}年${bm}月時点`,
    headline,
    verdict: verdict(self, depP, depC, endAge),
    result: resultVerdict(names, self, depP, depC, endAge),
    names,
    chart,
    flows: flowChart(proposal, proposed.table, years, "収支の推移（提案）"),
    balance: balanceChart(proposed.table, years, chart.ages, "資産と負債の推移（提案）"),
    baseLines: { net: baseFlows.net, netWorth: baseBalance.netWorth },
    who: self?.label ?? "",
    selectedYear,
    yearDetail,
    events: evs,
    table,
    goals: goals(proposal, proposed.table, years, depP),
    fee: input.fee === undefined ? null : feeLine({ fee: input.fee, targetYear, targetLabel: self !== undefined ? `${self.label}${age(targetYear)}歳` : `${targetYear}年`, finP, finC, ...(custom ? { baseLabel: `${names.base}（基準）` } : {}) }),
    provisional: input.provisional,
  };
}

// ---- キャッシュフロー表（案ごと・2つの案の差）----

/** 年齢の行（世帯にいる年だけ） */
function ageRows(req: EngineRequest, years: readonly number[]): TableRowModel[] {
  const present = (r: Role, y: number) => ageInYear(r.member, y) >= 0 && (leaveYear(r.member) === null || y <= (leaveYear(r.member) as number));
  return roles(req).map((r) => ({ kind: "age", key: `age:${r.key}`, label: r.label, ages: years.map((y) => (present(r, y) ? ageInYear(r.member, y) : null)) }));
}

/** 生涯キャッシュフロー表の提示用の値（1つの案）。evs を渡すとライフイベントの行も出す */
export function cashflowTable(req: EngineRequest, table: readonly TableCell[], years: number[], title: string, evs?: EventChip[]): CashflowTableModel {
  const rows: TableRowModel[] = ageRows(req, years);
  if (evs !== undefined) rows.push({ kind: "events", key: "events", label: "ライフイベント", icons: years.map((y) => evs.filter((e) => e.year === y).map((e) => e.icon)) });
  const groupLabel: Record<RowDef["group"], string> = { income: "収入", expense: "支出", net: "", assets: "貯蓄・資産" };
  let lastGroup: RowDef["group"] | null = null;
  for (const d of rowDefs(req)) {
    const sums = sumByYear(table, d.match);
    const cells = years.map((y) => {
      const v = sums.get(y);
      return { amount: v === undefined ? null : v, ...(d.key === "financial" && (v ?? 0) < 0 ? { short: true } : {}) };
    });
    if (d.kind === "value" && cells.every((c) => (c.amount ?? 0) === 0)) continue;
    if (d.group !== lastGroup && groupLabel[d.group] !== "") rows.push({ kind: "group", key: `group:${d.group}`, label: groupLabel[d.group] });
    lastGroup = d.group;
    rows.push({ kind: d.kind, key: d.key, label: d.label, cells, evidence: d.evidence });
  }
  return { title, years, rows };
}

/**
 * 2つの案の差のキャッシュフロー表（b − a。年ごと・行ごと）。根拠は出さない（差は計算式ではないため）。
 * 行の決め方は両方の案の構成員から（a の要求の行の定義を使う。構成員は案で変わらない）
 */
export function diffCashflowTable(req: EngineRequest, a: readonly TableCell[], b: readonly TableCell[], years: number[], title: string): CashflowTableModel {
  const rows: TableRowModel[] = ageRows(req, years);
  const groupLabel: Record<RowDef["group"], string> = { income: "収入", expense: "支出", net: "", assets: "貯蓄・資産" };
  let lastGroup: RowDef["group"] | null = null;
  for (const d of rowDefs(req)) {
    const sa = sumByYear(a, d.match);
    const sb = sumByYear(b, d.match);
    const cells = years.map((y) => {
      const va = sa.get(y);
      const vb = sb.get(y);
      return { amount: va === undefined && vb === undefined ? null : (vb ?? 0) - (va ?? 0) };
    });
    if (cells.every((c) => (c.amount ?? 0) === 0)) continue;
    if (d.group !== lastGroup && groupLabel[d.group] !== "") rows.push({ kind: "group", key: `group:${d.group}`, label: groupLabel[d.group] });
    lastGroup = d.group;
    rows.push({ kind: d.kind, key: d.key, label: d.label, cells, evidence: false });
  }
  return { title, years, rows };
}

/**
 * 表に基準との差を足す: 年間収支と金融資産残高の下に「差（C−A）」の行（見ている案−基準）、基準と違うマスに印。
 * table は見ている案の表（cashflowTable の結果）、shown・base はその案と基準の案の計算結果
 */
export function withDiff(req: EngineRequest, table: CashflowTableModel, shown: readonly TableCell[], base: readonly TableCell[], label: string): CashflowTableModel {
  const defs = new Map(rowDefs(req).map((d) => [d.key, d]));
  const rows: TableRowModel[] = [];
  for (const r of table.rows) {
    if (r.kind !== "value" && r.kind !== "total") {
      rows.push(r);
      continue;
    }
    const d = defs.get(r.key);
    if (d === undefined) {
      rows.push(r);
      continue;
    }
    const sb = sumByYear(base, d.match);
    const ss = sumByYear(shown, d.match);
    rows.push({ ...r, cells: r.cells.map((c, i) => ({ ...c, changed: (ss.get(table.years[i] as number) ?? 0) !== (sb.get(table.years[i] as number) ?? 0) })) });
    if (r.key === "net" || r.key === "financial") rows.push({ kind: "diff", key: `diff:${r.key}`, label, cells: table.years.map((y) => (ss.get(y) ?? 0) - (sb.get(y) ?? 0)) });
  }
  return { ...table, rows };
}

// ---- 収支の推移・資産と負債の推移 ----

const series = (key: string, label: string, table: readonly TableCell[], years: readonly number[], pred: (c: TableCell) => boolean): StackSeries => {
  const m = sumByYear(table, pred);
  return { key, label, values: years.map((y) => m.get(y) ?? 0) };
};

/** 収支の推移: 収入（給与・年金・その他）と支出（生活費・住宅・教育・保険・その他）の積み上げ */
export function flowChart(req: EngineRequest, table: readonly TableCell[], years: number[], title: string): FlowChartModel {
  const self = roles(req).find((r) => r.key === "self");
  const isWork = (c: TableCell) => under(c.row, "cf.income.salary") || under(c.row, "cf.income.business");
  const known = ["cf.expense.living", "cf.expense.housing", "cf.expense.education", "cf.expense.insurance"];
  const net = sumByYear(table, (c) => c.row === "cf.net");
  return {
    title,
    years,
    ages: years.map((y) => (self !== undefined ? ageInYear(self.member, y) : null)),
    income: [
      series("salary", "給与", table, years, isWork),
      series("pension", "年金", table, years, (c) => under(c.row, "cf.income.pension")),
      series("incomeOther", "その他の収入", table, years, (c) => under(c.row, "cf.income") && !isWork(c) && !under(c.row, "cf.income.pension")),
    ],
    expense: [
      series("living", "生活費", table, years, (c) => under(c.row, "cf.expense.living")),
      series("housing", "住宅", table, years, (c) => under(c.row, "cf.expense.housing")),
      series("education", "教育", table, years, (c) => under(c.row, "cf.expense.education")),
      series("insurance", "保険", table, years, (c) => under(c.row, "cf.expense.insurance")),
      series("expenseOther", "その他（税・社会保険料など）", table, years, (c) => (under(c.row, "cf.expense") && !known.some((p) => under(c.row, p))) || under(c.row, "cf.taxSi")),
    ],
    net: years.map((y) => net.get(y) ?? 0),
  };
}

const NISA_ROWS = ["cf.balance.account.nisa", "cf.balance.account.childNisa", "cf.balance.account.juniorNisa", "cf.balance.account.legacyNisa"];
const DC_ROWS = ["cf.balance.account.ideco", "cf.balance.account.corporateDc"];

/** 資産と負債の推移: 資産（預金・NISA・iDeCo など・その他）と負債（住宅ローン・その他）、純資産 */
export function balanceChart(table: readonly TableCell[], years: number[], ages: (number | null)[], title: string): BalanceChartModel {
  const pos = (s: StackSeries): StackSeries => ({ ...s, values: s.values.map((v) => Math.max(0, v)) });
  const isAccount = (c: TableCell) => under(c.row, "cf.balance.account") && c.row !== "cf.balance.account.realEstate";
  const deposit = series("deposit", "預金", table, years, (c) => c.row === "cf.balance.account.deposit");
  const assets = [
    pos(deposit),
    series("nisa", "NISA", table, years, (c) => NISA_ROWS.includes(c.row)),
    series("dc", "iDeCo・企業型DC", table, years, (c) => DC_ROWS.includes(c.row)),
    series("assetOther", "その他の資産（課税口座・財形など）", table, years, (c) => isAccount(c) && c.row !== "cf.balance.account.deposit" && !NISA_ROWS.includes(c.row) && !DC_ROWS.includes(c.row)),
  ].map(pos);
  const debts = [
    series("mortgage", "住宅ローン", table, years, (c) => c.row === "cf.balance.debt.mortgage" || c.row === "cf.balance.debt.unpaidInterest"),
    series("debtOther", "その他の負債", table, years, (c) => c.row === "cf.balance.debt.other"),
  ];
  const fin = financialOf(table);
  const shortfall = years.map((y) => Math.min(0, fin.get(y) ?? 0));
  return {
    title,
    years,
    ages,
    assets,
    debts,
    shortfall,
    netWorth: years.map((y, i) => (fin.get(y) ?? 0) - debts.reduce((s, d) => s + (d.values[i] ?? 0), 0)),
  };
}
