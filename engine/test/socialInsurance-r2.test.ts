// 社会保険料・給付・介護の切り替わりの月と判定の検算（0171）。どれも法令どおりの答え（条文から作った額）と突き合わせる。
// 直す前はすべて落ちた（任意継続の家族・特定同一世帯所属者・給与所得者等・被扶養者であった人・介護の所得の指標・高額介護サービス費の課税所得・
// 亡くなった月の保険料・亡くなる前の扶養・出生後休業支援給付の母）
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import { box, household, member, modelHousehold, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
const packs = () => realPacks();
const H = (r: Req) => (r.input as unknown as { household: Record<string, unknown> }).household;
const run = (r: Req): EngineResult => runEngine(r, packs());
const entry = (r: Req, component: string, input: unknown): Record<string, unknown> =>
  (runEngine(r, packs(), { entry: { component, input } }) as { entryOutput?: unknown }).entryOutput as Record<string, unknown>;
const fy = (r: EngineResult, prefix: string, who: string | null, y: number) =>
  r.flows.filter((f) => f.formula.startsWith(prefix) && (who === null || f.member === uid(who)) && f.accrualYear === y).reduce((s, f) => s + f.amount, 0);
const status = (r: Req, who: string, from: string, to: string) =>
  (entry(r, "socialInsurance.healthStatus", { member: uid(who) }).months as { month: string; kind: string }[]).filter((x) => x.month >= from && x.month <= to).map((x) => x.kind);
const category = (r: Req, who: string, from: string, to: string) =>
  (entry(r, "pension.category", { member: uid(who) }).months as { month: string; category: string }[]).filter((x) => x.month >= from && x.month <= to).map((x) => x.category);
const pr = (name: string, who: string, basic: number, employee: number) => ({ id: uid(name), member: uid(who), kind: "receiving", asOf: "2026-06", amounts: { basic: box(basic), employee: box(employee) } });
const spouse = (a: string, b: string) => ({ type: "spouse", a: uid(a), b: uid(b), marriage: "legal", from: null, to: null });
const death = (id: string, who: string, at: string) => ({ id: uid(id), kind: "death", member: uid(who), occurs: { at }, survivor: { funeral: 0 } });
const withDeath = (r: Req, d: unknown): Req => ({ ...r, input: { ...r.input, contingencies: [d] } }) as Req;

describe("R2-001 任意継続の被扶養者", () => {
  it("任意継続の夫の妻は被扶養者のまま（健康保険法3条1項・7項）。国保に入れない", () => {
    const req = household({ baseMonth: "2026-04", endYear: 2030, members: [member("r1.a", "self", "1966-05", { sex: "male" }), member("r1.w", "spouse", "1968-01")], relations: [spouse("r1.a", "r1.w")],
      periods: [period("r1.p", { member: "r1.a", from: "2000-04", to: "2026-09", annual: 6000000, std: [500000, 500000] }), { id: uid("r1.u"), member: uid("r1.a"), from: { at: "2026-10" }, to: null, type: "unemployed", healthInsurance: { kind: "continuation" } }] });
    expect(status(req, "r1.w", "2026-10", "2028-09").every((k) => k === "dependent")).toBe(true); // 直す前は national
    expect(fy(run(req), "socialInsurance.nationalHealth", null, 2027)).toBe(0); // 直す前は 77,383
  });
});

describe("R2-002 特定同一世帯所属者・特定世帯（国民健康保険法施行令29条の7第2項8号・第6項）", () => {
  it("夫が後期へ移った翌年度の妻だけの国保: 人数に夫を数えて5割、平等割は2分の1", () => {
    const req = household({ baseMonth: "2027-04", endYear: 2031, members: [member("t3.h", "self", "1952-07", { sex: "male" }), member("t3.w", "spouse", "1956-01")], relations: [spouse("t3.h", "t3.w")] });
    H(req).pensionRecords = [pr("t3.prh", "t3.h", 800000, 1200000), pr("t3.prw", "t3.w", 800000, 0)];
    const r = run(req);
    // 医療分: 均等割 29,349×0.5 ＋ 平等割 16,429×0.5×0.5 ＝ 18,781.75（直す前は 36,622 ＝ 2割軽減・平等割そのまま）
    expect(Math.abs(fy(r, "socialInsurance.nationalHealth.medical", null, 2028) - 18782)).toBeLessThanOrEqual(2);
  });
});

describe("R2-003 給与所得者等の数（施行令29条の7第6項1号・附則5条、高齢者医療確保法施行令18条5項・附則3条）", () => {
  const couple = (hb: string, wb: string) => {
    const req = household({ baseMonth: "2027-04", endYear: 2029, members: [member("e.h", "self", hb, { sex: "male" }), member("e.w", "spouse", wb)], relations: [spouse("e.h", "e.w")] });
    H(req).pensionRecords = [pr("e.prh", "e.h", 800000, 935000), pr("e.prw", "e.w", 800000, 0)];
    return run(req);
  };
  it("国保: 年金の収入 約80万円の妻は数えない → 7割でなく5割", () => {
    // 所得割 0.0777×193,976 ＋ 均等割 29,349×2×0.5 ＋ 平等割 16,429×0.5 ＝ 52,635.5（直す前は 37,607 ＝ 7割）。人ごと・区分ごとの円未満の切り捨てで数円の差
    expect(Math.abs(fy(couple("1959-06", "1960-09"), "socialInsurance.nationalHealth.medical", null, 2027) - 52636)).toBeLessThanOrEqual(5);
  });
  it("後期: 同じ夫婦が75歳以上 → 5割（医療分の夫 47,700円）", () => {
    // 所得割 0.1017×193,964 ＋ 均等割 56,083×0.5 → 100円未満切り捨て（直す前は 35,400 ＝ 7.2割）
    expect(fy(couple("1949-06", "1950-09"), "socialInsurance.lateElderly.medical", "e.h", 2027)).toBe(47700);
  });
});

describe("R2-004 後期の被扶養者だった人（高齢者医療確保法施行令18条1項2号ただし書・6項）", () => {
  it("会社員の夫に扶養されていた妻が75歳で後期へ: 所得割なし・均等割5割（加入から2年）", () => {
    const req = household({ baseMonth: "2027-04", endYear: 2031, members: [member("f3.h", "self", "1960-01", { sex: "male" }), member("f3.w", "spouse", "1952-07")], relations: [spouse("f3.h", "f3.w")],
      periods: [period("f3.p", { member: "f3.h", from: "2000-04", type: "contract", annual: 3600000, std: [300000, 300000] })] });
    H(req).pensionRecords = [pr("f3.prw", "f3.w", 800000, 900000), pr("f3.prh", "f3.h", 800000, 900000)];
    // 令和10年度（2028-04〜2029-03）は全部が加入から2年の中: 56,083×0.5 → 28,000（直す前は 73,300）
    expect(fy(run(req), "socialInsurance.lateElderly.medical", "f3.w", 2028)).toBe(28000);
  });
});

describe("R2-005 介護の自己負担割合の合計所得金額（介護保険法施行令22条の2第1項。令和6年1月の厚生労働省の事務連絡 Ⅰ）", () => {
  it("年金だけの合計所得金額165万円は、10万円を引いて155万円 → 1割", () => {
    const req = household({ baseMonth: "2027-04", endYear: 2030, members: [member("c1.a", "self", "1952-10", { sex: "male" }), member("c1.b", "spouse", "1954-03")], relations: [spouse("c1.a", "c1.b")] });
    H(req).pensionRecords = [pr("c1.pa", "c1.a", 800000, 1950000), pr("c1.pb", "c1.b", 800000, 200000)];
    H(req).careExpenses = [{ id: uid("c1.care"), member: uid("c1.a"), from: { at: "2028-01" }, months: 24, place: "home", serviceMonthly: box(200000), otherMonthly: box(0), initial: box(0), growth: { kind: "none" } }];
    const m = run(req).flows.filter((f) => f.formula.startsWith("care.expense") && f.ym === "2028-08").reduce((s, f) => s + f.amount, 0);
    expect(m).toBe(20000); // 直す前は 40,000（2割）
  });
});

describe("R2-006 高額介護サービス費の課税所得（介護保険法施行令22条の2の2第5項・6項）", () => {
  it("住民税の課税所得 394.6万円（所得税の課税所得は 370.6万円）→ 上限 93,000円", () => {
    const req = household({ baseMonth: "2027-04", endYear: 2030, members: [member("c2.a", "self", "1951-10", { sex: "male" })] });
    H(req).pensionRecords = [{ id: uid("c2.p"), member: uid("c2.a"), kind: "receiving", asOf: "2026-06", amounts: { basic: box(800000), employee: box(6000000) } }];
    H(req).careExpenses = [{ id: uid("c2.care"), member: uid("c2.a"), from: { at: "2028-08" }, months: 12, place: "home", serviceMonthly: box(1000000), otherMonthly: box(0), initial: box(0), growth: { kind: "none" } }];
    const m = run(req).flows.filter((f) => f.formula.startsWith("care.expense") && f.ym === "2028-09").reduce((s, f) => s + f.amount, 0);
    expect(m).toBe(93000); // 直す前は 44,400
  });
});

describe("R2-007 亡くなった月の保険料（資格を失うのは死亡の翌日。保険料はその月の前月まで）", () => {
  const seniors = () => {
    const req = household({ baseMonth: "2027-04", endYear: 2031, members: [member("d1.h", "self", "1946-03", { sex: "male" }), member("d1.w", "spouse", "1948-05")], relations: [spouse("d1.h", "d1.w")] });
    H(req).pensionRecords = [pr("d1.prh", "d1.h", 800000, 1600000), pr("d1.prw", "d1.w", 800000, 300000)];
    return req;
  };
  it("2028-10 に亡くなった夫の後期・介護第1号は 4〜9月の6か月分（高齢者医療確保法53条・介護保険法11条）", () => {
    const alive = run(seniors());
    const dead = run(withDeath(seniors(), death("d1.c", "d1.h", "2028-10")));
    for (const p of ["socialInsurance.lateElderly", "socialInsurance.careFirst"]) {
      expect(Math.abs(fy(dead, p, "d1.h", 2028) - (fy(alive, p, "d1.h", 2028) * 6) / 12)).toBeLessThanOrEqual(100); // 直す前は7か月分
    }
  });
  it("会社員が 2028-10 に亡くなる: 10月分の健康保険料・厚生年金保険料はかからない。扶養の子は10月から国保（健康保険法36条・国民健康保険法7条）", () => {
    const req = household({ baseMonth: "2027-04", endYear: 2031, members: [member("d3.h", "self", "1978-05", { sex: "male" }), member("d3.w", "spouse", "1980-02"), member("d3.k", "child", "2012-06")],
      relations: [spouse("d3.h", "d3.w"), { type: "parentOf", parent: uid("d3.h"), child: uid("d3.k") }, { type: "parentOf", parent: uid("d3.w"), child: uid("d3.k") }],
      periods: [period("d3.p", { member: "d3.h", from: "2000-04", annual: 4800000, std: [410000, 410000] })] });
    const d = withDeath(req, death("d3.c", "d3.h", "2028-10"));
    const r = run(d);
    // 10月の給与から引くのは9月分の1回だけ（直す前は9月分と10月分の2回）
    expect(r.flows.filter((f) => f.formula === "socialInsurance.health.monthly" && f.member === uid("d3.h") && f.ym === "2028-10").length).toBe(1);
    expect(status(d, "d3.k", "2028-10", "2028-10")).toEqual(["national"]); // 直す前は dependent
  });
});

describe("R2-008 亡くなる前の扶養の判定に、亡くなった後の遺族年金・給与の止まりが入る", () => {
  it("夫が 2028-10 に亡くなる想定でも、7〜9月の妻は夫の健康保険の被扶養者", () => {
    const req = household({ baseMonth: "2027-04", endYear: 2031, members: [member("d3.h", "self", "1978-05", { sex: "male" }), member("d3.w", "spouse", "1980-02"), member("d3.k", "child", "2012-06")],
      relations: [spouse("d3.h", "d3.w"), { type: "parentOf", parent: uid("d3.h"), child: uid("d3.k") }, { type: "parentOf", parent: uid("d3.w"), child: uid("d3.k") }],
      periods: [period("d3.p", { member: "d3.h", from: "2000-04", annual: 4800000, std: [410000, 410000] })] });
    const d = withDeath(req, death("d3.c", "d3.h", "2028-10"));
    expect(status(d, "d3.w", "2028-07", "2028-09")).toEqual(["dependent", "dependent", "dependent"]); // 直す前は national
  });
});

describe("R2-002 の続き: 世帯主でない人が後期へ移る", () => {
  it("妻が先に75歳で後期へ移り、夫だけが国保に残る: 妻を軽減の人数に数え、平等割は2分の1（施行令29条の7第2項8号・第6項）", () => {
    const req = household({ baseMonth: "2027-04", endYear: 2031, members: [member("t5.h", "self", "1956-01", { sex: "male" }), member("t5.w", "spouse", "1952-07")], relations: [spouse("t5.h", "t5.w")] });
    H(req).pensionRecords = [pr("t5.prh", "t5.h", 800000, 0), pr("t5.prw", "t5.w", 800000, 1200000)];
    const r = run(req);
    // 判定の所得: 夫 0円（年金の所得 0）＋妻 750,000円（90万−15万）＝75万円 ≦ 43万＋31万×2 → 5割。医療分＝均等割 29,349×0.5 ＋ 平等割 16,429×0.5×0.5
    expect(Math.abs(fy(r, "socialInsurance.nationalHealth.medical", null, 2028) - 18782)).toBeLessThanOrEqual(5);
  });
});

describe("R2-007 の続き: 自営業の人が亡くなる月", () => {
  const mk = (withDeath: boolean): Req => {
    const req = household({ baseMonth: "2027-04", endYear: 2031, members: [member("d2.h", "self", "1978-05", { sex: "male" }), member("d2.w", "spouse", "1980-02"), member("d2.k", "child", "2012-06")],
      relations: [spouse("d2.h", "d2.w"), { type: "parentOf", parent: uid("d2.h"), child: uid("d2.k") }, { type: "parentOf", parent: uid("d2.w"), child: uid("d2.k") }],
      periods: [{ id: uid("d2.p"), member: uid("d2.h"), from: { at: "2000-04" }, to: null, type: "selfEmployed", business: { income: box(1000000) } }] });
    return withDeath ? withDeath2(req) : req;
  };
  const withDeath2 = (r: Req) => withDeath(r, death("d2.c", "d2.h", "2028-10"));
  it("2028-10 に亡くなった人の国民年金保険料は9月分まで（10月分を11月に払わない。国民年金法9条1号・11条）", () => {
    const r = run(mk(true));
    const paid = r.flows.filter((f) => f.formula === "socialInsurance.nationalPension.monthly" && f.member === uid("d2.h") && f.ym >= "2028-10").map((f) => f.ym);
    expect(paid).toEqual(["2028-10"]); // 9月分（10月に払う）だけ。直す前は 2028-11（10月分）も
    expect(category(mk(true), "d2.h", "2028-10", "2028-10")).toEqual(["none"]);
  });
  it("国民健康保険の亡くなった人の分は4〜9月の6か月（国民健康保険法8条）", () => {
    const status0 = status(mk(true), "d2.h", "2028-09", "2028-10");
    expect(status0).toEqual(["national", "none"]);
  });
});

describe("R2-007 の続き: 会社員が亡くなっても遺族厚生年金の短期要件は満たす", () => {
  it("在職中に亡くなった人（加入20年余り）の遺族厚生年金は300月のみなしで出る（死亡の月は加入の記録に入らない）", () => {
    const req = household({ baseMonth: "2027-04", endYear: 2031, members: [member("d4.h", "self", "1985-05", { sex: "male" }), member("d4.w", "spouse", "1987-02"), member("d4.k", "child", "2016-06")],
      relations: [spouse("d4.h", "d4.w"), { type: "parentOf", parent: uid("d4.h"), child: uid("d4.k") }, { type: "parentOf", parent: uid("d4.w"), child: uid("d4.k") }],
      periods: [period("d4.p", { member: "d4.h", from: "2008-04", annual: 4800000, std: [410000, 410000] })] });
    const r = run(withDeath(req, death("d4.c", "d4.h", "2028-10")));
    const emp = r.flows.filter((f) => f.formula.startsWith("pension.survivor") && f.member === uid("d4.w") && f.ym === "2029-02").reduce((s, f) => s + f.amount, 0);
    expect(emp).toBeGreaterThan(0);
    expect(category(withDeath(req, death("d4.c", "d4.h", "2028-10")), "d4.w", "2028-09", "2028-10")).toEqual(["3", "1"]);
  });
});

describe("R2-010 介護第1号の第1〜5段階のその他の合計所得金額（介護保険法施行令22条の2第4項。令和6年1月の厚生労働省の事務連絡 Ⅱ）", () => {
  it("給与所得25万円は10万円を引いて15万円: 年金の収入 約60万円＋15万円 ≦ 82.65万円 → 第1段階", () => {
    const req = household({ baseMonth: "2027-04", endYear: 2029, members: [member("k.a", "self", "1960-06")],
      periods: [{ id: uid("k.p"), member: uid("k.a"), from: { at: "2020-04" }, to: null, type: "partTime", employer: { size: 10, weeklyHours: "15" }, salary: { annual: box(990000), bonus: box(0) }, pensionCategory: "none", healthInsurance: { kind: "national" }, employmentInsuranceCovered: false }] });
    H(req).pensionRecords = [{ id: uid("k.pr"), member: uid("k.a"), kind: "receiving", asOf: "2026-06", amounts: { basic: box(600000), employee: box(0) } }];
    const r = run(req);
    const first = fy(r, "socialInsurance.careFirst", "k.a", 2027);
    // 基準額×12×0.285（第1段階）。直す前は 0.485（第2段階）
    const base = (entry(req, "socialInsurance.careFirst", { member: uid("k.a"), fiscalYear: 2027 }).flows as { amount: number }[]).reduce((s, f) => s + f.amount, 0);
    expect(base).toBe(first);
    expect(first / 21289).toBeCloseTo(1, 2);
  });
});

describe("R2-011 出生後休業支援給付の産後休業をした母（対象期間は出生から16週間）", () => {
  it("見本の世帯 parentalLeave: 母にも 休業開始時賃金日額×28日×13% が出る", () => {
    const req = modelHousehold("parentalLeave");
    const r = runEngine(req, packs());
    const mom = (req.input.household.members[0] as { id: string }).id;
    const dad = (req.input.household.members[1] as { id: string }).id;
    const post = (id: string) => r.flows.filter((f) => f.formula === "benefit.employment.postBirth" && f.member === id).reduce((s, f) => s + f.amount, 0);
    expect(post(dad)).toBe(60205);
    expect(post(mom)).toBe(42679); // 11,725円×28日×13%（直す前は0円）
  });
});
