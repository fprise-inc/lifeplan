// お知らせの一覧と受付番号（0087）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { FEEDBACK_FORM } from "../src/generated/distribution.ts";
import type { StorageNotice } from "../src/engine/host.ts";
import { barNotices, householdNoticeText, NOTICE_TODO, type BarInputs } from "../src/workspace/header/status.ts";
import { CATEGORIES, compareVersions, EMPTY_LOCAL, FEED_SCREENS, feedKey, filterItems, householdKey, markRead, needsAction, parseFeed, readLocal, sortItems, unreadCount, visibleFeed, type CenterItem } from "../src/workspace/notices/center.ts";
import { fpMenuGroups, fpMenuWithoutHousehold } from "../src/workspace/header/FpMenu.tsx";
import { HEARING_ARRIVAL_TODO } from "../src/workspace/hearing/bell.ts";
import { customCenterNotice, estimateCenterNotice } from "../src/workspace/office/customNotice.ts";
import { FeedbackPanel } from "../src/workspace/notices/FeedbackPanel.tsx";
import { NoticeCenter } from "../src/workspace/notices/NoticeCenter.tsx";
import { addReceipt, feedbackFormUrl, newReceiptCode, osName, RECEIPT_CHARS, RECEIPT_PATTERN, readReceiptInput } from "../src/workspace/notices/receipts.ts";

const APP = join(import.meta.dirname, "..");
const item = (over: Partial<CenterItem> = {}): CenterItem => ({ key: "k", category: "app", urgency: "normal", date: "2026-10-30", title: "題", body: "本文", household: null, receipts: [], action: null, todo: false, read: false, ...over });
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
    expect(out[0]).toMatchObject({ category: "household", urgency: "normal", target: "plans", text: "古い形式のプランの変更のうち 2件を読み替えられませんでした。プランの一覧の「要確認」で確認してください" });
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
    expect(html).toContain("2026/10/29");
    expect(html).toContain("data-feedback-input");
  });
});

describe("印は状態にだけ色を使い、要対応と参考を見分ける（0245）", () => {
  const noop = () => undefined;
  const action = { label: "保存先", run: noop };
  const css = readFileSync(join(APP, "src", "styles", "header.css"), "utf8");
  /** 1行に1つの決まり（セレクタ → 中身） */
  const rules = css.split("\n").flatMap((l) => {
    const m = /^\s*([^{}@/][^{}]*?)\s*\{([^{}]*)\}\s*$/.exec(l);
    return m === null ? [] : [{ selector: m[1] ?? "", body: m[2] ?? "" }];
  });
  const body = (selector: string) => rules.filter((r) => r.selector === selector).map((r) => r.body).join(" ");
  /** 一覧の1行（押すボタンの中身） */
  const row = (html: string, key: string) => new RegExp(`<button[^>]*data-notice="${key}"[^>]*>([\\s\\S]*?)</button>`).exec(html)?.[1] ?? "";

  it("要対応は種類ごとに決めた todo だけで決める（日付・開く画面からは推し量らない）。既読でも付けたまま・参考には付けない", () => {
    expect(needsAction(item({ todo: true }))).toBe(true);
    expect(needsAction(item({ todo: true, urgency: "critical" }))).toBe(true);
    expect(needsAction(item({ todo: true, read: true }))).toBe(true);
    expect(needsAction(item({ todo: true, urgency: "info" }))).toBe(false);
    // 今の状態の知らせ（日付なし）で開く画面があっても、種類が要対応でなければ付けない
    expect(needsAction(item({ date: null, action, todo: false }))).toBe(false);
  });

  const base: BarInputs = { opened: true, stored: true, save: { kind: "idle" }, paused: false, aiSharing: false, storage: [], showing: { recovery: false, office: false, storage: false }, presence: null, message: (c) => c };
  const sn = (kind: string, level: "alert" | "warn" | "info" = "warn") => ({ kind, level, scope: "office" as const, count: 1, name: "担当N", at: null, code: null });

  it("本体の保存先・事務所の共有の通知: 表のとおりに付く。表に無い種類には付けない", () => {
    const want: Record<string, boolean> = { needsRecovery: true, recoveryNotKept: true, unavailable: true, closed: true, removed: true, recoveryJoin: true, localHouseholds: true, syncCopies: true, pending: false, joinRequest: false };
    expect(NOTICE_TODO.storage).toEqual(want);
    const out = barNotices({ ...base, storage: [...Object.keys(want).map((k) => sn(k)), sn("someNewKind"), sn("constructor")] });
    expect(Object.fromEntries(out.map((x) => [x.id.replace(/:\d+$/, ""), x.todo]))).toEqual({ ...want, someNewKind: false, constructor: false });
  });

  it("見本番号を無くしたときに名前の後ろに番号を付けた知らせ（0247 の8）: 参考・要対応にしない・世帯の一覧を開く。文に前と後の名前", () => {
    const n = { kind: "sampleRenames", level: "info" as const, scope: "local" as const, count: 1, name: "「研修用」→「研修用（2）」", at: null, code: null };
    const [x] = barNotices({ ...base, storage: [n] });
    expect(x).toMatchObject({ urgency: "info", todo: false, target: "households", title: "同じ名前の見本の名前を直しました" });
    expect(x?.text).toContain("「研修用」→「研修用（2）」");
    expect(x?.text).toContain("「名前と項目を直す」");
  });

  it("世帯を開いたときの知らせ: 困ることが残る2つだけ要対応。済んだことの知らせ・表に無い種類には付けない", () => {
    expect(Object.entries(NOTICE_TODO.household).filter(([, v]) => v).map(([k]) => k).sort()).toEqual(["livingAllowance", "unresolvedDiffs"]);
    const kinds = Object.keys(NOTICE_TODO.household);
    // 表の種類はどれも文がある（表と文の種類がずれていない）
    for (const kind of kinds) expect(householdNoticeText({ kind, count: 1 }), kind).not.toBeNull();
    const out = barNotices({ ...base, household: [...kinds.map((kind, k) => ({ id: `n${k}`, kind, count: 1 })), { id: "x", kind: "someNewKind", count: 1 }] });
    expect(out.filter((x) => x.todo).map((x) => x.title).sort()).toEqual(["基本生活費の内訳の「仕送り」を移してください", "読み替えられなかったプランの変更があります"]);
    expect(out.find((x) => x.title === "ペットの費用の入れ先をまとめました")?.todo).toBe(false);
  });

  it("ほかの人が開いている・共有に加わる承認待ち・共有に加わる申請は知らせるだけ。届いたヒアリングの回答・書類は要対応", () => {
    expect(barNotices({ ...base, presence: "担当Bさんが開いています" }).map((x) => x.todo)).toEqual([false]);
    expect(HEARING_ARRIVAL_TODO).toBe(true);
  });

  it("事務所の既定値の知らせ: 承認の記録が無効・承認待ち・推定の値を使えなくなった は要対応。公式が新しくなった知らせは付けない", () => {
    const st = { state: "pending", fingerprint: "f", ledgerReset: true, updates: [{}], approved: { fingerprint: "a" } } as unknown as Parameters<typeof customCenterNotice>[0];
    expect(customCenterNotice(st).map((n) => [n.key.split(":")[2], n.todo])).toEqual([
      ["ledger", true],
      ["pending", true],
      ["updates", false],
    ]);
    expect(customCenterNotice({ ...(st as object), kind: "terms", ledgerReset: false } as unknown as Parameters<typeof customCenterNotice>[0]).map((n) => [n.key.split(":")[2], n.todo])).toEqual([
      ["pending", true],
      ["updates", false],
    ]);
    const src = readFileSync(join(APP, "src", "workspace", "office", "customNotice.ts"), "utf8");
    expect(src).toContain('todo: u.kind === "broken"');
    expect(estimateCenterNotice(undefined)).toEqual([]);
  });

  it("一覧: 状態の印（重大・要対応・参考・要望に対応）を言葉で先に、種類は色の無い言葉で後ろに。並びは重大 → 要対応 → 参考 → 配信元のお知らせ", () => {
    const items = [
      item({ key: "feed", date: "2026-10-30" }),
      item({ key: "info", category: "office", urgency: "info", date: null, action, todo: true }),
      item({ key: "state", category: "household", date: null, action }),
      item({ key: "todo", category: "household", date: null, action, todo: true }),
      item({ key: "crit", category: "data", urgency: "critical", date: "2026-10-01" }),
      item({ key: "rcpt", date: "2026-10-29", receipts: ["R-7K2Q"] }),
    ];
    const html = renderToString(h(NoticeCenter, { items, onRead: noop, initialOpen: true }));
    // 要対応は、先に並んでいた今の状態の知らせ（要対応でない）より上に来る
    expect([...html.matchAll(/data-notice="([^"]+)"/g)].map((m) => m[1])).toEqual(["crit", "todo", "state", "info", "feed", "rcpt"]);
    expect(row(html, "state")).not.toContain("data-notice-todo");
    const todo = row(html, "todo");
    expect(todo).toContain("data-notice-todo");
    expect(todo).toContain("要対応");
    expect(todo.indexOf("data-notice-todo")).toBeLessThan(todo.indexOf('data-notice-category="household"'));
    expect(row(html, "info")).toContain('data-notice-urgency="info"');
    expect(row(html, "info")).not.toContain("data-notice-todo");
    expect(row(html, "crit")).toContain('data-notice-urgency="critical"');
    expect(row(html, "crit")).not.toContain("data-notice-todo");
    // 知らせるだけのお知らせ（配信元・ふつう）は状態の印なし（種類と日付だけ）
    expect(row(html, "feed")).not.toMatch(/data-notice-(todo|urgency)/);
    expect(row(html, "rcpt")).toContain("あなたの要望に対応しました");
    // 種類の印に色の名前（c-app など）を付けない
    expect(html).not.toMatch(/\bc-(app|data|household|office)\b/);
  });

  it("種類には色を使わない（地・枠・色つきの四角なし。灰色の文字だけ）。色は状態の印だけ", () => {
    expect(rules.filter((r) => /\.c-(app|data|household|office)\b/.test(r.selector)).map((r) => r.selector)).toEqual([]);
    expect(rules.filter((r) => /\.nc-cat-pick[^,]*::before/.test(r.selector)).map((r) => r.selector)).toEqual([]);
    const cat = body(".nc-cat");
    expect(cat).toContain("color: var(--ink-2)");
    expect(cat).not.toMatch(/background|border/);
    // 状態の色: 重大＝赤・要対応＝黄土・参考＝灰・要望に対応＝緑（0240 の色の意味）
    expect(body(".u-critical.nc-urg")).toContain("background: var(--short)");
    expect(body(".nc-todo")).toContain("var(--est-bg)");
    expect(body(".nc-todo")).toContain("border-color: var(--est)");
    expect(body(".u-info.nc-urg")).toContain("border-color: var(--line)");
    expect(body(".nc-rcpt")).toContain("background: var(--good)");
  });

  it("種類の絞り込みで選んでいる方は藍の塗り（1つ選ぶ切り替えの決まり。0240）", () => {
    const html = renderToString(h(NoticeCenter, { items: [item()], onRead: noop, initialOpen: true }));
    expect(html).toMatch(/<button[^>]*aria-checked="true"[^>]*class="nc-cat-pick on"[^>]*data-notice-filter="all"/);
    expect(body(".nc-cat-pick.on")).toContain("background: var(--prop)");
    expect(body(".nc-cat-pick.on")).toContain("color: var(--on-fill)");
  });

  it("詳しい中身の「〜を開く」は主のボタン", () => {
    const src = readFileSync(join(APP, "src", "workspace", "notices", "NoticeCenter.tsx"), "utf8");
    expect(src).toContain('class="btn primary nc-go"');
  });

  it("「要望・不具合を送る」の入口は FP のメニューだけ。お知らせの一覧には、どんなときも出さない。FP のメニューは世帯を開いていないときも出す", () => {
    const html = renderToString(h(NoticeCenter, { items: [item()], onRead: noop, initialOpen: true }));
    expect(html).not.toContain("data-notice-feedback");
    expect(html).not.toContain("要望・不具合を送る");
    expect(renderToString(h(NoticeCenter, { items: [], onRead: noop, initialOpen: true }))).not.toContain("要望・不具合を送る");
    const center = readFileSync(join(APP, "src", "workspace", "notices", "NoticeCenter.tsx"), "utf8");
    expect(center).not.toMatch(/onFeedback|data-notice-feedback/);
    // FP のメニューには、世帯を開いていてもいなくても「ファイナンシアへ」の「要望・不具合を送る」がある
    const feedback = (groups: { id: string; items: { action: string; label: string }[] }[]) => groups.find((g) => g.id === "feedback")?.items.map((i) => [i.action, i.label]);
    expect(feedback(fpMenuGroups({ snapshots: 0, review: null, imports: null, office: null }))).toEqual([["feedback", "要望・不具合を送る"]]);
    expect(feedback(fpMenuWithoutHousehold(null))).toEqual([["feedback", "要望・不具合を送る"]]);
    // 画面は、お知らせに入口を渡さず、世帯を開いていないときも FP のメニューを描く
    const app = readFileSync(join(APP, "src", "workspace", "App.tsx"), "utf8");
    expect(app).not.toContain("onFeedback");
    expect(app).toMatch(/tools=\{\s*opened !== null \? \(\s*<>\s*<UndoButtons \/>\s*<FpMenu[\s\S]*?\) : \(\s*\/\/[^\n]*\n\s*<FpMenu groups=\{fpMenuWithoutHousehold\(fpOffice\)\} onPick=\{pickFpMenu\}/);
    expect(app).toContain('if (a === "feedback") return setFeedbackOpen(true);');
    expect(readFileSync(join(APP, "src", "styles", "header.css"), "utf8")).not.toContain(".nc-foot");
  });

  it("ベルの線の太さは、隣の ↶↷・FP のメニューと同じ 1.5px。左右の余白で、数の丸つきの幅を前と同じに", () => {
    const bell = body(".bell-btn");
    expect(bell).toContain("border: 1.5px solid var(--est)");
    expect(bell).toContain("padding: 0 6.5px");
    for (const selector of [".fpm-btn", ".undo-btn"]) expect(body(selector), selector).toMatch(/border: 1\.5px solid/);
  });
});
