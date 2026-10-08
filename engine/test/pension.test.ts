// 公的年金の部品の修正（PR #6 の「計算部品について気づいたこと」1・2）: 加給年金額の改定率、令和10年4月からの子の加給年金と老齢基礎年金の子の加算
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { PensionOutput, RecordOutput, RevisionOutput } from "../src/sdk/contracts.ts";
import { box, fictionalPacks, household, member, realPacks, uid } from "./helpers.ts";

const A = uid("pt.a");
const B = uid("pt.b");
const C = uid("pt.c");
type Req = ReturnType<typeof household>;
const entry = <T>(req: Req, component: string, input: unknown) =>
  runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const rta = (m: string, fy: number) => ({ id: uid(`pt.rta.${m}.${fy}`), member: m, fiscalYear: fy, amount: box(100000) });

/** 夫（老齢厚生年金を受ける）と妻の世帯。kids は子の生年月 */
function family(o: { base: string; end: number; hBirth: string; wBirth: string; employeeMonths: number; kids?: string[]; wageGrowth?: string; inflation?: string }): Req {
  const kids = o.kids ?? [];
  const req = household({
    baseMonth: o.base,
    endYear: o.end,
    members: [member("pt.a", "self", o.hBirth, { sex: "male" }), member("pt.b", "spouse", o.wBirth), ...kids.map((b, i) => member(`pt.c${i}`, "child", b))],
    relations: [{ type: "spouse", a: A, b: B, marriage: "legal", from: null, to: null }],
    ...(o.wageGrowth !== undefined ? { wageGrowth: o.wageGrowth } : {}),
  });
  const h = req.input.household as unknown as Record<string, unknown>;
  const y = Number(o.base.slice(0, 4));
  const employee = o.employeeMonths > 0 ? { employee: box(1000000) } : {};
  h.pensionRecords = [
    { id: uid("pt.r"), member: A, kind: "projection", asOf: `${y}-04`, months: { basic: 480, employee: o.employeeMonths }, amounts: { basic: box(800000), ...employee } },
    { id: uid("pt.s"), member: B, kind: "projection", asOf: `${y}-04`, months: { basic: 480, employee: 0 }, amounts: { basic: box(600000) } },
  ];
  h.residentTaxAssessments = [rta(A, y), rta(B, y)];
  if (o.inflation !== undefined) (req.input as unknown as { assumptions: Record<string, unknown> }).assumptions = { ...(req.input as unknown as { assumptions?: Record<string, unknown> }).assumptions, inflation: { default: o.inflation } };
  return req;
}
const monthOf = (req: Req, who: string, ym: string) => entry<PensionOutput>(req, "pension.oldAge", { member: who }).months.find((x) => x.month === ym);

describe("加給年金額の改定率（B-1）", () => {
  it("令和8年度: 受給権者が昭和31年4月1日以前生まれでも、加給年金額・特別加算は新規裁定者の改定率（配偶者 243,800円＋特別加算 179,900円）", () => {
    // 新規裁定者の率 1.085 で 224,700円→243,800円、特別加算 165,800円→179,900円（日本年金機構の表は生年月日によらず同じ額）
    const old = monthOf(family({ base: "2026-04", end: 2026, hBirth: "1955-05", wBirth: "1963-08", employeeMonths: 300 }), A, "2026-06");
    const young = monthOf(family({ base: "2026-04", end: 2026, hBirth: "1961-05", wBirth: "1964-08", employeeMonths: 300 }), A, "2026-06");
    expect(young?.employee).toBe(1000000 + 423700);
    // 報酬比例の 100万円は記録の年度の額（改定の比 1）。加給年金額だけを比べる
    expect(old?.employee).toBe(1000000 + 423700);
  });

  it("新規裁定者の改定率は、制度データの年度はその年度に65歳になる生年月日の行、延ばす年度は賃金で改定する", () => {
    const req = family({ base: "2026-04", end: 2030, hBirth: "1955-05", wBirth: "1963-08", employeeMonths: 300, wageGrowth: "0.03", inflation: "0.01" });
    const rows = entry<RevisionOutput>(req, "pension.revision", { member: A }).byFiscalYear;
    const r2026 = rows.find((x) => x.fiscalYear === 2026);
    expect(r2026).toMatchObject({ rate: "1.082", newAward: "1.085" });
    // 2027年度以後は延ばす。本人（既裁定者）は物価、新規裁定者は賃金（マクロ経済スライドの前提なし）
    const r2027 = rows.find((x) => x.fiscalYear === 2027);
    expect(r2027?.projected).toBe(true);
    expect(Number(r2027?.newAward)).toBeGreaterThan(Number(r2027?.rate));
  });
});

describe("令和10年4月からの子の加給年金と、老齢基礎年金の子の加算（B-2）", () => {
  const kid = "2018-04";
  // 子の額: 269,600円×新規裁定者の改定率（前提なしで令和8年度の 1.085 のまま）を100円単位 → 292,500円
  const CHILD = 292500;

  it("厚生年金の加入が120月以上240月未満: 令和10年3月までは子の加給年金なし、4月から加算（要件120月）", () => {
    const req = family({ base: "2026-04", end: 2029, hBirth: "1961-05", wBirth: "1964-08", employeeMonths: 150, kids: [kid] });
    const before = monthOf(req, A, "2028-03");
    const after = monthOf(req, A, "2028-04");
    expect(before?.employee).toBe(1000000);
    expect(after?.employee).toBe(1000000 + CHILD);
    // 子の加給年金を受けるので、老齢基礎年金に子の加算は付かない
    expect(after?.basic).toBe(before?.basic);
  });

  it("厚生年金が120月未満（または無い）: 令和10年4月から老齢基礎年金に子の加算（子の加給年金とは重ねない）", () => {
    const req = family({ base: "2026-04", end: 2029, hBirth: "1961-05", wBirth: "1964-08", employeeMonths: 0, kids: [kid, "2020-01"] });
    const before = monthOf(req, A, "2028-03");
    const after = monthOf(req, A, "2028-04");
    expect(before?.employee ?? 0).toBe(0);
    expect((after?.basic ?? 0) - (before?.basic ?? 0)).toBe(2 * CHILD);
  });

  it("240月以上: 令和10年4月から子は人数によらず一律の額（3人目も同じ）", () => {
    const req = family({ base: "2026-04", end: 2029, hBirth: "1961-05", wBirth: "1958-08", employeeMonths: 300, kids: [kid, "2019-01", "2020-01"] });
    const before = monthOf(req, A, "2028-03");
    const after = monthOf(req, A, "2028-04");
    // 令和10年3月まで: 224,700円×2人＋74,900円 に 1.085 を掛けた額（243,800×2＋81,300）
    expect(before?.employee).toBe(1000000 + 243800 * 2 + 81300);
    expect(after?.employee).toBe(1000000 + CHILD * 3);
    expect(C).toBeTypeOf("string");
  });
});

describe("再評価率の表（B-3。【架空の見本】の値で形だけを確かめる。実在の値は制度データに入れていない）", () => {
  const record = (birth: string, history: Record<string, unknown>[]) => {
    const req = household({ baseMonth: "2026-06", endYear: 2027, members: [member("pt.a", "self", birth, { sex: "male" })] });
    (req.input.household as unknown as Record<string, unknown>).pensionRecords = [{ id: uid("pt.r"), member: A, kind: "history", asOf: "2026-06", history }];
    const r = runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "pension.record", input: { member: A } } });
    return { out: r.entryOutput as RecordOutput, notices: (r.header as { notices: { code: string; ids: string[] }[] }).notices };
  };
  const hist = (key: "averageRemuneration" | "averageRemunerationAtTime") => [
    { from: "1995-01", to: "1995-12", category: "employee", [key]: 300000 },
    { from: "2005-01", to: "2005-12", category: "employee", [key]: 400000 },
  ];

  it("当時の額は、記録の年度の再評価率（生年月日の区分×報酬の月）でいまの水準に直してから乗率を掛ける", () => {
    // 架空の乗率: 2003年3月以前 7/1000、4月以後 5/1000。架空の再評価率: 昭和35年4月2日以後生まれは 1990年代 1.2・2000年代 1.1
    expect(record("1965-05", hist("averageRemunerationAtTime")).out.amounts.employee).toBe(30240 + 26400);
    // それより前に生まれた区分は別の行（1.3・1.05）
    expect(record("1958-05", hist("averageRemunerationAtTime")).out.amounts.employee).toBe(32760 + 25200);
    // いまの水準の額（これまでの入力）は再評価率を掛けない
    expect(record("1965-05", hist("averageRemuneration")).out.amounts.employee).toBe(25200 + 24000);
  });

  it("表に無い期間は、いまの水準の額とみなして知らせる（N_PARAM_MISSING）", () => {
    const r = record("1965-05", [{ from: "1985-01", to: "1985-12", category: "employee", averageRemunerationAtTime: 300000 }]);
    expect(r.out.amounts.employee).toBe(25200);
    expect(r.notices.some((n) => n.code === "N_PARAM_MISSING" && n.ids.includes("pension.revaluationRate"))).toBe(true);
  });

  it("当時の額といまの水準の額は、同じ期間に両方は書けない", () => {
    const r = record("1965-05", hist("averageRemuneration"));
    expect(r.out.amounts.employee).toBeGreaterThan(0);
    const req = household({ baseMonth: "2026-06", endYear: 2027, members: [member("pt.a", "self", "1965-05", { sex: "male" })] });
    (req.input.household as unknown as Record<string, unknown>).pensionRecords = [
      { id: uid("pt.r"), member: A, kind: "history", asOf: "2026-06", history: [{ from: "1995-01", to: "1995-12", category: "employee", averageRemuneration: 1, averageRemunerationAtTime: 1 }] },
    ];
    expect(() => runEngine(req, fictionalPacks(), { checkInternal: true })).toThrow("E_INPUT_SCHEMA");
  });
});
