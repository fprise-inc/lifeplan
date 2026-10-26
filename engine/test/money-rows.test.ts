// お金の行（0044）のテスト: 入るお金の行（種類の既定・課税の扱いごとの所得のつなぎ・受け取る人・月額・万一）、出るお金の行の広げた欄
// （月額・払う人・あげる贈与）、口座の間の移し替えの入れ物（知らせだけ）。製品の制度データで、手計算と突き合わせる
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import { EngineError } from "../src/errors.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { INCOME_KIND_DEFAULTS } from "../src/sdk/moneyRows.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
type Flow = EngineResult["flows"][number];
const run = (req: EngineRequest): EngineResult => runEngine(req, realPacks(), {});
const call = <T>(req: EngineRequest, component: string, input: unknown): T => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const edit = (req: EngineRequest, f: (h: Obj) => void): EngineRequest => {
  const r = structuredClone(req) as unknown as { input: { household: Obj } };
  f(r.input.household);
  return r as unknown as EngineRequest;
};
const sum = (fs: readonly Flow[], pick: (f: Flow) => boolean) => fs.filter(pick).reduce((s, f) => s + f.amount, 0);
const notices = (r: EngineResult) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const S = uid("mr-self");
const W = uid("mr-wife");
const P = uid("mr-parent");
const G = uid("mr-grandchild");
const at = (ym: string) => ({ at: ym });

/** 本人（会社員・年収600万円）・配偶者（収入なし）・世帯の外の親・世帯の外の孫（2026年10月から2035年まで） */
function base(): EngineRequest {
  return household({
    baseMonth: "2026-10",
    endYear: 2035,
    members: [
      member("mr-self", "self", "1975-05", { sex: "male" }),
      member("mr-wife", "spouse", "1977-08"),
      member("mr-parent", "parent", "1948-03", { sex: "male", outside: { of: S, periods: [] } }),
      member("mr-grandchild", "grandchild", "2000-04", { outside: { of: S, periods: [] } }),
    ],
    relations: [{ type: "spouse", a: S, b: W, marriage: "legal", from: { at: "2002-04" }, to: null }],
    periods: [period("mr-job", { member: "mr-self", from: "1998-04", annual: 6000000, std: [500000, 500000] })],
    // 計算基準月の年度の住民税は決定額（前の年の所得を計算しない）
    residentTaxAssessments: [
      { id: uid("mr-rta"), member: S, fiscalYear: 2026, amount: box(300000) },
      { id: uid("mr-rtw"), member: W, fiscalYear: 2026, amount: box(0) },
    ],
  });
}
const flow = (name: string, o: Obj): Obj => ({ id: uid(`if:${name}`), from: at("2028-07"), to: at("2028-07"), everyYears: 1, growth: { kind: "none" }, ...o });
const withIncome = (...fs: Obj[]) => edit(base(), (h) => (h.incomeFlows = fs));
const total = (req: EngineRequest, year: number, member = S) => call<{ total: number; temporary?: number; miscellaneous?: number; other?: number; separate?: number; employment: number }>(req, "tax.totalIncome", { member, year });

describe("入るお金の行（income.flows）", () => {
  it("種類の既定の表の行に、受け取る月の額で入る（1回・n年ごと・月額）。行が無ければ今と同じ結果", () => {
    const req = withIncome(
      flow("inh", { kind: "inheritance", amount: box(20000000) }),
      flow("cs", { kind: "childSupport", from: at("2027-04"), to: at("2028-03"), monthly: true, amount: box(50000) }),
      flow("cel", { kind: "celebration", from: at("2029-05"), to: null, everyYears: 3, amount: box(100000) }),
    );
    const r = run(req);
    const mine = r.flows.filter((f) => f.formula === "income.flows.receipt");
    expect(sum(mine, (f) => f.row === "cf.income.lumpSum.inheritance")).toBe(20000000);
    const cs = mine.filter((f) => f.object === uid("if:cs"));
    expect(cs.length).toBe(12);
    expect(cs.every((f) => f.row === "cf.income.other" && f.amount === 50000)).toBe(true);
    expect(mine.filter((f) => f.object === uid("if:cel")).map((f) => f.ym)).toEqual(["2029-05", "2032-05", "2035-05"]);
    // 非課税・相続税で見る行は、所得税・住民税を変えない
    const plain = run(base());
    expect(sum(r.flows, (f) => f.row.startsWith("cf.taxSi."))).toBe(sum(plain.flows, (f) => f.row.startsWith("cf.taxSi.")));
    expect(notices(r).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("incomeFlow.inheritanceTax"))).toBe(true);
    expect(run(edit(base(), (h) => (h.incomeFlows = []))).flows).toEqual(plain.flows);
  });

  it("その他の入金は1回なら一時的収入、くり返すならその他の収入（表の行を書けばその行）", () => {
    const fs = call<{ flows: Flow[] }>(withIncome(flow("o1", { kind: "other", amount: box(1000) }), flow("o2", { kind: "other", to: null, amount: box(1000) }), flow("o3", { kind: "other", amount: box(1000), row: "cf.income.other.sideJob" })), "income.flows", {}).flows;
    expect(fs.find((f) => f.object === uid("if:o1"))?.row).toBe("cf.income.lumpSum.other");
    expect(fs.find((f) => f.object === uid("if:o2"))?.row).toBe("cf.income.other");
    expect(fs.find((f) => f.object === uid("if:o3"))?.row).toBe("cf.income.other.sideJob");
  });

  it("伸び方・段階・例外の年は出るお金の行と同じ形で当たる", () => {
    const fs = call<{ flows: Flow[] }>(
      withIncome(flow("g", { kind: "support", from: at("2027-06"), to: null, amount: box(100000), growth: { kind: "rate", rate: "0.1" }, stages: [{ id: uid("st"), at: at("2030-01"), ratio: "0.5" }], exceptions: [{ id: uid("ex"), year: 2028, amount: box(0) }] })),
      "income.flows",
      {},
    ).flows;
    const y = Object.fromEntries(fs.map((f) => [f.ym.slice(0, 4), f.amount]));
    // 計算基準年（2026年）の価格で、1年ごとに10%伸ばす
    expect(y["2027"]).toBe(110000);
    expect(y["2028"]).toBeUndefined();
    expect(y["2029"]).toBe(133100);
    expect(y["2030"]).toBe(73205); // 50,000 を4年伸ばす
  });

  it("一時所得: 特別控除（50万円）を引いた2分の1が合計所得金額に入る。必要経費を引く", () => {
    const req = withIncome(flow("t", { kind: "temporary", amount: box(2000000), cost: box(300000) }));
    const t = total(req, 2028);
    const plain = total(base(), 2028);
    expect(t.temporary).toBe((2000000 - 300000 - 500000) / 2);
    expect(t.total - plain.total).toBe(600000);
    // 所得税・住民税が増える
    const taxes = (r: EngineResult) => sum(r.flows, (f) => f.member === S && (f.row === "cf.taxSi.incomeTax" || f.row === "cf.taxSi.residentTax"));
    expect(taxes(run(req))).toBeGreaterThan(taxes(run(base())));
  });

  it("雑所得（業務・その他）は収入−必要経費、事業は事業所得として合計所得金額に入る。受け取る人の所得になる", () => {
    const req = withIncome(
      flow("m1", { kind: "sideJob", to: null, amount: box(1200000), cost: box(200000) }),
      flow("m2", { kind: "powerSale", amount: box(100000) }),
      flow("b", { kind: "other", taxTreatment: "business", amount: box(3000000), cost: box(1000000), recipient: W }),
    );
    const t = total(req, 2028);
    expect(t.miscellaneous).toBe(1000000 + 100000);
    expect(t.total - total(base(), 2028).total).toBe(1100000);
    const w = total(req, 2028, W);
    expect(w.other).toBe(2000000);
    // 受け取る人を入れた行は、その人のお金の動きとして出る
    expect(run(req).flows.find((f) => f.object === uid("if:b"))?.member).toBe(W);
  });

  it("給与（社会保険なし）は本業の給与収入と合わせて給与所得にする（社会保険料は変わらない）", () => {
    const req = withIncome(flow("w", { kind: "otherWork", amount: box(1000000) }));
    const e = call<{ revenue: number }>(req, "tax.employmentIncome", { member: S, year: 2028 });
    const e0 = call<{ revenue: number }>(base(), "tax.employmentIncome", { member: S, year: 2028 });
    expect(e.revenue - e0.revenue).toBe(1000000);
    const si = (r: EngineResult) => sum(r.flows, (f) => f.member === S && (f.row === "cf.taxSi.health" || f.row === "cf.taxSi.pension" || f.row === "cf.taxSi.employment" || f.row === "cf.taxSi.care"));
    expect(si(run(req))).toBe(si(run(base())));
  });

  it("譲渡所得（分離）: 収入−取得費に所得税（復興特別所得税・防衛特別所得税を足す）を翌年3月、住民税を翌年6月。total に入れず separate で添える", () => {
    const req = withIncome(flow("s", { kind: "saleBusiness", amount: box(10000000), cost: box(2000000) }));
    const r = run(req);
    const it = r.flows.filter((f) => f.row === "cf.taxSi.incomeTax.capitalGains");
    const rt = r.flows.filter((f) => f.row === "cf.taxSi.residentTax.capitalGains");
    expect(it.map((f) => f.ym)).toEqual(["2029-03"]);
    expect(rt.map((f) => [f.ym, f.amount])).toEqual([["2029-06", 400000]]);
    // 8,000,000 × 15% = 1,200,000。復興特別所得税 2.1%（防衛特別所得税は制度データの年の率）を足し、100円未満を切り捨て
    expect(it[0]?.amount).toBeGreaterThanOrEqual(1225200);
    expect((it[0]?.amount ?? 0) % 100).toBe(0);
    const t = total(req, 2028);
    expect(t.separate).toBe(8000000);
    expect(t.total).toBe(total(base(), 2028).total);
    // 配偶者控除の本人の所得の要件に足す: 本人の合計所得金額が1,000万円を超えると配偶者控除が無くなる
    const d = call<{ spouse: number }>(req, "tax.deductions", { member: S, year: 2028, regime: "incomeTax" });
    const d0 = call<{ spouse: number }>(base(), "tax.deductions", { member: S, year: 2028, regime: "incomeTax" });
    expect(d0.spouse).toBeGreaterThan(0);
    expect(d.spouse).toBe(0);
  });

  it("贈与税で見る行: 相手（世帯の外の親）からの贈与として、受け取る人の贈与税を翌年3月に（直系尊属から18歳以上は特例税率）", () => {
    const req = withIncome(flow("gr", { kind: "giftReceived", amount: box(5000000), counterparty: P }));
    const r = run(req);
    const g = r.flows.filter((f) => f.row === "cf.taxSi.giftTax");
    // (5,000,000 − 1,100,000) = 3,900,000 → 特例税率 15% − 10万円 = 485,000
    expect(g.map((f) => [f.ym, f.amount, f.member])).toEqual([["2029-03", 485000, S]]);
    // 相手が無ければ一般税率（3,900,000 → 20% − 25万円 = 530,000）
    const other = run(withIncome(flow("gr", { kind: "giftReceived", amount: box(5000000) })));
    expect(other.flows.filter((f) => f.row === "cf.taxSi.giftTax").map((f) => f.amount)).toEqual([530000]);
  });

  it("受け取る人が世帯の外の家族の行は、世帯のお金に入れない", () => {
    const r = run(withIncome(flow("x", { kind: "support", amount: box(1000000), recipient: P })));
    expect(r.flows.some((f) => f.object === uid("if:x"))).toBe(false);
  });

  it("万一のときの扱い: 受け取る人を入れた行は、その人の万一の翌月から（入れていない行は世帯のだれかの万一）", () => {
    const withContingency = (req: EngineRequest, who: string) => {
      const r = structuredClone(req) as unknown as { input: Obj };
      r.input.contingencies = [{ id: uid("c"), member: who, kind: "death", occurs: at("2029-06") }];
      return r as unknown as EngineRequest;
    };
    const row = (recipient?: string) => flow("k", { kind: "childSupport", from: at("2029-01"), to: at("2029-12"), monthly: true, amount: box(10000), onContingency: { mode: "stop" }, ...(recipient !== undefined ? { recipient } : {}) });
    const months = (req: EngineRequest) => call<{ flows: Flow[] }>(req, "income.flows", {}).flows.filter((f) => f.object === uid("if:k")).length;
    expect(months(withContingency(withIncome(row()), W))).toBe(6);
    expect(months(withContingency(withIncome(row(S)), W))).toBe(12);
    expect(months(withContingency(withIncome(row(S)), S))).toBe(6);
  });

  it("月額の行は何年ごとが1だけ（スキーマで確かめる）", () => {
    expect(() => run(withIncome(flow("bad", { kind: "support", to: null, monthly: true, everyYears: 2, amount: box(1) })))).toThrow(EngineError);
  });

  it("種類ごとの既定は、課税の扱い9通りのどれか", () => {
    const allowed = new Set(["nonTaxable", "temporary", "miscBusiness", "miscOther", "salary", "business", "capitalGains", "inheritance", "gift"]);
    for (const d of Object.values(INCOME_KIND_DEFAULTS)) expect(allowed.has(d.tax)).toBe(true);
  });
});

describe("出るお金の行の広げた欄（expense.periodic）", () => {
  const pe = (name: string, o: Obj): Obj => ({ id: uid(`pe:${name}`), row: "cf.expense.lumpSum.other", from: at("2028-04"), to: at("2028-04"), everyYears: 1, growth: { kind: "none" }, amount: box(100000), ...o });
  const withExpense = (...es: Obj[]) => edit(base(), (h) => (h.periodicExpenses = es));

  it("月額の行は毎月。払う人を入れた行は、その人の万一だけに当てる", () => {
    const req = withExpense(pe("m", { kind: "allowance", counterparty: P, from: at("2029-01"), to: at("2029-12"), monthly: true, amount: box(30000), payer: S, onContingency: { mode: "stop" } }));
    const months = (who: string) => {
      const r = structuredClone(req) as unknown as { input: Obj };
      r.input.contingencies = [{ id: uid("c"), member: who, kind: "death", occurs: at("2029-03") }];
      return call<{ flows: Flow[] }>(r as unknown as EngineRequest, "expense.periodic", {}).flows.length;
    };
    expect(call<{ flows: Flow[] }>(req, "expense.periodic", {}).flows.length).toBe(12);
    expect(months(W)).toBe(12);
    expect(months(S)).toBe(3);
  });

  it("表の行に教育費・車の維持費を選べる", () => {
    const fs = call<{ flows: Flow[] }>(withExpense(pe("e", { kind: "education", row: "cf.expense.education" }), pe("c", { kind: "car", row: "cf.expense.living.car" })), "expense.periodic", {}).flows;
    expect(fs.map((f) => f.row).sort()).toEqual(["cf.expense.education", "cf.expense.living.car"]);
  });

  it("あげる贈与: 世帯から出し、受け取る人（世帯の外の孫）の贈与税は世帯から出さずに要約に出す。その都度払う贈与は非課税", () => {
    const req = withExpense(pe("gift", { kind: "gift", row: "cf.expense.lumpSum.gift", counterparty: G, payer: S, amount: box(2000000), gift: { method: "calendar", purpose: "general" } }));
    const r = run(req);
    expect(sum(r.flows, (f) => f.object === uid("pe:gift"))).toBe(2000000);
    expect(r.flows.some((f) => f.row === "cf.taxSi.giftTax")).toBe(false);
    const gifts = (r.summary as { gifts?: { year: number; recipient: string; amount: number; tax: number; inCashflow: boolean }[] }).gifts ?? [];
    // (2,000,000 − 1,100,000) = 900,000 → 特例税率 10% = 90,000（祖父母から18歳以上の孫）
    expect(gifts).toContainEqual(expect.objectContaining({ year: 2028, recipient: G, amount: 2000000, tax: 90000, inCashflow: false }));
    const asNeeded = run(withExpense(pe("gift", { kind: "gift", counterparty: G, amount: box(2000000), gift: { purpose: "asNeeded" } })));
    expect(((asNeeded.summary as { gifts?: unknown[] }).gifts ?? []).length).toBe(0);
  });

  it("払う人が世帯の外の家族の行は、世帯から出さない", () => {
    expect(call<{ flows: Flow[] }>(withExpense(pe("o", { payer: P })), "expense.periodic", {}).flows).toEqual([]);
  });
});

describe("口座の間の移し替え（入れ物だけ）", () => {
  it("あれば知らせ（N_NOT_SUPPORTED transfers）を出し、計算に入れない", () => {
    const req = edit(base(), (h) => {
      h.accounts = [
        { id: uid("acc-a"), kind: "deposit", owner: S, marketValue: box(1000000), asOf: "2026-09", contributions: [] },
        { id: uid("acc-b"), kind: "deposit", owner: S, marketValue: box(0), asOf: "2026-09", contributions: [] },
      ];
    });
    const moved = edit(req, (h) => (h.transfers = [{ id: uid("tr"), at: at("2028-01"), from: uid("acc-a"), to: uid("acc-b"), how: { kind: "all" } }]));
    const r = run(moved);
    expect(notices(r).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("transfers"))).toBe(true);
    expect(r.table).toEqual(run(req).table);
  });
});
