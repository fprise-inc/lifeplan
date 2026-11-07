// 公式の資料から作った期待値との突き合わせで見つかった計算の誤りの見張り（独立の検算）。
// 期待値は、条文・国税庁・日本年金機構の資料から先に作った値（部品のコードからは作らない）
// - 所得金額調整控除の子ども・特別障害者等の分（租税特別措置法41条の3の11第1項・3項、国税庁 No.1411）
// - 給与所得の最低保障額のすぐ上の0円の区分と、660万円以上の1円未満の切り捨て（所得税法別表第五・措置法29条の4第2項）
// - 66歳になる前の受け取りは繰下げにならない（国民年金法28条1項・厚生年金保険法44条の3第1項）
// - 中高齢寡婦加算の40歳の判定は、死亡の当時か、40歳に達した当時に子がいたか（厚生年金保険法62条1項）
// - 見込額の記録でも、対象の生年月の人には特別支給の老齢厚生年金がある（厚生年金保険法附則8条の2）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { EmploymentIncomeOutput, PensionOutput, SurvivorPensionOutput, TotalIncomeOutput } from "../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = EngineRequest;
type Obj = Record<string, unknown>;
const A = uid("or.a");
const S = uid("or.s");
const at = (ym: string) => ({ at: ym });
const result = (req: Req, component: string, input: unknown) => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } });
const call = <T>(req: Req, component: string, input: unknown): T => result(req, component, input).entryOutput as T;
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  f((r.input as unknown as Obj).household as Obj, r.input as unknown as Obj);
  return r;
};
const first = (ym: string) => ({ birth: { birthYearMonth: ym, bornOnFirst: true } });

// ---------- 所得金額調整控除（子ども・特別障害者等） ----------
interface Kid {
  birth: string;
  salary?: number;
  outside?: boolean;
}
/** 本人（給与）・配偶者（給与）・子の世帯 */
function family(year: number, o: { self: number; spouse?: number; kids?: Kid[] }): Req {
  const members: Obj[] = [member("or.a", "self", "1980-01")];
  const relations: Obj[] = [];
  const periods: Obj[] = [period("or.pa", { member: "or.a", from: "2000-04", annual: o.self, std: [650000, 650000] })];
  if (o.spouse !== undefined) {
    members.push(member("or.s", "spouse", "1981-01"));
    relations.push({ type: "spouse", a: A, b: S, marriage: "legal", from: null, to: null });
    if (o.spouse > 0) periods.push(period("or.ps", { member: "or.s", from: "2000-04", annual: o.spouse, std: [650000, 650000] }));
  }
  (o.kids ?? []).forEach((k, i) => {
    members.push(member(`or.k${i}`, "child", k.birth));
    relations.push({ type: "parentOf", parent: A, child: uid(`or.k${i}`) });
    if (o.spouse !== undefined) relations.push({ type: "parentOf", parent: S, child: uid(`or.k${i}`) });
    if (k.salary !== undefined)
      periods.push(period(`or.pk${i}`, { member: `or.k${i}`, from: `${year}-01`, type: "partTime", annual: k.salary, pensionCategory: "none", healthInsurance: { kind: "dependent" }, extra: { employmentInsuranceCovered: false } }));
  });
  return household({ baseMonth: `${year}-01`, endYear: year + 1, members, relations, periods });
}
const total = (req: Req, who: string, year: number) => call<TotalIncomeOutput>(req, "tax.totalIncome", { member: who, year });

describe("所得金額調整控除: 給与収入850万円超で23歳未満の扶養親族がいる人（措置法41条の3の11第1項、国税庁 No.1411）", () => {
  it("給与1,000万円・11歳の子 → (1,000万−850万)×10%＝15万円を引き、給与所得 7,900,000円", () => {
    const t = total(family(2026, { self: 10000000, kids: [{ birth: "2015-05" }] }), A, 2026);
    expect(t.employment).toBe(7900000);
    expect(t.adjustment).toBe(150000);
  });
  it("給与1,200万円 → 収入は1,000万円が上限なので15万円、10,050,000−150,000＝9,900,000円", () => {
    expect(total(family(2026, { self: 12000000, kids: [{ birth: "2015-05" }] }), A, 2026).employment).toBe(9900000);
  });
  it("子がいなければ引かない（8,050,000円）", () => {
    const t = total(family(2026, { self: 10000000 }), A, 2026);
    expect(t.employment).toBe(8050000);
    expect(t.adjustment ?? 0).toBe(0);
  });
  it("給与850万円ちょうどは引かない（850万円を超える人だけ）", () => {
    const t = total(family(2026, { self: 8500000, kids: [{ birth: "2015-05" }] }), A, 2026);
    expect(t.adjustment ?? 0).toBe(0);
  });
  it("1円未満の端数は切り上げる（年末調整のしかたの例: 給与8,765,432円 → 26,543.2円 → 26,544円）", () => {
    expect(total(family(2026, { self: 8765432, kids: [{ birth: "2015-05" }] }), A, 2026).adjustment).toBe(26544);
  });
  it("扶養控除と違い、夫婦ともに給与850万円超なら、同じ子で夫婦の両方が引ける", () => {
    const req = family(2026, { self: 10000000, spouse: 9000000, kids: [{ birth: "2015-05" }] });
    expect(total(req, A, 2026).adjustment).toBe(150000);
    expect(total(req, S, 2026).adjustment).toBe(50000);
  });
  it("その年の12月31日に23歳に達している子（2003年5月生まれは2026年5月に23歳）は数えない。22歳の子（2004年5月生まれ）は数える", () => {
    expect(total(family(2026, { self: 10000000, kids: [{ birth: "2003-05" }] }), A, 2026).adjustment ?? 0).toBe(0);
    expect(total(family(2026, { self: 10000000, kids: [{ birth: "2004-05" }] }), A, 2026).adjustment).toBe(150000);
  });
  it("合計所得金額が扶養親族の上限（令和8年分 62万円）を超える子は扶養親族でないので数えない", () => {
    // 給与150万円 → 給与所得 76万円（＞62万円）
    expect(total(family(2026, { self: 10000000, kids: [{ birth: "2005-05", salary: 1500000 }] }), A, 2026).adjustment ?? 0).toBe(0);
    // 給与100万円 → 給与所得 26万円（≦62万円）
    expect(total(family(2026, { self: 10000000, kids: [{ birth: "2005-05", salary: 1000000 }] }), A, 2026).adjustment).toBe(150000);
  });
  it("給与と公的年金等の両方がある分（10万円まで）は、子ども等の分を引いた後の給与所得からさらに引く（同条2項）", () => {
    // 2項の計算は今までどおり。子ども等の分と合わせた額を adjustment に出す
    const t = total(family(2026, { self: 10000000, kids: [{ birth: "2015-05" }] }), A, 2026);
    expect(t.total).toBe(7900000);
  });
});

// ---------- 給与所得の端数 ----------
function employmentIncome(year: number, revenue: number): number {
  const req = household({ baseMonth: `${year}-01`, endYear: year, members: [member("or.a", "self", "1980-01")], periods: [period("or.p", { member: "or.a", from: "2000-04", annual: revenue, std: [300000, 300000] })] });
  return call<EmploymentIncomeOutput>(req, "tax.employmentIncome", { member: A, year }).income;
}

describe("給与所得の最低保障額のすぐ上は0円の区分（措置法29条の4第2項1号・所得税法別表第五）", () => {
  it("令和8年分: 69.1万円以上74.1万円未満は給与所得なし、74.1万円から収入−74万円", () => {
    expect(employmentIncome(2026, 740500)).toBe(0);
    expect(employmentIncome(2026, 740999)).toBe(0);
    expect(employmentIncome(2026, 741000)).toBe(1000);
    expect(employmentIncome(2026, 741001)).toBe(1001);
  });
  it("令和10年分: 691,000円未満は0円、691,000円から収入−69万円", () => {
    expect(employmentIncome(2028, 690500)).toBe(0);
    expect(employmentIncome(2028, 690999)).toBe(0);
    expect(employmentIncome(2028, 691000)).toBe(1000);
  });
  it("令和7年分: 651,000円未満は0円、651,000円から収入−65万円", () => {
    expect(employmentIncome(2025, 650999)).toBe(0);
    expect(employmentIncome(2025, 651000)).toBe(1000);
  });
});

describe("給与収入660万円以上の給与所得は、算式で求めた額の1円未満を切り捨てる（所得税法別表第五の備考）", () => {
  it("令和8年分 6,600,001円 → 6,600,001×80%−440,000＝4,840,000.8 → 4,840,000円", () => {
    expect(employmentIncome(2026, 6600001)).toBe(4840000);
  });
  it("年末調整のしかたの例: 7,654,321円 → ×90%−1,100,000＝5,788,888.9 → 5,788,888円", () => {
    expect(employmentIncome(2025, 7654321)).toBe(5788888);
  });
});

// ---------- 繰下げは66歳から ----------
/** 1961年5月生まれの男性（65歳に達した月の翌月は2026年6月）。見込額の記録で受け取りの始まりを決める */
function oldAge(o: { basic?: number; employee?: number; claimBasic?: string; claimEmployee?: string; endYear: number }): ReturnType<typeof result> {
  const req = edit(household({ baseMonth: "2026-04", endYear: o.endYear, members: [member("or.a", "self", "1961-05", { sex: "male" })] }), (h) => {
    h.pensionRecords = [
      {
        id: uid("or.rec"),
        member: A,
        kind: "projection",
        asOf: "2026-04",
        amounts: { basic: box(o.basic ?? 1200000), ...(o.employee !== undefined ? { employee: box(o.employee) } : {}) },
        claim: { ...(o.claimBasic !== undefined ? { basic: at(o.claimBasic) } : {}), ...(o.claimEmployee !== undefined ? { employee: at(o.claimEmployee) } : {}) },
      },
    ];
    h.residentTaxAssessments = [{ id: uid("or.rta"), member: A, fiscalYear: 2026, amount: box(100000) }];
  });
  return result(req, "pension.oldAge", { member: A });
}
const monthOf = (r: ReturnType<typeof result>, ym: string) => (r.entryOutput as PensionOutput).months.find((m) => m.month === ym);
const paidUntil = (r: ReturnType<typeof result>, part: "basic" | "employee", ym: string) =>
  (r.entryOutput as PensionOutput).payments.filter((p) => p.part === part && p.ym <= ym).reduce((s, p) => s + p.amount, 0);

describe("66歳になる前の受け取りは繰下げにならない（国民年金法28条1項・厚生年金保険法44条の3第1項）", () => {
  it("65歳11か月（2027年5月）に受け始めても増額は無く、65歳の翌月（2026年6月）の分から受け取る", () => {
    const r = oldAge({ basic: 1000000, claimBasic: "2027-05", endYear: 2028 });
    expect(monthOf(r, "2027-05")?.basic).toBe(1000000);
    expect(monthOf(r, "2026-06")?.basic).toBe(1000000);
    expect(notices(r)).toContainEqual({ code: "N_ASSUMED", ids: ["pension.oldAgeBase", "pension.deferral.beforeSixtySix", A] });
  });
  it("65歳1か月でも増額は無い（120万円のまま）", () => {
    expect(monthOf(oldAge({ claimBasic: "2026-07", endYear: 2027 }), "2026-07")?.basic).toBe(1200000);
  });
  it("2027年12月までの受け取りは、2026年6月〜2027年11月の18か月分（120万円×18/12＝180万円）", () => {
    expect(paidUntil(oldAge({ claimBasic: "2027-05", endYear: 2028 }), "basic", "2027-12")).toBe(1800000);
  });
  it("66歳0か月（2027年6月）からは繰下げ: 0.7%×12か月＝8.4%の増額（1,084,000円）", () => {
    const r = oldAge({ basic: 1000000, claimBasic: "2027-06", endYear: 2028 });
    expect(monthOf(r, "2027-06")?.basic).toBe(1084000);
    expect(monthOf(r, "2027-05")?.basic ?? 0).toBe(0);
  });
  it("老齢厚生年金も同じ: 65歳6か月に受け始めても増額は無く、65歳の翌月から", () => {
    const r = oldAge({ employee: 1000000, claimEmployee: "2026-12", endYear: 2027 });
    expect(monthOf(r, "2026-12")?.employee).toBe(1000000);
    expect(monthOf(r, "2026-06")?.employee).toBe(1000000);
  });
});

// ---------- 中高齢寡婦加算の40歳の判定 ----------
/** 会社員の夫（1980年5月生まれ・2003年4月から厚生年金）が亡くなる。妻と子の生年月、死亡の月、見る月 */
function widow(o: { wife: string; kids?: string[]; death: string; month: string }): SurvivorPensionOutput["months"][number] | undefined {
  const H = uid("or.h");
  const W = uid("or.w");
  const kids = (o.kids ?? []).map((b, i) => member(`or.k${i}`, "child", b));
  const req = household({
    baseMonth: o.death,
    endYear: Number(o.month.slice(0, 4)) + 1,
    members: [member("or.h", "self", "1980-05", { sex: "male" }), member("or.w", "spouse", o.wife), ...kids],
    relations: [
      { type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null },
      ...(o.kids ?? []).flatMap((_, i) => [
        { type: "parentOf", parent: H, child: uid(`or.k${i}`) },
        { type: "parentOf", parent: W, child: uid(`or.k${i}`) },
      ]),
    ],
    periods: [period("or.p", { member: "or.h", from: "2003-04", annual: 6000000, std: [500000, 500000] })],
    residentTaxAssessments: [{ id: uid("or.rta"), member: H, fiscalYear: 2026, amount: box(300000) }],
  });
  const r = edit(req, (_h, input) => (input.contingencies = [{ id: uid("or.cg"), kind: "death", member: H, occurs: at(o.death) }]));
  return call<SurvivorPensionOutput>(r, "pension.survivor", { member: W }).months.find((m) => m.month === o.month);
}

describe("中高齢寡婦加算は、夫の死亡の当時40歳以上か、40歳に達した当時に遺族基礎年金の対象の子がいた妻（厚生年金保険法62条1項）", () => {
  it("子なし・死亡の月（2026年10月）は39歳で、翌月に40歳 → 付かない", () => {
    expect(widow({ wife: "1986-11", death: "2026-10", month: "2026-11" })?.widowAddition ?? 0).toBe(0);
    expect(widow({ wife: "1986-11", death: "2026-10", month: "2027-06" })?.widowAddition ?? 0).toBe(0);
  });
  it("子なし・死亡の月に40歳に達した（日の前後が分からない）→ 付ける", () => {
    expect(widow({ wife: "1986-10", death: "2026-10", month: "2026-11" })?.widowAddition).toBe(635500);
  });
  it("子なし・死亡の当時45歳 → 付く", () => {
    expect(widow({ wife: "1981-05", death: "2026-10", month: "2026-11" })?.widowAddition).toBe(635500);
  });
  it("子あり: 遺族基礎年金が終わった翌月（2027年4月）に40歳に達した妻は、40歳に達した当時に子がいないので付かない", () => {
    expect(widow({ wife: "1987-04", kids: ["2008-05"], death: "2026-01", month: "2027-04" })?.widowAddition ?? 0).toBe(0);
  });
  it("子あり: 子がいる間（2027年3月）に40歳に達した妻は、遺族基礎年金が終わった翌月から付く", () => {
    expect(widow({ wife: "1987-03", kids: ["2008-05"], death: "2026-01", month: "2027-04" })?.widowAddition).toBe(635500);
  });
});

// ---------- 見込額の記録と特別支給の老齢厚生年金 ----------
/** 女性の見込額の記録（2026年4月時点）。その月の特別支給の老齢厚生年金の年額 */
function special(o: { birth: string; bornOnFirst?: boolean; month: string; kind?: string; months?: boolean }): number {
  const req = edit(household({ baseMonth: "2026-04", endYear: Number(o.month.slice(0, 4)) + 1, members: [member("or.a", "self", o.birth, { sex: "female", ...(o.bornOnFirst === true ? first(o.birth) : {}) })] }), (h) => {
    h.pensionRecords = [
      {
        id: uid("or.rec"),
        member: A,
        kind: o.kind ?? "projection",
        asOf: "2026-04",
        ...(o.months === false ? {} : { months: { basic: 480, employee: 300 } }),
        amounts: { basic: box(800000), employee: box(600000) },
      },
    ];
    h.residentTaxAssessments = [{ id: uid("or.rta"), member: A, fiscalYear: 2026, amount: box(100000) }];
  });
  return call<PensionOutput>(req, "pension.oldAge", { member: A }).months.find((x) => x.month === o.month)?.special ?? 0;
}

describe("見込額の記録でも、対象の生年月の女性には特別支給の老齢厚生年金がある（厚生年金保険法附則8条の2）", () => {
  it("1965年5月生まれ: 64歳に達した月の翌月（2029年6月）からあり、2029年5月は無い", () => {
    expect(special({ birth: "1965-05", month: "2029-06" })).toBeGreaterThan(0);
    expect(special({ birth: "1965-05", month: "2029-05" })).toBe(0);
  });
  it("1966年4月1日生まれ（昭和41年4月1日）: 2030年4月にある", () => {
    expect(special({ birth: "1966-04", bornOnFirst: true, month: "2030-04" })).toBeGreaterThan(0);
  });
  it("加入月数を入れていない見込額の記録でも、老齢厚生年金の見込額があれば受給の要件（1年以上）を満たすとみなす", () => {
    expect(special({ birth: "1965-05", month: "2029-06", months: false })).toBeGreaterThan(0);
  });
  it("50歳以上の定期便と同じ額になる（報酬比例部分は記録の老齢厚生年金の額から）", () => {
    expect(special({ birth: "1965-05", month: "2029-06" })).toBe(special({ birth: "1965-05", month: "2029-06", kind: "statementOver50" }));
  });
});
