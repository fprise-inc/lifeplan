// 結果の見方（0044 の追記）: 「すべて入れる｜確実な分だけ」と物ごとの入れ外し（保存しない）、基本の計算に入れない物を「入れて見る」、
// 一覧の名前・額・時期、入れ外しできる物の無い世帯では出さないこと、札の言葉を2つずつにしたこと（古い値は同じ扱いの札で見せ、書き換えない）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { ALL_ROWS, applyRowsView, forEngine, isAllRows, pickRow, viewCandidates, viewExcluded, viewMode } from "../src/engine/moneyRows.ts";
import type { Debt, EngineRequest, IncomeFlow, PeriodicExpense } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { LIKELIHOOD_LABEL, PRIORITY_LABEL } from "../src/workspace/input/moneyRows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { RowsViewBar } from "../src/workspace/RowsViewBar.tsx";
import { viewRows } from "../src/workspace/rowsView.ts";
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
  it("入れ外しできる物: 基本の計算に入れない物（当てにしない受け取る相続・受け継ぐ借金）・当てにしない入るお金・できればの出るお金", () => {
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

  it("確実な分だけ: 当てにしない入るお金と、できれば（want・wish）の出るお金を外す。たぶん（古い値）は確実と同じに入れる", () => {
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
    // すべて入れるで、当てにしない副業だけ外す
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

  it("入れ外しできる物の無い世帯: 確実な分だけでも要求は同じ物。見方の帯は出さない", () => {
    const plain = modelHousehold("dualNoKids");
    expect(applyRowsView(plain, viewMode(true))).toBe(plain);
    const rows = viewRows([plain.input.household], ALL_ROWS);
    expect(rows).toEqual([]);
    expect(renderToString(h(RowsViewBar, { rows, view: ALL_ROWS, onMode: () => undefined, onPick: () => undefined }))).toBe("");
  });
});

describe("見方の一覧（名前・額・時期）", () => {
  it("選んでいるプランの世帯を先に、現状の世帯の物を足す。外しているかは今の見方で", () => {
    const cur = sample();
    const plan = structuredClone(cur);
    plan.input.household.incomeFlows![1]!.label = "副業（プラン）";
    const rows = viewRows([plan.input.household, cur.input.household], viewMode(true));
    expect(rows.map((r) => [r.name, r.amount, r.when, r.tag, r.excluded])).toEqual([
      ["父からの相続", "1,000万円・1回", "2035年4月", "基本の計算に入れない", true],
      ["副業（プラン）", "3万円・毎月", "2027年1月〜最後まで", "当てにしない", true],
      ["入れた相続", "1,000万円・1回", "2035年4月", "当てにしない", true],
      ["海外旅行", "50万円・3年ごと", "2030年4月〜2039年4月", "できれば", true],
      ["車の買い替え", "50万円・1回", "2030年4月", "できれば", true],
      ["相続で受け継ぐ借金", "100万円", "2031年1月から", "基本の計算に入れない", true],
    ]);
    const all = viewRows([cur.input.household], ALL_ROWS);
    expect(all.filter((r) => r.excluded).map((r) => r.name)).toEqual(["父からの相続", "相続で受け継ぐ借金"]);
  });

  it("帯: すべて入れる｜確実な分だけの切り替えと、外している物の件数", () => {
    const rows = viewRows([sample().input.household], viewMode(true));
    const html = renderToString(h(RowsViewBar, { rows, view: viewMode(true), onMode: () => undefined, onPick: () => undefined }));
    expect(html).toContain("すべて入れる");
    expect(html).toContain("確実な分だけ");
    expect(html).toContain("外している物（6件）▾");
    expect(html).toMatch(/data-view-mode="certain"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-view-mode="certain"/);
    expect(html).toContain("保存はしません");
  });
});

describe("札の言葉（2つずつ）", () => {
  it("見込みは確実／当てにしない、優先度は必ず／できれば。古い値は同じ扱いの札で読む", () => {
    expect(LIKELIHOOD_LABEL).toEqual({ likely: "確実", certain: "確実", uncertain: "当てにしない" });
    expect(PRIORITY_LABEL).toEqual({ need: "必ず", want: "できれば", wish: "できれば" });
  });

  it("欄の選択肢は2つ。likely は確実、wish はできればで見せ、黙って書き換えない。選び直すと certain・uncertain・want を書く", () => {
    const r = sample();
    const wh = fromRequest(r);
    const fields = allFields(buildStage("work", wh));
    const like = fields.find((f) => f.key === `in/${id(3)}/likelihood`) as FieldDef & { options: { value: string; label: string }[] };
    expect(like.options.map((o) => o.label)).toEqual(["確実", "当てにしない"]);
    expect(like.get(wh).value).toBe("certain");
    expect(wh.request.input.household.incomeFlows![2]!.likelihood).toBe("likely");
    const unc = like.set(wh, "uncertain");
    expect(unc.request.input.household.incomeFlows![2]!.likelihood).toBe("uncertain");
    const back = (allFields(buildStage("work", unc)).find((f) => f.key === `in/${id(3)}/likelihood`) as FieldDef).set(unc, "certain");
    expect(back.request.input.household.incomeFlows![2]!.likelihood).toBe("certain");

    const ev = allFields(buildStage("events", wh));
    const prio = ev.find((f) => f.key === `ev/${id(10)}/priority`) as FieldDef & { options: { value: string; label: string }[] };
    expect(prio.options.map((o) => o.label)).toEqual(["必ず", "できれば"]);
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
