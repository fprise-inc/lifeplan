// UTC の文字で残している日時を、画面では端末の時刻で出す（0241 の追記 2026-11-23）:
// AI からのコードの候補の届いた日時（事務所の既定値）と、書類の読み取りの「同じファイルを前にも読んでいます（…）」。
// 境目（日本の時間の 0時〜8時台＝UTC では前の日・年の変わり目）と、値が無い・壊れているときの出し方が今までと同じことを確かめる。
// 端末の時差が違っても通ること（TZ=UTC・TZ=Asia/Tokyo で流す。このファイルの中でも時差を切り替えて確かめる）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { isDateTimeText, proseDateTimeWritten, proseDateWritten } from "../src/dates.ts";
import { readProposal } from "../src/workspace/documents/proposal.ts";
import { PROPOSAL_CONTRACT } from "../src/workspace/documents/types.ts";
import { docReview, readDayText } from "../src/workspace/documents/review.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { NO_FEATURES, receivedAtText, type FeatureCandidateView, type FeatureStatus } from "../src/workspace/office/featureCodes.ts";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const TZ0 = process.env.TZ;
const ZONES = ["UTC", "Asia/Tokyo", "America/Los_Angeles"];

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

/** 無い・壊れている値（日時として読めない文字。日時らしく読めてしまうだけの文字も入れる） */
const BROKEN = ["", "x", "2026", "1", "2026/11/21", "2026年11月21日", "2026-11-21", "2026-11-21T", "2026-13-45T99:99:00Z"];

describe("時刻つきの日時として読める文字か（isDateTimeText）", () => {
  it("ISO 8601 の日時だけを読む。日だけの文字・日時らしく読めてしまうだけの文字・無い値は読まない", () => {
    for (const ok of ["2026-11-21T05:05:00Z", "2026-11-21T05:05:00.000Z", "2026-11-21T14:05:00+09:00", "2026-11-21T14:05", "2026-12-31T15:00:00Z"]) expect([ok, isDateTimeText(ok)]).toEqual([ok, true]);
    for (const ng of [...BROKEN, null, undefined, 0, new Date()]) expect([ng, isDateTimeText(ng)]).toEqual([ng, false]);
  });
});

describe("AI からのコードの候補の届いた日時（端末の時刻で出す。「（UTC）」の添え書きは出さない）", () => {
  it("日本の時間の 0時〜8時台に届いた候補（UTC では前の日）・年の変わり目", () => {
    inZone("Asia/Tokyo", () => {
      expect(receivedAtText("2026-11-21T05:05:00Z")).toBe("2026年11月21日 14:05");
      expect(receivedAtText("2026-11-20T15:00:00Z")).toBe("2026年11月21日 00:00");
      expect(receivedAtText("2026-11-20T23:59:59Z")).toBe("2026年11月21日 08:59");
      expect(receivedAtText("2026-11-21T00:00:00Z")).toBe("2026年11月21日 09:00");
      expect(receivedAtText("2026-11-20T14:59:00Z")).toBe("2026年11月20日 23:59");
      expect(receivedAtText("2026-12-31T15:00:00Z")).toBe("2027年1月1日 00:00");
      expect(receivedAtText("2026-12-31T14:59:00Z")).toBe("2026年12月31日 23:59");
      expect(receivedAtText("2028-02-28T15:00:00Z")).toBe("2028年2月29日 00:00");
    });
    inZone("UTC", () => {
      expect(receivedAtText("2026-11-20T15:00:00Z")).toBe("2026年11月20日 15:00");
      expect(receivedAtText("2026-12-31T15:00:00Z")).toBe("2026年12月31日 15:00");
    });
    inZone("America/Los_Angeles", () => expect(receivedAtText("2026-12-31T15:00:00Z")).toBe("2026年12月31日 07:00"));
  });

  it("値が無い・壊れているときの出し方は今までと同じ（どの時差の端末でも）", () => {
    for (const zone of ZONES) {
      inZone(zone, () => {
        for (const bad of BROKEN) expect([zone, bad, receivedAtText(bad)]).toEqual([zone, bad, proseDateTimeWritten(bad)]);
        expect([zone, receivedAtText("x")]).toEqual([zone, "x"]);
        expect([zone, receivedAtText("")]).toEqual([zone, ""]);
        expect([zone, receivedAtText("2026")]).toEqual([zone, "2026"]);
        expect([zone, receivedAtText(undefined as unknown as string)]).toEqual([zone, ""]);
        expect([zone, receivedAtText(null as unknown as string)]).toEqual([zone, ""]);
      });
    }
  });

  it("画面: 「2026年11月21日 00:00 に届きました」と出し、「（UTC）」を出さない（同じ画面のほかの AI の候補と同じ書き方）", () => {
    const cand: FeatureCandidateView = { id: "c1", receivedAt: "2026-11-20T15:00:00Z", connector: "test-ai 1", ok: true, error: null, name: "見本 花子", features: ["combinedBs"], expires: null, before: [], after: ["combinedBs"], replaces: 0 };
    const features: FeatureStatus = { ...NO_FEATURES, candidates: [cand] };
    const panel = () =>
      renderToString(h(OfficeSettingsPanel, { value: { ...DEFAULT_OFFICE_SETTINGS, features: { combinedBs: true } }, onSave: async () => undefined, shared: false, onClose: () => undefined, features, onAddCode: async () => features, onRemoveCode: async () => features, onDismissNotice: async () => features, onCheckCodes: async () => features, onDecideCandidate: async () => features }));
    inZone("Asia/Tokyo", () => {
      const html = panel();
      expect(html).toContain("2026年11月21日 00:00 に届きました（AIのアプリの名乗り: test-ai 1。確かめられない参考の情報です）");
      expect(html).not.toContain("（UTC）");
      expect(html).not.toContain("2026年11月20日");
    });
    inZone("UTC", () => {
      const html = panel();
      expect(html).toContain("2026年11月20日 15:00 に届きました");
      expect(html).not.toContain("（UTC）");
    });
  });
});

describe("書類の読み取りの「同じファイルを前にも読んでいます（…）」（読んだ日を端末の時刻で出す）", () => {
  it("UTC の文字（AI が読んだ記録）: 日本の時間の 0時〜8時台に読んだ記録が、前の日にならない。年の変わり目", () => {
    inZone("Asia/Tokyo", () => {
      expect(readDayText("2026-11-20T22:30:00Z")).toBe("2026年11月21日");
      expect(readDayText("2026-11-20T15:00:00Z")).toBe("2026年11月21日");
      expect(readDayText("2026-11-20T23:59:59Z")).toBe("2026年11月21日");
      expect(readDayText("2026-11-20T14:59:59Z")).toBe("2026年11月20日");
      expect(readDayText("2026-11-21T00:00:00Z")).toBe("2026年11月21日");
      expect(readDayText("2026-12-31T15:00:00Z")).toBe("2027年1月1日");
      expect(readDayText("2026-12-31T14:59:00Z")).toBe("2026年12月31日");
    });
    inZone("UTC", () => {
      expect(readDayText("2026-11-20T22:30:00Z")).toBe("2026年11月20日");
      expect(readDayText("2026-12-31T15:00:00Z")).toBe("2026年12月31日");
    });
  });

  it("時差つきの文字（この PC で読んだ記録）: 書いた端末と同じ時差なら、書いてある日のまま（今までと同じ）。別の時差の端末では、その端末の日", () => {
    inZone("Asia/Tokyo", () => {
      expect(readDayText("2026-11-21T07:30:00+09:00")).toBe("2026年11月21日");
      expect(readDayText("2026-11-21T00:00:00+09:00")).toBe("2026年11月21日");
      expect(readDayText("2026-11-21T23:59:59+09:00")).toBe("2026年11月21日");
      expect(readDayText("2027-01-01T00:00:00+09:00")).toBe("2027年1月1日");
      // UTC の文字と時差つきの文字が同じ時刻を指すなら、同じ日
      expect(readDayText("2026-11-20T22:30:00Z")).toBe(readDayText("2026-11-21T07:30:00+09:00"));
    });
    inZone("UTC", () => {
      expect(readDayText("2026-11-21T07:30:00+09:00")).toBe("2026年11月20日");
      expect(readDayText("2026-11-20T22:30:00Z")).toBe(readDayText("2026-11-21T07:30:00+09:00"));
    });
  });

  it("値が無い・壊れているときの出し方は今までと同じ（どの時差の端末でも）", () => {
    for (const zone of ZONES) {
      inZone(zone, () => {
        for (const bad of BROKEN) expect([zone, bad, readDayText(bad)]).toEqual([zone, bad, proseDateWritten(bad)]);
        expect([zone, readDayText("x")]).toEqual([zone, "x"]);
        expect([zone, readDayText("2026")]).toEqual([zone, "2026"]);
        // 日だけの文字は、その日のまま（時差でずらさない）
        expect([zone, readDayText("2026-11-21")]).toEqual([zone, "2026年11月21日"]);
        expect([zone, readDayText(undefined as unknown as string)]).toEqual([zone, ""]);
      });
    }
  });

  it("書類の読み取りの確認画面の知らせ: 同じファイルを前に AI が読んだ記録（UTC の文字）の日が、日本の端末で正しい日で出る", () => {
    const wh: WorkingHousehold = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const members = roles(wh.request).map((r) => ({ key: r.key, id: r.member.id }));
    let n = 0;
    const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const raw = { contract: PROPOSAL_CONTRACT, docType: "insurancePolicy", holder: "self", values: [{ item: "insurance.premium", at: ["amount"], member: "holder", value: 16200, period: "once", source: { page: 1, where: "合計保険料", text: "月払保険料 16,200円" }, confidence: "high" }] };
    const read = (at: string, via: "ai" | "sample") => {
      const res = readProposal(raw, { via, at, newId, members });
      if (res.reading === null) throw new Error(JSON.stringify(res.issues));
      return { ...res.reading, file: { sha256: `sha256:${"a".repeat(64)}`, bytes: 1234 } };
    };
    // 前に AI が読んだ記録（日本の時間で 11月21日 07:30）と、いま読んだ記録
    const before = read("2026-11-20T22:30:00Z", "ai");
    const now = read("2026-11-25T01:00:00Z", "ai");
    inZone("Asia/Tokyo", () => {
      const notices = docReview(wh, now, {}, null, [before, now]).notices;
      expect(notices).toContain("同じファイルを前にも読んでいます（2026年11月21日）。");
      expect(notices.join("")).not.toContain("2026年11月20日");
    });
    inZone("UTC", () => expect(docReview(wh, now, {}, null, [before, now]).notices).toContain("同じファイルを前にも読んでいます（2026年11月20日）。"));
    // 同じ時に読んだ記録どうしは知らせない（今までと同じ）
    expect(docReview(wh, now, {}, null, [now]).notices.some((x) => x.includes("同じファイルを前にも"))).toBe(false);
  });
});
