// 説明モードの提示用の値（ExplainModel）: 面談で、グラフを1段ずつ積み上げて見せる。
// 順番: 収入 → 年金 → 支出 → 教育 → 住宅 → 資産の推移。各段の一文の数字は計算の結果から作る。
// 提示層の約束（0016 の2）: 許可した数字と構成員の呼び方だけを写す（FPのメモ・案の名前・物の ID は写さない）
import type { EngineRequest, PreviewResult, TableCell } from "../engine/types.ts";
import { man } from "../presentation/format.ts";
import type { ExplainModel, ExplainStep, VerdictPart } from "../presentation/model.ts";
import { addMonths, ageReachedMonth, parseYm, readLevers } from "./levers.ts";
import { depletionYear, displayYears, financialOf, SURPLUS_ROW, sumByYear } from "./present.ts";
import { ruleFor, ruleText, surplusOf, yearOfTimepoint } from "./surplus.ts";
import { ageInYear, roles } from "./roles.ts";

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");

function byYears(table: readonly TableCell[], years: readonly number[], pred: (c: TableCell) => boolean): number[] {
  const m = sumByYear(table, pred);
  return years.map((y) => m.get(y) ?? 0);
}

/** 0 でない最初と最後の年 */
function span(values: readonly number[], years: readonly number[]): { from: number; to: number } | null {
  const idx = values.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return null;
  return { from: years[idx[0] as number] as number, to: years[idx.at(-1) as number] as number };
}

function peak(values: readonly number[], years: readonly number[]): { year: number; amount: number } {
  let best = 0;
  values.forEach((v, i) => {
    if (v > (values[best] ?? 0)) best = i;
  });
  return { year: years[best] ?? 0, amount: values[best] ?? 0 };
}

export function explainModel(req: EngineRequest, result: PreviewResult, targetAge: number): ExplainModel {
  const t = result.table;
  const years = displayYears(req);
  const rs = roles(req);
  const self = rs.find((r) => r.key === "self");
  const who = self?.label ?? "ご本人";
  const ageOf = (y: number) => (self !== undefined ? ageInYear(self.member, y) : null);
  const ageText = (y: number) => (self !== undefined ? `${who}${ageOf(y)}歳` : `${y}年`);

  const isPension = (c: TableCell) => under(c.row, "cf.income.pension");
  const work = byYears(t, years, (c) => under(c.row, "cf.income") && !isPension(c));
  const pension = byYears(t, years, isPension);
  const education = byYears(t, years, (c) => under(c.row, "cf.expense.education"));
  const housing = byYears(t, years, (c) => under(c.row, "cf.expense.housing"));
  const living = byYears(t, years, (c) => (under(c.row, "cf.expense") && !under(c.row, "cf.expense.education") && !under(c.row, "cf.expense.housing")) || under(c.row, "cf.taxSi"));
  const livingOnly = byYears(t, years, (c) => under(c.row, "cf.expense.living") && c.row !== SURPLUS_ROW);
  const surplusSpend = byYears(t, years, (c) => c.row === SURPLUS_ROW);
  const fin = financialOf(t);
  const financial = years.map((y) => fin.get(y) ?? 0);
  const steps: ExplainStep[] = [];
  const s = (parts: VerdictPart[]) => parts;

  // 1. 収入
  const salary = byYears(t, years, (c) => under(c.row, "cf.income.salary") || under(c.row, "cf.income.business"));
  const sw = span(salary, years);
  const wp = peak(work, years);
  steps.push({
    key: "income",
    title: "収入",
    sentence:
      sw !== null
        ? s([{ text: "給与の収入は、" }, { text: `${sw.to}年（${ageText(sw.to)}）まで`, strong: true }, { text: "入ります。いちばん多い年は " }, { text: `年${man(wp.amount)}万円`, strong: true }, { text: "です" }])
        : s([{ text: "給与の収入はありません。収入は " }, { text: `年${man(wp.amount)}万円`, strong: true }, { text: "（いちばん多い年）です" }]),
  });

  // 2. 年金: 本人の受け取り開始の翌年（1年分そろう年）の世帯の年金
  const pAge = self !== undefined ? readLevers(req, self.member.id).pensionAge : undefined;
  let pYear = span(pension, years)?.from ?? null;
  if (self !== undefined && pAge !== undefined) pYear = parseYm(addMonths(ageReachedMonth(self.member, pAge), 1)).y + 1;
  // もう受け取っている人（受け取り開始の翌年が表の最初の年より前）は、表の最初の年の世帯の年金
  const firstYear = years[0];
  if (pYear !== null && firstYear !== undefined && pYear < firstYear) pYear = firstYear;
  const pi = pYear !== null ? years.indexOf(pYear) : -1;
  steps.push({
    key: "pension",
    title: "年金",
    sentence:
      pi >= 0 && (pension[pi] ?? 0) > 0
        ? s([{ text: `${pAge !== undefined ? `${who}が${pAge}歳` : `${pYear}年`}からは、年金が ` }, { text: `年${man(pension[pi] ?? 0)}万円`, strong: true }, { text: `入ります（${pYear}年の世帯の合計）` }])
        : s([{ text: "年金は、表の期間には入りません" }]),
  });

  // 3. 支出（生活費・税と社会保険料・保険料など）
  const first = years.findIndex((_, i) => (living[i] ?? 0) > 0);
  steps.push({
    key: "expense",
    title: "支出",
    sentence:
      first >= 0
        ? s([{ text: `毎年の生活費は、${years[first]}年で ` }, { text: `年${man(livingOnly[first] ?? 0)}万円`, strong: true }, { text: "です。税・社会保険料や保険料を合わせると " }, { text: `年${man(living[first] ?? 0)}万円`, strong: true }, { text: "になります" }])
        : s([{ text: "支出は入っていません" }]),
  });

  // 3'. 黒字のうち貯まらない分（ゆとりの支出。0031）: 入れたときだけ、何を差し引いたかを一言
  const ss = surplusOf(req);
  const si = surplusSpend.findIndex((v) => v > 0);
  if (ss !== undefined && si >= 0) {
    const y = years[si] as number;
    const rule = ruleFor(ss, y, (tp) => yearOfTimepoint(req, tp));
    const step = steps.find((x) => x.key === "expense");
    if (step !== undefined)
      step.sentence = [
        ...step.sentence,
        { text: "。黒字の年は、黒字のうち貯まるのは " },
        { text: ruleText(rule), strong: true },
        { text: `とみて、残り（${y}年は年${man(surplusSpend[si] ?? 0)}万円）を「ゆとりの支出」として支出に入れています` },
      ];
  }

  // 4. 教育
  const es = span(education, years);
  const ep = peak(education, years);
  steps.push({
    key: "education",
    title: "教育",
    sentence:
      es !== null
        ? s([{ text: `教育費がかかるのは${es.from}〜${es.to}年で、いちばん多い${ep.year}年は ` }, { text: `年${man(ep.amount)}万円`, strong: true }, { text: "です" }])
        : s([{ text: "教育費は入っていません" }]),
  });

  // 5. 住宅
  const loan = byYears(t, years, (c) => under(c.row, "cf.expense.housing.loan"));
  const ls = span(loan, years);
  const hp = peak(housing, years);
  steps.push({
    key: "housing",
    title: "住宅",
    sentence:
      ls !== null
        ? s([{ text: "住宅ローンの返済は " }, { text: `${ls.to}年（${ageText(ls.to)}）まで`, strong: true }, { text: `続きます。住居費はいちばん多い年で年${man(hp.amount)}万円です` }])
        : hp.amount > 0
          ? s([{ text: "住居費は、いちばん多い年で " }, { text: `年${man(hp.amount)}万円`, strong: true }, { text: "です" }])
          : s([{ text: "住居費は入っていません" }]),
  });

  // 6. 資産の推移
  // ○歳時点の資産は既定では出さない（2026-10-17。出すかどうかは表示の設定で FP が選ぶ）。ここは足りるかどうかだけ
  const dep = depletionYear(t, years);
  const last = years.at(-1) ?? req.input.endYear;
  void targetAge;
  steps.push({
    key: "assets",
    title: "資産の推移",
    sentence:
      dep !== null
        ? s([{ text: "この収入と支出のままだと、" }, { text: `${dep}年（${ageText(dep)}）に資産が尽きます`, strong: true }])
        : s([{ text: "その結果、" }, { text: `${self !== undefined ? `${ageOf(last)}歳まで` : "最後まで"}資産が足ります`, strong: true }]),
  });

  return { title: "これからのお金の流れ", years, ages: years.map((y) => ageOf(y)), work, pension, living, education, housing, financial, steps };
}
