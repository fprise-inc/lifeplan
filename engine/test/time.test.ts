// 0003: 時間の規約
import { describe, expect, it } from "vitest";
import { EngineError } from "../src/errors.ts";
import { resolveAgeSwitch, type AgeSwitch, type Birth } from "../src/time/ageSwitch.ts";
import { lookupFor, normalizeBasis } from "../src/time/basis.ts";
import { formatDate } from "../src/time/civil.ts";
import { formatYm, monthIndex, parseYm } from "../src/time/month.ts";
import { TimeResolver } from "../src/time/timepoint.ts";

const b = (ym: string, bornOnFirst = false): Birth => ({ birthYearMonth: ym, bornOnFirst });
const at = (birth: Birth, years: number, rule: AgeSwitch, months = 0) => formatYm(resolveAgeSwitch(birth, { years, months }, rule));

describe("月", () => {
  it("年月と通し番号を行き来する", () => {
    expect(parseYm("2031-04")).toBe(2031 * 12 + 3);
    expect(formatYm(parseYm("0999-12"))).toBe("0999-12");
    expect(() => parseYm("2031-13")).toThrow(EngineError);
    expect(() => parseYm("2031-4")).toThrow(EngineError);
  });
});

describe("年齢の切り替え（ageSwitch）", () => {
  it("reachMonth: 達する日（誕生日の前日）の月。1日生まれだけ前の月", () => {
    expect(at(b("1960-05"), 65, "reachMonth")).toBe("2025-05");
    expect(at(b("1960-05", true), 65, "reachMonth")).toBe("2025-04");
    expect(at(b("1960-01", true), 65, "reachMonth")).toBe("2024-12");
  });

  it("monthAfterReach: 達する日の翌月", () => {
    expect(at(b("1960-05"), 65, "monthAfterReach")).toBe("2025-06");
    expect(at(b("1960-05", true), 65, "monthAfterReach")).toBe("2025-05");
  });

  it("birthdayMonth: 誕生日当日の月（1日生まれでも誕生月）", () => {
    expect(at(b("1950-07"), 75, "birthdayMonth")).toBe("2025-07");
    expect(at(b("1950-07", true), 75, "birthdayMonth")).toBe("2025-07");
  });

  it("firstMarch31AfterReach: 達する日以後の最初の3月31日の月", () => {
    expect(at(b("2010-03"), 18, "firstMarch31AfterReach")).toBe("2028-03"); // 3月2日〜31日生まれ: 達する日が3月
    expect(at(b("2010-04", true), 18, "firstMarch31AfterReach")).toBe("2028-03"); // 4月1日生まれ: 達する日が3月31日
    expect(at(b("2010-04"), 18, "firstMarch31AfterReach")).toBe("2029-03"); // 4月2日以後生まれ
    expect(at(b("2010-12"), 18, "firstMarch31AfterReach")).toBe("2029-03");
    expect(at(b("2011-01", true), 18, "firstMarch31AfterReach")).toBe("2029-03"); // 達する日が2028年12月31日
  });

  it("schoolYear: 4月2日〜翌年4月1日生まれが同じ学年", () => {
    expect(at(b("2020-04", true), 6, "schoolYear")).toBe("2026-04"); // 4月1日生まれは早い学年
    expect(at(b("2020-04"), 6, "schoolYear")).toBe("2027-04"); // 4月2日以後
    expect(at(b("2021-03"), 6, "schoolYear")).toBe("2027-04");
    expect(at(b("2021-04", true), 6, "schoolYear")).toBe("2027-04");
    expect(at(b("2020-05"), 6, "schoolYear")).toBe("2027-04");
  });

  it("年齢の月まで指定できる", () => {
    expect(at(b("1960-05"), 64, "reachMonth", 6)).toBe("2024-11");
    expect(() => at(b("1960-05"), 64, "reachMonth", 12)).toThrow(EngineError);
  });
});

describe("時点と名前つきイベント", () => {
  const self = "35e5035f-61a4-412a-9671-486b3c8f6924";
  const e1 = "f14de8b8-75fc-45d6-844d-63dcfb20618e";
  const e2 = "0b8f6d0e-2a5e-4c4b-9f3e-1c2d3e4f5a6b";
  const members = [{ id: self, birth: b("1971-04", true) }];

  it("絶対・年齢・イベントからの時点を解決する", () => {
    const t = new TimeResolver(members, [
      { id: e1, kind: "retirement", at: { memberAge: { member: self, years: 60 } } },
      { id: e2, kind: "reemployment", at: { event: e1, offset: { years: 5, months: -1 } } },
    ]);
    const ev = t.resolveAllEvents();
    expect(formatYm(ev.get(e1) as never)).toBe("2031-03");
    expect(formatYm(ev.get(e2) as never)).toBe("2036-02");
    expect(formatYm(t.resolve({ at: "2030-01" }))).toBe("2030-01");
    expect(formatYm(t.resolve({ memberAge: { member: self, years: 65, ageSwitch: "monthAfterReach" } }))).toBe("2036-04");
  });

  it("イベントを動かすと、指している時点が一緒に動く", () => {
    const mk = (years: number) =>
      new TimeResolver(members, [
        { id: e1, kind: "retirement", at: { memberAge: { member: self, years } } },
        { id: e2, kind: "reemployment", at: { event: e1, offset: { months: 1 } } },
      ]).resolveAllEvents();
    expect((mk(65).get(e2) as number) - (mk(60).get(e2) as number)).toBe(60);
  });

  it("循環参照はエラー", () => {
    const t = new TimeResolver(members, [
      { id: e1, kind: "a", at: { event: e2 } },
      { id: e2, kind: "b", at: { event: e1 } },
    ]);
    expect(() => t.resolveAllEvents()).toThrow("E_TIMEPOINT_CYCLE");
  });

  it("知らない構成員・イベントはエラー", () => {
    const t = new TimeResolver(members, []);
    expect(() => t.resolve({ event: e1 })).toThrow("E_TIMEPOINT_UNKNOWN");
  });
});

describe("値を選ぶ基準（basis）", () => {
  const m = (ym: string) => parseYm(ym);
  const date = (basis: unknown, ym: string, anchor?: string) =>
    formatDate(lookupFor(normalizeBasis(basis), m(ym), anchor !== undefined ? { anchorMonth: m(anchor) } : {}).date);

  it("incomeYear はその暦年", () => {
    expect(date("incomeYear", "2031-11")).toBe("2031-01-01");
  });

  it("priorYearIncome は切り替え月の前後で、所得の年と値の年度が変わる", () => {
    const after = lookupFor(normalizeBasis("priorYearIncome"), m("2031-06"));
    const before = lookupFor(normalizeBasis("priorYearIncome"), m("2031-05"));
    expect([formatDate(after.date), after.incomeYear]).toEqual(["2031-06-01", 2030]);
    expect([formatDate(before.date), before.incomeYear]).toEqual(["2030-06-01", 2029]);
    // 保育料のような9月切り替え
    expect(date({ type: "priorYearIncome", switchMonth: 9 }, "2031-08")).toBe("2030-09-01");
  });

  it("month はその月、fiscalYear は年度の始まり", () => {
    expect(date("month", "2031-11")).toBe("2031-11-01");
    expect(date("fiscalYear", "2031-03")).toBe("2030-04-01");
    expect(date("fiscalYear", "2031-04")).toBe("2031-04-01");
  });

  it("anchor は出来事の月の値を使い続ける。省略できない", () => {
    expect(date({ type: "anchor", anchor: "moveIn" }, "2040-01", "2031-07")).toBe("2031-07-01");
    expect(() => normalizeBasis("anchor")).toThrow(EngineError);
    expect(() => lookupFor(normalizeBasis({ type: "anchor", anchor: "moveIn" }), m("2040-01"))).toThrow(EngineError);
  });

  it("文字列の省略形は既定値を使う", () => {
    expect(normalizeBasis("fiscalYear")).toEqual({ type: "fiscalYear", startMonth: 4 });
    expect(normalizeBasis("priorYearIncome")).toEqual({ type: "priorYearIncome", switchMonth: 6 });
    expect(monthIndex(2031, 1)).toBe(m("2031-01"));
  });
});
