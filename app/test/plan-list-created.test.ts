// プランの一覧の「作った日」（0241 の追記）: プランを作った時刻は UTC の文字で残している。一覧には端末の時刻で出す
// （数字をそのまま出すと、日本の端末では9時間前の時刻・0時〜8時台に作ったプランは前の日に見える）。
// 保存する値の形は変えない。作った時刻が無い・壊れている世帯ファイルの出し方は今までと同じ。
// 端末の時差が違っても通ること（TZ=UTC・TZ=Asia/Tokyo で流す。このファイルの中でも時差を切り替えて確かめる）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { listDateTimeWritten } from "../src/dates.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { createdText, PlanList } from "../src/workspace/plans/PlanList.tsx";
import { savePlan } from "../src/workspace/plans/plans.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyOf, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const TZ0 = process.env.TZ;
const noop = () => undefined;

/** 端末の時差を切り替えて確かめる（切り替わらない環境では、その時差の確かめを飛ばす） */
function inZone(zone: string, run: () => void): void {
  process.env.TZ = zone;
  const hours = -new Date(2026, 0, 1).getTimezoneOffset() / 60;
  const want: Record<string, number> = { UTC: 0, "Asia/Tokyo": 9, "America/Los_Angeles": -8 };
  if (hours === want[zone]) run();
}

afterEach(() => {
  if (TZ0 === undefined) delete process.env.TZ;
  else process.env.TZ = TZ0;
});

function withPlan(now: string): { wh: WorkingHousehold; cat: Catalog } {
  const id = "salariedCoupleTwoKids";
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh0 = fromRequest(req);
  const cat = buildCatalog(wh0, self.id, demoHousehold(id) ?? null);
  const { wh } = savePlan(wh0, cat, { name: "プランB 生活費を28万円に", base: null, values: { "lever:livingMonthly": 280000 }, now });
  return { wh, cat };
}

/** 一覧の「作った日」の欄の文字 */
function cell(wh: WorkingHousehold, cat: Catalog): string {
  const html = renderToString(h(PlanList, { wh, catalog: cat, letters: new Map(), band: [], onBand: noop, onEdit: noop, onReflect: noop, onClose: noop, stored: true }));
  const m = /<td class="num">([^<]*)<\/td>/.exec(html);
  if (m === null) throw new Error("作った日の欄がありません");
  return m[1] ?? "";
}

/** 作った時刻だけを書き換えた世帯（古い世帯ファイル・壊れた値の形を作る） */
function withCreatedAt(wh: WorkingHousehold, createdAt: unknown): WorkingHousehold {
  return { ...wh, proposals: wh.proposals.map((p) => ({ ...p, createdAt: createdAt as string })) };
}

describe("プランの一覧の「作った日」（端末の時刻で出す）", () => {
  it("日本の時間で 0時〜8時台に作ったプラン（UTC では前の日）は、日本の端末で作った日・作った時刻で出る", () => {
    inZone("Asia/Tokyo", () => {
      for (const [utc, shown] of [
        ["2026-11-18T15:00:00.000Z", "2026/11/19 00:00"],
        ["2026-11-18T15:30:00.000Z", "2026/11/19 00:30"],
        ["2026-11-18T23:59:59.000Z", "2026/11/19 08:59"],
        // 9時から後は、UTC でも同じ日（時刻は9時間進む）
        ["2026-11-19T00:00:00.000Z", "2026/11/19 09:00"],
        ["2026-11-19T12:14:00.000Z", "2026/11/19 21:14"],
        ["2026-11-18T14:59:00.000Z", "2026/11/18 23:59"],
        // 1桁の月・日
        ["2026-01-04T20:03:00.000Z", "2026/01/05 05:03"],
      ] as const) {
        const { wh, cat } = withPlan(utc);
        expect([utc, cell(wh, cat)]).toEqual([utc, shown]);
        // 保存する値の形は変えない（UTC の文字のまま）
        expect(wh.proposals[0]?.createdAt).toBe(utc);
      }
    });
  });

  it("年の変わり目・うるう日（UTC 12月31日 15:00 ＝ 日本 1月1日 0:00）", () => {
    inZone("Asia/Tokyo", () => {
      const at = (utc: string) => ((x) => cell(x.wh, x.cat))(withPlan(utc));
      expect(at("2026-12-31T14:59:00.000Z")).toBe("2026/12/31 23:59");
      expect(at("2026-12-31T15:00:00.000Z")).toBe("2027/01/01 00:00");
      expect(at("2026-12-31T23:59:00.000Z")).toBe("2027/01/01 08:59");
      expect(at("2027-01-01T00:00:00.000Z")).toBe("2027/01/01 09:00");
      expect(at("2028-02-28T15:00:00.000Z")).toBe("2028/02/29 00:00");
      expect(at("2028-02-29T15:00:00.000Z")).toBe("2028/03/01 00:00");
    });
  });

  it("端末の時差が違えば、その端末の時刻で出る（UTC の端末は数字のまま・時差が負の端末は前の日）", () => {
    const { wh, cat } = withPlan("2026-12-31T15:00:00.000Z");
    inZone("UTC", () => expect(cell(wh, cat)).toBe("2026/12/31 15:00"));
    inZone("Asia/Tokyo", () => expect(cell(wh, cat)).toBe("2027/01/01 00:00"));
    inZone("America/Los_Angeles", () => expect(cell(wh, cat)).toBe("2026/12/31 07:00"));
    // どの時差の端末でも、Date で読んだ端末の時刻と同じ
    for (const zone of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
      inZone(zone, () => {
        const d = new Date("2026-12-31T15:00:00.000Z");
        const p2 = (n: number) => String(n).padStart(2, "0");
        expect([zone, cell(wh, cat)]).toEqual([zone, `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`]);
      });
    }
  });

  it("作った時刻が無い・壊れている世帯ファイルの出し方は今までと同じ（どの時差の端末でも）", () => {
    const { wh, cat } = withPlan("2026-11-19T10:00:00.000Z");
    for (const zone of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
      inZone(zone, () => {
        // 無い（古い世帯ファイル）: 欄は空
        expect([zone, cell(withCreatedAt(wh, undefined), cat)]).toEqual([zone, ""]);
        expect([zone, cell(withCreatedAt(wh, null), cat)]).toEqual([zone, ""]);
        expect([zone, cell(withCreatedAt(wh, ""), cat)]).toEqual([zone, ""]);
        // 壊れている: 書いてある文字のまま（日時らしく読めてしまう文字も、日時に読み替えない）
        for (const bad of ["x", "2026", "1", "2026/11/19", "2026年11月19日", "2026-11-19T", "2026-13-45T99:99:00Z"]) expect([zone, bad, cell(withCreatedAt(wh, bad), cat)]).toEqual([zone, bad, listDateTimeWritten(bad)]);
        expect([zone, cell(withCreatedAt(wh, "x"), cat)]).toEqual([zone, "x"]);
        expect([zone, cell(withCreatedAt(wh, "2026"), cat)]).toEqual([zone, "2026"]);
        // 日だけの文字は、その日のまま（時差でずらさない・無い時刻を作らない）
        expect([zone, cell(withCreatedAt(wh, "2026-11-19"), cat)]).toEqual([zone, "2026/11/19"]);
        // 時差なしの文字（端末の時刻として書いた文字）は、その数字のまま
        expect([zone, cell(withCreatedAt(wh, "2026-11-19T00:30:00"), cat)]).toEqual([zone, "2026/11/19 00:30"]);
      });
    }
    expect(createdText(undefined as unknown as string)).toBe("");
  });

  it("世帯ファイルに書いて読み直しても、作った時刻の文字は変わらない（保存する値の形は UTC のまま）", () => {
    const utc = "2026-11-18T15:30:00.000Z";
    const { wh, cat } = withPlan(utc);
    const display = { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS };
    const back = fromBody(bodyOf({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display, carry: EMPTY_CARRY } as never)).wh;
    expect(back.proposals[0]?.createdAt).toBe(utc);
    inZone("Asia/Tokyo", () => expect(cell(back, cat)).toBe("2026/11/19 00:30"));
  });
});
