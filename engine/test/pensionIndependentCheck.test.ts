// 計算の本体を別の目で点検して見つかった年金の計算の誤りの見張り（0167 の追記 2026-11-14）。期待値は制度の決まりから手で作った値
// - 記録の無い人の過去の月の報酬に、標準報酬月額の上限（65万円）と標準賞与額の1回の上限（150万円）を掛ける（厚生年金保険法20条・24条の4。
//   日本年金機構「厚生年金保険の保険料」 https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20150515-01.html）
// - 50歳以上のねんきん定期便の見込額は、作成時点の加入条件で60歳まで加入を続けたと仮定した額（日本年金機構「ねんきん定期便」の見方ガイド
//   （50歳以上）https://www.nenkin.go.jp/service/nenkinkiroku/torikumi/teikibin/teikibin.html）。60歳より前に厚生年金を離れた月の分を引く
// - 在職老齢年金の総報酬月額相当額は、その月の標準報酬月額＋その月以前1年間の標準賞与額の合計÷12（日本年金機構「在職老齢年金の計算方法」
//   https://www.nenkin.go.jp/service/jukyu/seido/roureinenkin/zaishoku/20150401-01.html）
// - 1986年3月以前の会社員の妻の期間（任意加入しなかった期間）は合算対象期間で、年金額に反映しない（日本年金機構「合算対象期間」
//   https://www.nenkin.go.jp/service/jukyu/seido/roureinenkin/jukyu-yoken/20140421-05.html）
// - 振替加算は、妻が65歳になった後に夫が240月以上の老齢厚生年金を受けられるようになったときは、そのときから（日本年金機構「加給年金額と
//   振替加算」の加算開始事由 https://www.nenkin.go.jp/service/jukyu/tetsuduki/rourei/jukyu/20140421-28.html）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { PensionMonth, RecordOutput } from "../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

const H = uid("pic.h");
const W = uid("pic.w");
const result = (req: EngineRequest, component: string, input: unknown) => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } });
const call = <T>(req: EngineRequest, component: string, input: unknown): T => result(req, component, input).entryOutput as T;
const notices = (r: { header: unknown }) => (r.header as { notices: { code: string; ids: string[] }[] }).notices;
const oldAge = (req: EngineRequest, who: string) => call<{ months: PensionMonth[] }>(req, "pension.oldAgeBase", { member: who }).months;
const monthOf = (months: PensionMonth[], ym: string) => months.find((x) => x.month === ym) as PensionMonth;

describe("記録の無い人の過去の月の報酬に、標準報酬の上限を掛ける（厚生年金保険法20条・24条の4）", () => {
  // 1961年6月生まれの男性、2004年4月〜2026年5月に勤務。計算基準月 2026年1月（2025年11月より前の月は給与の入力から近似する）
  const mk = (annual: number, bonus: number) =>
    household({ baseMonth: "2026-01", endYear: 2030, members: [member("pic.h", "self", "1961-06", { sex: "male" })], periods: [period("pic.p", { member: "pic.h", from: "2004-04", to: "2026-05", annual, bonus })] });
  const past = (req: EngineRequest) => call<RecordOutput>(req, "pension.record", { member: H }).months.filter((x) => x.month < "2025-11" && x.employee);
  const employeeAt65 = (req: EngineRequest) => monthOf(oldAge(req, H), "2026-08").employee;

  it("月給の年額1,500万円（月125万円）は、標準報酬月額の上限65万円の人と同じ額になる", () => {
    const high = mk(15000000, 0);
    const atCap = mk(7800000, 0);
    expect(past(high).every((x) => x.remuneration === 650000)).toBe(true);
    expect(past(atCap).every((x) => x.remuneration === 650000)).toBe(true);
    expect(employeeAt65(high)).toBe(employeeAt65(atCap));
  });

  it("賞与900万円（年2回で1回450万円）は、1回150万円の上限で年300万円とみなす: 2003年4月以後の月の報酬は (780万＋300万)÷12＝90万円", () => {
    const high = mk(7800000, 9000000);
    const atCap = mk(7800000, 3000000);
    expect(past(high).every((x) => x.remuneration === 900000)).toBe(true);
    expect(employeeAt65(high)).toBe(employeeAt65(atCap));
  });

  it("上限に当たらない人の額は変えない（月給の年額600万円＋賞与120万円 → (600万＋120万)÷12＝60万円）", () => {
    expect(past(mk(6000000, 1200000)).every((x) => x.remuneration === 600000)).toBe(true);
  });
});

describe("50歳以上のねんきん定期便の見込額は60歳まで今の条件で加入する前提: 60歳より前に厚生年金を離れた月の分を引く", () => {
  // 1971年5月生まれ（60歳に達する月は2031年5月）、1994年4月から厚生年金、月給50万円（年600万円・賞与なし）。定期便は2026年5月の作成
  const mk = (o: { from?: string; to: string }) => {
    const req = household({
      baseMonth: "2026-06",
      endYear: 2050,
      members: [member("pic.h", "self", "1971-05", { sex: "male" })],
      periods: [period("pic.p", { member: "pic.h", from: o.from ?? "1994-04", to: o.to, annual: 6000000, bonus: 0 })],
    });
    (req.input.household as unknown as Record<string, unknown>).pensionRecords = [
      { id: uid("pic.rec"), member: H, kind: "statementOver50", asOf: "2026-05", months: { basic: 421, employee: 386 }, amounts: { basic: box(847300), employee: box(1200000), transitional: box(400) } },
    ];
    return req;
  };

  it("60歳になる前の月（2031年4月）まで勤めれば、見込額はそのまま", () => {
    const r = result(mk({ to: "2031-04" }), "pension.record", { member: H });
    expect((r.entryOutput as RecordOutput).amounts.employee).toBe(1200000);
    expect(notices(r).some((n) => n.ids.includes("pension.record.statementOver50.beforeSixty"))).toBe(false);
  });

  it("57歳（2028年5月）で辞めると、勤めない35か月（2028年6月〜2031年4月）×50万円×5.481/1000＝95,918円を引く", () => {
    const req = mk({ to: "2028-05" });
    const r = result(req, "pension.record", { member: H });
    expect((r.entryOutput as RecordOutput).amounts.employee).toBe(1200000 - Math.round((500000 * 5.481 * 35) / 1000));
    expect(notices(r)).toContainEqual({ code: "N_ASSUMED", ids: ["pension.record", "pension.record.statementOver50.beforeSixty", H] });
    // 65歳からの老齢厚生年金も同じだけ少ない（経過的加算は加入月数から計算するので、ほぼ同じ）
    const full = monthOf(oldAge(mk({ to: "2031-04" }), H), "2036-06").employee;
    const early = monthOf(oldAge(req, H), "2036-06").employee;
    expect(full - early).toBeGreaterThan(95000);
    expect(full - early).toBeLessThan(97000);
  });

  it("作成時点で厚生年金に入っていない人が、その後60歳までに勤めた月は報酬比例に足す（見込額に入っていない）", () => {
    // 2026年5月の時点では勤めていない（1994年4月〜2026年3月の勤めの後、2027年4月から再び勤める）
    const req = mk({ to: "2026-03" });
    const h = req.input.household as unknown as { employmentPeriods: Record<string, unknown>[] };
    h.employmentPeriods.push(period("pic.p2", { member: "pic.h", from: "2027-04", to: "2031-04", annual: 6000000, bonus: 0 }));
    const rec = call<RecordOutput>(req, "pension.record", { member: H });
    expect(rec.amounts.employee).toBe(1200000);
    expect(rec.months.find((x) => x.accrues)?.month).toBe("2027-04");
  });
});

describe("在職老齢年金: その月以前1年間の標準賞与額に、計算基準年の前の年の賞与も入れる", () => {
  // 1960年6月生まれ、1983年4月から2028年3月まで勤務、月給40万円（標準報酬月額41万円）＋賞与120万円×2回（6月・12月）。計算基準月 2026年1月
  const req = household({
    baseMonth: "2026-01",
    endYear: 2032,
    members: [member("pic.h", "self", "1960-06", { sex: "male" })],
    periods: [period("pic.p", { member: "pic.h", from: "1983-04", to: "2028-03", annual: 4800000, bonus: 2400000 })],
  });
  const months = oldAge(req, H);

  it("2026年1〜3月（支給停止調整額51万円）: 2025年6月と12月の賞与（計240万円）を数え、停止（年額）は1,384,316円", () => {
    // 直す前は2025年6月の賞与120万円が入らず 784,316円（年額）だった。賞与の120万円÷12×12か月÷2＝60万円 多く止まる
    for (const ym of ["2025-12", "2026-01", "2026-02", "2026-03"]) expect(monthOf(months, ym).suspended, ym).toBe(784316 + 600000);
  });

  it("2026年4〜5月（支給停止調整額65万円）: 年額の停止は、賞与が同じ240万円の2026年6月と同じ", () => {
    const jun = monthOf(months, "2026-06").suspended;
    expect(jun).toBeGreaterThan(0);
    expect(monthOf(months, "2026-04").suspended).toBe(jun);
    expect(monthOf(months, "2026-05").suspended).toBe(jun);
  });
});

describe("1986年3月以前の会社員の妻の期間は合算対象期間（年金額に入れず、受給資格期間にだけ数える）", () => {
  // 夫1961年6月生まれ（1980年4月から勤務）、妻1962年3月生まれ（20歳の1982年3月から専業主婦）
  const req = household({
    baseMonth: "2026-01",
    endYear: 2030,
    members: [member("pic.h", "self", "1961-06", { sex: "male" }), member("pic.w", "spouse", "1962-03", { sex: "female" })],
    relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }],
    periods: [period("pic.p", { member: "pic.h", from: "1980-04", to: "2026-06", annual: 6000000, bonus: 0 })],
  });

  it("1982年3月〜1986年3月の49か月を老齢基礎年金の額から外す: 847,300×431/480＝760,805円＋振替加算16,335円＝777,140円", () => {
    const rec = call<RecordOutput>(req, "pension.record", { member: W });
    expect(rec.months.filter((x) => x.basic).length).toBe(431);
    expect(rec.months.some((x) => x.month < "1986-04")).toBe(false);
    expect(rec.qualifyingMonths).toBe(480);
    expect(monthOf(oldAge(req, W), "2027-04").basic).toBe(777140);
  });
});

describe("振替加算は、配偶者が240月以上の老齢厚生年金を受けられるようになった月から（妻が年上のとき）", () => {
  const mk = (wBirth: string) =>
    household({
      baseMonth: "2026-01",
      endYear: 2032,
      members: [member("pic.h", "self", "1961-06", { sex: "male" }), member("pic.w", "spouse", wBirth, { sex: "female" })],
      relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }],
      // 夫の勤めは1986年4月から（1986年3月以前の会社員の妻の期間〔合算対象期間〕を作らない）
      periods: [period("pic.p", { member: "pic.h", from: "1986-04", to: "2026-06", annual: 6000000, bonus: 0 })],
    });

  it("妻1958年3月生まれ（専業主婦）: 夫が65歳になった翌月の2026年7月から付く（2026年6月までは満額847,300円のまま）", () => {
    const w = oldAge(mk("1958-03"), W);
    for (const ym of ["2025-04", "2026-01", "2026-04", "2026-06"]) expect(monthOf(w, ym).basic, ym).toBe(ym < "2026-04" ? monthOf(w, "2025-04").basic : 847300);
    expect(monthOf(w, "2026-07").basic).toBe(889477);
  });

  it("妻が年下（1964年9月生まれ）なら今までどおり妻の65歳（2029年10月）から", () => {
    const w = oldAge(mk("1964-09"), W);
    expect(monthOf(w, "2029-10").basic).toBe(863635);
  });
});
