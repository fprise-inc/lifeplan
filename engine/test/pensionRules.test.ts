// 公的年金の計算の決まりの直し: 加給年金の停止の時期・令和10年4月からの配偶者の加給年金額・在職老齢年金の基準額の改定・
// 寡婦年金と遺族厚生年金の選択・遺族年金の受給権と繰下げ・繰上げの同時請求・障害の想定の法定免除の月
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { CoverageOutput, DisabilityPensionOutput, PensionOutput, SurvivorPensionOutput } from "../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = EngineRequest;
type Obj = Record<string, unknown>;
const A = uid("pr.a");
const B = uid("pr.b");
const at = (ym: string) => ({ at: ym });
const result = (req: Req, component: string, input: unknown) => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } });
const call = <T>(req: Req, component: string, input: unknown): T => result(req, component, input).entryOutput as T;
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const months = (req: Req, who: string) => call<PensionOutput>(req, "pension.oldAgeBase", { member: who }).months;
const monthOf = (req: Req, who: string, ym: string) => months(req, who).find((x) => x.month === ym);
const firstWith = (req: Req, who: string, part: "basic" | "employee") => months(req, who).find((x) => x[part] > 0)?.month;

/** 夫 A（会社員だった）と妻 B の世帯。records は加入の記録（構成員ごと）、periods は勤め先の期間 */
function couple(o: {
  base?: string;
  end: number;
  aBirth: string;
  bBirth: string;
  aSex?: "male" | "female";
  bSex?: "male" | "female";
  records: Obj[];
  periods?: Obj[];
  contingencies?: Obj[];
  wageGrowth?: string;
}): Req {
  const req = household({
    baseMonth: o.base ?? "2026-04",
    endYear: o.end,
    members: [member("pr.a", "self", o.aBirth, { sex: o.aSex ?? "male" }), member("pr.b", "spouse", o.bBirth, { sex: o.bSex ?? "female" })],
    relations: [{ type: "spouse", a: A, b: B, marriage: "legal", from: null, to: null }],
    ...(o.periods !== undefined ? { periods: o.periods } : {}),
    ...(o.wageGrowth !== undefined ? { wageGrowth: o.wageGrowth } : {}),
    residentTaxAssessments: [
      { id: uid("pr.rta.a"), member: A, fiscalYear: 2026, amount: box(100000) },
      { id: uid("pr.rta.b"), member: B, fiscalYear: 2026, amount: box(100000) },
    ],
  });
  const input = req.input as unknown as Obj;
  (input.household as Obj).pensionRecords = o.records;
  if (o.contingencies !== undefined) input.contingencies = o.contingencies;
  return req;
}
const record = (name: string, who: string, o: Obj) => ({ id: uid(`pr.rec.${name}`), member: who, kind: "projection", asOf: "2026-04", ...o });

describe("配偶者の加給年金の停止は、配偶者が厚生年金240月以上の老齢厚生年金の受給権を得た月から（厚生年金保険法46条6項）", () => {
  // 令和8年度の配偶者の加給年金額＋特別加算（新規裁定者の改定率 1.085）: 243,800円＋179,900円
  const SUP = 423700;
  const husband = record("a", A, { months: { basic: 480, employee: 300 }, amounts: { basic: box(800000), employee: box(1000000) } });

  it("配偶者がこれから働いて240月に届いても、受給権を得る（65歳）前は加給年金を止めない", () => {
    // 妻は 228月の厚生年金があり、65歳になる 2030年8月まで勤め続ける（計画の全体では240月を超える）
    const wife = record("b", B, { months: { basic: 400, employee: 228 }, amounts: { basic: box(700000), employee: box(500000) } });
    const req = couple({
      end: 2031,
      aBirth: "1961-05",
      bBirth: "1965-08",
      records: [husband, wife],
      periods: [period("pr.pb", { member: "pr.b", from: "2010-04", annual: 3600000, std: [300000, 300000] })],
    });
    expect(monthOf(req, A, "2026-06")?.employee).toBe(1000000 + SUP);
    expect(monthOf(req, A, "2027-01")?.employee).toBeGreaterThan(1000000 + 400000);
    // 妻が65歳に達した月の翌月（2030年9月）からは、65歳未満の配偶者でないので無い
    expect((monthOf(req, A, "2030-09")?.employee ?? 0) < 1000000 + 400000).toBe(true);
  });

  it("配偶者が240月以上で繰上げを請求すると、その月から止まる", () => {
    const wife = record("b", B, {
      months: { basic: 480, employee: 250 },
      amounts: { basic: box(780000), employee: box(600000) },
      claim: { basic: at("2028-09"), employee: at("2028-09") },
    });
    const req = couple({ end: 2029, aBirth: "1961-05", bBirth: "1965-08", records: [husband, wife] });
    expect(monthOf(req, A, "2026-06")?.employee).toBe(1000000 + SUP);
    const aug = monthOf(req, A, "2028-08")?.employee ?? 0;
    const sep = monthOf(req, A, "2028-09")?.employee ?? 0;
    expect(aug).toBeGreaterThan(1000000 + 400000);
    expect(sep).toBeLessThan(1000000 + 10000);
  });

  it("配偶者がすでに240月以上の老齢厚生年金を受けている（受給中の記録）なら、最初から無い", () => {
    const wife = { id: uid("pr.rec.b"), member: B, kind: "receiving", asOf: "2026-04", months: { basic: 480, employee: 260 }, amounts: { basic: box(780000), employee: box(600000) } };
    const req = couple({ end: 2027, aBirth: "1961-05", bBirth: "1959-08", records: [husband, wife] });
    expect(monthOf(req, A, "2026-06")?.employee).toBe(1000000);
  });
});

describe("令和10年4月以後に加給年金の要件を満たした人の配偶者の加給年金額（令和7年法律第74号）", () => {
  const husband = () => record("a", A, { months: { basic: 480, employee: 300 }, amounts: { basic: box(800000), employee: box(1000000) } });
  const wife = record("b", B, { months: { basic: 480, employee: 0 }, amounts: { basic: box(780000) } });

  it("令和10年4月以後に65歳になる人: 202,200円×改定率＋149,200円×改定率（前提なしで新規裁定者の率 1.085 → 219,400円＋161,900円）", () => {
    const req = couple({ end: 2029, aBirth: "1963-05", bBirth: "1968-08", records: [husband(), wife] });
    expect(monthOf(req, A, "2028-06")?.employee).toBe(1000000 + 219400 + 161900);
  });

  it("令和10年3月以前に受給権を得た人は、令和10年4月以後も見直し前の額（243,800円＋179,900円）", () => {
    const req = couple({ end: 2029, aBirth: "1961-05", bBirth: "1968-08", records: [husband(), wife] });
    expect(monthOf(req, A, "2028-06")?.employee).toBe(1000000 + 243800 + 179900);
  });

  it("障害厚生年金の配偶者の加給年金額は見直さない（令和10年4月以後も 224,700円×改定率）", () => {
    const base = (withSpouse: boolean) => {
      const req = household({
        baseMonth: "2026-10",
        endYear: 2032,
        members: [member("pr.a", "self", "1985-05", { sex: "male" }), ...(withSpouse ? [member("pr.b", "spouse", "1987-08")] : [])],
        relations: withSpouse ? [{ type: "spouse", a: A, b: B, marriage: "legal", from: null, to: null }] : [],
        periods: [period("pr.pa", { member: "pr.a", from: "2008-04", annual: 6000000, std: [500000, 500000] })],
        residentTaxAssessments: [{ id: uid("pr.rta.a"), member: A, fiscalYear: 2026, amount: box(300000) }],
      });
      (req.input as unknown as Obj).contingencies = [{ id: uid("pr.cg"), kind: "disability", member: A, occurs: at("2027-01"), grade: 2 }];
      return call<DisabilityPensionOutput>(req, "pension.disability", { member: A }).months.find((x) => x.month === "2029-04")?.employee ?? 0;
    };
    expect(base(true) - base(false)).toBe(243800);
  });
});

describe("在職老齢年金の支給停止調整額は、令和9年度以後は賃金の前提で改定する（厚生年金保険法46条3項）", () => {
  it("賃金上昇率3%: 令和9年度は 65万円×1.03 を1万円単位に四捨五入した 67万円、令和10年度は 69万円。知らせ（N_PARAM_PROJECTED）を出す", () => {
    const rec = record("a", A, { months: { basic: 480, employee: 400 }, amounts: { basic: box(800000), employee: box(2400000) } });
    const req = couple({
      end: 2029,
      aBirth: "1960-05",
      bBirth: "1960-08",
      records: [rec, record("b", B, { months: { basic: 480, employee: 0 }, amounts: { basic: box(780000) } })],
      periods: [period("pr.pa", { member: "pr.a", from: "2000-04", annual: 6000000, std: [500000, 500000] })],
      wageGrowth: "0.03",
    });
    const cov = call<CoverageOutput>(req, "socialInsurance.coverage", { member: A, fromYear: 2026 });
    const stdOf = (ym: string) => cov.months.find((c) => c.month === ym)?.pensionStd ?? 0;
    const check = (ym: string, limit: number) => {
      const m = monthOf(req, A, ym);
      const prop = (m?.employee ?? 0) + (m?.suspended ?? 0);
      const expected = (prop + 12 * stdOf(ym) - 12 * limit) / 2;
      expect(Math.abs((m?.suspended ?? 0) - expected)).toBeLessThanOrEqual(1);
    };
    check("2026-06", 650000);
    check("2027-06", 670000);
    check("2028-06", 690000);
    const r = result(req, "pension.oldAgeBase", { member: A });
    expect(notices(r)).toContainEqual({ code: "N_PARAM_PROJECTED", ids: ["pension.oldAgeBase", "pension.workingAdjustment.threshold", "2027", "2029"] });
  });
});

describe("遺族年金の受給権と繰下げ（国民年金法28条・厚生年金保険法44条の3、令和7年法律第74号附則5条）", () => {
  // 夫 A（1958年生まれ。厚生年金の長期要件を満たす）が亡くなる。妻 B（1960年8月生まれ。65歳に達した月は2025年8月）は70歳まで繰り下げる
  const husband = record("a", A, { months: { basic: 480, employee: 400 }, amounts: { basic: box(800000), employee: box(1500000) } });
  const wife = record("b", B, {
    months: { basic: 480, employee: 120 },
    amounts: { basic: box(780000), employee: box(300000) },
    claim: { basic: at("2030-09"), employee: at("2030-09") },
  });
  const plan = (deathYm: string, bBirth = "1960-08") =>
    couple({ end: 2032, aBirth: "1958-05", bBirth, records: [husband, wife], contingencies: [{ id: uid("pr.cg"), kind: "death", member: A, occurs: at(deathYm) }] });

  it("万一の想定が無ければ、70歳まで繰り下げる", () => {
    const req = couple({ end: 2032, aBirth: "1958-05", bBirth: "1960-08", records: [husband, wife] });
    expect(firstWith(req, B, "employee")).toBe("2030-09");
    expect(firstWith(req, B, "basic")).toBe("2030-09");
  });

  it("66歳の後（令和10年4月以後）に夫が亡くなる: 老齢厚生年金は死亡の日に申出があったとみなし翌月から（増額はそこまで）。老齢基礎年金は遺族厚生年金があっても繰り下げられる", () => {
    const req = plan("2028-06");
    expect(firstWith(req, B, "employee")).toBe("2028-07");
    // 増額: 65歳に達した月（2025年8月）から死亡の月の前月まで34か月 × 0.7% = 23.8%
    expect(monthOf(req, B, "2028-07")?.employee).toBe(Math.round(300000 * 1.238));
    expect(firstWith(req, B, "basic")).toBe("2030-09");
  });

  it("66歳の後（令和10年3月以前）に夫が亡くなる: 令和10年3月31日に65歳以上で遺族厚生年金の受給権があるので、老齢基礎年金も死亡の翌月から", () => {
    const req = plan("2027-06");
    expect(firstWith(req, B, "employee")).toBe("2027-07");
    expect(firstWith(req, B, "basic")).toBe("2027-07");
  });

  it("65歳から66歳の間に夫が亡くなる: 繰り下げられないので、老齢厚生年金は65歳から増額なし", () => {
    const req = plan("2027-06", "1961-12");
    // 妻は1961年12月生まれ: 65歳に達した月は2026年12月。66歳に達する前（2027年6月）に遺族厚生年金の受給権を得る
    expect(firstWith(req, B, "employee")).toBe("2027-01");
    expect(monthOf(req, B, "2027-01")?.employee).toBe(300000);
    // 老齢基礎年金は、改正の後の28条（令和10年3月31日に65歳以上で受給権がある人だけ従前）: 受給権を得たのが令和10年3月以前で、その日に65歳以上なので繰り下げられない
    expect(firstWith(req, B, "basic")).toBe("2027-01");
  });
});

describe("寡婦年金と遺族厚生年金は同じ月に受けない（一人一年金。国民年金法20条）・妻の繰上げで寡婦年金は無くなる（附則9条の2第5項）", () => {
  // 夫 A（1962年生まれ）は第1号の納付済が10年以上、厚生年金も長期要件（受給資格期間25年以上・240月以上）を満たす。64歳で亡くなる
  const husband = (employee: number) =>
    record("a", A, { months: { basic: 480, employee, category1: { paid: 480 - employee } }, amounts: { basic: box(800000), ...(employee > 0 ? { employee: box(900000) } : {}) } });
  const wife = (claim?: Obj) => record("b", B, { months: { basic: 480, employee: 0 }, amounts: { basic: box(780000) }, ...(claim !== undefined ? { claim } : {}) });
  const plan = (employee: number, claim?: Obj) =>
    couple({ end: 2031, aBirth: "1962-05", bBirth: "1964-08", records: [husband(employee), wife(claim)], contingencies: [{ id: uid("pr.cg"), kind: "death", member: A, occurs: at("2026-12") }] });

  it("両方を受けられる月は、多い方の一方だけ", () => {
    const out = call<SurvivorPensionOutput>(plan(250), "pension.survivor", { member: B });
    expect(out.months.length).toBeGreaterThan(0);
    for (const m of out.months) expect(m.widowPension > 0 && (m.employee > 0 || m.widowAddition > 0)).toBe(false);
    // 遺族厚生年金＋中高齢寡婦加算の方が多いので、寡婦年金は受けない
    expect(out.months.some((m) => m.widowPension > 0)).toBe(false);
    expect(out.months.find((m) => m.month === "2027-01")?.employee).toBeGreaterThan(0);
  });

  it("妻が繰上げを請求した月から寡婦年金は無い", () => {
    const base = call<SurvivorPensionOutput>(plan(0), "pension.survivor", { member: B });
    expect(base.months.find((m) => m.month === "2028-06")?.widowPension).toBeGreaterThan(0);
    const early = call<SurvivorPensionOutput>(plan(0, { basic: at("2028-01") }), "pension.survivor", { member: B });
    expect(early.months.find((m) => m.month === "2027-12")?.widowPension).toBeGreaterThan(0);
    expect(early.months.filter((m) => m.month >= "2028-01" && m.widowPension > 0)).toEqual([]);
  });

  it("夫の死亡の前に繰上げを請求していれば、寡婦年金は無い（死亡一時金を受けうる）", () => {
    const early = call<SurvivorPensionOutput>(plan(0, { basic: at("2026-09") }), "pension.survivor", { member: B });
    expect(early.months.some((m) => m.widowPension > 0)).toBe(false);
    expect(early.lumpSum).toBeGreaterThan(0);
  });
});

describe("繰上げは老齢基礎年金と老齢厚生年金を同時に請求する（国民年金法附則9条の2第2項）", () => {
  it("片方だけの繰上げは、両方をその月にそろえて計算し、知らせる（N_ASSUMED）", () => {
    const rec = record("a", A, { months: { basic: 480, employee: 300 }, amounts: { basic: box(800000), employee: box(1000000) }, claim: { basic: at("2029-06") } });
    const req = couple({ end: 2032, aBirth: "1966-05", bBirth: "1966-08", records: [rec, record("b", B, { months: { basic: 480, employee: 0 }, amounts: { basic: box(780000) } })] });
    expect(firstWith(req, A, "basic")).toBe("2029-06");
    expect(firstWith(req, A, "employee")).toBe("2029-06");
    expect(notices(result(req, "pension.oldAgeBase", { member: A }))).toContainEqual({ code: "N_ASSUMED", ids: ["pension.oldAgeBase", "pension.earlyClaim.simultaneous", A] });
  });

  it("厚生年金の加入が無い人の繰上げ（老齢基礎年金だけ）は、そろえる必要が無いので知らせない", () => {
    const rec = record("a", A, { months: { basic: 480, employee: 0 }, amounts: { basic: box(800000) }, claim: { basic: at("2029-06") } });
    const req = couple({ end: 2032, aBirth: "1966-05", bBirth: "1966-08", records: [rec, record("b", B, { months: { basic: 480, employee: 0 }, amounts: { basic: box(780000) } })] });
    expect(firstWith(req, A, "basic")).toBe("2029-06");
    expect(notices(result(req, "pension.oldAgeBase", { member: A })).some((n) => n.code === "N_ASSUMED")).toBe(false);
  });

  it("繰下げは別々の月にできる（そろえない）", () => {
    const rec = record("a", A, { months: { basic: 480, employee: 300 }, amounts: { basic: box(800000), employee: box(1000000) }, claim: { basic: at("2033-06") } });
    const req = couple({ end: 2034, aBirth: "1966-05", bBirth: "1966-08", records: [rec, record("b", B, { months: { basic: 480, employee: 0 }, amounts: { basic: box(780000) } })] });
    expect(firstWith(req, A, "employee")).toBe("2031-06");
    expect(firstWith(req, A, "basic")).toBe("2033-06");
  });
});

describe("障害の想定の法定免除の月は、老齢基礎年金の額では全額免除の月（2009年4月以後は2分の1）として数える（国民年金法27条・89条）", () => {
  // 自営業（第1号）の本人。2030年1月に初診日、1年6か月後の障害認定日（2031年7月）の翌月から60歳になる前（2040年4月）までの105か月が法定免除
  const plan = (disabled: boolean, kind: "statementUnder50" | "projection") => {
    const req = household({
      baseMonth: "2026-10",
      endYear: 2046,
      members: [member("pr.a", "self", "1980-05", { sex: "male" })],
      periods: [{ id: uid("pr.pa"), member: A, from: at("2010-04"), to: null, type: "selfEmployed", business: { income: box(4000000) } }],
      residentTaxAssessments: [{ id: uid("pr.rta.a"), member: A, fiscalYear: 2026, amount: box(200000) }],
    });
    const input = req.input as unknown as Obj;
    (input.household as Obj).pensionRecords = [
      { id: uid("pr.rec.a"), member: A, kind, asOf: "2026-10", months: { basic: 300, employee: 0 }, amounts: { basic: box(kind === "projection" ? 812500 : 500000) } },
    ];
    if (disabled) input.contingencies = [{ id: uid("pr.cg"), kind: "disability", member: A, occurs: at("2030-01"), grade: 2 }];
    return monthOf(req, A, "2045-06")?.basic ?? 0;
  };

  it("月数から計算する記録: 105か月のうち半分だけ減る", () => {
    const healthy = plan(false, "statementUnder50");
    const disabled = plan(true, "statementUnder50");
    // 健康なときの月数 300＋記録の後の第1号の月（2026年11月〜2040年4月の162か月）= 462。満額は healthy×480/462
    const full = (healthy * 480) / 462;
    expect(Math.abs(healthy - disabled - (full * 105) / 2 / 480)).toBeLessThanOrEqual(100);
    expect(disabled).toBeLessThan(healthy);
  });

  it("額で入れた見込み（60歳まで納める前提）: 法定免除の月の半分の額を引く", () => {
    const healthy = plan(false, "projection");
    const disabled = plan(true, "projection");
    // 満額（780,900円×改定率 1.085 → 847,300円）×105か月×(1−1/2)÷480 ≒ 92,673円
    expect(Math.abs(healthy - disabled - (847300 * 105) / 2 / 480)).toBeLessThanOrEqual(1);
  });
});

describe("65歳になる前の遺族年金と自分の老齢年金（特別支給・繰上げ）は一方だけ（国民年金法20条・附則9条の2の4、厚生年金保険法38条・附則17条）", () => {
  // 夫 A（1962年生まれ）は厚生年金300月。2026年12月に亡くなる。妻 B（1964年生まれ）は2026年9月から繰上げで老齢年金を受ける
  const husband = record("a", A, { months: { basic: 480, employee: 300 }, amounts: { basic: box(800000), employee: box(1000000) } });
  const wife = (employee: number, early: boolean) =>
    record("b", B, {
      months: { basic: 480, employee: employee > 0 ? 120 : 0 },
      amounts: { basic: box(780000), ...(employee > 0 ? { employee: box(employee) } : {}) },
      ...(early ? { claim: { basic: at("2026-09"), employee: at("2026-09") } } : {}),
    });
  const plan = (employee: number, early = true) =>
    couple({ end: 2031, aBirth: "1962-05", bBirth: "1964-08", records: [husband, wife(employee, early)], contingencies: [{ id: uid("pr.cg"), kind: "death", member: A, occurs: at("2026-12") }] });
  const survivorAt = (req: Req, ym: string) => {
    const r = call<SurvivorPensionOutput>(req, "pension.survivor", { member: B }).months.find((m) => m.month === ym);
    return r === undefined ? 0 : r.basic + r.employee + r.widowAddition + r.widowPension;
  };
  const ownAt = (req: Req, ym: string) => {
    const r = call<PensionOutput>(req, "pension.oldAge", { member: B }).months.find((m) => m.month === ym);
    return r === undefined ? 0 : r.basic + r.employee + r.special;
  };

  it("遺族年金の方が多ければ、受け取りは遺族年金の額（自分の老齢年金との差を遺族年金の行に出す）。知らせ（N_ASSUMED）を出す", () => {
    const req = plan(0);
    const full = survivorAt(plan(0, false), "2027-06");
    expect(ownAt(req, "2027-06")).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(ownAt(req, "2027-06"));
    expect(survivorAt(req, "2027-06") + ownAt(req, "2027-06")).toBe(full);
    expect(notices(result(req, "pension.survivor", { member: B }))).toContainEqual({ code: "N_ASSUMED", ids: ["pension.survivor", "pension.survivor.ownPensionBefore65", B] });
    // 65歳から（2029年8月）は今までどおり（遺族厚生年金と自分の老齢年金の調整）
    expect(survivorAt(req, "2029-09")).toBeGreaterThan(0);
  });

  it("自分の老齢年金の方が多ければ、65歳になるまで遺族年金は受けない", () => {
    const req = plan(3000000);
    expect(ownAt(req, "2027-06")).toBeGreaterThan(survivorAt(plan(3000000, false), "2027-06"));
    expect(survivorAt(req, "2027-06")).toBe(0);
    expect(survivorAt(req, "2029-07")).toBe(0);
  });
});

describe("繰上げの後の障害年金（国民年金法附則9条の2の3・厚生年金保険法附則16条の3）", () => {
  // 本人 A（1965年生まれ）は2026年6月から繰上げで老齢年金を受ける。2026年7月が初診日の障害（2級）の想定
  const rec = record("a", A, { months: { basic: 480, employee: 300 }, amounts: { basic: box(800000), employee: box(1000000) }, claim: { basic: at("2026-06"), employee: at("2026-06") } });
  const plan = (working: boolean) =>
    couple({
      end: 2031,
      aBirth: "1965-05",
      bBirth: "1966-08",
      records: [rec, record("b", B, { months: { basic: 480, employee: 0 }, amounts: { basic: box(780000) } })],
      ...(working ? { periods: [period("pr.pa", { member: "pr.a", from: "2000-04", annual: 4000000, std: [320000, 320000] })] } : {}),
      contingencies: [{ id: uid("pr.cg"), kind: "disability", member: A, occurs: at("2026-07"), grade: 2 }],
    });

  it("初診日に厚生年金に入っていなければ、繰上げの後の初診日の障害年金は無い。知らせ（N_NOT_ENTITLED）を出す", () => {
    const req = plan(false);
    expect(call<DisabilityPensionOutput>(req, "pension.disability", { member: A }).months).toEqual([]);
    expect(notices(result(req, "pension.disability", { member: A }))).toContainEqual({ code: "N_NOT_ENTITLED", ids: ["pension.disability", "pension.disability.afterEarlyClaim", A] });
  });

  it("初診日に厚生年金に入っていれば障害年金を受けられるが、65歳になるまでは繰上げの老齢年金と一方だけ", () => {
    const req = plan(true);
    const dis = call<DisabilityPensionOutput>(req, "pension.disability", { member: A }).months;
    const old = call<PensionOutput>(req, "pension.oldAge", { member: A }).months;
    expect(dis.length).toBeGreaterThan(0);
    for (const ym of ["2028-06", "2029-06", "2030-03"]) {
      const d = dis.find((x) => x.month === ym);
      const o = old.find((x) => x.month === ym);
      const both = (d?.basic ?? 0) + (d?.employee ?? 0) > 0 && (o?.basic ?? 0) + (o?.employee ?? 0) + (o?.special ?? 0) > 0;
      expect(both, ym).toBe(false);
    }
  });
});

describe("配偶者が障害年金を受ける間は、配偶者の加給年金を止める（厚生年金保険法46条6項）", () => {
  const husband = record("a", A, { months: { basic: 480, employee: 300 }, amounts: { basic: box(800000), employee: box(1000000) } });
  const wife = record("b", B, { months: { basic: 400, employee: 0 }, amounts: { basic: box(700000) } });
  const plan = (disabled: boolean) =>
    couple({
      end: 2030,
      aBirth: "1961-05",
      bBirth: "1965-08",
      records: [husband, wife],
      ...(disabled ? { contingencies: [{ id: uid("pr.cg"), kind: "disability", member: B, occurs: at("2026-06"), grade: 2 }] } : {}),
    });

  it("妻の障害基礎年金の支払いが始まる月（障害認定日の翌月）から、夫の老齢厚生年金の配偶者の加給年金が止まる", () => {
    const req = plan(true);
    const base = (ym: string) => call<PensionOutput>(req, "pension.oldAgeBase", { member: A }).months.find((x) => x.month === ym);
    const paid = (ym: string) => call<PensionOutput>(req, "pension.oldAge", { member: A }).months.find((x) => x.month === ym)?.employee ?? 0;
    const first = call<DisabilityPensionOutput>(req, "pension.disability", { member: B }).months[0]?.month;
    expect(first).toBe("2028-01");
    expect(paid("2027-12")).toBe(base("2027-12")?.employee);
    const sup = (base("2028-06") as { spouseSupplement?: number } | undefined)?.spouseSupplement ?? 0;
    expect(sup).toBeGreaterThan(400000);
    expect(paid("2028-06")).toBe((base("2028-06")?.employee ?? 0) - sup);
    // 障害の想定が無ければ止めない
    expect(call<PensionOutput>(plan(false), "pension.oldAge", { member: A }).months.find((x) => x.month === "2028-06")?.employee).toBe(base("2028-06")?.employee);
  });
});
