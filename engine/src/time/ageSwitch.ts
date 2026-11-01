// 0003 の4: 年齢による切り替えは規則を宣言して使う。部品の中で年齢から月を計算しない
import { EngineError } from "../errors.ts";
import { addMonths, monthIndex, monthOf, parseYm, yearOf, type MonthIndex } from "./month.ts";

export type AgeSwitch = "reachMonth" | "monthAfterReach" | "birthdayMonth" | "monthAfterBirthday" | "firstMarch31AfterReach" | "schoolYear" | "schoolYearJanuary";

export const AGE_SWITCHES: readonly AgeSwitch[] = [
  "reachMonth",
  "monthAfterReach",
  "birthdayMonth",
  "monthAfterBirthday",
  "firstMarch31AfterReach",
  "schoolYear",
  "schoolYearJanuary",
];

/** 0012: 生年月日は「生年月＋1日生まれか」で持つ */
export interface Birth {
  readonly birthYearMonth: string;
  readonly bornOnFirst: boolean;
}

export interface Age {
  readonly years: number;
  readonly months?: number;
}

/**
 * 構成員がその年齢（月まで）に関わる月を、規則に従って解決する。
 * 達する日は誕生日の前日なので、1日生まれだけ達する日が前の月になる。
 */
export function resolveAgeSwitch(birth: Birth, age: Age, rule: AgeSwitch): MonthIndex {
  const months = age.months ?? 0;
  if (!Number.isInteger(age.years) || age.years < 0 || !Number.isInteger(months) || months < 0 || months > 11) {
    throw new EngineError("E_ARGUMENT", ["age"]);
  }
  const birthday = addMonths(parseYm(birth.birthYearMonth), age.years * 12 + months);
  const reach = birth.bornOnFirst ? addMonths(birthday, -1) : birthday;
  switch (rule) {
    case "reachMonth":
      return reach;
    case "monthAfterReach":
      return addMonths(reach, 1);
    case "birthdayMonth":
      return birthday;
    case "monthAfterBirthday":
      // 誕生日当日の属する月の翌月（0003 の追記 2026-10-09: 児童手当の3歳の切り替え。1日生まれも誕生月の翌月）
      return addMonths(birthday, 1);
    case "firstMarch31AfterReach": {
      // 達する日以後の最初の3月31日の月（その月まで該当）
      const y = yearOf(reach);
      return monthOf(reach) <= 3 ? monthIndex(y, 3) : monthIndex(y + 1, 3);
    }
    case "schoolYear": {
      // 4月2日〜翌年4月1日生まれを同じ学年とし、その年齢の誕生日以後の最初の4月1日（学年の始まり）
      const y = yearOf(birthday);
      const m = monthOf(birthday);
      const sameYear = m < 4 || (m === 4 && birth.bornOnFirst);
      return monthIndex(sameYear ? y : y + 1, 4);
    }
    case "schoolYearJanuary": {
      // その年齢になる年度（学年と同じく4月2日〜翌年4月1日生まれを同じ年度とする）の1月。schoolYear の月の3か月前
      // （子の成人式の月。0104。1〜3月生まれと4月1日生まれは、その年齢の誕生日の前の1月）
      const y = yearOf(birthday);
      const m = monthOf(birthday);
      const sameYear = m < 4 || (m === 4 && birth.bornOnFirst);
      return monthIndex(sameYear ? y : y + 1, 1);
    }
    default:
      throw new EngineError("E_ARGUMENT", ["ageSwitch"]);
  }
}
