// お金の3つの分け方（説明用。0032）のテスト（L1）: 表のマスから出す値の足し算・マイナスのとき・何年先までがプランの終わりを超えるとき・
// ふだんの支出とできごとの支出の分け方。最後にモデル世帯の計算の結果でも、足し算が合うことを確かめる
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { moneyThree, type MoneyThreeCell, type MoneyThreeRequest } from "../src/index.ts";
import { modelHousehold, realPacks } from "./helpers.ts";

const MAN = 10_000;
const req = (baseMonth = "2026-01", endYear = 2060, periodicExpenses: { id: string; everyYears: number }[] = []): MoneyThreeRequest => ({ input: { baseMonth, endYear, household: { periodicExpenses } } });

/** 毎年: 給与 600万円・税社保 100万円・基本生活費 300万円・住居費 60万円・保険料 24万円（収入の残り 116万円） */
function yearly(from: number, to: number): MoneyThreeCell[] {
  const out: MoneyThreeCell[] = [];
  for (let y = from; y <= to; y++) {
    out.push(
      { row: "cf.income.salary", year: y, amount: 600 * MAN },
      { row: "cf.taxSi.incomeTax", year: y, amount: 40 * MAN },
      { row: "cf.taxSi.pension", year: y, amount: 60 * MAN },
      { row: "cf.expense.living", year: y, amount: 300 * MAN },
      { row: "cf.expense.housing.rent", year: y, amount: 60 * MAN },
      { row: "cf.expense.insurance.life", year: y, amount: 24 * MAN },
    );
  }
  return out;
}

describe("お金の3つの分け方（0032）", () => {
  const table: MoneyThreeCell[] = [
    ...yearly(2026, 2060),
    // 2027: 車の買い替え 300万円 → 賄えない分 184万円
    { row: "cf.expense.lumpSum.car", year: 2027, amount: 300 * MAN, object: "car1" },
    // 2029: 高校の学費 80万円 → 収入の残りで賄える（0）
    { row: "cf.expense.education.school", year: 2029, amount: 80 * MAN, member: "c1" },
    // 2031: 大学の入学金・授業料 250万円 → 134万円
    { row: "cf.expense.education.entrance", year: 2031, amount: 100 * MAN, member: "c1" },
    { row: "cf.expense.education.school", year: 2031, amount: 150 * MAN, member: "c1" },
    // 2040: 11年先（10年の外）
    { row: "cf.expense.lumpSum.other", year: 2040, amount: 500 * MAN },
    // 数えない行（ゆとりの支出・取り崩しの計画で使うお金）と、器の間の移動
    { row: "cf.expense.living.surplus", year: 2026, amount: 50 * MAN },
    { row: "cf.expense.living.drawdown", year: 2028, amount: 999 * MAN },
    { row: "cf.transfer.nisa.tsumitate", year: 2027, amount: 120 * MAN },
  ];

  it("使う＋貯める＋増やす＝金融資産の合計（足し算が合う）", () => {
    const r = moneyThree(req(), table, { liquid: 1200 * MAN, financial: 2000 * MAN }, { months: 6, years: 10 });
    expect(r.spend.year).toBe(2026);
    expect(r.spend.annual).toBe(384 * MAN);
    expect(r.spend.monthly).toBe(32 * MAN);
    expect(r.spend.amount).toBe(192 * MAN);
    expect(r.spend.parts).toEqual([
      { kind: "living", monthly: 25 * MAN },
      { kind: "housing", monthly: 5 * MAN },
      { kind: "insurance", monthly: 2 * MAN },
      { kind: "other", monthly: 0 },
    ]);
    expect(r.save.fromYear).toBe(2027);
    expect(r.save.toYear).toBe(2036);
    expect(r.save.clipped).toBe(false);
    expect(r.save.rows.map((x) => [x.year, x.eventTotal, x.leftover, x.uncovered])).toEqual([
      [2027, 300 * MAN, 116 * MAN, 184 * MAN],
      [2029, 80 * MAN, 116 * MAN, 0],
      [2031, 250 * MAN, 116 * MAN, 134 * MAN],
    ]);
    expect(r.save.rows[2]?.parts).toEqual([{ kind: "education", row: "cf.expense.education.entrance", member: "c1", amount: 250 * MAN }]);
    expect(r.save.amount).toBe(318 * MAN);
    expect(r.need).toBe(510 * MAN);
    expect(r.grow).toBe(1490 * MAN);
    expect(r.spend.amount + r.save.amount + r.grow).toBe(r.placement.financial);
    expect(r.gap).toBe(690 * MAN);
    expect(r.status).toBe("over");
    expect(r.overFinancial).toBe(0);
  });

  it("黒字は次の年に繰り越さない（各年のプラスだけを足す）", () => {
    const r = moneyThree(req(), table, { liquid: 0, financial: 0 }, { months: 1, years: 10 });
    const byHand = r.save.rows.reduce((s, x) => s + Math.max(0, x.eventTotal - x.leftover), 0);
    expect(r.save.amount).toBe(byHand);
  });

  it("預金などが使う＋貯めるより少ないとき・金融資産でも足りないとき（増やすお金がマイナス）", () => {
    const short = moneyThree(req(), table, { liquid: 300 * MAN, financial: 1000 * MAN }, { months: 6, years: 10 });
    expect(short.status).toBe("short");
    expect(short.gap).toBe(-210 * MAN);
    expect(short.grow).toBe(490 * MAN);
    const neg = moneyThree(req(), table, { liquid: 100 * MAN, financial: 400 * MAN }, { months: 6, years: 10 });
    expect(neg.grow).toBe(-110 * MAN);
    expect(neg.overFinancial).toBe(110 * MAN);
    expect(neg.spend.amount + neg.save.amount + neg.grow).toBe(neg.placement.financial);
  });

  it("差がふだんの支出の1か月分より小さいときは「ほぼ同じ」", () => {
    expect(moneyThree(req(), table, { liquid: 510 * MAN + 31 * MAN, financial: 2000 * MAN }, { months: 6, years: 10 }).status).toBe("even");
    expect(moneyThree(req(), table, { liquid: 510 * MAN - 31 * MAN, financial: 2000 * MAN }, { months: 6, years: 10 }).status).toBe("even");
    expect(moneyThree(req(), table, { liquid: 510 * MAN + 32 * MAN, financial: 2000 * MAN }, { months: 6, years: 10 }).status).toBe("over");
    expect(moneyThree(req(), table, { liquid: 510 * MAN - 32 * MAN, financial: 2000 * MAN }, { months: 6, years: 10 }).status).toBe("short");
  });

  it("何年先までがプランの最後の年を超えるときは、最後の年までで止める", () => {
    const short = table.filter((c) => c.year <= 2030);
    const r = moneyThree(req("2026-01", 2030), short, { liquid: 0, financial: 1000 * MAN }, { months: 6, years: 10 });
    expect(r.save.fromYear).toBe(2027);
    expect(r.save.toYear).toBe(2030);
    expect(r.save.clipped).toBe(true);
    expect(r.save.rows.map((x) => x.year)).toEqual([2027, 2029]);
    expect(r.save.amount).toBe(184 * MAN);
    // 今の時点がプランの最後の年なら、数える年は無い
    const last = moneyThree(req("2030-01", 2030), short, { liquid: 0, financial: 0 }, { months: 6, years: 10 });
    expect(last.save.rows).toEqual([]);
    expect(last.save.amount).toBe(0);
    // 11年先まで数えると 2040年のできごとが入る
    expect(moneyThree(req(), table, { liquid: 0, financial: 0 }, { months: 6, years: 14 }).save.rows.map((x) => x.year)).toContain(2040);
  });

  it("基準月が年の途中なら、ふだんの支出は1年分そろう翌年の値で見る", () => {
    const part = [...table.filter((c) => c.year !== 2026), { row: "cf.expense.living", year: 2026, amount: 75 * MAN }];
    const r = moneyThree(req("2026-10"), part, { liquid: 0, financial: 0 }, { months: 6, years: 10 });
    expect(r.spend.year).toBe(2027);
    expect(r.spend.amount).toBe(192 * MAN);
    expect(r.save.fromYear).toBe(2027);
  });

  it("周期的な支出は、2年以上ごとならできごと・毎年ならふだんの支出", () => {
    const t: MoneyThreeCell[] = [
      ...yearly(2026, 2040),
      { row: "cf.expense.housing.maintenance", year: 2026, amount: 12 * MAN, object: "every1" },
      { row: "cf.expense.housing.maintenance", year: 2030, amount: 300 * MAN, object: "every10" },
      { row: "cf.expense.lumpSum.other", year: 2026, amount: 24 * MAN, object: "trip" },
    ];
    const r = moneyThree(req("2026-01", 2040, [{ id: "every1", everyYears: 1 }, { id: "every10", everyYears: 10 }, { id: "trip", everyYears: 1 }]), t, { liquid: 0, financial: 0 }, { months: 12, years: 10 });
    expect(r.spend.annual).toBe((384 + 12 + 24) * MAN);
    expect(r.spend.parts.find((p) => p.kind === "housing")?.monthly).toBe(6 * MAN);
    expect(r.spend.parts.find((p) => p.kind === "other")?.monthly).toBe(2 * MAN);
    expect(r.save.rows).toHaveLength(1);
    expect(r.save.rows[0]?.parts[0]).toMatchObject({ kind: "periodic", object: "every10", row: "cf.expense.housing.maintenance" });
  });

  it("何か月・何年の範囲の外は受け付けない", () => {
    expect(() => moneyThree(req(), table, { liquid: 0, financial: 0 }, { months: 0, years: 10 })).toThrow();
    expect(() => moneyThree(req(), table, { liquid: 0, financial: 0 }, { months: 25, years: 10 })).toThrow();
    expect(() => moneyThree(req(), table, { liquid: 0, financial: 0 }, { months: 6, years: 31 })).toThrow();
    expect(() => moneyThree(req(), table, { liquid: 0, financial: 0 }, { months: 1.5, years: 10 })).toThrow();
  });

  it("モデル世帯の計算の結果でも足し算が合い、計算の結果は変えない", () => {
    const rq = modelHousehold("educationTwoKids");
    const res = runEngine(rq, realPacks());
    const before = JSON.stringify(res.table);
    const cells = res.table as unknown as MoneyThreeCell[];
    const y0 = Number(rq.input.baseMonth.slice(0, 4));
    const financial = cells.filter((c) => c.row === "cf.balance.financial" && c.year === y0).reduce((s, c) => s + c.amount, 0);
    const r = moneyThree(rq as unknown as MoneyThreeRequest, cells, { liquid: financial, financial }, { months: 6, years: 10 });
    expect(r.spend.amount + r.save.amount + r.grow).toBe(financial);
    expect(r.save.rows.length).toBeGreaterThan(0);
    expect(r.save.rows.every((x) => x.parts.some((p) => p.kind === "education"))).toBe(true);
    for (const x of r.save.rows) expect(x.uncovered).toBe(Math.max(0, x.eventTotal - x.leftover));
    expect(JSON.stringify(res.table)).toBe(before);
  });
});
