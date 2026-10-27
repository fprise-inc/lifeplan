// 当てはまるときだけ出す知らせ: 受給資格期間に足りない（働き方を入れていない子には出さない）・国民健康保険の未就学児の軽減と
// 産前産後の免除（小学校に入る前の子が国民健康保険に入っているときだけ）・住民税の非課税の基準の級地（級地で判定が変わりうるときだけ）。
// どれも知らせだけを変え、計算の結果は変えない
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { clone, modelHousehold, realPacks, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
type Member = { id: string; kind: string; birth: { birthYearMonth: string } };
const run = (req: EngineRequest): EngineResult => runEngine(req, realPacks(), {});
const has = (r: EngineResult, code: string, id: string, member?: string) =>
  (r.header as { notices: { code: string; ids: string[] }[] }).notices.some((n) => n.code === code && n.ids.includes(id) && (member === undefined || n.ids.includes(member)));
const membersOf = (req: EngineRequest) => req.input.household.members as unknown as Member[];
const periodsOf = (req: EngineRequest) => req.input.household.employmentPeriods as unknown as Obj[];
const children = (req: EngineRequest) => membersOf(req).filter((m) => m.kind === "child");
/** 子の生まれた年月を変える */
function childBorn(name: string, births: string[]): EngineRequest {
  const req = clone(modelHousehold(name));
  children(req).forEach((c, i) => (c.birth.birthYearMonth = births[i] ?? c.birth.birthYearMonth));
  return req;
}

const QUALIFYING = ["N_NOT_ENTITLED", "pension.qualifyingMonths"] as const;
const PRESCHOOL = ["N_NOT_SUPPORTED", "socialInsurance.nationalHealth.preschoolReduction"] as const;
const GRADE = ["N_DEFAULT_USED", "residentTax.exemption.perCapita.gradeOne"] as const;

describe("受給資格期間に足りない知らせ（pension.oldAgeBase）", () => {
  it("働き方も加入の記録も入れていない子には出さない（20歳から世帯を離れるまでの加入の月しか表に無いため）", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const r = run(req);
    for (const c of children(req)) expect(has(r, ...QUALIFYING, c.id), c.birth.birthYearMonth).toBe(false);
  });

  it("働き方を入れた子で、表の中の加入の月が足りなければ出す", () => {
    const req = clone(modelHousehold("salariedCoupleTwoKids"));
    const child = children(req)[0] as Member;
    const job = clone(periodsOf(req)[0] as Obj);
    Object.assign(job, { id: uid("na-child-job"), member: child.id, from: { at: "2035-04" }, to: { at: "2037-03" } });
    periodsOf(req).push(job);
    expect(has(run(req), ...QUALIFYING, child.id)).toBe(true);
  });
});

describe("国民健康保険の未就学児の軽減・産前産後の免除の知らせ（socialInsurance.nationalHealth）", () => {
  it("小学校に入る前の子が国民健康保険に入っている世帯だけに出す", () => {
    // 自営業の世帯で、子が小学生以上（表の中で未就学の月が無い）
    expect(has(run(modelHousehold("sampleSelfEmployedFamily")), ...PRESCHOOL)).toBe(false);
    // 同じ世帯で、下の子が未就学
    expect(has(run(childBorn("sampleSelfEmployedFamily", ["2012-10", "2023-05"])), ...PRESCHOOL)).toBe(true);
    // 未就学の子がいても、会社の健康保険の世帯
    expect(has(run(childBorn("salariedCoupleTwoKids", ["2012-05", "2023-05"])), ...PRESCHOOL)).toBe(false);
  });

  it("これから生まれる子（産前産後の免除が当てはまりうる年度）でも出す", () => {
    expect(has(run(childBorn("sampleSelfEmployedFamily", ["2012-10", "2028-07"])), ...PRESCHOOL)).toBe(true);
  });
});

describe("住民税の非課税の基準の級地の知らせ（residentTax.exemption）", () => {
  it("所得が1級地の基準を超える人だけなら出さない", () => {
    // 年収360万円のひとり
    expect(has(run(modelHousehold("single25")), ...GRADE)).toBe(false);
  });

  it("1級地の基準では非課税で、ほかの級地では課税になりうる所得の人がいれば出す", () => {
    // 年収100万円のパートの配偶者（給与所得35万円。1級地の基準は 35万円＋10万円）
    expect(has(run(modelHousehold("salariedCoupleTwoKids")), ...GRADE)).toBe(true);
  });
});
