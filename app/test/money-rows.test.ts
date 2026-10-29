// お金の行（0044）の画面の側: 基本の計算に入れない物（不確かな受け取る相続・贈与と受け継ぐ借金）を要求から外す・確実な分だけで見る・
// 種類の既定（エンジンと同じ表）・カードごとの区画・欄の往復・古い周期的な支出がそのまま読めること・プランでの足す外すと「基本の計算に入れる」
import { describe, expect, it } from "vitest";
import { INCOME_KIND_DEFAULTS } from "../../engine/src/sdk/incomeKinds.ts";
import { certainOnly, forEngine, viewCandidates } from "../src/engine/moneyRows.ts";
import type { EngineRequest, IncomeFlow, PeriodicExpense } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addExpense, addIncome, addInheritedDebt, addOutsideGrandchild, expenseCard, incomeCard, INCOME_KINDS, kindsOf, OUT_KINDS, type MoneyCard } from "../src/workspace/input/moneyRows.ts";
import type { StageId } from "../src/workspace/input/form.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyPlan, type Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const box = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });
const id = (n: number) => `00000000-0000-4000-8000-0000000a${String(n).padStart(4, "0")}`;
const income = (n: number, o: Partial<IncomeFlow>): IncomeFlow => ({ id: id(n), kind: "inheritance", from: { at: "2035-04" }, to: { at: "2035-04" }, everyYears: 1, amount: box(10000000), ...o });
const withRows = (req: EngineRequest, o: { incomes?: IncomeFlow[]; expenses?: PeriodicExpense[] }): EngineRequest => {
  const r = structuredClone(req);
  r.input.endYear = 2040;
  if (o.incomes !== undefined) r.input.household.incomeFlows = o.incomes;
  if (o.expenses !== undefined) r.input.household.periodicExpenses = [...(r.input.household.periodicExpenses ?? []), ...o.expenses];
  return r;
};
const base = () => modelHousehold("dualNoKids");
/** お金の行の区画を置くカード（介護・親と相続・贈与はライフイベントの区画） */
// 介護・親・相続・贈与の行は、それぞれのカード（0045）
const stageOf = (c: MoneyCard): StageId => (c === "inherit" ? "inheritance" : c);

describe("基本の計算に入れない物（0035 の7・0036 の6）", () => {
  it("見込みが不確かな受け取る相続・遺贈・贈与だけを外す（includeInBase で入れる。ほかの種類は不確かでも入れる）。世帯のデータは変えない", () => {
    const req = withRows(base(), {
      incomes: [
        income(1, { likelihood: "uncertain" }),
        income(2, { kind: "giftReceived", likelihood: "uncertain" }),
        income(3, { likelihood: "likely" }),
        income(4, { likelihood: "uncertain", includeInBase: true }),
        income(5, { kind: "support", likelihood: "uncertain" }),
        income(6, {}),
      ],
    });
    const before = JSON.stringify(req);
    const sent = forEngine(req);
    expect((sent.input.household.incomeFlows ?? []).map((f) => f.id)).toEqual([id(3), id(4), id(5), id(6)]);
    expect(JSON.stringify(req)).toBe(before);
    // 外す物が無ければ同じ物（計算し直さない）
    const plain = base();
    expect(forEngine(plain)).toBe(plain);
    // 外した行は結果に出ない
    const r = preview(sent);
    expect(r.table.filter((c) => c.row === "cf.income.lumpSum.inheritance").reduce((s, c) => s + c.amount, 0)).toBeGreaterThan(0);
  });

  it("相続で受け継ぐ借金も、見込みが不確かなら外す（受け継ぐ借金でない負債は外さない）", () => {
    const wh = addInheritedDebt(addOutsideGrandchild(fromRequest(withRows(base(), {}), {})));
    const req = structuredClone(wh.request);
    const parentless = (req.input.household.debts ?? []).filter((d) => d.inheritedFrom !== undefined);
    // 親（世帯の外の家族）がいない世帯では足さない
    expect(parentless.length).toBe(0);
    req.input.household.debts = [
      ...(req.input.household.debts ?? []),
      { id: id(20), kind: "other", debtors: [{ member: roles(req)[0]!.member.id, role: "primary" }], principal: 1000000, start: { at: "2030-01" }, rateSchedule: [{ from: { at: "2030-01" }, type: "fixed", rate: "0.02" }], repayment: { method: "equalPayment", termMonths: 60 }, inheritedFrom: id(99), likelihood: "uncertain" },
      { id: id(21), kind: "other", debtors: [{ member: roles(req)[0]!.member.id, role: "primary" }], principal: 1000000, start: { at: "2030-01" }, rateSchedule: [{ from: { at: "2030-01" }, type: "fixed", rate: "0.02" }], repayment: { method: "equalPayment", termMonths: 60 }, likelihood: "uncertain" },
    ];
    const ids = (forEngine(req).input.household.debts ?? []).map((d) => d.id);
    expect(ids).not.toContain(id(20));
    expect(ids).toContain(id(21));
  });

  it("確実な分だけ: 見込みが「当てにしない」の入るお金のすべてと、優先度が「できれば」（want・wish）の出るお金を外す（保存しない）", () => {
    const pe = (n: number, priority?: PeriodicExpense["priority"]): PeriodicExpense => ({ id: id(n), row: "cf.expense.lumpSum.other", from: { at: "2030-04" }, to: { at: "2030-04" }, everyYears: 1, amount: box(100000), ...(priority !== undefined ? { priority } : {}) });
    const req = withRows(base(), { incomes: [income(1, { likelihood: "uncertain" }), income(2, { kind: "sideJob", likelihood: "uncertain" }), income(3, { kind: "sideJob" })], expenses: [pe(10, "need"), pe(11, "want"), pe(12, "wish"), pe(13)] });
    expect(viewCandidates(req.input.household).map((c) => [c.id, c.reason])).toEqual([
      [id(1), "base"],
      [id(2), "uncertain"],
      [id(11), "priority"],
      [id(12), "priority"],
    ]);
    const c = certainOnly(req);
    expect((c.input.household.incomeFlows ?? []).map((f) => f.id)).toEqual([id(3)]);
    const kept = (c.input.household.periodicExpenses ?? []).map((p) => p.id);
    expect(kept).toContain(id(10));
    expect(kept).toContain(id(13));
    expect(kept).not.toContain(id(11));
    expect(kept).not.toContain(id(12));
    const plain = base();
    expect(certainOnly(plain)).toBe(plain);
  });
});

describe("種類の既定とカードの区画", () => {
  it("入るお金の種類ごとの課税の扱い・表の行の既定は、エンジンと同じ", () => {
    for (const k of INCOME_KINDS) expect({ tax: k.tax, once: k.once, repeat: k.repeat }, k.kind).toEqual(INCOME_KIND_DEFAULTS[k.kind]);
    expect(INCOME_KINDS.map((k) => k.kind).sort()).toEqual(Object.keys(INCOME_KIND_DEFAULTS).sort());
  });

  it("どの種類も1つのカード（か、ライフイベントの介護・親／相続・贈与の区画）に置く", () => {
    const cards = ["family", "work", "pension", "living", "education", "housing", "insurance", "rental", "events", "car", "care", "inherit"] as const;
    for (const k of INCOME_KINDS) expect(cards).toContain(k.card);
    for (const k of OUT_KINDS) expect(cards).toContain(k.card);
    expect(kindsOf("family").incomes.map((k) => k.kind)).toEqual(["childSupport", "propertyDivision", "householdContribution", "benefit"]);
    expect(kindsOf("inherit").incomes.map((k) => k.kind)).toEqual(["inheritance", "giftReceived"]);
    expect(kindsOf("inherit").outs.map((k) => k.kind)).toEqual(["gift"]);
    expect(kindsOf("car").outs.map((k) => k.kind)).toEqual(["car"]);
  });

  it("足した行はそのカードの区画に出る。入るお金の額は未入力の警告（0円で計算中）、出るお金はひな形の推定。要求はスキーマを通る", () => {
    let wh: WorkingHousehold = fromRequest(base(), {});
    for (const k of INCOME_KINDS) wh = addIncome(wh, k.kind);
    for (const k of OUT_KINDS) wh = addExpense(wh, k.kind);
    const h = wh.request.input.household;
    for (const f of h.incomeFlows ?? []) {
      const stage = buildStage(stageOf(incomeCard(f)), wh);
      const amount = allFields(stage).find((x) => x.key === `in/${f.id}/amount`);
      expect(amount, f.kind).toBeDefined();
      expect(fieldStatus(amount as FieldDef, wh).status, f.kind).toBe("missing");
    }
    for (const p of (h.periodicExpenses ?? []).filter((x) => x.kind !== undefined)) {
      const stage = buildStage(stageOf(expenseCard(h, p)), wh);
      const amount = allFields(stage).find((x) => x.key === `ev/${p.id}/amount`);
      expect(amount, p.kind).toBeDefined();
      expect(fieldStatus(amount as FieldDef, wh).status, p.kind).toBe("estimated");
    }
    preview(wh.request);
  });

  it("欄の往復: 値を変えて戻すと元の世帯に戻り、同じ値を入れ直しても世帯は変わらない（古い周期的な支出もそのまま読める）", () => {
    let wh: WorkingHousehold = fromRequest(withRows(base(), { expenses: [{ id: id(30), row: "cf.expense.lumpSum.other", from: { at: "2031-04" }, to: null, everyYears: 3, amount: box(300000) }] }), {});
    for (const k of INCOME_KINDS) wh = addIncome(wh, k.kind);
    for (const k of OUT_KINDS) wh = addExpense(wh, k.kind);
    const stages = ["family", "work", "pension", "living", "education", "housing", "insurance", "rental", "events", "car"] as const;
    let moved = 0;
    for (const s of stages)
      for (const f of allFields(buildStage(s, wh))) {
        if (!f.key.startsWith("in/") && !f.key.startsWith("ev/")) continue;
        const st = f.get(wh);
        expect(JSON.stringify(f.set(wh, st.value)), f.key).toBe(JSON.stringify(wh));
        if (f.structural === true || f.readOnly !== undefined || st.implicit === true || st.estimated != null || f.kind === "when") continue;
        const v2 = f.kind === "yen" || f.kind === "int" ? (typeof st.value === "number" ? st.value + 1 : null) : f.kind === "text" ? `${String(st.value ?? "")}x` : null;
        if (v2 === null) continue;
        const w1 = f.set(wh, v2);
        expect(f.set(w1, st.value), f.key).toEqual(wh);
        moved++;
      }
    expect(moved).toBeGreaterThan(20);
    // 古い周期的な支出（種類・優先度の無い行）はライフイベントの出るお金の行で、何も書き換えない
    const old = (wh.request.input.household.periodicExpenses ?? []).find((p) => p.id === id(30)) as PeriodicExpense;
    expect(expenseCard(wh.request.input.household, old)).toBe("events");
    const fields = allFields(buildStage("events", wh)).filter((f) => f.key.startsWith(`ev/${id(30)}/`));
    expect(fields.find((f) => f.key.endsWith("/priority"))?.get(wh)).toMatchObject({ value: "need", implicit: true });
    expect(fields.find((f) => f.key.endsWith("/cadence"))?.get(wh).value).toBe("repeat");
    expect(old).toEqual({ id: id(30), row: "cf.expense.lumpSum.other", from: { at: "2031-04" }, to: null, everyYears: 3, amount: box(300000) });
  });

  it("時期の入れ方: 1回は終わりを始まりと同じ月に、毎月は月額（何年ごとは1）", () => {
    const wh = addIncome(fromRequest(base(), {}), "sideJob", id(40));
    const cad = allFields(buildStage("work", wh)).find((f) => f.key === `in/${id(40)}/cadence`) as FieldDef;
    const once = cad.set(wh, "once");
    const f1 = (once.request.input.household.incomeFlows ?? [])[0] as IncomeFlow;
    expect(f1.to).toEqual(f1.from);
    const monthly = cad.set(once, "monthly");
    const f2 = (monthly.request.input.household.incomeFlows ?? [])[0] as IncomeFlow;
    expect([f2.monthly, f2.everyYears, f2.to]).toEqual([true, 1, null]);
    preview(monthly.request);
  });

  it("時期の選択肢は「1回／毎月／年ごと」。年ごとにすると何年ごとは1（毎年）から始まり、2以上も入れられる", () => {
    const wh = addIncome(fromRequest(base(), {}), "sideJob", id(40));
    const cad = allFields(buildStage("work", wh)).find((f) => f.key === `in/${id(40)}/cadence`) as FieldDef & { options: { label: string }[] };
    expect(cad.options.map((o) => o.label)).toEqual(["1回", "毎月", "年ごと"]);
    const yearly = cad.set(cad.set(wh, "monthly"), "repeat");
    const fields = allFields(buildStage("work", yearly));
    const every = fields.find((f) => f.key === `in/${id(40)}/every`) as FieldDef;
    expect(every.get(yearly).value).toBe(1);
    expect(every.help).toContain("1なら毎年");
    // 額の欄の名前は、毎年なら「年額」、2以上なら「3年ごとの額」（0044 の 2026-10-29 の追記）
    expect(fields.find((f) => f.key === `in/${id(40)}/amount`)?.label).toBe("年額");
    const w3 = every.set(yearly, 3);
    expect((w3.request.input.household.incomeFlows ?? [])[0]?.everyYears).toBe(3);
    expect(allFields(buildStage("work", w3)).find((f) => f.key === `in/${id(40)}/amount`)?.label).toBe("3年ごとの額");
    expect(allFields(buildStage("work", cad.set(wh, "monthly"))).find((f) => f.key === `in/${id(40)}/amount`)?.label).toBe("月額");
    preview(w3.request);
  });
});

describe("プランで足す・外す・基本の計算に入れる（0036）", () => {
  const plan = (pid: string): Proposal => ({ id: pid, name: `プラン${pid}`, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] });
  const setup = (req: EngineRequest) => {
    const self = roles(req).find((r) => r.key === "self")!.member;
    const wh = { ...fromRequest(req, {}), proposals: [plan("B")] };
    return { wh, cat: buildCatalog(wh, self.id, null) };
  };

  it("プランで入るお金の行を足す・外すと add・remove の差分になり、現状は変わらない", () => {
    const { wh, cat } = setup(withRows(base(), { incomes: [income(1, { likelihood: "likely" })] }));
    const view = planView(wh, cat, "B");
    const added = addIncome(view, "sideJob", id(50));
    const w1 = recordPlanEdit(wh, cat, "B", view, added);
    expect(w1.proposals[0]!.diffs.map((d) => d.op)).toEqual(["add"]);
    expect(w1.request).toEqual(wh.request);
    const v1 = planView(w1, cat, "B");
    const removed = { ...v1, request: { ...v1.request, input: { ...v1.request.input, household: { ...v1.request.input.household, incomeFlows: (v1.request.input.household.incomeFlows ?? []).filter((f) => f.id !== id(1)) } } } };
    const w2 = recordPlanEdit(w1, cat, "B", v1, removed);
    expect(w2.proposals[0]!.diffs.map((d) => d.op).sort()).toEqual(["add", "remove"]);
    expect((applyPlan(w2, "B", cat).request.input.household.incomeFlows ?? []).map((f) => f.id)).toEqual([id(50)]);
  });

  it("不確かな受け取る相続は現状では計算に入らず、プランで「基本の計算に入れる」を set すると、そのプランだけ入る", () => {
    const { wh, cat } = setup(withRows(base(), { incomes: [income(1, { likelihood: "uncertain" })] }));
    expect(forEngine(wh.request).input.household.incomeFlows).toEqual([]);
    const view = planView(wh, cat, "B");
    const f = allFields(buildStage("inheritance", view)).find((x) => x.key === `in/${id(1)}/includeInBase`) as FieldDef;
    const w = recordPlanEdit(wh, cat, "B", view, f.set(view, true));
    const d = w.proposals[0]!.diffs;
    expect(d.map((x) => [x.op, x.item, x.at])).toEqual([["set", "incomeFlow.includeInBase", []]]);
    expect((forEngine(applyPlan(w, "B", cat).request).input.household.incomeFlows ?? []).map((x) => x.id)).toEqual([id(1)]);
    expect(forEngine(w.request).input.household.incomeFlows).toEqual([]);
  });
});
