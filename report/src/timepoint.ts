// 時点（0003 の6）を年月に解く（帳票の側）。計算エンジンの time/timepoint.ts・time/ageSwitch.ts と同じ決まりで、
// アプリの画面の側（app/src/workspace/timepoint.ts）とも同じ。
// 帳票の部品（build.ts・moneyThree.ts・rentalSale.ts）が時点を読むときは、年月（{at}）・構成員の年齢（{memberAge}。年齢の切り替えの規則つき）・
// 名前つきの出来事（{event}。出来事の年月＋ずらし）のどの形でも、すべてこの関数で解く。年月の形だけを読むと、アプリが標準で書く年齢の形の
// 時点（子の独立・保険料の払込の終わり・働き方の期間の終わり など）が帳票から消えるため（0168）

export function parseYm(s: string): { y: number; m: number } {
  const [y, m] = s.split("-").map(Number) as [number, number];
  return { y, m };
}

export const ym = (y: number, m: number): string => `${y}-${String(m).padStart(2, "0")}`;

export function addMonths(s: string, n: number): string {
  const { y, m } = parseYm(s);
  const i = y * 12 + (m - 1) + n;
  return ym(Math.floor(i / 12), (i % 12) + 1);
}

/** 時点を解くのに要る世帯の欄（エンジンの型でも、アプリの画面の型でも渡せるように、要るところだけ） */
export interface TimepointHousehold {
  members: readonly { id: string; birth: { birthYearMonth: string; bornOnFirst?: boolean } }[];
  events?: readonly { id: string; at: unknown }[];
}

type BirthOf = TimepointHousehold["members"][number];

/**
 * 構成員がその年齢（月まで）に関わる月（計算エンジンの time/ageSwitch.ts と同じ決まり。省略は達する月）。
 * 「○歳の4月」（schoolYear）・「○歳になった翌月」（monthAfterReach）なども、計算と同じ年月にする
 */
export function ageSwitchMonth(m: BirthOf, years: number, months: number, rule: string | undefined): string {
  const birthday = addMonths(m.birth.birthYearMonth, years * 12 + months);
  const reach = m.birth.bornOnFirst === true ? addMonths(birthday, -1) : birthday;
  const { y, m: mo } = parseYm(reach);
  switch (rule) {
    case "monthAfterReach":
      return addMonths(reach, 1);
    case "birthdayMonth":
      return birthday;
    case "monthAfterBirthday":
      return addMonths(birthday, 1);
    case "firstMarch31AfterReach":
      return ym(mo <= 3 ? y : y + 1, 3);
    case "schoolYear": {
      const b = parseYm(birthday);
      const same = b.m < 4 || (b.m === 4 && m.birth.bornOnFirst === true);
      return ym(same ? b.y : b.y + 1, 4);
    }
    case "schoolYearJanuary": {
      // その年齢になる年度の1月（子の成人式。0104）
      const b = parseYm(birthday);
      const same = b.m < 4 || (b.m === 4 && m.birth.bornOnFirst === true);
      return ym(same ? b.y : b.y + 1, 1);
    }
    default:
      return reach;
  }
}

/**
 * 時点を年月にする: 年月、構成員の年齢（年齢の切り替えの規則つき）、名前つきの出来事（の年月＋ずらし）。
 * 解けない時点（空・いない構成員・無い出来事・出来事の循環）は null
 */
export function monthOfTimepoint(h: TimepointHousehold, t: unknown, stack: readonly string[] = []): string | null {
  if (t === null || t === undefined || typeof t !== "object") return null;
  const at = (t as { at?: unknown }).at;
  if (typeof at === "string") return at;
  const ma = (t as { memberAge?: { member: string; years: number; months?: number; ageSwitch?: string } }).memberAge;
  if (ma !== undefined) {
    const m = h.members.find((x) => x.id === ma.member);
    return m === undefined ? null : ageSwitchMonth(m, ma.years, ma.months ?? 0, ma.ageSwitch);
  }
  const ev = t as { event?: string; offset?: { years?: number; months?: number } };
  if (ev.event === undefined || stack.includes(ev.event)) return null;
  const e = (h.events ?? []).find((x) => x.id === ev.event);
  const base = e === undefined ? null : monthOfTimepoint(h, e.at, [...stack, ev.event]);
  return base === null ? null : addMonths(base, (ev.offset?.years ?? 0) * 12 + (ev.offset?.months ?? 0));
}

/** 時点の年（解けなければ null） */
export function yearOfTimepoint(h: TimepointHousehold, t: unknown): number | null {
  const m = monthOfTimepoint(h, t);
  return m === null ? null : parseYm(m).y;
}
