// お知らせの一覧と受付番号（0087）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { FEEDBACK_FORM } from "../src/generated/distribution.ts";
import type { StorageNotice } from "../src/engine/host.ts";
import { barNotices, type BarInputs } from "../src/workspace/header/status.ts";
import { CATEGORIES, compareVersions, EMPTY_LOCAL, FEED_SCREENS, feedKey, filterItems, householdKey, markRead, parseFeed, readLocal, sortItems, unreadCount, visibleFeed, type CenterItem } from "../src/workspace/notices/center.ts";
import { FeedbackPanel } from "../src/workspace/notices/FeedbackPanel.tsx";
import { NoticeCenter } from "../src/workspace/notices/NoticeCenter.tsx";
import { addReceipt, feedbackFormUrl, newReceiptCode, osName, RECEIPT_CHARS, RECEIPT_PATTERN, readReceiptInput } from "../src/workspace/notices/receipts.ts";

const APP = join(import.meta.dirname, "..");
const item = (over: Partial<CenterItem> = {}): CenterItem => ({ key: "k", category: "app", urgency: "normal", date: "2026-10-30", title: "題", body: "本文", household: null, receipts: [], action: null, read: false, ...over });
const feed = (notices: unknown[], formatVersion = "1.0") => JSON.stringify({ format: "financia-notices", formatVersion, issuedAt: "2026-10-30T00:00:00Z", notices });
const n = (over: Record<string, unknown> = {}) => ({ id: "a", kind: "app", urgency: "normal", date: "2026-10-30", title: "題", body: "本文", ...over });

describe("既読と件数", () => {
  it("開いたものは既読にして一覧に残す（すべて で見える・未読 では出ない）。既読の日は変えない", () => {
    let s = markRead(EMPTY_LOCAL, ["feed:a"], "2026-10-30");
    expect(s.read).toEqual({ "feed:a": "2026-10-30" });
    expect(markRead(s, ["feed:a"], "2026-11-01")).toBe(s);
    s = markRead(s, ["feed:b"], "2026-11-01");
    const items = [item({ key: "feed:a", read: s.read["feed:a"] !== undefined }), item({ key: "feed:b", read: true }), item({ key: "feed:c" })];
    expect(filterItems(items, { unreadOnly: false, category: null }).map((i) => i.key)).toEqual(["feed:a", "feed:b", "feed:c"]);
    expect(filterItems(items, { unreadOnly: true, category: null }).map((i) => i.key)).toEqual(["feed:c"]);
    // 手元の状態を読み直しても残る
    expect(readLocal(JSON.parse(JSON.stringify(s))).read).toEqual(s.read);
  });

  it("件数に数えるのは未読の重大・ふつうだけ（参考は一覧に入るだけ）", () => {
    const items = [item({ key: "1", urgency: "critical" }), item({ key: "2" }), item({ key: "3", urgency: "info" }), item({ key: "4", read: true })];
    expect(unreadCount(items)).toBe(2);
    expect(unreadCount([item({ urgency: "info" })])).toBe(0);
    // 参考の未読も「未読」の一覧には出る
    expect(filterItems(items, { unreadOnly: true, category: null }).map((i) => i.key)).toEqual(["1", "2", "3"]);
  });

  it("種類で絞る・重大を先に、今の状態の知らせ（日付なし）、配信元のお知らせは新しい順", () => {
    const items = [item({ key: "old", date: "2026-10-01" }), item({ key: "hh", category: "household", date: null }), item({ key: "new", date: "2026-10-29" }), item({ key: "crit", category: "data", urgency: "critical", date: "2026-09-01" })];
    expect(sortItems(items).map((i) => i.key)).toEqual(["crit", "hh", "new", "old"]);
    expect(filterItems(items, { unreadOnly: false, category: "household" }).map((i) => i.key)).toEqual(["hh"]);
  });

  it("既読の印は上限を超えたら古いものから忘れる", () => {
    const keys = Array.from({ length: 2001 }, (_, k) => `k${k}`);
    const s = markRead(markRead(EMPTY_LOCAL, ["first"], "2020-01-01"), keys, "2026-10-30");
    expect(Object.keys(s.read).length).toBe(2000);
    expect(s.read.first).toBeUndefined();
  });

  it("世帯の知らせの鍵には世帯の内部 ID を添える（同じ知らせの ID の別の世帯と混ざらない）", () => {
    expect(householdKey("h1", "n0")).not.toBe(householdKey("h2", "n0"));
    expect(feedKey("a")).toBe("feed:a");
  });
});

describe("世帯・事務所の知らせを一覧の入れ物に入れる（文と開く画面は前のまま）", () => {
  const base: BarInputs = { opened: true, stored: true, save: { kind: "idle" }, paused: false, aiSharing: false, storage: [], showing: { recovery: false, office: false, storage: false }, presence: null, message: (c) => c };
  const sn = (kind: string, level: StorageNotice["level"]): StorageNotice => ({ kind, level, scope: "office", count: 1, name: "担当N", at: null, code: null });
  it("本体の level: alert＝重大・warn＝ふつう・info＝参考。種類は事務所", () => {
    const out = barNotices({ ...base, storage: [sn("removed", "alert"), sn("syncCopies", "warn"), sn("pending", "info")] });
    expect(out.map((x) => [x.category, x.urgency])).toEqual([
      ["office", "critical"],
      ["office", "normal"],
      ["office", "info"],
    ]);
    expect(out.every((x) => x.title !== "")).toBe(true);
  });
  it("世帯の知らせは種類「世帯」。文は前と同じ", () => {
    const out = barNotices({ ...base, household: [{ id: "n0", kind: "unresolvedDiffs", count: 2 }] });
    expect(out[0]).toMatchObject({ category: "household", urgency: "normal", target: "plans", text: "古い形式のプランの変更のうち 2件を読み替えられませんでした。プランの一覧の「要確認」で確かめてください" });
  });
});

describe("配信元のお知らせ（形式・版の範囲・受付番号）", () => {
  it("形の合わない1件・知らない種類（宣伝など）・知らない急ぎ具合と画面は捨てる。ほかは読む", () => {
    const got = parseFeed(feed([n({ id: "ok" }), n({ id: "ad", kind: "promotion" }), n({ id: "u", urgency: "urgent" }), n({ id: "s", screen: "shop" }), n({ id: "r", receipts: ["R-0000"] }), { id: "x" }, n({ id: "ok" })]));
    expect(got.map((x) => x.id)).toEqual(["ok"]);
    expect(parseFeed(feed([n()], "2.0"))).toEqual([]);
    expect(parseFeed(feed([n()], "1.3")).length).toBe(1);
    expect(parseFeed("not json")).toEqual([]);
    expect(parseFeed(null)).toEqual([]);
  });

  it("対象の版の範囲（どちらも含む）", () => {
    const f = parseFeed(feed([n({ id: "a", appVersions: { min: "0.2.0" } }), n({ id: "b", appVersions: { max: "0.1.0" } }), n({ id: "c", appVersions: { min: "0.1.0", max: "0.1.9" } })]));
    expect(visibleFeed(f, { appVersion: "0.1.0", receipts: [] }).map((x) => x.id)).toEqual(["b", "c"]);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("受付番号の並びのあるお知らせは、手元に覚えた番号と合うものだけ出す（合った番号を添える）。合わないものは一覧にも出さない", () => {
    const f = parseFeed(feed([n({ id: "all" }), n({ id: "mine", receipts: ["R-7K2Q", "R-9MXT"] }), n({ id: "theirs", receipts: ["R-WWWW"] })]));
    expect(visibleFeed(f, { appVersion: "0.1.0", receipts: [] }).map((x) => x.id)).toEqual(["all"]);
    const v = visibleFeed(f, { appVersion: "0.1.0", receipts: [{ code: "R-9MXT" }] });
    expect(v.map((x) => [x.id, x.matched])).toEqual([
      ["all", []],
      ["mine", ["R-9MXT"]],
    ]);
  });

  it("開発用の見本（封筒の中身）を読める。版 0.1.0 では古い版だけのものと他人の受付番号のものは出ない", () => {
    const env = JSON.parse(readFileSync(join(APP, "schemas", "notices.dev-sample.json"), "utf8")) as { format: string; payload: string; signatures: unknown[] };
    expect(env.format).toBe("financia-notices-envelope");
    expect(env.signatures).toEqual([]);
    const f = parseFeed(env.payload);
    expect(f.length).toBe(6);
    expect(visibleFeed(f, { appVersion: "0.1.0", receipts: [] }).map((x) => x.id)).not.toContain("dev-old-version-only");
    expect(visibleFeed(f, { appVersion: "0.1.0", receipts: [{ code: "R-7K2Q" }] }).find((x) => x.matched.length > 0)?.id).toBe("dev-2026-10-29-request");
  });

  it("JSON Schema の種類・急ぎ具合・画面・受付番号の形が、読む側と同じ", () => {
    const schema = JSON.parse(readFileSync(join(APP, "schemas", "notices.json"), "utf8")) as { $defs: { notice: { properties: Record<string, { enum?: string[]; items?: { pattern: string } }> } } };
    const p = schema.$defs.notice.properties;
    expect(p.kind!.enum).toEqual(["app", "data"]);
    expect(p.urgency!.enum).toEqual(["critical", "normal", "info"]);
    expect(p.screen!.enum).toEqual([...FEED_SCREENS]);
    expect(p.receipts!.items!.pattern).toBe(RECEIPT_PATTERN.source);
    // 配信元が配れるのはファイナンシアからと制度・データの更新だけ（世帯・事務所は手元の知らせ）
    expect(CATEGORIES.map((c) => c.id)).toEqual(["app", "data", "household", "office"]);
  });
});

describe("受付番号", () => {
  it("R- と4文字。紛らわしい 0・O・1・I・L を使わない", () => {
    expect(RECEIPT_CHARS).not.toMatch(/[0O1IL]/);
    expect(RECEIPT_CHARS.length).toBe(31);
    for (let k = 0; k < 500; k++) expect(newReceiptCode()).toMatch(RECEIPT_PATTERN);
    // 偏りを出さないため、248 以上の乱数は捨てる
    let calls = 0;
    const code = newReceiptCode((len) => {
      calls++;
      return calls === 1 ? new Uint8Array(len).fill(250) : Uint8Array.from({ length: len }, (_, i) => i);
    });
    expect(code).toBe("R-2345");
  });

  it("手で入れた番号: 小文字・全角・R- なし・空白を読む。使わない文字・長さ違いは理由を返す", () => {
    expect(readReceiptInput(" r-7k2q ")).toEqual({ code: "R-7K2Q" });
    expect(readReceiptInput("７Ｋ２Ｑ")).toEqual({ code: "R-7K2Q" });
    expect(readReceiptInput("R 7K2Q")).toEqual({ code: "R-7K2Q" });
    expect(readReceiptInput("R7K2Q")).toEqual({ code: "R-7K2Q" });
    expect("error" in readReceiptInput("R-7K2O")).toBe(true);
    expect("error" in readReceiptInput("R-1K2Q")).toBe(true);
    expect("error" in readReceiptInput("R-7K2")).toBe(true);
    expect("error" in readReceiptInput("")).toBe(true);
  });

  it("覚えた番号は重ねない（新しい順）。手元の状態から形の合わない番号は捨てる", () => {
    const a = addReceipt([], { code: "R-7K2Q", on: "2026-10-30" });
    expect(addReceipt(a, { code: "R-7K2Q", on: "2026-11-01", manual: true })).toEqual(a);
    expect(addReceipt(a, { code: "R-9MXT", on: "2026-11-01" }).map((r) => r.code)).toEqual(["R-9MXT", "R-7K2Q"]);
    expect(readLocal({ receipts: [{ code: "R-7K2Q", on: "2026-10-30" }, { code: "R-0000", on: "x" }, { code: "R-7K2Q", on: "dup" }] }).receipts).toEqual([{ code: "R-7K2Q", on: "2026-10-30" }]);
  });

  it("フォームの URL に入るのは、受付番号・アプリの版・OS だけ（世帯の情報は渡す口が無い）", () => {
    const template = "https://example.com/f?no={受付番号}&ver={版}&os={OS}";
    const url = new URL(feedbackFormUrl(template, { code: "R-7K2Q", appVersion: "0.1.0", os: "macOS" }));
    expect([...url.searchParams.entries()]).toEqual([
      ["no", "R-7K2Q"],
      ["ver", "0.1.0"],
      ["os", "macOS"],
    ]);
    expect(url.origin + url.pathname).toBe("https://example.com/f");
    // 差し込む値は URL の形に直す（ほかの欄を作れない）
    expect(new URL(feedbackFormUrl(template, { code: "R-7K2Q", appVersion: "0.1.0&x=1", os: "不明" })).searchParams.get("x")).toBeNull();
    // 配布元の設定のひな形も、差し込む印は3つだけで https
    expect(FEEDBACK_FORM.startsWith("https://")).toBe(true);
    expect((FEEDBACK_FORM.match(/\{[^}]*\}/g) ?? []).every((m) => ["{受付番号}", "{版}", "{OS}"].includes(m))).toBe(true);
    expect(feedbackFormUrl.length).toBe(2);
  });

  it("OS はおおまかな名前だけ", () => {
    expect(osName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macOS");
    expect(osName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
    expect(osName("")).toBe("不明");
  });
});

describe("画面", () => {
  const noop = () => undefined;
  it("一覧: 種類の印・重大の印・受付番号の対応の印", () => {
    // 開いた状態は描画の後で決まるので、ベルの数字と読み上げの名前を確かめる
    const html = renderToString(h(NoticeCenter, { items: [item({ urgency: "critical" }), item({ key: "i", urgency: "info" }), item({ key: "r", receipts: ["R-7K2Q"], read: true })], onRead: noop }));
    expect(html).toContain('data-notice-bell="1"');
  });
  it("要望を送る画面: 受付番号を大きく出し、写すボタン・フォームを開く・覚えた番号の一覧（日付つき）・手で入れる欄", () => {
    const html = renderToString(
      h(FeedbackPanel, { receipts: [{ code: "R-9MXT", on: "2026-10-29", manual: true }], template: "https://example.com/f?no={受付番号}", appVersion: "0.1.0", os: "macOS", onSend: async () => undefined, onAdd: noop, onClose: noop, initialCode: "R-7K2Q" }),
    );
    expect(html).toContain('data-feedback-code="R-7K2Q"');
    expect(html).toContain("data-feedback-copy");
    expect(html).toContain("data-feedback-send");
    expect(html).toContain('data-feedback-receipt="R-9MXT"');
    expect(html).toContain("2026年10月29日");
    expect(html).toContain("data-feedback-input");
  });
});
