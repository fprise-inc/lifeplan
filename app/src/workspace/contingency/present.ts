// 万一の画面の提示用の値（作業の層）。計算結果（必要保障額の推移・万一の想定の表）から、許可した項目だけを写す（0016 の2）。
// 物の ID・FP用のメモ・前提の入力の細部は写さない
import type { EngineRequest, OldAgeChoice, PreviewResult, ProtectionOutput, TableCell } from "../../engine/types.ts";
import type { BenefitDetailModel, BreakdownRowModel, ChartModel, ContingencyModel, Depletion, ProtectionChartModel, ProtectionInsightModel, ScenarioCardModel, ScenarioModel, Verdict, YearCellModel, YearStripModel } from "../../presentation/model.ts";
import { man } from "../../presentation/format.ts";
import { REFORM_TEXT } from "../engineNotices.ts";
import { parseYm } from "../levers.ts";
import { ageAxis, depletionYear, displayYears, familyText, financialOf, sumByYear } from "../present.ts";
import { ageInYear, roles } from "../roles.ts";
import { OLD_AGE_CHOICE_LABEL } from "./inputs.ts";
import type { ContingencyPlan } from "./planData.ts";
import { hasInvested, INCOME_DROP_DEFAULT, ILLNESS_DEFAULT, MARKET_CLASSES_DEFAULT, partnerOf, type Scenario } from "./requests.ts";

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");
export const REFORM_NOTICE = "N_REFORM_NOT_REFLECTED";

/**
 * 相続税の目安の一文（死亡の想定の時点。0039）。お金の流れには入れていない（表示だけ）ことと、含めていない特例を添える。
 * 目安を求めていない結果・計算できない結果は null
 */
export function inheritanceText(r: PreviewResult): string | null {
  const p = r.inheritanceTax?.points.find((x) => x.point === "contingency");
  if (p === undefined || p.status === "noData") return null;
  const tail = "（目安。お金の流れには入れていません。小規模宅地等の特例・2割加算などは含めていません）";
  if (p.status === "noHeirs") return `相続税の目安: 相続人がいないので出していません${tail}`;
  if (p.state === "confirmed") return `相続税: ${manText(p.amount)}（FP が入れた額）`;
  if (p.noTax) return `相続税の目安: かからない見込み（基礎控除 ${manText(p.basicDeduction)} ${p.margin > 0 ? "＞" : "＝"} 財産 ${manText(p.assets.taxablePrice)}）${tail}`;
  return `相続税の目安: 約${manText(p.payable)}（財産 ${manText(p.assets.taxablePrice)}、基礎控除 ${manText(p.basicDeduction)}）${tail}`;
}

export function hasReformNotice(r: PreviewResult): boolean {
  return (r.header.notices ?? []).some((n) => n.code === REFORM_NOTICE);
}

/** 必要保障額の推移（構成員1人）の提示用の値。insights は気づき（保険が切れる年。insuranceLines.ts の lapseInsights） */
export function protectionChart(req: EngineRequest, out: ProtectionOutput, result: PreviewResult, memberId: string, insights: readonly ProtectionInsightModel[] = []): ProtectionChartModel | null {
  const m = out.members.find((x) => x.member === memberId);
  const rs = roles(req);
  const who = rs.find((r) => r.member.id === memberId);
  if (m === undefined || who === undefined || m.years.length === 0) return null;
  const surv = rs.find((r) => r.member.id === m.survivor);
  const years = m.years.map((y) => y.year);
  const horizon = m.years[0]?.horizon;
  const kind = req.input.protection?.horizon?.kind ?? "lifeExpectancy";
  const until = kind === "youngestIndependence" || (kind === "lifeExpectancy" && surv?.member.kind === "child") ? "末子の独立" : kind === "age" ? `${surv?.label ?? "ご家族"}が${req.input.protection?.horizon?.age ?? ""}歳` : `${surv?.label ?? "ご家族"}の平均余命`;
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
    axis: ageAxis(rs, years),
    need: m.years.map((y) => y.need),
    needWithAssets: m.years.map((y) => y.needWithAssets),
    coverage: m.years.map((y) => y.coverage),
    maxShort,
    reformFrom: reform,
    insights: [...insights],
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

/** 内訳の「保険金・給付金」の行（大きな病気の場面では、契約ごとの内訳を添える） */
const BENEFITS_LABEL = "保険金・給付金";

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
  { label: BENEFITS_LABEL, group: "income", match: (c) => under(c.row, "cf.income.lumpSum.insurance") || under(c.row, "cf.income.other.insuranceBenefit") },
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
  /** 場面の前提（収入が減る・重ねる相場の下落の言い方に使う） */
  plan?: Pick<ContingencyPlan, "incomeDrop" | "stackMarket" | "market">;
  /** 大きな病気の場面の保険金・給付金の契約ごとの内訳と、表の下の一文（insuranceLines.ts の illnessBenefits） */
  benefits?: { details: readonly BenefitDetailModel[]; note: string };
}

/** 収入が減る人の言い方（前提の「誰の収入」） */
function incomeWho(req: EngineRequest, plan: ScenarioInput["plan"]): string {
  const rs = roles(req);
  const who = plan?.incomeDrop?.member ?? INCOME_DROP_DEFAULT.member;
  const self = rs.find((r) => r.key === "self")?.label ?? "ご本人";
  const spouse = rs.find((r) => r.key === "spouse")?.label;
  if (who === "both" && spouse !== undefined) return `${self}と${spouse}`;
  if (who === "spouse" && spouse !== undefined) return spouse;
  return self;
}

/**
 * 残された人の年金の月額の一言（死亡の場面。エンジンの結果の年金の行を読むだけ。0071）: 亡くなった翌年の月額（遺族年金を含む）と、
 * 65歳を過ぎた年（66歳の年）から変わればその月額
 */
export function survivorPensionText(req: EngineRequest, result: PreviewResult, sc: Scenario, year: number): string | null {
  if (sc.kind !== "death") return null;
  const rs = roles(req);
  const surv = rs.find((r) => (r.key === "self" || r.key === "spouse") && r.member.id !== sc.member);
  if (surv === undefined) return null;
  const pen = sumByYear(result.table, (c) => c.member === surv.member.id && under(c.row, "cf.income.pension"));
  const years = displayYears(req);
  const first = years.find((y) => y > year);
  if (first === undefined) return null;
  const m1 = Math.round((pen.get(first) ?? 0) / 12);
  const y66 = years.find((y) => y > first && ageInYear(surv.member, y) >= 66);
  const m2 = y66 === undefined ? null : Math.round((pen.get(y66) ?? 0) / 12);
  if (m1 === 0 && (m2 === null || m2 === 0)) return `${surv.label}の年金: 亡くなった翌年は受け取りがありません`;
  const later = m2 !== null && Math.abs(m2 - m1) >= 1000 ? `。${y66}年（${ageInYear(surv.member, y66 as number)}歳）からは月${man(m2)}万円` : "";
  return `${surv.label}の年金: 月${man(m1)}万円（${first}年。遺族年金を含む${later}）`;
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
  const event = scenarioEvent(sc, year, input.drop, input.plan !== undefined ? { who: incomeWho(req, input.plan), ratio: input.plan.incomeDrop?.ratio ?? INCOME_DROP_DEFAULT.ratio, years: input.plan.incomeDrop?.years ?? INCOME_DROP_DEFAULT.years, stack: input.plan.stackMarket === true } : undefined);
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
  if (depN !== null) depletions.push({ series: "current", year: depN });
  if (depS !== null) depletions.push({ series: "proposal", year: depS });
  // 年齢の段と年の札: 亡くなった人は、亡くなった年の翌年から空ける
  const gone = sc.kind === "death" && target !== undefined ? { key: target.key, year } : undefined;
  const chart: ChartModel = { years, ages: years.map((y) => age(y)), axis: ageAxis(rs, years, gone), family: years.map((y) => familyText(rs, y, gone)), proposal: years.map((y) => finS.get(y) ?? 0), current: years.map((y) => finN.get(y) ?? 0), depletions };

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
    const details = d.label === BENEFITS_LABEL && sc.kind === "illness" && input.benefits !== undefined && input.benefits.details.length > 0 ? [...input.benefits.details] : undefined;
    rows.push({ label: d.label, firstYear, total, group: d.group, ...(details !== undefined ? { details } : {}) });
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
  const pension = survivorPensionText(req, result, sc, year);
  if (pension !== null) notices.push(pension);
  if (sc.kind === "death" && hasReformNotice(result)) notices.push(REFORM_TEXT);
  const inherit = sc.kind === "death" ? inheritanceText(result) : null;
  if (inherit !== null) notices.push(inherit);
  return {
    title: event,
    who: self?.label ?? "",
    headline,
    verdict,
    chart,
    breakdown: { firstYearLabel: `${first}年（年額）`, totalLabel: `${year}〜${lastYear}年の累計`, rows, note: rows.some((r) => r.details !== undefined) ? (input.benefits?.note ?? null) : null },
    choice,
    notices,
  };
}

/**
 * 想定の年の選択肢（計算基準年から、表の最後の年まで。上限は60年。0071 で対象の人が75歳になる年までの切りをやめた）。
 * age は対象の人のその年の年齢
 */
export function yearOptions(req: EngineRequest, memberId: string): { value: number; label: string; age: number | null }[] {
  const m = req.input.household.members.find((x) => x.id === memberId);
  const by = parseYm(req.input.baseMonth).y;
  const out: { value: number; label: string; age: number | null }[] = [];
  for (let y = by; y <= Math.min(req.input.endYear, by + 60); y++) {
    const a = m === undefined ? null : ageInYear(m, y);
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
  if (sc.kind === "income") return "収入が減ったとき";
  if (sc.kind === "market") return "相場が下がったとき";
  return sc.kind === "death" ? `${sc.who}が亡くなったら` : `${sc.who}が働けなくなったら`;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** 下がる幅の言い方（"0.3" → 「3割」） */
export const dropText = (drop: string | undefined) => `${Math.round(Number(drop ?? "0.3") * 10)}割`;

/** 想定の出来事の言い方（例: 「ご主人が2031年に亡くなった場合」「2041年に株などが3割下がった場合」） */
export function scenarioEvent(sc: Scenario, year: number, drop?: string, o?: { who: string; ratio: string; years: number; stack: boolean }): string {
  if (sc.kind === "market") return `${year}年に株などが${dropText(drop)}下がった場合`;
  const also = o?.stack === true ? `（同じ年に株などが${dropText(drop)}下がる）` : "";
  if (sc.kind === "income") return `${year}年から${o?.years ?? INCOME_DROP_DEFAULT.years}年、${o?.who ?? sc.who}の収入が${dropText(o?.ratio ?? INCOME_DROP_DEFAULT.ratio)}減った場合${also}`;
  if (sc.kind === "illness") return `${sc.who}が${year}年に大きな病気になった場合${also}`;
  return sc.kind === "death" ? `${sc.who}が${year}年に亡くなった場合${also}` : `${sc.who}が${year}年に働けなくなった場合${also}`;
}

const GRADE_TEXT: Record<number, string> = { 0: "障害年金なしの仮定", 1: "障害1級の仮定", 2: "障害2級の仮定", 3: "障害3級の仮定" };

/** 働き方の短い言い方（場面の札） */
const WORK_SHORT: Readonly<Record<string, string>> = { regular: "正社員", contract: "契約社員", partTime: "パート", selfEmployed: "自営業", none: "働かない" };
const DISEASE_SHORT: Readonly<Record<string, string>> = { cancer: "がん", heartStroke: "心疾患・脳卒中", other: "そのほかの病気" };

type CardPlan = Pick<ContingencyPlan, "market" | "illness" | "incomeDrop" | "stackMarket" | "partnerWork">;

/**
 * 場面の札の見出し（条件を書く。0085）: 収入が減るは「収入が3割減る（5年）」（本人のほかの収入なら「奥様の収入が…」）、相場の下落は「相場が3割下がる」。
 * 死亡・就業不能・大きな病気は人の言い方のまま（条件は札の下の行）。条件を動かすと文字も変わる
 */
export function scenarioCardTitle(req: EngineRequest, sc: Scenario, plan: CardPlan | undefined): string {
  if (sc.kind === "market") return `相場が${dropText(plan?.market?.drop)}下がる`;
  if (sc.kind === "income") {
    const who = plan?.incomeDrop?.member ?? INCOME_DROP_DEFAULT.member;
    const head = who === "both" && roles(req).some((r) => r.key === "spouse") ? "2人の" : who === "spouse" ? `${incomeWho(req, plan)}の` : "";
    return `${head}収入が${dropText(plan?.incomeDrop?.ratio ?? INCOME_DROP_DEFAULT.ratio)}減る（${plan?.incomeDrop?.years ?? INCOME_DROP_DEFAULT.years}年）`;
  }
  return scenarioTitle(sc);
}

/**
 * 場面の帯のカード（提示用の値）: 死亡の場面は必要保障額の推移から「保障の不足 最大○万円」か「保障は足りています」、障害の場面は仮定の等級、
 * 大きな病気は病気の種類と働けない期間、収入が減るは誰の収入か、相場の下落は下げる資産と戻り方。配偶者の働き方を置き換えていれば「奥様はパート」、
 * 相場の下落を重ねていれば「相場も下落」を足す（0085）。
 * 資産が最後まで足りるかは、カードには出さない（カードによって出る・出ないがばらつくため。年ごとの結果の帯とグラフの見出しで分かる）
 */
export function scenarioCards(input: {
  req: EngineRequest;
  scenarios: readonly Scenario[];
  selected: string;
  protection: ContingencyModel["protection"];
  grade: 0 | 1 | 2 | 3 | undefined;
  /** 前提（カードの見出しと札に出す） */
  plan?: CardPlan;
}): ScenarioCardModel[] {
  const keyOf = new Map(roles(input.req).map((r) => [r.member.id, r.key]));
  const h = input.req.input.household;
  const labelOf = new Map(roles(input.req).map((r) => [r.member.id, r.label]));
  const stack = input.plan?.stackMarket === true && hasInvested(h) ? "・相場も下落" : "";
  /** 配偶者の働き方の置き換え（就業不能・収入が減る） */
  const partnerText = (sc: Scenario): string => {
    if (sc.kind !== "disability" && sc.kind !== "income") return "";
    const p = partnerOf(h, sc);
    const t = p === undefined ? undefined : input.plan?.partnerWork?.[sc.kind]?.[p.id]?.type;
    return p === undefined || t === undefined || t === "keep" ? "" : `・${labelOf.get(p.id) ?? "配偶者"}は${WORK_SHORT[t] ?? t}`;
  };
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
    } else if (sc.kind === "market") {
      const m = input.plan?.market;
      const what = m?.classes === undefined || sameSet(m.classes, MARKET_CLASSES_DEFAULT) ? "株・REIT" : "選んだ資産";
      const after = m?.recoveryYears !== undefined && m.recoveryYears > 0 ? `・その後${m.recoveryYears}年は利回り${Math.round(Number(m.recoveryCap ?? "0") * 1000) / 10}%まで` : "";
      [status, tone] = [`下げる資産: ${what}${after}`, "wait"];
    } else if (sc.kind === "income") {
      [status, tone] = [`${incomeWho(input.req, input.plan)}の給与・事業の所得${partnerText(sc)}${stack}`, "wait"];
    } else if (sc.kind === "illness") {
      const il = input.plan?.illness;
      [status, tone] = [`${DISEASE_SHORT[il?.disease ?? ILLNESS_DEFAULT.disease] ?? ""}・${il?.months ?? ILLNESS_DEFAULT.months}か月働けない${stack}`, "wait"];
    } else [status, tone] = [`${GRADE_TEXT[input.grade ?? 2] ?? ""}${partnerText(sc)}${stack}`, "wait"];
    const loading = sc.kind === "death" && input.protection.status === "loading";
    return { key: sc.key, label: sc.label, title: scenarioCardTitle(input.req, sc, input.plan), status, tone, loading, protection: chart !== undefined ? chart.key : null };
  });
}
