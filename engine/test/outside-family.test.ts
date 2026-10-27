// 世帯の外の家族の計算（0035 の4）: 年金・給与・給付とその人の税・社会保険料は世帯に入れない（家計を1つにする期間のうち収入を世帯に
// 入れる期間だけ入れる）。世帯の判定（国民健康保険・扶養・子の数）の顔ぶれに入れない。扶養していると入れたときだけ扶養親族。
// 勤め先の健康保険に入っている世帯の外の家族は、世帯の人を扶養に入れられる。世帯の外の夫婦は、その2人の世帯で判定する
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { sameHousehold } from "../src/sdk/index.ts";
import { household, member, period, realPacks, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
const run = (req: EngineRequest): EngineResult => runEngine(req, realPacks(), {});
const call = <T>(req: EngineRequest, component: string, input: unknown): T => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const edit = (req: EngineRequest, f: (h: Obj) => void): EngineRequest => {
  const r = structuredClone(req) as unknown as { input: { household: Obj } };
  f(r.input.household);
  return r as unknown as EngineRequest;
};
const S = uid("of-self");
const P = uid("of-parent");
const M = uid("of-mother");
const sum = (r: EngineResult, pick: (f: EngineResult["flows"][number]) => boolean, year?: number) => r.flows.filter((f) => pick(f) && (year === undefined || f.ym.startsWith(`${year}-`))).reduce((s, f) => s + f.amount, 0);

/** 本人（会社員）と、年金を受ける親（75歳以上） */
function base(outside: Obj | null): EngineRequest {
  return household({
    baseMonth: "2026-10",
    endYear: 2032,
    members: [member("of-self", "self", "1980-05", { sex: "male" }), member("of-parent", "parent", "1948-05", { sex: "male", ...(outside !== null ? { outside } : {}) })],
    relations: [{ type: "parentOf", parent: P, child: S }],
    periods: [period("of-job", { member: "of-self", from: "2003-04", annual: 6000000, std: [500000, 500000] })],
    residentTaxAssessments: [
      { id: uid("of-rta"), member: S, fiscalYear: 2026, amount: { value: 300000, state: "confirmed", origin: { kind: "manual" } } },
      { id: uid("of-rtp"), member: P, fiscalYear: 2026, amount: { value: 0, state: "confirmed", origin: { kind: "manual" } } },
    ],
  });
}

describe("世帯の外の家族のお金の動き", () => {
  it("家計を1つにする期間が無ければ、親の年金・税・社会保険料は世帯に入らない（世帯の中の親なら入る）", () => {
    const inside = run(base(null));
    const outside = run(base({ of: S, periods: [] }));
    expect(sum(inside, (f) => f.member === P && f.row.startsWith("cf.income.pension"))).toBeGreaterThan(0);
    expect(outside.flows.some((f) => f.member === P)).toBe(false);
    // 本人の分は同じ
    expect(sum(outside, (f) => f.member === S)).toBe(sum(inside, (f) => f.member === S));
  });

  it("収入を世帯に入れる期間（income）の月だけ、その人のお金の動きを世帯に入れる。生活費の人数だけの期間（living）は入れない", () => {
    const withIncome = run(base({ of: S, periods: [{ id: uid("of-p1"), from: { at: "2029-01" }, to: { at: "2029-12" }, living: true, income: true }] }));
    const livingOnly = run(base({ of: S, periods: [{ id: uid("of-p2"), from: { at: "2029-01" }, to: null, living: true, income: false }] }));
    const mine = withIncome.flows.filter((f) => f.member === P);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((f) => f.ym >= "2029-01" && f.ym <= "2029-12")).toBe(true);
    expect(sum(withIncome, (f) => f.member === P && f.row.startsWith("cf.income.pension"), 2029)).toBeGreaterThan(0);
    expect(livingOnly.flows.some((f) => f.member === P)).toBe(false);
  });
});

describe("亡くなる見込みの後（0035 の4 の追記）", () => {
  it("家計を1つにする期間に終わりが無くても、亡くなる見込み（leaves）の月からは、その人のお金の動きを世帯に入れない", () => {
    const req = base({ of: S, periods: [{ id: uid("of-p3"), from: null, to: null, living: true, income: true }] });
    const dies = edit(req, (h) => void ((h.members as Obj[])[1]!.leaves = { at: "2029-07" }));
    const before = run(req);
    const after = run(dies);
    const mine = after.flows.filter((f) => f.member === P);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((f) => f.ym < "2029-07")).toBe(true);
    // 亡くなる見込みの月より前の年金は、今までと同じ（税・社会保険料は亡くなる年の所得と加入の月で変わる）
    const pension = (r: EngineResult) => sum(r, (f) => f.member === P && f.row.startsWith("cf.income.pension") && f.ym < "2029-07");
    expect(pension(after)).toBe(pension(before));
    expect(pension(after)).toBeGreaterThan(0);
    expect(sum(before, (f) => f.member === P && f.row.startsWith("cf.income.pension") && f.ym >= "2029-07")).toBeGreaterThan(0);
    // 本人の分は変わらない（扶養していないので）
    expect(sum(after, (f) => f.member === S)).toBe(sum(before, (f) => f.member === S));
  });
});

describe("世帯の判定の顔ぶれ", () => {
  it("世帯の外の家族は、扶養していると入れたときだけ扶養親族（扶養控除）", () => {
    const dep = (support: Obj | undefined) =>
      call<{ dependents: number }>(
        edit(base({ of: S, periods: [] }), (h) => {
          const p = (h.members as Obj[])[1] as Obj;
          if (support !== undefined) p.support = support;
          // 年金の少ない親（扶養親族の所得の要件に入る）
          (h as Obj).pensionRecords = [{ id: uid("of-rec"), member: P, kind: "statementOver50", asOf: "2026-12", months: { basic: 120, employee: 0 }, amounts: { basic: { value: 400000, state: "confirmed", origin: { kind: "manual" } }, employee: { value: 0, state: "confirmed", origin: { kind: "manual" } } } }];
        }),
        "tax.dependentDeduction",
        { member: S, year: 2028, regime: "incomeTax" },
      ).dependents;
    expect(dep(undefined)).toBe(0);
    expect(dep({ dependent: true, cohabiting: false })).toBeGreaterThan(0);
  });

  it("世帯の外の夫婦（両親）の判定の世帯はその2人で、世帯の中の人の判定の世帯には入らない", () => {
    const members = [
      { id: S, kind: "self" },
      { id: P, kind: "parent", outside: { of: S, periods: [] } },
      { id: M, kind: "parent", outside: { of: S, periods: [] } },
    ];
    const relations = [{ type: "spouse", a: P, b: M, from: null, to: null }];
    const ctx = {} as never;
    expect(sameHousehold(ctx, members, relations, P).map((m) => m.id).sort()).toEqual([P, M].sort());
    expect(sameHousehold(ctx, members, relations, S).map((m) => m.id)).toEqual([S]);
  });

  it("勤め先の健康保険に入っている世帯の外の家族は、世帯の人（仕事を辞めた本人）を扶養に入れられる", () => {
    const C = uid("of-child");
    const req = household({
      baseMonth: "2026-10",
      endYear: 2029,
      members: [member("of-self", "self", "1975-05", { sex: "male" }), member("of-child", "child", "1998-05", { outside: { of: S, periods: [], employeeInsurance: true } })],
      relations: [{ type: "parentOf", parent: S, child: C }],
      periods: [period("of-job2", { member: "of-self", from: "1998-04", to: "2027-03", annual: 5000000, std: [400000, 400000] })],
      residentTaxAssessments: [{ id: uid("of-rta2"), member: S, fiscalYear: 2026, amount: { value: 250000, state: "confirmed", origin: { kind: "manual" } } }],
    });
    const months = call<{ months: { month: string; kind: string; supporter?: string }[] }>(req, "socialInsurance.healthStatus", { member: S }).months;
    const may = months.find((x) => x.month === "2027-05");
    expect(may?.kind).toBe("dependent");
    expect(may?.supporter).toBe(C);
    // 印が無ければ扶養に入れない（国民健康保険）
    const none = edit(req, (h) => ((((h.members as Obj[])[1] as Obj).outside as Obj).employeeInsurance = false));
    expect(call<{ months: { month: string; kind: string }[] }>(none, "socialInsurance.healthStatus", { member: S }).months.find((x) => x.month === "2027-05")?.kind).toBe("national");
  });
});
