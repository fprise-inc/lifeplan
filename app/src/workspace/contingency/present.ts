// 万一の画面の提示用の値（作業の層）。計算結果（必要保障額の推移・万一の想定の表）から、許可した項目だけを写す（0016 の2）。
// 物の ID・FP用のメモ・前提の入力の細部は写さない
import type { EngineRequest, OldAgeChoice, PreviewResult, ProtectionOutput, TableCell } from "../../engine/types.ts";
import type { BreakdownRowModel, ChartModel, ContingencyModel, Depletion, ProtectionChartModel, ScenarioCardModel, ScenarioModel, Verdict, YearCellModel, YearStripModel } from "../../presentation/model.ts";
import { man } from "../../presentation/format.ts";
import { parseYm } from "../levers.ts";
import { depletionYear, displayYears, financialOf, sumByYear } from "../present.ts";
import { ageInYear, roles } from "../roles.ts";
import { OLD_AGE_CHOICE_LABEL } from "./inputs.ts";
import type { ContingencyPlan } from "./planData.ts";
import { ILLNESS_DEFAULT, type Scenario } from "./requests.ts";

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");
export const REFORM_NOTICE = "N_REFORM_NOT_REFLECTED";
const REFORM_TEXT = "遺族年金は2028年4月の見直し前の制度で計算しています（2028年4月以後に亡くなる想定）";

export function hasReformNotice(r: PreviewResult): boolean {
  return (r.header.notices ?? []).some((n) => n.code === REFORM_NOTICE);
}

/** 必要保障額の推移（構成員1人）の提示用の値 */
export function protectionChart(req: EngineRequest, out: ProtectionOutput, result: PreviewResult, memberId: string): ProtectionChartModel | null {
  const m = out.members.find((x) => x.member === memberId);
  const rs = roles(req);
  const who = rs.find((r) => r.member.id === memberId);
  if (m === undefined || who === undefined || m.years.length === 0) return null;
  const surv = rs.find((r) => r.member.id === m.survivor);
  const years = m.years.map((y) => y.year);
  const horizon = m.years[0]?.horizon;
  const kind = req.input.protection?.horizon?.kind ?? "lifeExpectancy";
  const until = kind === "youngestIndependence" ? "末子の独立" : kind === "age" ? `${surv?.label ?? "ご家族"}が${req.input.protection?.horizon?.age ?? ""}歳` : `${surv?.label ?? "ご家族"}の平均余命`;
  let maxShort: ProtectionChartModel["maxShort"] = null;
  for (const y of m.years) {
    const s = y.needWithAssets - y.coverage;
    if (s > 0 && (maxShort === null || s > maxShort.amount)) maxShort = { year: y.year, amount: s };
  }
  const reform = hasReformNotice(result) ? (m.years.find((y) => y.death >= "2028-04")?.year ?? null) : null;
  return {
    key: who.key,
    title: `${who.label}が亡くなった場合`,
    sub: `${until}${horizon !== undefined ? `（${horizon}年）` : ""}までの資金。遺族は${surv?.label ?? "お子さま"}`,
    years,
    ages: years.map((y) => ageInYear(who.member, y)),
    need: m.years.map((y) => y.need),
    needWithAssets: m.years.map((y) => y.needWithAssets),
    coverage: m.years.map((y) => y.coverage),
    maxShort,
    reformFrom: reform,
  };
}

/** 障害の想定の、65歳からの組み合わせ（表の年ごとの障害年金・老齢年金の行から読む。66歳の年から） */
export function chosenCombinations(req: EngineRequest, table: readonly TableCell[], memberId: string): { from: number; combination: OldAgeChoice }[] {
  const m = req.input.household.members.find((x) => x.id === memberId);
  if (m === undefined) return [];
  const dis = sumByYear(table, (c) => c.member === memberId && c.row === "cf.income.pension.disability");
  const old = sumByYear(table, (c) => c.member === memberId && c.row === "cf.income.pension");
  const out: { from: number; combination: OldAgeChoice }[] = [];
  for (const y of displayYears(req)) {
    if (ageInYear(m, y) < 66) continue;
    const d = dis.get(y) ?? 0;
    const o = old.get(y) ?? 0;
    if (d === 0 && o === 0) continue;
    const c: OldAgeChoice = d > 0 && o > 0 ? "disabilityBasicOldAgeEmployee" : d > 0 ? "disability" : "oldAge";
    if (out.at(-1)?.combination !== c) out.push({ from: y, combination: c });
  }
  return out;
}

interface BreakdownDef {
  label: string;
  group: BreakdownRowModel["group"];
  match: (c: TableCell) => boolean;
}

const BREAKDOWN: BreakdownDef[] = [
  { label: "遺族年金", group: "income", match: (c) => under(c.row, "cf.income.pension.survivor") },
  { label: "障害年金", group: "income", match: (c) => under(c.row, "cf.income.pension.disability") },
  { label: "老齢年金", group: "income", match: (c) => c.row === "cf.income.pension" },
  { label: "傷病手当金など", group: "income", match: (c) => under(c.row, "cf.income.benefit") && !under(c.row, "cf.income.benefit.childAllowance") && !under(c.row, "cf.income.benefit.education") },
  { label: "保険金・給付金", group: "income", match: (c) => under(c.row, "cf.income.lumpSum.insurance") || under(c.row, "cf.income.other.insuranceBenefit") },
  { label: "退職金・一時金", group: "income", match: (c) => under(c.row, "cf.income.lumpSum") && !under(c.row, "cf.income.lumpSum.insurance") },
  { label: "給与・事業の収入", group: "income", match: (c) => under(c.row, "cf.income.salary") || under(c.row, "cf.income.business") },
  { label: "生活費", group: "expense", match: (c) => under(c.row, "cf.expense.living") },
  { label: "住居費（住宅ローン・団信）", group: "expense", match: (c) => under(c.row, "cf.expense.housing") },
  { label: "医療・介護", group: "expense", match: (c) => under(c.row, "cf.expense.care") },
  { label: "税・社会保険料", group: "expense", match: (c) => under(c.row, "cf.taxSi") },
  { label: "そのほかの支出", group: "expense", match: (c) => under(c.row, "cf.expense") && !["cf.expense.living", "cf.expense.housing", "cf.expense.care"].some((p) => under(c.row, p)) },
  { label: "年間収支", group: "net", match: (c) => c.row === "cf.net" },
];

export interface ScenarioInput {
  req: EngineRequest;
  scenario: Scenario;
  year: number;
  /** 万一の場合 */
  result: PreviewResult;
  /** 万一なし（現状） */
  none: PreviewResult;
  /** 主役の数字の年齢（本人） */
  targetAge: number;
  /** FP が選び直した組み合わせ（障害の想定） */
  choice: OldAgeChoice | undefined;
  /** 相場が下がったときの下がる幅 */
  drop?: string;
}

export function scenarioModel(input: ScenarioInput): ScenarioModel {
  const { req, scenario: sc, year, result, none } = input;
  const years = displayYears(req);
  const rs = roles(req);
  const self = rs.find((r) => r.key === "self");
  const target = rs.find((r) => r.member.id === sc.member);
  const other = rs.find((r) => (r.key === "self" || r.key === "spouse") && r.member.id !== sc.member);
  const age = (y: number) => (self !== undefined ? ageInYear(self.member, y) : null);
  const finS = financialOf(result.table);
  const finN = financialOf(none.table);
  const depS = depletionYear(result.table, years);
  const depN = depletionYear(none.table, years);
  const lastYear = years.at(-1) ?? req.input.endYear;
  const targetYear = self !== undefined ? Math.min(lastYear, parseYm(self.member.birth.birthYearMonth).y + input.targetAge) : lastYear;
  const event = scenarioEvent(sc, year, input.drop);
  // 主役の数字は、残る人（死亡の想定）か本人の年齢で見る
  const watcher = sc.kind === "death" ? (other ?? self) : self;
  const wAge = (y: number) => (watcher !== undefined ? ageInYear(watcher.member, y) : null);
  const headline = {
    label: `${targetYear}年${watcher !== undefined ? `（${watcher.label}${wAge(targetYear)}歳）` : ""}の金融資産（万一の場合）`,
    amount: finS.get(targetYear) ?? 0,
    currentAmount: finN.get(targetYear) ?? 0,
    diff: (finS.get(targetYear) ?? 0) - (finN.get(targetYear) ?? 0),
    currentNote: depN !== null ? `${self?.label ?? ""}${age(depN) ?? depN}歳で不足` : null,
  };
  let verdict: Verdict;
  if (depS === null) verdict = { tone: depN === null ? "flat" : "up", parts: [{ text: `${event}も、` }, { text: "資産は最後まで尽きません", strong: true }] };
  else
    verdict = {
      tone: "down",
      parts: [{ text: `${event}、資産は ` }, { text: `${depS}年（${watcher?.label ?? ""}${wAge(depS) ?? ""}歳）に尽きます`, strong: true }, { text: depN === null ? "（万一なしは尽きません）" : `（万一なしは${depN}年）` }],
    };
  const depletions: Depletion[] = [];
  if (depN !== null) depletions.push({ series: "current", year: depN, label: `万一なし ${age(depN) ?? depN}歳で不足` });
  if (depS !== null) depletions.push({ series: "proposal", year: depS, label: `万一の場合 ${age(depS) ?? depS}歳で不足` });
  const chart: ChartModel = { years, ages: years.map((y) => age(y)), proposal: years.map((y) => finS.get(y) ?? 0), current: years.map((y) => finN.get(y) ?? 0), depletions };

  // 内訳（万一なしとの差）: 万一の翌年と、万一の年から最後の年までの累計
  const first = Math.min(year + 1, lastYear);
  const rows: BreakdownRowModel[] = [];
  for (const d of BREAKDOWN) {
    const s = sumByYear(result.table, d.match);
    const n = sumByYear(none.table, d.match);
    let total = 0;
    for (const y of years) if (y >= year) total += (s.get(y) ?? 0) - (n.get(y) ?? 0);
    const firstYear = (s.get(first) ?? 0) - (n.get(first) ?? 0);
    if (total === 0 && firstYear === 0 && d.group !== "net") continue;
    rows.push({ label: d.label, firstYear, total, group: d.group });
  }

  let choice: string | null = null;
  if (sc.kind === "disability") {
    const combos = chosenCombinations(req, result.table, sc.member);
    if (combos.length > 0) {
      const text = combos.map((c, i) => `${i === 0 ? "" : `${c.from}年からは`}「${OLD_AGE_CHOICE_LABEL[c.combination]}」`).join("、");
      choice = input.choice === undefined ? `65歳からは、手取りが多い組み合わせ ${text} を選びました` : `65歳からは ${text} にしています（選び直した組み合わせ）`;
    }
  }
  const notices: string[] = [];
  if (sc.kind === "death" && hasReformNotice(result)) notices.push(REFORM_TEXT);
  void target;
  return {
    title: event,
    who: self?.label ?? "",
    headline,
    verdict,
    chart,
    breakdown: { firstYearLabel: `${first}年（年額）`, totalLabel: `${year}〜${lastYear}年の累計`, rows },
    choice,
    notices,
  };
}

/** 想定の年の選択肢（計算基準年から、対象の人が75歳になる年まで）。age は対象の人のその年の年齢 */
export function yearOptions(req: EngineRequest, memberId: string): { value: number; label: string; age: number | null }[] {
  const m = req.input.household.members.find((x) => x.id === memberId);
  const by = parseYm(req.input.baseMonth).y;
  const out: { value: number; label: string; age: number | null }[] = [];
  for (let y = by; y <= Math.min(req.input.endYear, by + 60); y++) {
    const a = m === undefined ? null : ageInYear(m, y);
    if (a !== null && a > 75) break;
    out.push({ value: y, label: `${y}年${a !== null ? `（${a}歳）` : ""}`, age: a });
  }
  return out;
}

/** 年ごとの結果の帯の1マスの計算結果（要約。workspace/contingency/engine.ts の YearOutcome と同じ形） */
export type YearResult = { state: "ready"; depletion: number | null; source: "preview" | "canonical" } | { state: "error"; code: string } | { state: "pending" };

/** 続いた年のまとまり（例: [2031, 2032, 2033, 2040] → 「2031〜2033年・2040年」） */
export function yearRanges(years: readonly number[]): string {
  const ys = [...years].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < ys.length) {
    let j = i;
    while (j + 1 < ys.length && (ys[j + 1] as number) === (ys[j] as number) + 1) j++;
    parts.push(i === j ? `${ys[i]}年` : `${ys[i]}〜${ys[j]}年`);
    i = j + 1;
  }
  return parts.join("・");
}

/**
 * 年ごとの結果の帯（提示用の値）: マスごとに「その年に起きても最後まで足りるか」。全体の一言は、
 * 全部足りる「2027〜2050年のどの年に起きても、最後まで資産は足ります」／一部が不足「2031〜2035年に起きると、資産が途中で不足します」。
 * 計算中の年が残っている間は一言を出さず、何年分できたかを出す。万一なしでも不足する世帯は、そのことを添える
 */
export function yearStripModel(input: {
  options: readonly { value: number; age: number | null }[];
  results: readonly YearResult[];
  who: string;
  /** 万一なしで資産が尽きる年（尽きなければ null。計算前は undefined） */
  noneDepletion: number | null | undefined;
  stale: boolean;
}): YearStripModel {
  const { options, results, who } = input;
  const cells: YearCellModel[] = options.map((o, i) => {
    const r = results[i] ?? { state: "pending" };
    const when = `${o.value}年${o.age !== null ? `（${who}${o.age}歳）` : ""}に起きた場合`;
    if (r.state === "pending") return { year: o.value, age: o.age, state: "pending", shortYear: null, provisional: false, label: `${when}（計算中）` };
    if (r.state === "error") return { year: o.value, age: o.age, state: "error", shortYear: null, provisional: false, label: `${when}、計算できませんでした` };
    const short = r.depletion !== null;
    return {
      year: o.value,
      age: o.age,
      state: short ? "short" : "ok",
      shortYear: r.depletion,
      provisional: r.source !== "canonical",
      label: short ? `${when}、${r.depletion}年に資産が不足` : `${when}、最後まで資産は足ります`,
    };
  });
  const total = cells.length;
  const done = cells.filter((c) => c.state !== "pending").length;
  const first = options[0]?.value;
  const last = options.at(-1)?.value;
  const span = first === undefined ? "" : first === last ? `${first}年` : `${first}〜${last}年`;
  let summary: string;
  let tone: YearStripModel["tone"];
  const shorts = cells.filter((c) => c.state === "short").map((c) => c.year);
  if (total === 0) [summary, tone] = ["", "wait"];
  else if (done < total) [summary, tone] = [`年ごとの結果を計算しています（${done}/${total}年）`, "wait"];
  else if (cells.some((c) => c.state === "error")) [summary, tone] = ["計算できなかった年があります", "wait"];
  else if (shorts.length === 0) [summary, tone] = [`${span}のどの年に起きても、最後まで資産は足ります`, "ok"];
  else if (shorts.length === total) [summary, tone] = [`${span}のどの年に起きても、資産が途中で不足します`, "short"];
  else [summary, tone] = [`${yearRanges(shorts)}に起きると、資産が途中で不足します`, "short"];
  if (tone === "short" && input.noneDepletion != null) summary += `（万一なしでも${input.noneDepletion}年に不足します）`;
  return { who, cells, summary, tone, done, total, stale: input.stale };
}

/** 万円の短い書き方（提示層の外で一文を作るとき） */
export const manText = (yen: number) => `${man(yen)}万円`;

/** 場面の帯のカードの名前（例: 「ご主人が亡くなったら」「奥様が働けなくなったら」「相場が下がったとき」） */
export function scenarioTitle(sc: Scenario): string {
  if (sc.kind === "illness") return `${sc.who}が大きな病気のとき`;
  if (sc.kind === "market") return "相場が下がったとき";
  return sc.kind === "death" ? `${sc.who}が亡くなったら` : `${sc.who}が働けなくなったら`;
}

/** 下がる幅の言い方（"0.3" → 「3割」） */
export const dropText = (drop: string | undefined) => `${Math.round(Number(drop ?? "0.3") * 10)}割`;

/** 想定の出来事の言い方（例: 「ご主人が2031年に亡くなった場合」「2041年に株などが3割下がった場合」） */
export function scenarioEvent(sc: Scenario, year: number, drop?: string): string {
  if (sc.kind === "market") return `${year}年に株などが${dropText(drop)}下がった場合`;
  if (sc.kind === "illness") return `${sc.who}が${year}年に大きな病気になった場合`;
  return sc.kind === "death" ? `${sc.who}が${year}年に亡くなった場合` : `${sc.who}が${year}年に働けなくなった場合`;
}

const GRADE_TEXT: Record<number, string> = { 0: "障害年金なしの仮定", 1: "障害1級の仮定", 2: "障害2級の仮定", 3: "障害3級の仮定" };

/**
 * 場面の帯のカード（提示用の値）: 死亡の場面は必要保障額の推移から「保障の不足 最大○万円」か「保障は足りています」、障害の場面は仮定の等級。
 * 資産が最後まで足りるかは、カードには出さない（カードによって出る・出ないがばらつくため。年ごとの結果の帯とグラフの見出しで分かる）
 */
export function scenarioCards(input: {
  req: EngineRequest;
  scenarios: readonly Scenario[];
  selected: string;
  protection: ContingencyModel["protection"];
  grade: 0 | 1 | 2 | 3 | undefined;
  /** 大きな病気・相場が下がったときの前提（カードの札に出す） */
  plan?: Pick<ContingencyPlan, "market" | "illness">;
}): ScenarioCardModel[] {
  const keyOf = new Map(roles(input.req).map((r) => [r.member.id, r.key]));
  return input.scenarios.map((sc) => {
    const pk = keyOf.get(sc.member) ?? null;
    const chart = pk === null ? undefined : input.protection.charts.find((c) => c.key === pk);
    let status: string;
    let tone: ScenarioCardModel["tone"];
    if (sc.kind === "death") {
      if (input.protection.status === "loading") [status, tone] = ["計算しています", "wait"];
      else if (input.protection.status === "error" || chart === undefined) [status, tone] = ["必要保障額は出していません", "wait"];
      else if (chart.maxShort !== null) [status, tone] = [`保障の不足 最大${man(chart.maxShort.amount)}万円`, "ng"];
      else [status, tone] = ["保障は足りています", "ok"];
    } else if (sc.kind === "market") [status, tone] = [`下がる幅 ${dropText(input.plan?.market?.drop)}（株・REIT）`, "wait"];
    else if (sc.kind === "illness") [status, tone] = [`働けない期間 ${input.plan?.illness?.months ?? ILLNESS_DEFAULT.months}か月・医療費`, "wait"];
    else [status, tone] = [GRADE_TEXT[input.grade ?? 2] ?? "", "wait"];
    const loading = sc.kind === "death" && input.protection.status === "loading";
    return { key: sc.key, label: sc.label, title: scenarioTitle(sc), status, tone, loading, protection: chart !== undefined ? chart.key : null };
  });
}
