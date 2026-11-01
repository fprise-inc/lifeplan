import { describe, expect, it } from "vitest";
import { renderToString } from "preact-render-to-string";
import { h } from "preact";
import { applyLevers } from "../src/workspace/levers.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { depletionYear, displayYears, schoolEntryYear, toPresentation } from "../src/workspace/present.ts";
import { roles } from "../src/workspace/roles.ts";
import { CashflowTable, GoalCards, ResultCard } from "../src/presentation/MainView.tsx";
import type { TableCell } from "../src/engine/types.ts";
import { modelHousehold, preview } from "./helpers.ts";

const base = modelHousehold("salariedCoupleTwoKids");
const self = roles(base).find((r) => r.key === "self")!.member;
const demo = demoHousehold("salariedCoupleTwoKids")!;
const proposal = applyLevers(base, self.id, demo.firstProposal, { reemployment: demo.reemployment! });
const current = preview(base);
const proposed = preview(proposal);
const model = toPresentation({ base, proposal, current, proposed, targetAge: 95, selectedYear: 2031, provisional: false });

describe("提示用の値を作る", () => {
  it("表の年は計算基準月の翌年から（年の途中から始まるため）", () => {
    expect(displayYears(base)[0]).toBe(2027);
    expect(displayYears(base).at(-1)).toBe(2081);
  });

  it("資産が尽きる年は、金融資産がはじめてマイナスになる年", () => {
    const t = (vals: number[]): TableCell[] => vals.map((amount, i) => ({ row: "cf.balance.financial", year: 2027 + i, amount }));
    expect(depletionYear(t([5, 3, -1, 2]), [2027, 2028, 2029, 2030])).toBe(2029);
    expect(depletionYear(t([5, 3]), [2027, 2028])).toBeNull();
  });

  it("学校に入る年（4月2日〜翌年4月1日生まれが同じ学年）", () => {
    expect(schoolEntryYear("2012-05", false, "highSchool")).toBe(2028);
    expect(schoolEntryYear("2012-05", false, "university")).toBe(2031);
    expect(schoolEntryYear("2013-03", false, "university")).toBe(2031);
    expect(schoolEntryYear("2013-04", true, "university")).toBe(2031);
    expect(schoolEntryYear("2013-04", false, "university")).toBe(2032);
  });

  it("主役の数字・結論・グラフが計算結果と合う", () => {
    const fin = (r: typeof current, y: number) => r.table.filter((c) => c.row === "cf.balance.financial" && c.year === y).reduce((s, c) => s + c.amount, 0);
    expect(model.headline.label).toBe("ご本人95歳時点の金融資産（提案）");
    expect(model.headline.amount).toBe(fin(proposed, 2076));
    expect(model.headline.diff).toBe(fin(proposed, 2076) - fin(current, 2076));
    expect(model.chart.years).toHaveLength(55);
    expect(model.chart.proposal[0]).toBe(fin(proposed, 2027));
    const dep = depletionYear(current.table, model.chart.years);
    expect(dep).not.toBeNull();
    expect(model.verdict.tone).toBe("up");
    expect(model.verdict.parts.map((p) => p.text).join("")).toContain(`ご本人 ${dep! - 1981}歳で不足`);
    // 主画面の結論の1文（○歳時点の資産は既定では出さない）
    expect(model.result.parts.map((p) => p.text).join("")).toBe("提案は100歳まで足ります");
    expect(model.result.sub.map((p) => p.text).join("")).toBe(`現状（基準）は${dep! - 1981}歳で資産が尽きます`);
    expect(model.chart.depletions.map((d) => d.series)).toEqual(["current"]);
  });

  it("構成員は呼び方だけ（ご本人・配偶者・第1子・第2子。子は性別によらず生まれた順）", () => {
    expect(model.members).toEqual([
      { label: "ご本人", age: 45 },
      { label: "配偶者", age: 43 },
      { label: "第1子", age: 14 },
      { label: "第2子", age: 11 },
    ]);
  });

  it("表: 収入合計−支出合計＝年間収支（各年）", () => {
    const row = (k: string) => model.table.rows.find((r) => r.key === k) as { cells: { amount: number | null }[] };
    model.table.years.forEach((_, i) => {
      expect((row("incomeTotal").cells[i]!.amount ?? 0) - (row("expenseTotal").cells[i]!.amount ?? 0)).toBe(row("net").cells[i]!.amount ?? 0);
    });
    expect(model.table.rows.some((r) => r.key === "pension:self")).toBe(true);
    // 0 だけの行は出さない
    expect(model.table.rows.some((r) => r.key === "incomeOther")).toBe(false);
  });

  it("イベントと目標", () => {
    const texts = model.events.map((e) => `${e.year} ${e.icon} ${e.text}`);
    expect(texts).toContain("2031 学 第1子 大学入学（私立文系・自宅外）（第1子19歳）");
    expect(texts.some((t) => t.startsWith("2046 退 ご本人 退職（ご本人65歳）"))).toBe(true);
    expect(texts.some((t) => t.startsWith("2046 年 ご本人 年金の受け取り開始（65歳）"))).toBe(true);
    expect(model.goals.cards.map((c) => c.title)).toEqual(["第1子の大学", "第2子の大学", "住宅ローンの完済", "老後の生活資金", "何年かごとの支出", "まだ入れていません"]);
    expect(model.goals.needReady).toBe(model.goals.needTotal);
  });

  it("年の内訳", () => {
    expect(model.yearDetail!.year).toBe(2031);
    expect(model.yearDetail!.members).toBe("ご本人50歳・配偶者48歳・第1子19歳・第2子16歳");
  });
});

describe("0016 の2: 提示層は内部情報を受け取らない", () => {
  const MARK = "目印-FPメモ-ZQX";
  it("FP用のメモ・物の ID・部品の指紋は提示用の値に入らない", () => {
    const json = JSON.stringify(model);
    expect(json).not.toContain(MARK);
    for (const m of base.input.household.members) expect(json).not.toContain(m.id);
    expect(json).not.toContain("sha256:");
    expect(json).not.toContain(proposed.header.engine.sourceDigest);
  });

  it("提示層の部品を描いた結果に、メモの目印も物の ID も出ない", () => {
    // メモを持つのは作業の層だけ。提示層の部品は PresentationModel しか受け取れないので、目印は出ようがない
    const noop = () => undefined;
    const html = renderToString(h("div", null, h(GoalCards, { model: model.goals }), h(ResultCard, { model, verdict: model.result, provisional: false, mode: "assets", onMode: noop, explain: null, onExplain: noop, ageMark: null, pinnedYear: null, onSelectYear: noop }), h(CashflowTable, { model: model.table, selectedYear: 2031, onSelectYear: noop, onEvidence: noop })));
    expect(html).toContain("100歳まで足ります");
    expect(html).not.toContain(MARK);
    for (const m of base.input.household.members) expect(html).not.toContain(m.id);
  });
});
