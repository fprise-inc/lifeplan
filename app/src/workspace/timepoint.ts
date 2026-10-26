// 時点（0003 の6）を年月に解く（画面の側）。エンジンの time/timepoint.ts・time/ageSwitch.ts と同じ決まりで解く
// （年齢は規則 ageSwitch つき、出来事は名前つきイベントの年月＋ずらし。出来事から出来事は1段だけたどり、循環は解けないとする）
import type { Household, Member, Timepoint } from "../engine/types.ts";

/** 年齢の切り替えの規則（0003 の4） */
export type AgeSwitch = "reachMonth" | "monthAfterReach" | "birthdayMonth" | "monthAfterBirthday" | "firstMarch31AfterReach" | "schoolYear";

const idx = (ym: string): number => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return y * 12 + (m - 1);
};
const ymOf = (i: number): string => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

/** 年月の通し番号（年×12＋月−1） */
export const monthIndex = idx;
/** 通し番号 → "YYYY-MM" */
export const monthText = ymOf;
/** 年月どうしの差（a − b の月数） */
export const monthsBetween = (a: string, b: string): number => idx(a) - idx(b);
export const shiftMonth = (ym: string, n: number): string => ymOf(idx(ym) + n);

/** 構成員がその年齢（月まで）に関わる月（engine/src/time/ageSwitch.ts の resolveAgeSwitch と同じ） */
export function ageSwitchMonth(m: Pick<Member, "birth">, years: number, months: number, rule: AgeSwitch = "reachMonth"): string {
  const birthday = idx(m.birth.birthYearMonth) + years * 12 + months;
  const reach = m.birth.bornOnFirst ? birthday - 1 : birthday;
  switch (rule) {
    case "reachMonth":
      return ymOf(reach);
    case "monthAfterReach":
      return ymOf(reach + 1);
    case "birthdayMonth":
      return ymOf(birthday);
    case "monthAfterBirthday":
      return ymOf(birthday + 1);
    case "firstMarch31AfterReach": {
      const y = Math.floor(reach / 12);
      return ymOf(reach % 12 <= 2 ? y * 12 + 2 : (y + 1) * 12 + 2);
    }
    case "schoolYear": {
      const y = Math.floor(birthday / 12);
      const mo = (birthday % 12) + 1;
      const same = mo < 4 || (mo === 4 && m.birth.bornOnFirst);
      return ymOf((same ? y : y + 1) * 12 + 3);
    }
  }
}

/** 時点を年月にする（年齢・出来事で決めた時点も解く）。解けなければ null */
export function resolveTimepoint(h: Pick<Household, "members" | "events">, t: Timepoint | null | undefined, stack: readonly string[] = []): string | null {
  if (t == null) return null;
  if (t.at !== undefined) return t.at;
  if (t.memberAge !== undefined) {
    const a = t.memberAge;
    const m = h.members.find((x) => x.id === a.member);
    return m === undefined ? null : ageSwitchMonth(m, a.years, a.months ?? 0, (a.ageSwitch ?? "reachMonth") as AgeSwitch);
  }
  if (t.event !== undefined) {
    if (stack.includes(t.event)) return null;
    const e = (h.events ?? []).find((x) => x.id === t.event);
    const base = resolveTimepoint(h, e?.at, [...stack, t.event]);
    return base === null ? null : shiftMonth(base, (t.offset?.years ?? 0) * 12 + (t.offset?.months ?? 0));
  }
  return null;
}
