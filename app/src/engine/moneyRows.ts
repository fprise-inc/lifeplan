// お金の行（0044）の、計算の要求を作るときの決まり（0035 の7・0036 の6）:
// - 基本の計算に入れない: 見込みが「不確か」で includeInBase が true でない、受け取る相続・遺贈・贈与の入るお金の行（種類が inheritance・giftReceived）と、
//   相続で受け継ぐ借金（inheritedFrom のある負債）。世帯のデータからは消さず、エンジンへ渡す要求からだけ外す（エンジンは変えない）。
//   ほかの種類の入るお金には広げない（当てにならない遺産で楽な結果を見る誤りは、相続に特有なため）
// - 確実な分だけで見る（保存しない自動の差分。0036 の6）: 見込みが「不確か」の入るお金の行のすべてと、優先度が「希望」「夢」の出るお金の行を外す
//   （外す差分 remove を当てたのと同じ要求）
// どちらも差分を当てた後の作業中の世帯から作る要求に当てるので、プランでの見込み・includeInBase・優先度の set が効く
// - 世帯に保存した表示だけの設定（相続税の目安の設定・遺したい額。0060）も、エンジンへ渡すときに外す（withoutStoredSettings）
import type { Debt, EngineRequest, Household, IncomeFlow, IncomeFlowKind, PeriodicExpense } from "./types.ts";

/** 不確かなら基本の計算に入れない入るお金の種類（受け取る相続・遺贈・贈与） */
export const BASE_EXCLUDED_KINDS: ReadonlySet<IncomeFlowKind> = new Set(["inheritance", "giftReceived"]);

/** この入るお金の行を基本の計算から外すか */
export function excludedIncome(f: Pick<IncomeFlow, "kind" | "likelihood" | "includeInBase">): boolean {
  return BASE_EXCLUDED_KINDS.has(f.kind) && f.likelihood === "uncertain" && f.includeInBase !== true;
}

/** この負債（相続で受け継ぐ借金）を基本の計算から外すか */
export function excludedDebt(d: Pick<Debt, "inheritedFrom" | "likelihood" | "includeInBase">): boolean {
  return d.inheritedFrom !== undefined && d.likelihood === "uncertain" && d.includeInBase !== true;
}

/** 基本の計算に入れていない物の ID（入るお金の行・負債） */
export function excludedFromBase(h: Household): { incomes: string[]; debts: string[] } {
  return { incomes: (h.incomeFlows ?? []).filter(excludedIncome).map((f) => f.id), debts: (h.debts ?? []).filter(excludedDebt).map((d) => d.id) };
}

const withHousehold = (req: EngineRequest, h: Household): EngineRequest => ({ ...req, input: { ...req.input, household: h } });

/**
 * エンジンへ渡す要求（基本の計算に入れない物を外す）。外す物が無ければ同じ物を返す（要求の文字列が変わらず、計算し直さない）。
 * 外した入るお金の行・負債を指す物は無い（贈与・移し替えの結び付けは外した行を指しても計算に使わない）
 */
export function forEngine(req0: EngineRequest): EngineRequest {
  const req = withoutStoredSettings(req0);
  const h = req.input.household;
  const incomes = h.incomeFlows ?? [];
  const debts = h.debts ?? [];
  const dropIncome = incomes.some(excludedIncome);
  const dropDebt = debts.some(excludedDebt);
  if (!dropIncome && !dropDebt) return req;
  return withHousehold(req, {
    ...h,
    ...(dropIncome ? { incomeFlows: incomes.filter((f) => !excludedIncome(f)) } : {}),
    ...(dropDebt ? { debts: debts.filter((d) => !excludedDebt(d)) } : {}),
  });
}

/**
 * 世帯に保存した表示だけの設定を外す（0060）: 相続税の目安の設定（時点 points の無い inheritanceTax。目安を求める要求は時点を入れる。
 * inheritanceLine.ts・万一の死亡の想定）と、遺したい額（legacy）。どちらも計算のお金の流れに効かないので、外しても結果は同じで、
 * 設定を直しても計算し直さない。外す物が無ければ同じ物を返す
 */
export function withoutStoredSettings(req: EngineRequest): EngineRequest {
  const dropTax = req.input.inheritanceTax !== undefined && req.input.inheritanceTax.points === undefined;
  const dropLegacy = req.input.legacy !== undefined;
  if (!dropTax && !dropLegacy) return req;
  const { inheritanceTax, legacy: _legacy, ...rest } = req.input;
  void _legacy;
  return { ...req, input: { ...rest, ...(dropTax || inheritanceTax === undefined ? {} : { inheritanceTax }) } as EngineRequest["input"] };
}

/** 確実な分だけで見るときに外す行か（入るお金は見込みが不確か、出るお金は優先度が希望・夢） */
export const notCertainIncome = (f: Pick<IncomeFlow, "likelihood">): boolean => f.likelihood === "uncertain";
export const notNeededExpense = (e: Pick<PeriodicExpense, "priority">): boolean => e.priority === "want" || e.priority === "wish";

/** 確実な分だけで見るときに外す行の数（画面の見出しに出す） */
export function certainOnlyCounts(req: EngineRequest): { incomes: number; expenses: number } {
  const h = req.input.household;
  return { incomes: (h.incomeFlows ?? []).filter(notCertainIncome).length, expenses: (h.periodicExpenses ?? []).filter(notNeededExpense).length };
}

/**
 * 確実な分だけで見る要求（保存しない自動の差分。0036 の6）: 見込みが不確かな入るお金の行と、優先度が希望・夢の出るお金の行を外す。
 * 基本の計算に入れない物（forEngine）は、エンジンへ渡すときにいつものとおり外れる
 */
export function certainOnly(req: EngineRequest): EngineRequest {
  const h = req.input.household;
  const c = certainOnlyCounts(req);
  if (c.incomes === 0 && c.expenses === 0) return req;
  return withHousehold(req, {
    ...h,
    ...(c.incomes > 0 ? { incomeFlows: (h.incomeFlows ?? []).filter((f) => !notCertainIncome(f)) } : {}),
    ...(c.expenses > 0 ? { periodicExpenses: (h.periodicExpenses ?? []).filter((e) => !notNeededExpense(e)) } : {}),
  });
}
