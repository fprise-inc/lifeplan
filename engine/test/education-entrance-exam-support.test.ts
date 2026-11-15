// 教育費の推定の直し（education.cost の改訂12。0010 の追記 2026-11-14）: 高校の就学支援金を二重に引かない・入学金等は入学の前にまとめて・
// 受験・併願の費用の統計の推定。【架空の見本】の制度データ（test/fixtures/regulation）: 公立高校の学習費総額 596,954円・学校外活動費 245,431円・
// 入学金等 18,027円・授業料 45,272円、私立高校の学習費総額 1,179,261円・学校外活動費 346,611円・入学金等 80,290円・授業料 279,170円、
// 受験・併願の費用 私立大学文系 412,000円・国公立大学 385,000円・専門学校 223,000円
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EducationCostOutput } from "../src/sdk/contracts.ts";
import { fictionalPacks, household, member, period, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
type Flow = { row: string; ym: string; amount: number; formula: string };

const C = uid("c");
const A = uid("a");
/** 本人と子（2012年6月生まれ: 高校は2028年4月〜2031年3月、大学は2031年4月から）。計算基準月は baseMonth */
function req(stages: Obj[], baseMonth = "2027-01", extra: Obj = {}) {
  const r = household({
    members: [member("a", "self", "1980-01"), member("c", "child", "2012-06")],
    relations: [{ type: "parentOf", parent: A, child: C }],
    periods: [period("p", { member: "a", from: "2005-04", annual: 5000000, std: [400000, 400000] })],
    baseMonth,
    endYear: 2036,
  });
  const input = r.input as unknown as Obj;
  Object.assign(input, extra);
  (input.household as Obj).goals = [{ id: uid("g"), kind: "education", owner: C, education: { stages } }];
  return r;
}
const run = (r: ReturnType<typeof req>, component: string) => runEngine(r, fictionalPacks(), { checkInternal: true, entry: { component, input: { member: C } } });
const cost = (r: ReturnType<typeof req>) => run(r, "education.cost").entryOutput as EducationCostOutput;
const support = (r: ReturnType<typeof req>) => (run(r, "education.support").entryOutput as { flows: Flow[] }).flows;
const flows = (o: EducationCostOutput) => o.flows as unknown as Flow[];
const sum = (fs: Flow[], pred: (f: Flow) => boolean) => fs.filter(pred).reduce((s, f) => s + f.amount, 0);
const inFy = (fy: number) => (f: Flow) => f.ym >= `${fy}-04` && f.ym <= `${fy + 1}-03`;

describe("高校の就学支援金を二重に引かない（改訂12の2）", () => {
  it("統計の平均の高校: 支援金は上限と統計の授業料（支援金を引いた後に保護者が払った額）の小さい方", () => {
    const pub = support(req([{ stage: "highSchool", sector: "public" }]));
    expect(sum(pub, inFy(2028))).toBe(45272);
    const pri = support(req([{ stage: "highSchool", sector: "private" }]));
    expect(sum(pri, inFy(2028))).toBe(279170);
    // 在学の年度の授業料（公的支援の部品が読む）も統計の授業料
    expect(cost(req([{ stage: "highSchool", sector: "private" }])).enrollments[0]?.fees.map((f) => f.tuition)).toEqual([279170, 279170, 279170]);
  });

  it("学校の年額を入れた段は今までどおり（入れた額を支援金を引く前の額とみなし、上限と入れた額の小さい方）", () => {
    expect(sum(support(req([{ stage: "highSchool", sector: "private", annualOverride: 900000 }])), inFy(2028))).toBe(457200);
    expect(sum(support(req([{ stage: "highSchool", sector: "private", annualOverride: 300000 }])), inFy(2028))).toBe(300000);
    expect(sum(support(req([{ stage: "highSchool", sector: "public", annualOverride: 400000 }])), inFy(2028))).toBe(118800);
  });

  it("統計の平均の高校の学校の費用は、支援金の後の統計の額から入学金等を除いた額のまま（支援金を足し戻さない）", () => {
    const o = cost(req([{ stage: "highSchool", sector: "public" }]));
    expect(sum(flows(o), (f) => f.row === "cf.expense.education.school" && inFy(2029)(f))).toBe(596954 - 245431 - 18027);
  });
});

describe("入学金等は入学の前にまとめて（改訂12の1）", () => {
  it("まだ入学していない段: 学校の費用から入学金等を除き、在学年数の標準（高校は3年）の分を入学の前の2月に1回", () => {
    const o = cost(req([{ stage: "highSchool", sector: "private" }]));
    const entrance = flows(o).filter((f) => f.row === "cf.expense.education.entrance");
    expect(entrance.map((f) => [f.ym, f.amount, f.formula])).toEqual([["2028-02", 80290 * 3, "education.cost.entrance"]]);
    expect(sum(flows(o), (f) => f.row === "cf.expense.education.school" && inFy(2028)(f))).toBe(1179261 - 346611 - 80290);
    // 段の合計（学校の費用3年＋入学金）は前と同じ（入学金等の平均×3年を入学の前に寄せただけ）
    expect(sum(flows(o), (f) => f.row === "cf.expense.education.school" || f.row === "cf.expense.education.entrance")).toBe((1179261 - 346611) * 3);
    expect(o.enrollments[0]?.fees[0]?.admission).toBe(80290 * 3);
  });

  it("入学した後の子（計算基準月が在学中）: 残りの年数に入学金等を入れない", () => {
    const o = cost(req([{ stage: "highSchool", sector: "private" }], "2029-04"));
    expect(flows(o).some((f) => f.row === "cf.expense.education.entrance")).toBe(false);
    expect(sum(flows(o), (f) => f.row === "cf.expense.education.school" && inFy(2029)(f))).toBe(1179261 - 346611 - 80290);
  });

  it("入学金を入れた段はその額に置き換え、学校の年額を入れた段も入学金を入れていなければ統計の入学金等を払う。インターナショナルスクールは払わない", () => {
    const over = cost(req([{ stage: "highSchool", sector: "private", entranceOverride: 500000 }]));
    expect(flows(over).filter((f) => f.row === "cf.expense.education.entrance").map((f) => f.amount)).toEqual([500000]);
    const annual = cost(req([{ stage: "highSchool", sector: "private", annualOverride: 700000 }]));
    expect(flows(annual).filter((f) => f.row === "cf.expense.education.entrance").map((f) => f.amount)).toEqual([80290 * 3]);
    expect(sum(flows(annual), (f) => f.row === "cf.expense.education.school" && inFy(2028)(f))).toBe(700000);
    const intl = cost(req([{ stage: "highSchool", sector: "international", annualOverride: 2000000 }]));
    expect(flows(intl).some((f) => f.row === "cf.expense.education.entrance")).toBe(false);
  });

  it("入学金等の値の無い区分（架空の見本の公立小学校）は前のまま（学校の費用に含め、入学金は払わない）", () => {
    const r = household({ members: [member("a", "self", "1980-01"), member("c", "child", "2020-06")], relations: [{ type: "parentOf", parent: A, child: C }], periods: [], baseMonth: "2025-01", endYear: 2030 });
    ((r.input as unknown as Obj).household as Obj).goals = [{ id: uid("g"), kind: "education", owner: C, education: { stages: [{ stage: "elementary", sector: "public", schoolLunch: "paid" }] } }];
    const o = cost(r as ReturnType<typeof req>);
    expect(flows(o).some((f) => f.row === "cf.expense.education.entrance")).toBe(false);
    expect(o.enrollments[0]?.fees[0]?.tuition).toBe(366599 - 256489);
  });
});

describe("受験・併願の費用の推定（改訂12の3）", () => {
  const exam = (o: EducationCostOutput) => flows(o).filter((f) => f.row === "cf.expense.education.exam").map((f) => [f.ym, f.amount, f.formula]);

  it("入れていない大学・専門学校の段は、統計の平均を入学の前の1月に", () => {
    expect(exam(cost(req([{ stage: "university", sector: "private", field: "humanities" }])))).toEqual([["2031-01", 412000, "education.cost.examEstimate"]]);
    expect(exam(cost(req([{ stage: "university", sector: "national" }])))).toEqual([["2031-01", 385000, "education.cost.examEstimate"]]);
    expect(exam(cost(req([{ stage: "vocational", annualOverride: 1000000 }])))).toEqual([["2031-01", 223000, "education.cost.examEstimate"]]);
    // 浪人の年数だけうしろへ
    expect(exam(cost(req([{ stage: "university", sector: "private", field: "humanities", delayYears: 1 }])))).toEqual([["2032-01", 412000, "education.cost.examEstimate"]]);
  });

  it("受験料か納付金のどちらかを入れた段は、入れた額だけ（0円も入れた額）", () => {
    expect(exam(cost(req([{ stage: "university", sector: "private", field: "humanities", exam: { amount: 300000 } }])))).toEqual([["2031-01", 300000, "education.cost.exam"]]);
    expect(exam(cost(req([{ stage: "university", sector: "private", field: "humanities", exam: { deposits: 100000 } }])))).toEqual([["2031-02", 100000, "education.cost.examDeposit"]]);
    expect(exam(cost(req([{ stage: "university", sector: "private", field: "humanities", exam: { amount: 0 } }])))).toEqual([]);
  });

  it("高校・大学院・値の無い区分（架空の見本に無い私立理系）は統計を足さない。推定で埋めない事務所も足さない", () => {
    expect(exam(cost(req([{ stage: "highSchool", sector: "private" }])))).toEqual([]);
    expect(exam(cost(req([{ stage: "graduateMaster", sector: "national" }])))).toEqual([]);
    expect(exam(cost(req([{ stage: "university", sector: "private", field: "science" }])))).toEqual([]);
    expect(exam(cost(req([{ stage: "university", sector: "private", field: "humanities" }], "2027-01", { estimateNoFill: ["education"] })))).toEqual([]);
  });
});

describe("見本の世帯の学校外の費用（0062。前の形で塾を二重に数えない）", () => {
  it("塾・習い事の行がある子の教育の目標は、どれも入れ方（統計の平均で・行で）を書いている", () => {
    const dir = join(import.meta.dirname, "..", "..", "data", "modelHouseholds");
    const legacy: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as { input: { household: { goals?: { id: string; kind: string; education?: { lessons?: unknown[]; outOfSchoolMode?: string } }[] } } };
      for (const g of r.input.household.goals ?? []) if (g.kind === "education" && (g.education?.lessons ?? []).length > 0 && g.education?.outOfSchoolMode === undefined) legacy.push(`${f} ${g.id}`);
    }
    expect(legacy).toEqual([]);
  });
});
