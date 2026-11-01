// 保育料（education.nurseryFee）と学校給食費の負担軽減（education.cost）のテスト（L1。0029）。
// 【架空の見本】の制度データ（test/fixtures/regulation。製品のパックの値の形を写したもの）で、規則どおりに計算するかを手計算と突き合わせる。
// 住民税（所得割）は residentTax.annual を差し替えて、市町村民税の所得割の額を決めて与える
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EducationCostOutput } from "../src/sdk/contracts.ts";
import { fictionalPacks, household, member, period, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Flow = { row: string; ym: string; amount: number; member?: string; object?: string; formula: string };
type Cell = { row: string; year: number; amount: number };
const A = uid("a");
const B = uid("b");
const at = (ym: string) => ({ at: ym });
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;

/** 住民税の差し替え: 構成員と年度ごとの市町村民税の所得割（調整控除の後）。null は住民税を課されない（非課税） */
type Levy = (member: string, fiscalYear: number) => number | null;
const residentStub = (levy: Levy) => ({
  "residentTax.annual": (i: unknown) => {
    const { member: m, fiscalYear } = i as { member: string; fiscalYear: number };
    const v = levy(m, fiscalYear);
    const pair = (x: number) => ({ municipal: x, prefectural: 0 });
    return {
      flows: [],
      assessed: false,
      total: v === null ? 0 : v + 5000,
      taxable: 0,
      grossLevy: pair(v ?? 0),
      adjustmentCredit: pair(0),
      incomeLevy: pair(v ?? 0),
      perCapita: pair(v === null ? 0 : 3000),
      forestEnvironmentTax: v === null ? 0 : 1000,
    };
  },
});

interface Kid {
  name: string;
  birth: string;
  stages?: Obj[];
  lunch?: "free" | "paid";
}
/** 父母（a・b）と子の世帯。single は親が a だけ */
function mk(kids: Kid[], o: { single?: boolean; baseMonth?: string; endYear?: number; periods?: Obj[] } = {}): Req {
  const parents = o.single === true ? ["a"] : ["a", "b"];
  const req = household({
    members: [member("a", "self", "1990-01"), ...(o.single === true ? [] : [member("b", "spouse", "1991-01")]), ...kids.map((k) => member(k.name, "child", k.birth))],
    relations: kids.flatMap((k) => parents.map((p) => ({ type: "parentOf", parent: uid(p), child: uid(k.name) }))),
    periods: o.periods ?? [],
    baseMonth: o.baseMonth ?? "2027-01",
    endYear: o.endYear ?? 2031,
  }) as Req;
  const h = (req.input as unknown as Obj).household as Obj;
  h.goals = kids.filter((k) => k.stages !== undefined).map((k) => ({ id: uid(`g${k.name}`), kind: "education", owner: uid(k.name), education: { stages: k.stages, ...(k.lunch ? { schoolLunch: k.lunch } : {}) } }));
  return req;
}
const nursery = (req: Req, child: string, levy: Levy) =>
  runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "education.nurseryFee", input: { member: uid(child) } }, stubs: residentStub(levy) });
const flowsOf = (r: ReturnType<typeof nursery>) => (r.entryOutput as { flows: Flow[] }).flows;
const fee = (r: ReturnType<typeof nursery>, ym: string) => flowsOf(r).filter((f) => f.ym === ym).reduce((s, f) => s + f.amount, 0);
/** 父母の所得割をどの年度も同じ額にする */
const flat =
  (a: number | null, b: number | null = 0): Levy =>
  (m) =>
    m === A ? a : m === B ? b : null;
const C = { name: "c", birth: "2026-06" };
const auto = (o: Obj = {}) => [{ stage: "nursery", from: at("2027-10"), feeRatio: "1", ...o }];

describe("保育料の自動の計算（education.nurseryFee）", () => {
  it("市町村民税所得割合算額（父母の合計）の段階ごとの国の基準の額（保育標準時間）", () => {
    const req = mk([{ ...C, stages: auto() }]);
    const cases: [number, number][] = [
      [0, 19500],
      [48599, 19500],
      [48600, 30000],
      [96999, 30000],
      [97000, 44500],
      [168999, 44500],
      [169000, 61000],
      [300999, 61000],
      [301000, 80000],
      [396999, 80000],
      [397000, 104000],
    ];
    for (const [levy, want] of cases) expect([levy, fee(nursery(req, "c", flat(levy, 0)), "2027-10")]).toEqual([levy, want]);
    // 父 100,000 円＋母 69,000 円 = 169,000 円
    expect(fee(nursery(req, "c", flat(100000, 69000)), "2027-10")).toBe(61000);
  });

  it("保育短時間の表", () => {
    const req = mk([{ ...C, stages: auto({ hours: "short" }) }]);
    expect(fee(nursery(req, "c", flat(20000)), "2027-10")).toBe(19300);
    expect(fee(nursery(req, "c", flat(400000)), "2027-10")).toBe(102400);
  });

  it("所得割の年度: 4〜8月は前年度、9〜3月はその年度の住民税", () => {
    const req = mk([{ ...C, stages: auto() }]);
    // 2027年度 50,000円（30,000円の段）、2028年度 200,000円（61,000円の段）
    const levy: Levy = (m, fy) => (m === A ? (fy <= 2027 ? 50000 : 200000) : 0);
    const r = nursery(req, "c", levy);
    expect(fee(r, "2028-08")).toBe(30000);
    expect(fee(r, "2028-09")).toBe(61000);
    expect(fee(r, "2027-12")).toBe(30000);
  });

  it("所得割の年度は、計算基準月に払っている住民税の年度より前にしない（計算基準月が6〜8月の年の、その月から8月までの分。改訂2）", () => {
    // 計算基準月 2027年7月: 7・8月の分は本来は2026年度の住民税だが、表に載る最初の年度の2027年度の住民税で決める
    const req = mk([{ ...C, stages: auto({ from: at("2027-04") }) }], { baseMonth: "2027-07" });
    // 2026年度 50,000円（30,000円の段）、2027年度 200,000円（61,000円の段）
    const levy: Levy = (m, fy) => (m === A ? (fy <= 2026 ? 50000 : 200000) : 0);
    const r = nursery(req, "c", levy);
    expect(fee(r, "2027-06")).toBe(0);
    expect(fee(r, "2027-07")).toBe(61000);
    expect(fee(r, "2027-08")).toBe(61000);
    expect(fee(r, "2027-09")).toBe(61000);
  });

  it("父母がみな住民税を課されない（非課税）なら0円。所得割が0円でも均等割がかかれば一番下の段", () => {
    const req = mk([{ ...C, stages: auto() }]);
    expect(flowsOf(nursery(req, "c", flat(null, null)))).toEqual([]);
    expect(fee(nursery(req, "c", flat(0, null)), "2027-10")).toBe(19500);
  });

  it("3歳になった後の最初の4月から無償（2026年6月生まれは2030年3月まで）", () => {
    const req = mk([{ ...C, stages: auto() }]);
    const f = flowsOf(nursery(req, "c", flat(100000)));
    expect(f[0]?.ym).toBe("2027-10");
    expect(f.at(-1)?.ym).toBe("2030-03");
    expect(f.every((x) => x.row === "cf.expense.education.nursery" && x.formula === "education.nurseryFee.auto")).toBe(true);
  });

  it("多子の軽減: 小学校就学前で通っている年長の子から数えて、2番目は半額、3番目以降は0円", () => {
    const kids: Kid[] = [
      { name: "k1", birth: "2022-06", stages: [{ stage: "kindergarten", sector: "public" }] },
      { name: "k2", birth: "2024-06", stages: [{ stage: "nursery", from: at("2025-04"), feeRatio: "1" }] },
      { name: "k3", birth: "2026-06", stages: auto() },
    ];
    const req = mk(kids);
    // 2027年10月: k1 は幼稚園（年中）、k2 は保育所（2歳児）、k3 は保育所（1歳）
    expect(fee(nursery(req, "k2", flat(200000)), "2027-10")).toBe(30500);
    expect(fee(nursery(req, "k3", flat(200000)), "2027-10")).toBe(0);
    // k2 が3歳の4月（2028年4月）から無償になっても、幼稚園などに通っていれば数えるので k3 は3番目のまま
    expect(fee(nursery(req, "k3", flat(200000)), "2028-10")).toBe(0);
    // k1 が小学校に入る（2029年4月）と k3 は2番目
    expect(fee(nursery(req, "k3", flat(200000)), "2029-10")).toBe(30500);
    // 年長の子が通っていない（教育の目標が無い）なら数えない
    const noGoal = mk([{ name: "k1", birth: "2022-06" }, kids[1] as Kid, kids[2] as Kid]);
    expect(fee(nursery(noGoal, "k2", flat(200000)), "2027-10")).toBe(61000);
    expect(fee(nursery(noGoal, "k3", flat(200000)), "2027-10")).toBe(30500);
  });

  it("所得割合算額が57,700円未満なら、年齢と通っているかを問わず世帯の子の年長の順で数える", () => {
    const kids: Kid[] = [{ name: "k0", birth: "2016-06" }, { ...C, stages: auto() }];
    const req = mk(kids);
    expect(fee(nursery(req, "c", flat(57699)), "2027-10")).toBe(15000);
    expect(fee(nursery(req, "c", flat(57700)), "2027-10")).toBe(30000);
    const three = mk([{ name: "k0", birth: "2014-06" }, { name: "k1", birth: "2016-06" }, { ...C, stages: auto() }]);
    expect(fee(nursery(three, "c", flat(50000)), "2027-10")).toBe(0);
  });

  it("ひとり親世帯等: 所得割合算額が77,101円未満なら9,000円、年長の子がいれば2番目から0円", () => {
    const req = mk([{ ...C, stages: auto() }], { single: true });
    expect(fee(nursery(req, "c", flat(77100)), "2027-10")).toBe(9000);
    // 所得割は100円未満を切り捨てた額で比べる（77,101円未満＝77,100円以下）
    expect(fee(nursery(req, "c", flat(77200)), "2027-10")).toBe(30000);
    const two = mk([{ name: "k0", birth: "2016-06" }, { ...C, stages: auto() }], { single: true });
    expect(fee(nursery(two, "c", flat(77100)), "2027-10")).toBe(0);
  });

  it("国の基準に対する割合（省略は目安の 0.8）を掛け、目安の計算であることを知らせる", () => {
    const def = mk([{ ...C, stages: [{ stage: "nursery", from: at("2027-10") }] }]);
    const r = nursery(def, "c", flat(200000));
    expect(fee(r, "2027-10")).toBe(48800);
    expect(notices(r)).toContainEqual({ code: "N_ESTIMATED", ids: ["education.nurseryFee", "education.nurseryFee.auto", uid("c")] });
    expect(fee(nursery(mk([{ ...C, stages: auto({ feeRatio: "0.55" }) }]), "c", flat(200000)), "2027-10")).toBe(33550);
  });

  it("月額を入れた段はその額（教育費の上昇率で伸ばす）を優先し、0 なら保育料なし", () => {
    const given = nursery(mk([{ ...C, stages: auto({ monthly: 40000 }) }]), "c", flat(200000));
    expect(fee(given, "2027-10")).toBe(40000);
    expect(flowsOf(given).every((f) => f.formula === "education.nurseryFee.input")).toBe(true);
    expect(flowsOf(nursery(mk([{ ...C, stages: auto({ monthly: 0 }) }]), "c", flat(200000)))).toEqual([]);
  });

  it("通い始めの省略は、その子の育児休業の終わりの翌月（無ければ1歳の学年の4月）", () => {
    const leave = period("lv", { member: "b", from: "2026-08", to: "2027-08", annual: 0, type: "leave", extra: { leaveKind: "childcare", leaveChild: uid("c") } });
    const work = period("w", { member: "b", from: "2010-04", to: "2026-07", annual: 4000000 });
    const withLeave = mk([{ ...C, stages: [{ stage: "nursery", feeRatio: "1" }] }], { periods: [work, leave] });
    expect(flowsOf(nursery(withLeave, "c", flat(100000)))[0]?.ym).toBe("2027-09");
    const none = mk([{ ...C, stages: [{ stage: "nursery", feeRatio: "1" }] }]);
    expect(flowsOf(nursery(none, "c", flat(100000)))[0]?.ym).toBe("2028-04");
  });

  it("キャッシュフロー表の保育料の行に入る（本物の住民税の計算でも動く）", () => {
    const req = mk([{ ...C, stages: [{ stage: "nursery", from: at("2027-10") }] }], {
      periods: [period("pa", { member: "a", from: "2012-04", annual: 6000000, std: [500000, 500000] }), period("pb", { member: "b", from: "2013-04", annual: 4000000, std: [340000, 340000] })],
    });
    const r = runEngine(req, fictionalPacks(), { checkInternal: true });
    const total = (r.table as Cell[]).filter((c) => c.row === "cf.expense.education.nursery" && c.year === 2028).reduce((s, c) => s + c.amount, 0);
    // 年収600万円＋400万円の共働き: 所得割合算額はおよそ20万〜25万円で、国の基準 61,000円 × 0.8 = 48,800円/月
    expect(total).toBe(48800 * 12);
  });
});

describe("学校給食費の負担軽減（education.cost。改訂3）", () => {
  // 2018年6月生まれ: 小学校は2025年4月〜2031年3月、中学校は2031年4月〜
  const E = { name: "e", birth: "2018-06" };
  const cost = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "education.cost", input: { member: uid("e") } } }).entryOutput as EducationCostOutput;
  const tuition = (o: EducationCostOutput, fy: number, stage = "elementary") => o.enrollments.find((x) => x.stage === stage)?.fees.find((f) => f.fiscalYear === fy)?.tuition;
  // 統計（架空の見本の値）: 公立小学校の学習費総額 366,599円 − 学校外活動費 256,489円 = 110,110円、学校給食費 35,774円
  it("公立小学校は令和8年度から、統計の学校給食費（基準額×11か月より小さい）を学校の費用から引く", () => {
    const o = cost(mk([{ ...E, stages: [{ stage: "elementary", sector: "public" }] }], { baseMonth: "2025-01" }));
    expect(tuition(o, 2025)).toBe(110110);
    expect(tuition(o, 2026)).toBe(110110 - 35774);
    expect(tuition(o, 2030)).toBe(110110 - 35774);
    const f = (o.flows as unknown as Flow[]).filter((x) => x.ym === "2026-05" && x.row === "cf.expense.education.school");
    expect(f.map((x) => x.formula)).toEqual(["education.cost.schoolLunchRelief"]);
  });

  it("私立・学校の年額を直接入れた段は引かない。中学校は制度では引かない（未確定）", () => {
    const o = cost(mk([{ ...E, stages: [{ stage: "elementary", sector: "private" }, { stage: "juniorHigh", sector: "public" }] }]));
    expect(tuition(o, 2027)).toBe(1741516);
    const jh = tuition(o, 2031, "juniorHigh");
    const ov = cost(mk([{ ...E, stages: [{ stage: "elementary", sector: "public", annualOverride: 100000 }] }]));
    expect(tuition(ov, 2027)).toBe(100000);
    // 中学校（公立）は架空の見本に学校外活動費が無いので学習費総額（542,450円）のまま
    expect(jh).toBe(542450);
  });

  it("給食費なし（自治体が無償化）なら公立の小学校・中学校で全額、給食費あり（全額を払う）なら引かない", () => {
    const free = cost(mk([{ ...E, lunch: "free", stages: [{ stage: "elementary", sector: "public" }, { stage: "juniorHigh", sector: "public" }] }], { baseMonth: "2025-01" }));
    expect(tuition(free, 2025)).toBe(110110 - 35774);
    expect(tuition(free, 2031, "juniorHigh")).toBe(542450 - 35671);
    const paid = cost(mk([{ ...E, lunch: "paid", stages: [{ stage: "elementary", sector: "public" }] }]));
    expect(tuition(paid, 2027)).toBe(110110);
  });
});

describe("保育料とは別にかかるお金・段ごとの給食費・部活動の費用（0029・0062 の追記 2026-10-30）", () => {
  const E = { name: "e", birth: "2018-06" };
  const cost = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "education.cost", input: { member: uid("e") } } }).entryOutput as EducationCostOutput;
  const tuition = (o: EducationCostOutput, fy: number, stage = "elementary") => o.enrollments.find((x) => x.stage === stage)?.fees.find((f) => f.fiscalYear === fy)?.tuition;

  it("保育所の段: 保育料とは別のお金（年額÷12）を、通い始めから3歳の4月の前の月まで学校の費用の行に。統計の目安の無いパックでは数えない", () => {
    // 2026年6月生まれ: 3歳の4月は2030年4月。通い始め 2027-04（架空の見本のパックには目安が無いので、年額を入れて確かめる）
    const none = nursery(mk([{ ...C, stages: [{ stage: "nursery", from: at("2027-04"), monthly: 30000 }] }]), "c", () => 100000);
    expect((none.entryOutput as { flows: Flow[] }).flows.some((f) => f.formula === "education.nurseryFee.extra")).toBe(false);
    const r = nursery(mk([{ ...C, stages: [{ stage: "nursery", from: at("2027-04"), monthly: 30000, extraAnnual: 12000 }] }]), "c", () => 100000);
    const extra = (r.entryOutput as { flows: Flow[] }).flows.filter((f) => f.formula === "education.nurseryFee.extra");
    expect(extra.length).toBe(36);
    expect(extra[0]).toMatchObject({ row: "cf.expense.education.school", ym: "2027-04", amount: 1000 });
    expect(extra.at(-1)?.ym).toBe("2030-03");
    const r2 = nursery(mk([{ ...C, stages: [{ stage: "nursery", from: at("2027-04"), monthly: 0, extraAnnual: 24000 }] }]), "c", () => 100000);
    const e2 = (r2.entryOutput as { flows: Flow[] }).flows.filter((f) => f.formula === "education.nurseryFee.extra");
    expect(e2[0]?.amount).toBe(2000);
    // 保育料なし（月額 0）でも、別のお金は数える
    expect((r2.entryOutput as { flows: Flow[] }).flows.some((f) => f.row === "cf.expense.education.nursery")).toBe(false);
  });

  it("段ごとの給食費の選び方は、教育の目標の選び方より優先する", () => {
    const o = cost(mk([{ ...E, lunch: "paid", stages: [{ stage: "elementary", sector: "public", schoolLunch: "free" }, { stage: "juniorHigh", sector: "public" }] }], { baseMonth: "2025-01" }));
    expect(tuition(o, 2027)).toBe(110110 - 35774);
    const jh = cost(mk([{ ...E, stages: [{ stage: "juniorHigh", sector: "public" }] }]));
    const jhFree = cost(mk([{ ...E, stages: [{ stage: "juniorHigh", sector: "public", schoolLunch: "free" }] }]));
    expect(tuition(jh, 2031, "juniorHigh")! - tuition(jhFree, 2031, "juniorHigh")!).toBe(35671);
  });

  it("部活動の費用: 統計の平均の段は統計の教科外活動費と入れ替え、年額を入れた段はその年額に足す", () => {
    const base = cost(mk([{ ...E, stages: [{ stage: "juniorHigh", sector: "public" }] }]));
    const club = cost(mk([{ ...E, stages: [{ stage: "juniorHigh", sector: "public", clubAnnual: 84000 }] }]));
    expect(tuition(club, 2031, "juniorHigh")! - tuition(base, 2031, "juniorHigh")!).toBe(84000 - 27316);
    const ov = cost(mk([{ ...E, stages: [{ stage: "juniorHigh", sector: "public", annualOverride: 200000, clubAnnual: 50000 }] }]));
    expect(tuition(ov, 2031, "juniorHigh")).toBe(250000);
  });
});

describe("留学（education.cost 改訂6。0088）", () => {
  // 2010年6月生まれ: 高校 2026年4月〜2029年3月、大学 2029年4月〜2033年3月
  const H = { name: "h", birth: "2010-06" };
  const run = (req: Req) => runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "education.cost", input: { member: uid("h") } } }).entryOutput as EducationCostOutput;
  const flowsOf = (o: EducationCostOutput, formula: string) => (o.flows as unknown as Flow[]).filter((f) => f.formula === formula);
  const stages = [{ stage: "highSchool", sector: "public" }, { stage: "university", sector: "national" }];
  const withAbroad = (abroad: Obj[]) => {
    const req = mk([{ ...H, stages }], { baseMonth: "2026-04", endYear: 2036 });
    ((((req.input as unknown as Obj).household as Obj).goals as Obj[])[0]!.education as Obj).abroad = abroad;
    return req;
  };

  it("単位が認められる1年（延びない）: 大学3年の4月に1回の額。学費・在学の期間は変わらない", () => {
    const base = run(withAbroad([]));
    const o = run(withAbroad([{ stage: "university", grade: 3, kind: "credit", amount: 2000000 }]));
    const a = flowsOf(o, "education.cost.abroad");
    expect(a.map((f) => [f.ym, f.row])).toEqual([["2031-04", "cf.expense.education"]]);
    expect(flowsOf(o, "education.cost.tuition")).toEqual(flowsOf(base, "education.cost.tuition"));
  });

  it("短期は8月。休学して1年（延びる）: その年の学費はかからず、後の学年・卒業が1年うしろ", () => {
    const short = run(withAbroad([{ stage: "university", grade: 2, kind: "short", amount: 500000 }]));
    expect(flowsOf(short, "education.cost.abroad").map((f) => f.ym)).toEqual(["2030-08"]);
    const o = run(withAbroad([{ stage: "university", grade: 3, kind: "leave", amount: 2500000 }]));
    expect(flowsOf(o, "education.cost.abroad").map((f) => f.ym)).toEqual(["2031-04"]);
    const tuitionYm = flowsOf(o, "education.cost.tuition").map((f) => f.ym);
    expect(tuitionYm.some((ym) => ym.startsWith("2031"))).toBe(false);
    expect(tuitionYm.at(-1)).toBe("2033-10");
    const uni = o.enrollments.find((x) => x.stage === "university")!;
    expect(uni.years).toBe(5);
    expect(uni.fees.map((f) => f.fiscalYear)).toEqual([2029, 2030, 2032, 2033]);
  });

  it("万一のときの扱いが「やめる」なら、世帯の万一の想定の月より後の留学は払わない（続けるなら払う）", () => {
    const req = (mode: "stop" | "continue") => {
      const r = withAbroad([{ stage: "university", grade: 3, kind: "credit", amount: 2000000, onContingency: { mode } }]);
      (r.input as unknown as Obj).contingencies = [{ id: uid("cg"), member: uid("a"), kind: "death", occurs: at("2030-06") }];
      return r;
    };
    expect(flowsOf(run(req("stop")), "education.cost.abroad")).toEqual([]);
    expect(flowsOf(run(req("continue")), "education.cost.abroad").length).toBe(1);
  });

  it("高校で休学して1年留学すると、大学の入学も1年うしろ", () => {
    const o = run(withAbroad([{ stage: "highSchool", grade: 2, kind: "leave", amount: 2000000 }]));
    expect(flowsOf(o, "education.cost.abroad").map((f) => f.ym)).toEqual(["2027-04"]);
    expect(o.enrollments.find((x) => x.stage === "university")?.from).toBe("2030-04");
  });
});

describe("大学院・インターナショナルスクール（education.cost 改訂7。0089）", () => {
  const H = { name: "h", birth: "2010-06" };
  const run = (stages: Obj[]) => runEngine(mk([{ ...H, stages }], { baseMonth: "2026-04", endYear: 2040 }), fictionalPacks(), { checkInternal: true, entry: { component: "education.cost", input: { member: uid("h") } } });
  const out = (stages: Obj[]) => run(stages).entryOutput as EducationCostOutput;

  it("修士は大学を出た翌月の4月から2年。国立は標準額、私立は授業料＋施設設備費と入学料", () => {
    const o = out([{ stage: "university", sector: "national" }, { stage: "graduateMaster", sector: "private" }]);
    const gm = o.enrollments.find((x) => x.stage === "graduateMaster")!;
    expect(gm.from).toBe("2033-04");
    expect(gm.years).toBe(2);
    expect(gm.fees[0]).toMatchObject({ fiscalYear: 2033, tuition: 811006 + 70721, admission: 208987 });
    // 医歯系6年の大学の後は、6年を出た翌月から
    const m = out([{ stage: "university", sector: "national", field: "medical" }, { stage: "graduateMaster", sector: "national" }]);
    expect(m.enrollments.find((x) => x.stage === "graduateMaster")).toMatchObject({ from: "2035-04", fees: [{ fiscalYear: 2035, tuition: 535800, admission: 282000 }, { fiscalYear: 2036, tuition: 535800, admission: 0 }] });
  });

  it("インターナショナルスクールは学校の年額を入れるまで0円（入力が要ると知らせる）。入れた年額で計算する", () => {
    const r = run([{ stage: "highSchool", sector: "international" }]);
    const hs = (r.entryOutput as EducationCostOutput).enrollments.find((x) => x.stage === "highSchool")!;
    expect(hs.fees.every((f) => f.tuition === 0)).toBe(true);
    expect(notices(r).some((n) => n.code === "N_INPUT_REQUIRED")).toBe(true);
    const o = out([{ stage: "highSchool", sector: "international", annualOverride: 2500000 }]);
    expect(o.enrollments.find((x) => x.stage === "highSchool")!.fees[1]?.tuition).toBe(2500000);
  });
});

describe("高専・専門職大学院（education.cost 改訂8・education.support。0090）", () => {
  const H = { name: "h", birth: "2010-06" };
  const run = (stages: Obj[]) => runEngine(mk([{ ...H, stages }], { baseMonth: "2026-04", endYear: 2040 }), fictionalPacks(), { checkInternal: true, entry: { component: "education.cost", input: { member: uid("h") } } });
  const out = (stages: Obj[]) => run(stages).entryOutput as EducationCostOutput;

  it("高専は15歳の学年から5年。国立は機構の授業料・入学料。後の大学（編入）は高専を出た翌月の4月から", () => {
    const o = out([{ stage: "kosen", sector: "national" }, { stage: "university", sector: "national", years: 2 }]);
    const k = o.enrollments.find((x) => x.stage === "kosen")!;
    expect(k).toMatchObject({ from: "2026-04", years: 5 });
    expect(k.fees[0]).toMatchObject({ fiscalYear: 2026, tuition: 234600, admission: 84600 });
    expect(o.enrollments.find((x) => x.stage === "university")).toMatchObject({ from: "2031-04", years: 2 });
  });

  it("専門職大学院: 法科大学院（国立）は3年・省令の法科大学院の額。法科大学院以外は2年", () => {
    const o = out([{ stage: "university", sector: "national" }, { stage: "graduateProfessional", sector: "national", field: "law" }]);
    expect(o.enrollments.find((x) => x.stage === "graduateProfessional")).toMatchObject({ from: "2033-04", years: 3, fees: [{ fiscalYear: 2033, tuition: 804000, admission: 282000 }, { fiscalYear: 2034 }, { fiscalYear: 2035 }] });
    const p = out([{ stage: "university", sector: "national" }, { stage: "graduateProfessional", sector: "national" }]);
    expect(p.enrollments.find((x) => x.stage === "graduateProfessional")).toMatchObject({ years: 2, fees: [{ tuition: 535800, admission: 282000 }, { tuition: 535800 }] });
  });

  it("公立・私立の高専は学校の年額を入れるまで0円（入力が要ると知らせる）", () => {
    const r = run([{ stage: "kosen", sector: "private" }]);
    expect((r.entryOutput as EducationCostOutput).enrollments[0]!.fees.every((f) => f.tuition === 0)).toBe(true);
    expect(notices(r).some((n) => n.code === "N_INPUT_REQUIRED")).toBe(true);
  });

  it("国立の高専の1〜3年に就学支援金（国公立の高専の額）。4・5年は計算しない（知らせる）", () => {
    const req = mk([{ ...H, stages: [{ stage: "kosen", sector: "national" }] }], { baseMonth: "2026-04", endYear: 2040 });
    const r = runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "education.support", input: { member: uid("h") } } });
    const f = (r.entryOutput as { flows: Flow[] }).flows.filter((x) => x.formula === "education.support.highSchool");
    const years = [...new Set(f.map((x) => x.ym.slice(0, 4)))];
    expect(f.reduce((a, x) => a + x.amount, 0)).toBe(234600 * 3);
    expect(years).toEqual(["2026", "2027", "2028", "2029"]);
    expect(notices(r).some((n) => n.code === "N_NOT_SUPPORTED" && n.ids.includes("educationSupport.higher.kosenUpper"))).toBe(true);
  });
});
