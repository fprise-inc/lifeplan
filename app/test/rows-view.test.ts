// 結果の見方（0044 の追記）: 「すべて入れる｜確実な分だけ」と物ごとの入れ外し（保存しない）、基本の計算に入れない物を「入れて見る」、
// 結果のグラフのすぐ下の区画「これからの大きなお金」の行（名前・時期・額・見込み・入れ外し）、入れ外しできる物の無い世帯では切り替えを出さないこと、
// 見込みの言葉を「確実／不確実」の2つにそろえたこと（古い値は同じ扱いの選択肢で見せ、書き換えない）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { ALL_ROWS, applyRowsView, forEngine, isAllRows, pickRow, viewCandidates, viewExcluded, viewMode } from "../src/engine/moneyRows.ts";
import type { Debt, EngineRequest, IncomeFlow, PeriodicExpense } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { LIKELIHOOD_LABEL, PRIORITY_LABEL } from "../src/workspace/input/moneyRows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { BigMoneyCard } from "../src/workspace/BigMoneyCard.tsx";
import { bigMoneyOf } from "../src/workspace/bigMoney.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const box = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });
const id = (n: number) => `00000000-0000-4000-8000-0000000b${String(n).padStart(4, "0")}`;
const income = (n: number, o: Partial<IncomeFlow>): IncomeFlow => ({ id: id(n), kind: "inheritance", from: { at: "2035-04" }, to: { at: "2035-04" }, everyYears: 1, amount: box(10000000), ...o });
const pe = (n: number, o: Partial<PeriodicExpense>): PeriodicExpense => ({ id: id(n), row: "cf.expense.lumpSum.other", from: { at: "2030-04" }, to: { at: "2030-04" }, everyYears: 1, amount: box(500000), ...o });
const sample = (): EngineRequest => {
  const r = structuredClone(modelHousehold("dualNoKids"));
  r.input.endYear = 2040;
  const self = roles(r)[0]!.member.id;
  r.input.household.incomeFlows = [
    income(1, { label: "父からの相続", likelihood: "uncertain" }),
    income(2, { kind: "sideJob", label: "副業", likelihood: "uncertain", from: { at: "2027-01" }, to: null, monthly: true, amount: box(30000) }),
    income(3, { kind: "sideJob", label: "確かな副業", likelihood: "likely", from: { at: "2027-01" }, to: null, monthly: true, amount: box(20000) }),
    income(4, { label: "入れた相続", likelihood: "uncertain", includeInBase: true }),
  ];
  r.input.household.periodicExpenses = [...(r.input.household.periodicExpenses ?? []), pe(10, { label: "海外旅行", priority: "wish", everyYears: 3, to: { at: "2039-04" } }), pe(11, { label: "車の買い替え", priority: "want" }), pe(12, { label: "修繕", priority: "need" })];
  const debt: Debt = { id: id(20), kind: "other", debtors: [{ member: self, role: "primary" }], principal: 1000000, start: { at: "2031-01" }, rateSchedule: [{ from: { at: "2031-01" }, type: "fixed", rate: "0.02" }], repayment: { method: "equalPayment", termMonths: 60 }, inheritedFrom: id(99), likelihood: "uncertain" };
  r.input.household.debts = [...(r.input.household.debts ?? []), debt];
  return r;
};
const inIds = (r: EngineRequest) => (r.input.household.incomeFlows ?? []).map((f) => f.id);
const outIds = (r: EngineRequest) => (r.input.household.periodicExpenses ?? []).map((p) => p.id).filter((x) => x.startsWith("00000000-0000-4000-8000-0000000b"));

describe("結果の見方（保存しない）", () => {
  it("入れ外しできる物: 基本の計算に入れない物（不確実な受け取る相続・受け継ぐ借金）・不確実な入るお金・不確実な出るお金", () => {
    const c = viewCandidates(sample().input.household);
    expect(c.map((x) => [x.key, x.reason])).toEqual([
      [`in:${id(1)}`, "base"],
      [`in:${id(2)}`, "uncertain"],
      [`in:${id(4)}`, "uncertain"],
      [`out:${id(10)}`, "priority"],
      [`out:${id(11)}`, "priority"],
      [`debt:${id(20)}`, "base"],
    ]);
  });

  it("すべて入れる（いつもの計算）は要求をそのまま返す。決まりのとおり基本の計算に入れない物は外れている", () => {
    const r = sample();
    expect(applyRowsView(r, ALL_ROWS)).toBe(r);
    const c = viewCandidates(r.input.household);
    expect(c.filter((x) => viewExcluded(x, ALL_ROWS)).map((x) => x.key)).toEqual([`in:${id(1)}`, `debt:${id(20)}`]);
  });

  it("確実な分だけ: 不確実な入るお金と、不確実（want・wish）の出るお金を外す。たぶん（古い値）は確実と同じに入れる", () => {
    const r = applyRowsView(sample(), viewMode(true));
    expect(inIds(r)).toEqual([id(3)]);
    expect(outIds(r)).toEqual([id(12)]);
    // 受け継ぐ借金は要求には残り、エンジンへ渡すときにいつものとおり外れる
    expect(forEngine(r).input.household.debts?.some((d) => d.id === id(20))).toBe(false);
  });

  it("1件ずつ入れる・外す: 決まりのとおりに戻すと物ごとの入れ外しを持たない", () => {
    const c = viewCandidates(sample().input.household);
    const trip = c.find((x) => x.id === id(10))!;
    const v1 = pickRow(viewMode(true), trip, true);
    expect(v1.pick).toEqual({ [`out:${id(10)}`]: true });
    expect(outIds(applyRowsView(sample(), v1))).toEqual([id(10), id(12)]);
    expect(pickRow(v1, trip, false)).toEqual(viewMode(true));
    // すべて入れるで、不確実な副業だけ外す
    const side = c.find((x) => x.id === id(2))!;
    const v2 = pickRow(ALL_ROWS, side, false);
    expect(isAllRows(v2)).toBe(false);
    expect(inIds(forEngine(applyRowsView(sample(), v2)))).toEqual([id(3), id(4)]);
    // 切り替えると物ごとの入れ外しは決まりのとおりに戻る
    expect(viewMode(false)).toEqual(ALL_ROWS);
  });

  it("基本の計算に入れない物を「入れて見る」: 要求の写しで includeInBase を true にする（世帯は変えない）", () => {
    const r0 = sample();
    const before = structuredClone(r0);
    const c = viewCandidates(r0.input.household);
    let v = pickRow(ALL_ROWS, c.find((x) => x.id === id(1))!, true);
    v = pickRow(v, c.find((x) => x.id === id(20))!, true);
    const r = forEngine(applyRowsView(r0, v));
    expect(inIds(r)).toContain(id(1));
    expect(r.input.household.debts?.some((d) => d.id === id(20))).toBe(true);
    expect(r0).toEqual(before);
    // 確実な分だけでも、入れた物は入る
    const r2 = forEngine(applyRowsView(r0, pickRow(viewMode(true), c.find((x) => x.id === id(1))!, true)));
    expect(inIds(r2)).toEqual([id(1), id(3)]);
  });

  it("入れ外しできる物の無い世帯: 確実な分だけでも要求は同じ物。区画に切り替えと一行の結論は出さない", () => {
    const plain = modelHousehold("dualNoKids");
    expect(applyRowsView(plain, viewMode(true))).toBe(plain);
    const bm = bigMoneyOf(plain, [], { raw: plain, view: ALL_ROWS, certainTable: null });
    expect(bm.groups.flatMap((g) => g.rows).some((r) => r.pick !== null)).toBe(false);
    expect(bm.line).toBeNull();
    const html = renderToString(h(BigMoneyCard, { model: bm, notes: [] }));
    expect(html).not.toContain("data-view-mode");
    expect(html).not.toContain('type="checkbox"');
  });
});

describe("これからの大きなお金の行（名前・時期・額・見込み）", () => {
  const ours = (r: { key: string }) => r.key.includes("0000000b");
  it("選んでいるプランの世帯を先に、現状の世帯の物を足す。まとまりごとに年の順。計算に入れているかは今の見方で", () => {
    const cur = sample();
    const plan = structuredClone(cur);
    plan.input.household.incomeFlows![1]!.label = "副業（プラン）";
    const bm = bigMoneyOf(plan, [], { raw: plan, current: cur, view: viewMode(true), certainTable: null });
    const rows = (k: string) => bm.groups.find((g) => g.key === k)!.rows.filter(ours).map((r) => [r.name, r.when, r.amount, r.tag, r.included, r.pick !== null]);
    expect(rows("pay")).toEqual([
      ["海外旅行", "2030〜2039年・3年ごと", "50万円", "不確実", false, true],
      ["車の買い替え", "2030年", "50万円", "不確実", false, true],
      ["修繕", "2030年", "50万円", "確実", true, false],
    ]);
    // 確実な副業（likely）は並べない。受け取る相続は確実も不確実も並べる
    expect(rows("receive")).toEqual([
      ["副業（プラン）", "2027年〜・毎月", "月3万円", "不確実", false, true],
      ["相続で受け継ぐ借金", "2031年", "100万円", "不確実", false, true],
      ["父からの相続", "2035年", "1,000万円", "不確実", false, true],
      ["入れた相続", "2035年", "1,000万円", "不確実", false, true],
    ]);
    const all = bigMoneyOf(cur, [], { raw: cur, view: ALL_ROWS, certainTable: null });
    expect(all.groups.flatMap((g) => g.rows).filter((r) => ours(r) && !r.included).map((r) => r.name)).toEqual(["相続で受け継ぐ借金", "父からの相続"]);
    expect(all.certainOnly).toBe(false);
    expect(bm.certainOnly).toBe(true);
  });

  it("区画の頭: すべて入れる｜確実な分だけの切り替えと「?」。行の左にチェック、右に「確実」「不確実」、外している行は薄く", () => {
    const r = sample();
    const html = renderToString(h(BigMoneyCard, { model: bigMoneyOf(r, [], { raw: r, view: viewMode(true), certainTable: null }), notes: [] }));
    expect(html).toContain("すべて入れる");
    expect(html).toContain("確実な分だけ");
    expect(html).toMatch(/data-view-mode="certain"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-view-mode="certain"/);
    expect(html).toContain("保存はしません");
    expect(html).toContain("<h2>これからの大きなお金</h2>");
    expect(html).toContain("支払いの予定");
    expect(html).toContain("受け取りの予定");
    expect(html).toContain("受け取った後の金融資産");
    expect(html).toContain('class="bm-row off"');
    expect(html).toContain(">不確実<");
    expect(html).not.toContain("外している物");
  });
});

describe("見込みの言葉（確実／不確実の2つ）", () => {
  it("入るお金も出るお金も見込みは確実／不確実（値は変えない）。古い値は同じ扱いの選択肢で読む", () => {
    expect(LIKELIHOOD_LABEL).toEqual({ likely: "確実", certain: "確実", uncertain: "不確実" });
    expect(PRIORITY_LABEL).toEqual({ need: "確実", want: "不確実", wish: "不確実" });
  });

  it("欄の選択肢は2つ。likely は確実、wish は不確実で見せ、黙って書き換えない。選び直すと certain・uncertain・want を書く。出るお金の欄の名前も「見込み」", () => {
    const r = sample();
    const wh = fromRequest(r);
    const fields = allFields(buildStage("work", wh));
    const like = fields.find((f) => f.key === `in/${id(3)}/likelihood`) as FieldDef & { options: { value: string; label: string }[] };
    expect(like.options.map((o) => o.label)).toEqual(["確実", "不確実"]);
    expect(like.get(wh).value).toBe("certain");
    expect(wh.request.input.household.incomeFlows![2]!.likelihood).toBe("likely");
    const unc = like.set(wh, "uncertain");
    expect(unc.request.input.household.incomeFlows![2]!.likelihood).toBe("uncertain");
    const back = (allFields(buildStage("work", unc)).find((f) => f.key === `in/${id(3)}/likelihood`) as FieldDef).set(unc, "certain");
    expect(back.request.input.household.incomeFlows![2]!.likelihood).toBe("certain");

    const ev = allFields(buildStage("events", wh));
    const prio = ev.find((f) => f.key === `ev/${id(10)}/priority`) as FieldDef & { options: { value: string; label: string }[] };
    expect(prio.options.map((o) => o.label)).toEqual(["確実", "不確実"]);
    expect(prio.label).toBe("見込み");
    expect(prio.get(wh).value).toBe("want");
    // 見せている値をそのまま入れ直しても書き換えない
    expect(like.set(wh, "certain")).toBe(wh);
    expect(prio.set(wh, "want")).toBe(wh);
    expect(wh.request.input.household.periodicExpenses!.find((p) => p.id === id(10))!.priority).toBe("wish");
    const need = prio.set(wh, "need");
    expect(need.request.input.household.periodicExpenses!.find((p) => p.id === id(10))!.priority).toBeUndefined();
    const want = (allFields(buildStage("events", need)).find((f) => f.key === `ev/${id(10)}/priority`) as FieldDef).set(need, "want");
    expect(want.request.input.household.periodicExpenses!.find((p) => p.id === id(10))!.priority).toBe("want");
  });
});
