// 学校外の費用の入れ方（education.cost の改訂4。0062）: 統計の平均で／行で入れる／省略（前の形: 統計の平均に行を足す）。
// 【架空の見本】の制度データ（test/fixtures/regulation）で、公立小学校の学校外活動費 256,489円（年額）を使う
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EducationCostOutput } from "../src/sdk/contracts.ts";
import { fictionalPacks, household, member, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
type Flow = { row: string; ym: string; amount: number; formula: string };

/** 本人と子（2018年6月生まれ。小学校は2025年4月〜2031年3月）。教育の目標の中身を渡す */
function req(education: Obj) {
  const r = household({
    members: [member("a", "self", "1990-01"), member("e", "child", "2018-06")],
    relations: [{ type: "parentOf", parent: uid("a"), child: uid("e") }],
    periods: [],
    baseMonth: "2027-01",
    endYear: 2030,
  });
  ((r.input as unknown as Obj).household as Obj).goals = [{ id: uid("g"), kind: "education", owner: uid("e"), education: { stages: [{ stage: "elementary", sector: "public" }], ...education } }];
  return r;
}
const cost = (education: Obj) => runEngine(req(education), fictionalPacks(), { checkInternal: true, entry: { component: "education.cost", input: { member: uid("e") } } }).entryOutput as EducationCostOutput;
const sum = (o: EducationCostOutput, formula: string, year = "2028") => (o.flows as unknown as Flow[]).filter((f) => f.formula === formula && f.ym.startsWith(year)).reduce((s, f) => s + f.amount, 0);
const lesson = { from: { at: "2027-04" }, to: { at: "2029-03" }, monthly: 20000, label: "塾", kind: "cram" };

describe("学校外の費用の入れ方（0062）", () => {
  it("省略（前の形）は、統計の平均の学校外活動費に行を足す", () => {
    const o = cost({ lessons: [lesson] });
    expect(sum(o, "education.cost.outOfSchool")).toBeGreaterThan(250000);
    expect(sum(o, "education.cost.lessons")).toBeGreaterThanOrEqual(240000);
  });

  it("統計の平均で: 行は数えない（行は残っていても）", () => {
    const o = cost({ outOfSchoolMode: "statistics", lessons: [lesson] });
    expect(sum(o, "education.cost.outOfSchool")).toBe(sum(cost({}), "education.cost.outOfSchool"));
    expect(sum(o, "education.cost.lessons")).toBe(0);
  });

  it("行で入れる: 段の学校外活動費（統計の平均・月額）は数えず、行だけ。学校の費用は変わらない", () => {
    const o = cost({ outOfSchoolMode: "rows", lessons: [lesson] });
    expect(sum(o, "education.cost.outOfSchool")).toBe(0);
    expect(sum(o, "education.cost.lessons")).toBe(sum(cost({ lessons: [lesson] }), "education.cost.lessons"));
    expect(sum(o, "education.cost.school")).toBe(sum(cost({}), "education.cost.school"));
    const fixed = cost({ outOfSchoolMode: "rows", stages: [{ stage: "elementary", sector: "public", outOfSchool: { monthly: 10000 } }] });
    expect(sum(fixed, "education.cost.outOfSchool")).toBe(0);
  });

  it("高専・大学などの段（改訂11）: 月額を入れた段だけ在学中に数える。省略・統計・無しは0円、行で入れるときは数えない", () => {
    // 2008年6月生まれ: 大学は2027年4月〜2031年3月
    const uni = (education: Obj, outOfSchool?: unknown) => {
      const r = household({
        members: [member("a", "self", "1975-01"), member("e", "child", "2008-06")],
        relations: [{ type: "parentOf", parent: uid("a"), child: uid("e") }],
        periods: [],
        baseMonth: "2027-01",
        endYear: 2032,
      });
      ((r.input as unknown as Obj).household as Obj).goals = [{ id: uid("g"), kind: "education", owner: uid("e"), education: { stages: [{ stage: "university", sector: "private", ...(outOfSchool !== undefined ? { outOfSchool } : {}) }], ...education } }];
      return runEngine(r, fictionalPacks(), { checkInternal: true, entry: { component: "education.cost", input: { member: uid("e") } } }).entryOutput as EducationCostOutput;
    };
    const out = (o: EducationCostOutput) => (o.flows as unknown as Flow[]).filter((f) => f.row === "cf.expense.education.outOfSchool");
    expect(out(uni({}))).toEqual([]);
    expect(out(uni({}, "statistics"))).toEqual([]);
    expect(out(uni({}, "none"))).toEqual([]);
    const flows = out(uni({ outOfSchoolMode: "statistics" }, { monthly: 10000 }));
    // 2027年4月〜2031年3月の48か月（教育費の上昇率で伸びる）
    expect(flows.length).toBe(48);
    expect(flows[0]).toMatchObject({ ym: "2027-04", formula: "education.cost.outOfSchool" });
    expect(flows.at(-1)!.ym).toBe("2031-03");
    expect(flows[0]!.amount).toBeGreaterThanOrEqual(10000);
    expect(out(uni({ outOfSchoolMode: "rows" }, { monthly: 10000 }))).toEqual([]);
    // 学費は月額を入れても変わらない
    const tuition = (o: EducationCostOutput) => sum(o, "education.cost.tuition", "2028");
    expect(tuition(uni({}, { monthly: 10000 }))).toBe(tuition(uni({})));
  });
});
