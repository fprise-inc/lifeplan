// 日付の書き方（0241。app/src/dates.ts）: 一覧は「2026/11/21 01:54」、文の中は「2026年11月21日」。
// 境目（1桁の月日時分・年の変わり目・うるう日・深夜0時台・日だけの文字・時差・読めない文字）と、前の書き方と同じ日・同じ時刻を指すことを確かめる。
// 端末の時差が違っても通ること（TZ=UTC・TZ=Asia/Tokyo で流す。このファイルの中でも時差を切り替えて確かめる）
import { afterEach, describe, expect, it } from "vitest";
import { listDate, listDateTime, listDateTimeWritten, listDateWritten, proseDate, proseDateTime, proseDateTimeWritten, proseDateWritten } from "../src/dates.ts";

const TZ0 = process.env.TZ;
const ZONES = ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"];

/** 端末の時差を切り替えて確かめる（切り替わらない環境では、その時差の確かめを飛ばす） */
function inZone(zone: string, run: () => void): void {
  process.env.TZ = zone;
  const hours = -new Date(2026, 0, 1).getTimezoneOffset() / 60;
  const want: Record<string, number> = { UTC: 0, "Asia/Tokyo": 9, "America/Los_Angeles": -8, "Pacific/Kiritimati": 14 };
  if (hours === want[zone]) run();
}

afterEach(() => {
  if (TZ0 === undefined) delete process.env.TZ;
  else process.env.TZ = TZ0;
});

describe("日付の書き方（一覧は 2026/11/21 01:54、文の中は 2026年11月21日）", () => {
  it("一覧は月・日・時・分を2桁にそろえ、文の中は年月日をゼロ埋めしない（時刻は2桁）", () => {
    const d = new Date(2026, 0, 5, 9, 3);
    expect(listDateTime(d)).toBe("2026/01/05 09:03");
    expect(listDate(d)).toBe("2026/01/05");
    expect(proseDate(d)).toBe("2026年1月5日");
    expect(proseDateTime(d)).toBe("2026年1月5日 09:03");
    expect(listDateTime(new Date(2026, 10, 21, 1, 54))).toBe("2026/11/21 01:54");
    expect(proseDate(new Date(2026, 10, 21, 1, 54))).toBe("2026年11月21日");
  });

  it("年の変わり目・うるう日・深夜0時台", () => {
    expect(listDateTime(new Date(2026, 11, 31, 23, 59))).toBe("2026/12/31 23:59");
    expect(listDateTime(new Date(2027, 0, 1, 0, 0))).toBe("2027/01/01 00:00");
    expect(proseDateTime(new Date(2026, 11, 31, 23, 59))).toBe("2026年12月31日 23:59");
    expect(proseDateTime(new Date(2027, 0, 1, 0, 0))).toBe("2027年1月1日 00:00");
    expect(listDate(new Date(2028, 1, 29, 12, 0))).toBe("2028/02/29");
    expect(proseDate("2028-02-29")).toBe("2028年2月29日");
    expect(listDateTime(new Date(2026, 10, 21, 0, 7))).toBe("2026/11/21 00:07");
    expect(listDateTimeWritten("2026-12-31T23:59:59+09:00")).toBe("2026/12/31 23:59");
    expect(proseDateTimeWritten("2027-01-01T00:00:00+09:00")).toBe("2027年1月1日 00:00");
  });

  it("日だけの文字は、どの時差の端末でも書いてある日のまま（日時の関数に渡しても、前の日にずれず、無い時刻を作らない）", () => {
    for (const zone of ZONES) {
      inZone(zone, () => {
        for (const day of ["2026-11-21", "2026-01-01", "2026-12-31", "2028-02-29"]) {
          const [y, m, d] = day.split("-").map(Number) as [number, number, number];
          const slash = day.replaceAll("-", "/");
          const kanji = `${y}年${m}月${d}日`;
          expect([zone, listDate(day), listDateTime(day), listDateWritten(day), listDateTimeWritten(day)]).toEqual([zone, slash, slash, slash, slash]);
          expect([zone, proseDate(day), proseDateTime(day), proseDateWritten(day), proseDateTimeWritten(day)]).toEqual([zone, kanji, kanji, kanji, kanji]);
        }
      });
    }
  });

  it("時刻つきの文字は端末の時刻で出す（UTC の文字は時差を直し、時差なしの文字はその数字のまま）", () => {
    inZone("Asia/Tokyo", () => {
      expect(listDateTime("2026-11-20T15:30:00Z")).toBe("2026/11/21 00:30");
      expect(listDate("2026-11-20T15:30:00Z")).toBe("2026/11/21");
      expect(proseDate("2026-11-20T15:30:00Z")).toBe("2026年11月21日");
      expect(proseDateTime("2026-12-31T15:00:00Z")).toBe("2027年1月1日 00:00");
      expect(listDateTime("2026-11-21T00:00:00Z")).toBe("2026/11/21 09:00");
    });
    inZone("UTC", () => {
      expect(listDateTime("2026-11-20T15:30:00Z")).toBe("2026/11/20 15:30");
      expect(listDate("2026-11-21T00:00:00Z")).toBe("2026/11/21");
      expect(proseDateTime("2026-12-31T15:00:00Z")).toBe("2026年12月31日 15:00");
    });
    inZone("America/Los_Angeles", () => {
      expect(listDateTime("2026-11-21T00:00:00Z")).toBe("2026/11/20 16:00");
      expect(listDate("2026-11-21T07:59:00Z")).toBe("2026/11/20");
      expect(listDate("2026-11-21T08:00:00Z")).toBe("2026/11/21");
    });
    for (const zone of ZONES) {
      inZone(zone, () => {
        // 時差なしの文字（端末の時刻として書いた文字）は、日も時刻もそのまま
        expect([zone, listDateTime("2026-11-21T00:00:00")]).toEqual([zone, "2026/11/21 00:00"]);
        expect([zone, proseDateTime("2026-01-05T09:03:00")]).toEqual([zone, "2026年1月5日 09:03"]);
        expect([zone, listDate("2026-11-21T23:59:59")]).toEqual([zone, "2026/11/21"]);
        // Date は端末の時刻で
        expect([zone, listDateTime(new Date(2026, 10, 21, 0, 0))]).toEqual([zone, "2026/11/21 00:00"]);
      });
    }
  });

  it("書いてある数字のまま読む関数は、どの時差の端末でも同じ（控えを作った時刻など）", () => {
    for (const zone of ZONES) {
      inZone(zone, () => {
        expect([zone, listDateTimeWritten("2027-04-12T14:03:00+09:00")]).toEqual([zone, "2027/04/12 14:03"]);
        expect([zone, listDateWritten("2027-04-12T00:03:00+09:00")]).toEqual([zone, "2027/04/12"]);
        expect([zone, proseDateWritten("2027-04-02T23:59:00-08:00")]).toEqual([zone, "2027年4月2日"]);
        expect([zone, proseDateTimeWritten("2026-11-20T01:03:00Z")]).toEqual([zone, "2026年11月20日 01:03"]);
      });
    }
  });

  it("読めない文字は渡した文字のまま（bad を渡せばその文字）。null・undefined は bad、無ければ空", () => {
    for (const f of [listDate, listDateTime, proseDate, proseDateTime, listDateWritten, listDateTimeWritten, proseDateWritten, proseDateTimeWritten]) {
      expect(f("x")).toBe("x");
      expect(f("")).toBe("");
      expect(f("x", "不明")).toBe("不明");
      expect(f("", "")).toBe("");
      expect(f(undefined)).toBe("");
      expect(f(null)).toBe("");
      expect(f(null, "—")).toBe("—");
      expect(f(undefined, "—")).toBe("—");
    }
    expect(listDateTime(new Date(Number.NaN))).toBe("");
    expect(proseDate(new Date(Number.NaN), "不明")).toBe("不明");
    // 日時でない文字を、日として読まない
    expect(listDateWritten("2026年11月21日")).toBe("2026年11月21日");
    expect(proseDateWritten("11/21")).toBe("11/21");
  });
});

// 前の書き方（この変更で外した、画面ごとの組み立て）。書き方だけが変わり、指す日・時刻は変わらないことを確かめるために残す
const p2 = (n: number) => String(n).padStart(2, "0");
const OLD = {
  /** 世帯の一覧・保存まわり・AI の日時（2026/10/18 14:03） */
  shortDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  },
  /** エラーの記録（2026-11-20 14:05） */
  localTime(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  },
  /** 発行した URL の日（2026/11/20） */
  day: (iso: string) => new Date(iso).toLocaleDateString("ja-JP"),
  /** 届いた書類の日（11/20）・日時（11/20 14:05） */
  shortDay: (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }),
  dayTime: (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  /** お客さまが送った日時（11月6日 22:15）・回答の期限（2026年12月5日） */
  sentAt: (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  longDay: (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" }),
  /** 控えの一覧（2027年4月12日 14:03）・プランの一覧（2027/4/12 14:03） */
  snapshot(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    return m === null ? iso : `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}`;
  },
  plan(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    return m === null ? iso : `${Number(m[1])}/${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`;
  },
  /** 面談の履歴・お知らせ（2026年11月9日） */
  kanjiDay(d: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    return m === null ? d : `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
  },
  /** 明細（2026/11/09）・日だけの切り出し（2026-11-09）・時刻までの切り出し（2026-11-09 14:05） */
  slashDay: (d: string) => d.replace(/-/gu, "/"),
  cutDay: (iso: string) => iso.slice(0, 10),
  cutTime: (iso: string) => iso.slice(0, 16).replace("T", " "),
};

/** 文字の中の数字の並び（「2026/01/05 09:03」も「2026年1月5日 09:03」も [2026, 1, 5, 9, 3]） */
const nums = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number);

describe("前の書き方と、同じ日・同じ時刻を指す（書き方だけが変わる）", () => {
  // 1桁の月日時分・年の変わり目（UTC でも日本でも年をまたぐ時刻）・うるう日・深夜0時台
  const INSTANTS = ["2026-01-05T00:03:00Z", "2026-11-20T05:05:00Z", "2026-11-20T15:30:00Z", "2026-12-31T14:59:00Z", "2026-12-31T15:00:00Z", "2026-12-31T23:59:59Z", "2027-01-01T00:00:00Z", "2028-02-28T15:00:00Z", "2028-02-29T12:00:00Z", "2026-11-06T13:15:00.000Z", "2027-04-12T14:03:00+09:00"];
  const WRITTEN = ["2027-04-12T14:03:00+09:00", "2026-01-05T09:03:07+09:00", "2026-12-31T23:59:59+09:00", "2027-01-01T00:00:00+09:00", "2028-02-29T00:07:00-08:00", "2026-11-20T01:03:00Z"];
  const DAYS = ["2026-11-09", "2026-01-05", "2026-12-31", "2027-01-01", "2028-02-29"];

  it("端末の時刻で出す所（世帯の一覧・保存まわり・AI・エラーの記録・発行した URL・届いた書類・お客さまのページ）", () => {
    for (const zone of ZONES) {
      inZone(zone, () => {
        for (const iso of INSTANTS) {
          const full = nums(OLD.shortDate(iso));
          expect([zone, iso, listDateTime(iso)]).toEqual([zone, iso, OLD.shortDate(iso)]);
          expect([zone, iso, nums(proseDateTime(iso))]).toEqual([zone, iso, full]);
          expect([zone, iso, nums(listDateTime(iso))]).toEqual([zone, iso, nums(OLD.localTime(iso))]);
          expect([zone, iso, nums(listDate(iso))]).toEqual([zone, iso, nums(OLD.day(iso))]);
          expect([zone, iso, nums(proseDate(iso))]).toEqual([zone, iso, nums(OLD.day(iso))]);
          expect([zone, iso, nums(proseDate(iso))]).toEqual([zone, iso, nums(OLD.longDay(iso))]);
          expect([zone, iso, proseDate(iso)]).toEqual([zone, iso, OLD.longDay(iso)]);
          // 年を書いていなかった所は、月日（と時刻）が同じ
          expect([zone, iso, nums(listDate(iso)).slice(1)]).toEqual([zone, iso, nums(OLD.shortDay(iso))]);
          expect([zone, iso, nums(listDateTime(iso)).slice(1)]).toEqual([zone, iso, nums(OLD.dayTime(iso))]);
          expect([zone, iso, nums(proseDateTime(iso)).slice(1)]).toEqual([zone, iso, nums(OLD.dayTime(iso))]);
          expect([zone, iso, nums(proseDateTime(iso)).slice(1)]).toEqual([zone, iso, nums(OLD.sentAt(iso))]);
        }
      });
    }
  });

  it("書いてある数字のまま出す所（控え・プランの一覧・明細の記録・日だけを切り出していた所）", () => {
    for (const zone of ZONES) {
      inZone(zone, () => {
        for (const iso of WRITTEN) {
          expect([zone, iso, nums(listDateTimeWritten(iso))]).toEqual([zone, iso, nums(OLD.snapshot(iso))]);
          expect([zone, iso, nums(listDateTimeWritten(iso))]).toEqual([zone, iso, nums(OLD.plan(iso))]);
          expect([zone, iso, nums(listDateTimeWritten(iso))]).toEqual([zone, iso, nums(OLD.cutTime(iso))]);
          expect([zone, iso, nums(proseDateTimeWritten(iso))]).toEqual([zone, iso, nums(OLD.cutTime(iso))]);
          expect([zone, iso, proseDateWritten(iso)]).toEqual([zone, iso, OLD.snapshot(iso).replace(/ .*$/, "")]);
          expect([zone, iso, nums(proseDateWritten(iso))]).toEqual([zone, iso, nums(OLD.cutDay(iso))]);
          expect([zone, iso, nums(listDateWritten(iso))]).toEqual([zone, iso, nums(OLD.cutDay(iso))]);
        }
      });
    }
  });

  it("日だけの文字（面談の日・お知らせの日・受付番号の日・明細の使った日・期限）", () => {
    for (const zone of ZONES) {
      inZone(zone, () => {
        for (const day of DAYS) {
          expect([zone, proseDateWritten(day)]).toEqual([zone, OLD.kanjiDay(day)]);
          expect([zone, proseDate(day)]).toEqual([zone, OLD.kanjiDay(day)]);
          expect([zone, listDateWritten(day)]).toEqual([zone, OLD.slashDay(day)]);
          expect([zone, nums(listDateWritten(day))]).toEqual([zone, nums(OLD.kanjiDay(day))]);
        }
      });
    }
  });
});
