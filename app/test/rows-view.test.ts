// ふだんの計算（見込みが「不確実」の物は外す）と結果の見方（0044 の追記）: 物ごとの入れ外し（保存しない）、不確実な物を「入れて見る」・確実な物を外して見る、
// 対策のすぐ下の区画「夢と予定」の行（名前・時期・額・見込み・入れ外し）、並べる物の無い世帯では区画を出さないこと、
// 見込みの言葉を「確実／不確実」の2つにそろえたこと（古い値は同じ扱いの選択肢で見せ、書き換えない）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { ALL_ROWS, applyRowsView, forEngine, isAllRows, pickRow, viewCandidates } from "../src/engine/moneyRows.ts";
import type { Debt, EngineRequest, IncomeFlow, PeriodicExpense } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { LIKELIHOOD_LABEL, PRIORITY_LABEL } from "../src/workspace/input/moneyRows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { BigMoneyCard } from "../src/workspace/BigMoneyCard.tsx";
import { bigMoneyOf } from "../src/workspace/bigMoney.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

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

describe("ふだんの計算と結果の見方（保存しない）", () => {
  const ours = (k: string) => k.includes("0000000b");
  it("ふだんの計算は、見込みが「不確実」の物をすべて外す（入るお金・出るお金・受け継ぐ借金）。前の版の「この行を計算に入れる」の行と確実な物は入れる", () => {
    const r = forEngine(sample());
    expect(inIds(r)).toEqual([id(3), id(4)]);
    expect(outIds(r)).toEqual([id(12)]);
    expect(r.input.household.debts?.some((d) => d.id === id(20))).toBe(false);
  });

  it("入れ外しできる物: 区画に並ぶ物（家の購入の頭金を除く）。最初の状態はふだんの計算のとおり（不確実な物はチェックなし）", () => {
    const c = viewCandidates(sample().input.household).filter((x) => ours(x.key));
    expect(c.map((x) => [x.key, x.reason, x.off === true])).toEqual([
      [`in:${id(1)}`, "uncertain", true],
      [`in:${id(2)}`, "uncertain", true],
      [`in:${id(4)}`, "certain", false],
      [`out:${id(10)}`, "uncertain", true],
      [`out:${id(11)}`, "uncertain", true],
      [`out:${id(12)}`, "certain", false],
      [`debt:${id(20)}`, "uncertain", true],
    ]);
    expect(applyRowsView(sample(), ALL_ROWS)).toEqual(sample());
  });

  it("1件ずつ入れる・外す: 不確実な物を入れて見る（要求の写しで書き換える。世帯は変えない）・確実な物を外して見る・最初に戻すと入れ外しを持たない", () => {
    const r0 = sample();
    const before = structuredClone(r0);
    const c = viewCandidates(r0.input.household);
    const of = (n: number) => c.find((x) => x.id === id(n))!;
    let v = pickRow(ALL_ROWS, of(1), true);
    v = pickRow(v, of(10), true);
    v = pickRow(v, of(20), true);
    v = pickRow(v, of(12), false);
    expect(v.pick).toEqual({ [`in:${id(1)}`]: true, [`out:${id(10)}`]: true, [`debt:${id(20)}`]: true, [`out:${id(12)}`]: false });
    const r = forEngine(applyRowsView(r0, v));
    expect(inIds(r)).toEqual([id(1), id(3), id(4)]);
    expect(outIds(r)).toEqual([id(10)]);
    expect(r.input.household.debts?.some((d) => d.id === id(20))).toBe(true);
    expect(r0).toEqual(before);
    expect(pickRow(pickRow(ALL_ROWS, of(10), true), of(10), false)).toEqual(ALL_ROWS);
    expect(isAllRows(v)).toBe(false);
  });

  it("繰上返済も外して見られる（何番目かで外す）", () => {
    const r0 = sample();
    const d = r0.input.household.debts!.find((x) => x.id === id(20))!;
    d.likelihood = "certain";
    d.prepayments = [{ at: { at: "2033-01" }, amount: 300000, mode: "shortenTerm" }, { at: { at: "2034-01" }, amount: 200000, mode: "shortenTerm" }];
    const c = viewCandidates(r0.input.household).find((x) => x.key === `prepay:${id(20)}:0`)!;
    expect(c).toMatchObject({ side: "prepay", reason: "certain" });
    const r = forEngine(applyRowsView(r0, pickRow(ALL_ROWS, c, false)));
    expect(r.input.household.debts!.find((x) => x.id === id(20))!.prepayments).toEqual([d.prepayments[1]]);
  });

  it("並べる物の無い世帯: 区画を出さない", () => {
    const plain = structuredClone(modelHousehold("dualNoKids"));
    plain.input.household.periodicExpenses = (plain.input.household.periodicExpenses ?? []).filter((p) => p.monthly === true);
    plain.input.household.debts = (plain.input.household.debts ?? []).map((d) => { const { prepayments: _p, ...rest } = d; void _p; return rest; });
    plain.input.household.residences = (plain.input.household.residences ?? []).map((r) => { const { purchase: _p, ...rest } = r; void _p; return rest; });
    const bm = bigMoneyOf(plain, [], { raw: plain, view: ALL_ROWS });
    expect(bm.groups).toEqual([]);
    expect(bm.line).toBeNull();
    expect(renderToString(h(BigMoneyCard, { model: bm, notes: [] }))).toBe("");
  });
});

describe("区画「夢と予定」の行（名前・時期・額・見込み）", () => {
  const ours = (r: { key: string }) => r.key.includes("0000000b");
  it("選んでいるプランの世帯を先に、現状の世帯の物を足す。まとまりごとに年の順。チェックは今の見方で（最初はふだんの計算のとおり）", () => {
    const cur = sample();
    const plan = structuredClone(cur);
    plan.input.household.incomeFlows![1]!.label = "副業（プラン）";
    const bm = bigMoneyOf(plan, [], { raw: plan, current: cur, view: ALL_ROWS });
    const rows = (k: string) => bm.groups.find((g) => g.key === k)!.rows.filter(ours).map((r) => [r.name, r.when, r.amount, r.tag, r.included, r.pick !== null]);
    expect(rows("pay")).toEqual([
      ["海外旅行", "2030〜2039年・3年ごと", "50万円", "不確実", false, true],
      ["車の買い替え", "2030年", "50万円", "不確実", false, true],
      ["修繕", "2030年", "50万円", "確実", true, true],
    ]);
    // 確実な副業（likely）は並べない。受け取る相続は確実も不確実も並べる。前の版の「この行を計算に入れる」の相続は確実
    expect(rows("receive")).toEqual([
      ["副業（プラン）", "2027年〜・毎月", "月3万円", "不確実", false, true],
      ["相続で受け継ぐ借金", "2031年", "100万円", "不確実", false, true],
      ["父からの相続", "2035年", "1,000万円", "不確実", false, true],
      ["入れた相続", "2035年", "1,000万円", "確実", true, true],
    ]);
    const g = bm.groups.find((x) => x.key === "receive")!;
    expect(g.included).toBe(g.rows.filter((r) => r.included).length);
  });

  it("家の購入の頭金は外せない（チェックを置かず「確実」）", () => {
    const r = structuredClone(modelHousehold("housingPurchase"));
    const res = preview(forEngine(r));
    const pay = bigMoneyOf(r, res.table, { raw: r, view: ALL_ROWS }).groups.find((g) => g.key === "pay")!.rows;
    const buy = pay.find((x) => x.name === "家の購入の頭金")!;
    expect(buy).toMatchObject({ tag: "確実", included: true, pick: null, amount: "500万円" });
    expect(pay.find((x) => x.name.startsWith("繰上返済"))).toMatchObject({ tag: "確実", included: true });
    expect(pay.find((x) => x.name.startsWith("繰上返済"))!.pick).not.toBeNull();
  });

  it("区画の頭は名前と「?」と一行の結論だけ（切り替えは無い）。列ごとに時期・金額の見出しと「入れた件数/件数」。確実・不確実は行の右", () => {
    const r = sample();
    const html = renderToString(h(BigMoneyCard, { model: bigMoneyOf(r, [], { raw: r, view: ALL_ROWS }), notes: [] }));
    expect(html).toContain("<h2>夢と予定</h2>");
    expect(html).not.toContain("すべて入れる");
    expect(html).not.toContain("確実な分だけ");
    expect(html).not.toContain("data-view-mode");
    expect(html).toContain("保存はしません");
    expect(html).toContain("支払いの予定");
    expect(html).toContain("受け取りの予定");
    expect(html.match(/>時期</gu)!.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/>金額</gu)!.length).toBeGreaterThanOrEqual(2);
    expect(html).toMatch(/\d+\/\d+件/u);
    expect(html).toContain('class="bm-row off"');
    expect(html).toContain(">不確実<");
    expect(html).toContain("（不確実）を計算に入れる");
    expect(html).not.toContain("払った後");
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
