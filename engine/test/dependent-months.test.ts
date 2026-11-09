// 扶養・第3号の判定の月（0174）と、住民税の非課税の判定のひとり親・寡婦（0174）。
// - 被扶養者・第3号の「その月からの1年の見込み」は、その月の収入の状況が続くとしたらの年額で見る（働き始めた月から外れ、辞めた翌月から入る）
// - 第3号は、その月の健康保険の種類が扶養（dependent）の月だけ
// - 前の年の合計所得金額が135万円以下のひとり親・寡婦には住民税（均等割・所得割）をかけない（地方税法295条1項2号・24条の5第1項2号）
// 直す前はどれも落ちた
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
const packs = () => realPacks();
const entry = (r: Req, component: string, input: unknown): Record<string, unknown> =>
  (runEngine(r, packs(), { entry: { component, input } }) as { entryOutput?: unknown }).entryOutput as Record<string, unknown>;
const status = (r: Req, who: string, from: string, to: string) =>
  (entry(r, "socialInsurance.healthStatus", { member: uid(who) }).months as { month: string; kind: string }[]).filter((x) => x.month >= from && x.month <= to).map((x) => x.kind);
const category = (r: Req, who: string, from: string, to: string) =>
  (entry(r, "pension.category", { member: uid(who) }).months as { month: string; category: string }[]).filter((x) => x.month >= from && x.month <= to).map((x) => x.category);
const spouse = (a: string, b: string) => ({ type: "spouse", a: uid(a), b: uid(b), marriage: "legal", from: null, to: null });
const rep = <T>(x: T, n: number): T[] => Array.from({ length: n }, () => x);

// 会社員の夫と、パートの妻（勤め先の社会保険なし）
const couple = (from: string, to: string | null, o: { annual?: number; health?: string } = {}) =>
  household({
    baseMonth: "2028-01",
    endYear: 2031,
    members: [member("f.h", "self", "1978-05", { sex: "male" }), member("f.w", "spouse", "1980-02")],
    relations: [spouse("f.h", "f.w")],
    periods: [
      period("f.ph", { member: "f.h", from: "2000-04", annual: 4800000, std: [410000, 410000] }),
      {
        id: uid("f.pw"),
        member: uid("f.w"),
        from: { at: from },
        to: to === null ? null : { at: to },
        type: "partTime",
        employer: { size: 10, weeklyHours: "25" },
        salary: { annual: box(o.annual ?? 2000000), bonus: box(0) },
        pensionCategory: "none",
        // 書かないとき: 勤め先の協会けんぽ（小さな勤め先・短い時間で適用されないので、家族の扶養か国民健康保険を判定で導く）
        healthInsurance: o.health === undefined ? { kind: "kyokaikenpo", insurer: "kyokaikenpo.13" } : { kind: o.health },
        employmentInsuranceCovered: false,
      },
    ],
  });

describe("R2-009 扶養・第3号の見込みは、その月の収入の状況が続くとしたらで見る", () => {
  it("2029-04 から年200万円で働く妻は、それまで（収入0）は被扶養者・第3号。働き始めた月から国民健康保険・第1号", () => {
    const req = couple("2029-04", null, { health: "national" });
    expect(status(req, "f.w", "2028-12", "2029-04")).toEqual([...rep("dependent", 4), "national"]); // 直す前は 2028-12 から national
    expect(category(req, "f.w", "2028-12", "2029-04")).toEqual([...rep("3", 4), "1"]); // 直す前は 2028-12 から第1号
  });

  it("年200万円のパートを 2029-03 に辞める妻は、辞めるまで国民健康保険・第1号、辞めた翌月から被扶養者・第3号", () => {
    const req = couple("2020-04", "2029-03", { health: "national" });
    expect(status(req, "f.w", "2028-09", "2029-04")).toEqual([...rep("national", 7), "dependent"]);
    expect(category(req, "f.w", "2028-09", "2029-04")).toEqual([...rep("1", 7), "3"]); // 直す前は 2028-09 から第3号
  });

  it("勤め先の健康保険を書いた（適用されない）期間でも同じ（判定で導く）: 働き始めた月から外れ、辞めた翌月から入る", () => {
    const start = couple("2029-04", null);
    expect(status(start, "f.w", "2029-03", "2029-04")).toEqual(["dependent", "national"]);
    expect(category(start, "f.w", "2029-03", "2029-04")).toEqual(["3", "1"]);
    const quit = couple("2020-04", "2029-03");
    expect(status(quit, "f.w", "2029-03", "2029-04")).toEqual(["national", "dependent"]);
    expect(category(quit, "f.w", "2029-03", "2029-04")).toEqual(["1", "3"]);
  });

  it("第3号は健康保険の種類が扶養の月だけ: 収入が基準の未満でも、国民健康保険と書いた期間は第1号", () => {
    const req = couple("2020-04", null, { annual: 1000000, health: "national" });
    expect(status(req, "f.w", "2028-01", "2028-12")).toEqual(rep("national", 12));
    expect(category(req, "f.w", "2028-01", "2028-12")).toEqual(rep("1", 12)); // 直す前は第3号
  });

  it("年金は受け始めた月から見込みに入る（受ける前の月は、先の年金で扶養から外さない）", () => {
    // 60歳の妻（会社員の夫の扶養）が 2029-07 から年200万円の老齢年金を受ける（stub）
    const req = household({
      baseMonth: "2028-01",
      endYear: 2031,
      members: [member("g.h", "self", "1970-05", { sex: "male" }), member("g.w", "spouse", "1964-06")],
      relations: [spouse("g.h", "g.w")],
      periods: [period("g.ph", { member: "g.h", from: "1995-04", annual: 6000000, std: [500000, 500000] })],
    });
    const months = Array.from({ length: 48 }, (_, k) => `${2028 + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`);
    const oldAge = (i: unknown) =>
      (i as { member: string }).member === uid("g.w")
        ? { flows: [], payments: [], months: months.filter((m) => m >= "2029-07").map((month) => ({ month, basic: 2000000, employee: 0, special: 0, suspended: 0 })) }
        : { flows: [], payments: [], months: [] };
    const out = runEngine(req, packs(), { entry: { component: "socialInsurance.healthStatus", input: { member: uid("g.w") } }, stubs: { "pension.oldAge": oldAge } }) as { entryOutput?: unknown };
    const kinds = (out.entryOutput as { months: { month: string; kind: string }[] }).months.filter((x) => x.month >= "2029-05" && x.month <= "2029-08").map((x) => x.kind);
    // 直す前は、その月からの1年の年金の支払いで見ていた（受け始める1年前の月から外れる）
    expect(kinds).toEqual(["dependent", "dependent", "national", "national"]);
  });

  it("自分が任意継続に入っている月も、第2号の配偶者に扶養される形なら第3号（健康保険は任意継続のまま。0174 の追記）", () => {
    // 妻が 2028-03 に辞めて 2028-04 から自分の任意継続（収入0）。夫は会社員
    const req = household({
      baseMonth: "2028-01",
      endYear: 2031,
      members: [member("c.h", "self", "1978-05", { sex: "male" }), member("c.w", "spouse", "1980-02")],
      relations: [spouse("c.h", "c.w")],
      periods: [
        period("c.ph", { member: "c.h", from: "2000-04", annual: 4800000, std: [410000, 410000] }),
        period("c.pw", { member: "c.w", from: "2005-04", to: "2028-03", annual: 3600000, std: [300000, 300000] }),
        { id: uid("c.u"), member: uid("c.w"), from: { at: "2028-04" }, to: null, type: "unemployed", healthInsurance: { kind: "continuation" } },
      ],
    });
    expect(status(req, "c.w", "2028-03", "2028-05")).toEqual(["kyokaikenpo", "continuation", "continuation"]);
    expect(category(req, "c.w", "2028-03", "2028-05")).toEqual(["2", "3", "3"]); // 直す前は第1号
    // 国民健康保険と書いた期間は第1号のまま
    const national = household({
      baseMonth: "2028-01",
      endYear: 2031,
      members: [member("c.h", "self", "1978-05", { sex: "male" }), member("c.w", "spouse", "1980-02")],
      relations: [spouse("c.h", "c.w")],
      periods: [
        period("c.ph", { member: "c.h", from: "2000-04", annual: 4800000, std: [410000, 410000] }),
        { id: uid("c.u"), member: uid("c.w"), from: { at: "2020-04" }, to: null, type: "unemployed", healthInsurance: { kind: "national" } },
      ],
    });
    expect(category(national, "c.w", "2028-04", "2028-05")).toEqual(["1", "1"]);
  });

  it("基準の未満のパート（年100万円）は、働いていても被扶養者・第3号のまま", () => {
    const req = couple("2028-06", null, { annual: 1000000 });
    expect(status(req, "f.w", "2028-05", "2028-07")).toEqual(rep("dependent", 3));
    expect(category(req, "f.w", "2028-05", "2028-07")).toEqual(rep("3", 3));
  });
});

describe("住民税の非課税: 合計所得金額135万円以下のひとり親・寡婦（地方税法295条1項2号）", () => {
  const exemption = (req: Req, who: string, fiscalYear: number) => entry(req, "residentTax.exemption", { member: uid(who), fiscalYear }) as { perCapitaExempt: boolean; incomeLevyExempt: boolean };
  const total = (req: Req, who: string, year: number) => (entry(req, "tax.totalIncome", { member: uid(who), year }) as { total: number }).total;
  const single = (o: { sex: string; marital: string; annual: number; child: boolean }) =>
    household({
      baseMonth: "2027-01",
      endYear: 2030,
      members: [
        member("rt.p", "self", "1988-05", { sex: o.sex, maritalStatus: o.marital }),
        ...(o.child ? [member("rt.c", "child", "2018-04")] : []),
      ],
      periods: [period("rt.pp", { member: "rt.p", from: "2015-04", annual: o.annual, std: [150000, 150000] })],
    });

  it("ひとり親（離婚・子1人）で合計所得金額が135万円以下: 均等割・所得割とも非課税（扶養の人数の基準では課税になる所得）", () => {
    const req = single({ sex: "female", marital: "divorced", annual: 2000000, child: true });
    const t = total(req, "rt.p", 2027);
    // 人数の基準（35万円×2＋10万円＋21万円＝101万円）を超え、135万円以下
    expect(t).toBeGreaterThan(1010000);
    expect(t).toBeLessThanOrEqual(1350000);
    expect(exemption(req, "rt.p", 2028)).toMatchObject({ perCapitaExempt: true, incomeLevyExempt: true }); // 直す前はどちらも false
  });

  it("ひとり親の父（未婚・子1人）も同じ", () => {
    const req = single({ sex: "male", marital: "unmarried", annual: 2000000, child: true });
    expect(exemption(req, "rt.p", 2028)).toMatchObject({ perCapitaExempt: true, incomeLevyExempt: true });
  });

  it("寡婦（死別・子なし）で合計所得金額が135万円以下: 非課税", () => {
    const req = single({ sex: "female", marital: "bereaved", annual: 1900000, child: false });
    const t = total(req, "rt.p", 2027);
    expect(t).toBeGreaterThan(450000);
    expect(t).toBeLessThanOrEqual(1350000);
    expect(exemption(req, "rt.p", 2028)).toMatchObject({ perCapitaExempt: true, incomeLevyExempt: true });
  });

  it("寡婦にもひとり親にも当たらない人（死別の男性・子なし）は、135万円以下でも人数の基準で判定する（課税）", () => {
    const req = single({ sex: "male", marital: "bereaved", annual: 1900000, child: false });
    expect(exemption(req, "rt.p", 2028)).toMatchObject({ perCapitaExempt: false, incomeLevyExempt: false });
  });

  it("ひとり親でも合計所得金額が135万円を超えれば、この決まりでは非課税にしない", () => {
    const req = single({ sex: "female", marital: "divorced", annual: 2300000, child: true });
    expect(total(req, "rt.p", 2027)).toBeGreaterThan(1350000);
    expect(exemption(req, "rt.p", 2028)).toMatchObject({ perCapitaExempt: false, incomeLevyExempt: false });
  });
});
