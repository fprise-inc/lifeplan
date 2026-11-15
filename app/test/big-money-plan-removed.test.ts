// 区画「夢と予定」と選んでいるプランで外した物（0044 の追記 2026-11-14）: 現状の世帯にだけある物は、チェックを置かず
// 「このプランでは外しています」と添えて並べ、見出しの件数と一行の結論には数えない。チェックのある行は、どれも入れ外しで計算が変わる。
// 繰上返済の入れ外しのキーは要素の ID（無ければ年月と額）で作り、何番目かでは作らない（プランで前の1件をやめても、残した1件が2行並ばない）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { ALL_ROWS, applyRowsView, forEngine, pickRow, prepaymentKeys, viewCandidates } from "../src/engine/moneyRows.ts";
import type { Debt, EngineRequest, PeriodicExpense } from "../src/engine/types.ts";
import { BigMoneyCard } from "../src/workspace/BigMoneyCard.tsx";
import { BIG_MONEY_REMOVED_NOTE, bigMoneyOf, type BigMoneyModel } from "../src/workspace/bigMoney.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { diffRows, planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { applyPlan, type Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const box = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });
const id = (n: number) => `00000000-0000-4000-8000-0000000c${String(n).padStart(4, "0")}`;
const pe = (n: number, o: Partial<PeriodicExpense>): PeriodicExpense => ({ id: id(n), row: "cf.expense.lumpSum.other", from: { at: "2030-04" }, to: { at: "2030-04" }, everyYears: 1, amount: box(3000000), ...o });

/** 現状: リフォーム 2030年 300万円（確実）・車の買い替え 2032年 300万円（確実）・旅行 2034年 100万円（不確実） */
const current = (): EngineRequest => {
  const r = structuredClone(modelHousehold("dualNoKids"));
  r.input.endYear = 2040;
  r.input.household.periodicExpenses = [
    pe(1, { label: "リフォーム", priority: "need" }),
    pe(2, { label: "車の買い替え", priority: "need", from: { at: "2032-04" }, to: { at: "2032-04" } }),
    pe(3, { label: "旅行", priority: "want", from: { at: "2034-04" }, to: { at: "2034-04" }, amount: box(1000000) }),
  ];
  return r;
};
const without = (r: EngineRequest, ...ids: string[]): EngineRequest => {
  const p = structuredClone(r);
  p.input.household.periodicExpenses = (p.input.household.periodicExpenses ?? []).filter((x) => !ids.includes(x.id));
  return p;
};
const model = (plan: EngineRequest, cur: EngineRequest, view = ALL_ROWS): { m: BigMoneyModel; calc: EngineRequest } => {
  const calc = forEngine(applyRowsView(plan, view));
  return { m: bigMoneyOf(calc, preview(calc).table, { raw: plan, current: cur, view }), calc };
};
const rowsOf = (m: BigMoneyModel, g: string) => m.groups.find((x) => x.key === g)?.rows ?? [];

/** チェックのある行は、どれも入れ外しで選んでいるプランの計算が変わる */
function everyPickChangesCalc(plan: EngineRequest, m: BigMoneyModel): void {
  const base = JSON.stringify(forEngine(applyRowsView(plan, ALL_ROWS)));
  const rows = m.groups.flatMap((g) => g.rows).filter((r) => r.pick !== null);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(JSON.stringify(forEngine(applyRowsView(plan, pickRow(ALL_ROWS, r.pick!, !r.included)))), r.name).not.toBe(base);
}

describe("区画「夢と予定」: 選んでいるプランで外した物", () => {
  it("プランで外した確実な物は、チェックなし・「このプランでは外しています」で並び、見出しの件数と一行の結論に数えない", () => {
    const cur = current();
    const plan = without(cur, id(1));
    const { m, calc } = model(plan, cur);
    expect((calc.input.household.periodicExpenses ?? []).map((p) => p.label)).toEqual(["車の買い替え"]);
    const pay = m.groups.find((g) => g.key === "pay")!;
    expect(pay.rows.map((r) => [r.name, r.included, r.pick !== null, r.tag, r.removed === true])).toEqual([
      ["リフォーム", false, false, null, true],
      ["車の買い替え", true, true, "確実", false],
      ["旅行", false, true, "不確実", false],
    ]);
    // 見出しは選んでいるプランの世帯にある物だけ（1/2件）。一行の結論も、チェックのある2件のうち1件
    expect([pay.included, pay.count]).toEqual([1, 2]);
    expect(m.line).toMatch(/^チェックした1件（2件中）を入れても/);
    everyPickChangesCalc(plan, m);
    // 画面: 外した物の行にはチェックが無く、名前の下に添える
    const html = renderToString(h(BigMoneyCard, { model: m, notes: [] }));
    expect(html).toContain(BIG_MONEY_REMOVED_NOTE);
    expect(html).toContain("1/2件");
    const removed = /<div class="bm-row off fixed removed"[^>]*data-bm-removed="1"[^>]*>(.*?)<\/div>/.exec(html);
    expect(removed?.[1]).toContain("リフォーム");
    expect(removed?.[1]).not.toContain("checkbox");
  });

  it("プランで外した物しか違わないとき「すべて（1件）を入れても…」。現状を選んでいれば外した物の行は無い", () => {
    const cur = current();
    cur.input.household.periodicExpenses = cur.input.household.periodicExpenses!.filter((p) => p.id !== id(3));
    const plan = without(cur, id(1));
    expect(model(plan, cur).m.line).toMatch(/^すべて（1件）を入れても/);
    const own = model(cur, cur).m;
    expect(rowsOf(own, "pay").some((r) => r.removed === true)).toBe(false);
    expect(own.line).toMatch(/^すべて（2件）を入れても/);
  });

  it("プランで外した不確実な物と夢も、チェックを置かずに並べる。プランで足した物はふつうの行", () => {
    const cur = current();
    cur.input.household.periodicExpenses!.push(pe(4, { kind: "dream", label: "世界一周", from: { at: "2036-04" }, to: { at: "2036-04" }, dream: { include: true } } as Partial<PeriodicExpense>));
    const plan = without(cur, id(3), id(4));
    plan.input.household.periodicExpenses!.push(pe(5, { label: "家具", priority: "need", from: { at: "2031-04" }, to: { at: "2031-04" } }));
    const { m } = model(plan, cur);
    expect(rowsOf(m, "dreams").map((r) => [r.name, r.removed === true, r.pick !== null])).toEqual([["世界一周", true, false]]);
    expect(rowsOf(m, "pay").map((r) => [r.name, r.removed === true])).toEqual([
      ["リフォーム", false],
      ["家具", false],
      ["車の買い替え", false],
      ["旅行", true],
    ]);
    expect(m.groups.find((g) => g.key === "dreams")).toMatchObject({ included: 0, count: 0 });
    expect(m.line).toMatch(/^すべて（3件）を入れても/);
    everyPickChangesCalc(plan, m);
  });

  it("プランで見込みや額を変えた物は、プランの値の行が1行だけ（外した物と読まない）", () => {
    const cur = current();
    const plan = structuredClone(cur);
    const reform = plan.input.household.periodicExpenses!.find((p) => p.id === id(1))!;
    reform.priority = "want";
    reform.amount = box(2000000);
    // 確実な月々の行にした物は区画に並ばないが、外した物とも読まない
    Object.assign(plan.input.household.periodicExpenses!.find((p) => p.id === id(2))!, { monthly: true, to: null, amount: box(30000) });
    const { m } = model(plan, cur);
    expect(rowsOf(m, "pay").map((r) => [r.name, r.amount, r.tag, r.removed === true])).toEqual([
      ["リフォーム", "200万円", "不確実", false],
      ["旅行", "100万円", "不確実", false],
    ]);
  });

  it("入力の画面でプランを選んで行を外した（プランの記録を通した）ときも同じ", () => {
    const req = current();
    const self = roles(req).find((r) => r.key === "self")!.member;
    const p: Proposal = { id: "B", name: "プランB", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] };
    const wh: WorkingHousehold = { ...fromRequest(req, {}), proposals: [p] };
    const cat = buildCatalog(wh, self.id, null);
    const before = planView(wh, cat, "B");
    const hh = before.request.input.household;
    const after: WorkingHousehold = { ...before, request: { ...before.request, input: { ...before.request.input, household: { ...hh, periodicExpenses: (hh.periodicExpenses ?? []).filter((x) => x.id !== id(1)) } } } };
    const w1 = recordPlanEdit(wh, cat, "B", before, after);
    expect(diffRows(w1, cat, "B").some((r) => r.label.includes("リフォーム"))).toBe(true);
    const raw = applyPlan(w1, "B", cat).request as EngineRequest;
    expect((raw.input.household.periodicExpenses ?? []).some((x) => x.id === id(1))).toBe(false);
    const { m } = model(raw, w1.request as EngineRequest);
    expect(rowsOf(m, "pay").find((r) => r.key === `out:${id(1)}`)).toMatchObject({ included: false, pick: null, removed: true });
    expect(m.line).toMatch(/^チェックした1件（2件中）を入れても/);
    everyPickChangesCalc(raw, m);
  });
});

describe("区画「夢と予定」: 繰上返済のキー", () => {
  const withPrepay = (ids: boolean): { cur: EngineRequest; debt: Debt } => {
    const cur = structuredClone(modelHousehold("housingPurchase"));
    const debt = cur.input.household.debts!.find((d) => d.kind === "mortgage")!;
    debt.prepayments = [
      { ...(ids ? { id: id(31) } : {}), at: { at: "2030-12" }, amount: 1000000, mode: "shortenTerm", fee: 0 },
      { ...(ids ? { id: id(32) } : {}), at: { at: "2036-12" }, amount: 3000000, mode: "shortenTerm", fee: 0 },
    ];
    return { cur, debt };
  };

  for (const ids of [true, false]) {
    it(`2件のうち先の1件だけプランでやめると、残した1件が1行・やめた1件は外した物の行（${ids ? "要素の ID" : "ID の無い前の形。年月と額"}で当てる）`, () => {
      const { cur, debt } = withPrepay(ids);
      const plan = structuredClone(cur);
      const pd = plan.input.household.debts!.find((d) => d.id === debt.id)!;
      pd.prepayments = pd.prepayments!.slice(1);
      const { m } = model(plan, cur);
      const rows = rowsOf(m, "pay").filter((r) => r.key.startsWith("prepay:"));
      expect(rows.map((r) => [r.when, r.amount, r.included, r.pick !== null, r.removed === true])).toEqual([
        ["2030年", "100万円", false, false, true],
        ["2036年", "300万円", true, true, false],
      ]);
      everyPickChangesCalc(plan, m);
      // 残した1件のチェックを外すと、プランの計算から繰上返済が無くなる
      const off = forEngine(applyRowsView(plan, pickRow(ALL_ROWS, rows[1]!.pick!, false)));
      expect(off.input.household.debts!.find((d) => d.id === debt.id)!.prepayments).toEqual([]);
    });
  }

  it("キーは要素の ID、無ければ年月と額（同じ年月・額が2件なら2件目に「#2」）", () => {
    const d = { id: "d", prepayments: [{ id: "p1", at: { at: "2030-12" }, amount: 1, mode: "shortenTerm" }, { at: { at: "2031-12" }, amount: 2, mode: "shortenTerm" }, { at: { at: "2031-12" }, amount: 2, mode: "shortenTerm" }] };
    expect(prepaymentKeys(d)).toEqual(["d:p1", 'd:@{"at":"2031-12"}:2', 'd:@{"at":"2031-12"}:2#2']);
    expect(viewCandidates({ ...structuredClone(modelHousehold("dualNoKids")).input.household, debts: [{ ...(modelHousehold("housingPurchase").input.household.debts![0] as Debt), id: "d", prepayments: d.prepayments }] }).filter((c) => c.side === "prepay").map((c) => c.key)).toEqual(prepaymentKeys(d).map((k) => `prepay:${k}`));
  });
});
