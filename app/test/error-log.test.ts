// エラーの記録（0234）: 画面が本体に渡すのは種類・画面・操作・文だけで、本体が用意できる前のエラーも後で渡す。本体の命令の失敗は
// 命令の名前と文を残してから投げ直し、記録の命令そのものは記録しない。「要望・不具合を送る」の中の一覧（0件・まとめた回数・AI が読んだ回数）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: { cmd: string; args: unknown }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: unknown) => {
    calls.push({ cmd, args });
    if (cmd === "store_save") throw "E_STORE_CONFLICT";
    if (cmd === "error_log_get") throw "E_ERROR_LOG_DIR";
    return null;
  },
  isTauri: () => true,
}));

const { tauriHost } = await import("../src/engine/host.ts");
const log = await import("../src/workspace/notices/errorLog.ts");
const { FeedbackPanel } = await import("../src/workspace/notices/FeedbackPanel.tsx");

type Sent = Parameters<Parameters<typeof log.setErrorSink>[0] & object>[0];

describe("エラーの記録（0234）", () => {
  let sent: Sent[];
  beforeEach(() => {
    log.resetErrorLogForTest();
    sent = [];
    calls.length = 0;
  });
  afterEach(() => log.resetErrorLogForTest());

  it("本体が用意できる前のエラーは覚えておき（20件まで）、用意できたら画面の名前つきで渡す", async () => {
    for (let i = 0; i < 25; i++) log.recordError({ kind: "screen", action: "画面の処理", message: `TypeError ${i}` });
    log.setErrorSink(async (r) => void sent.push(r));
    expect(sent).toHaveLength(20);
    expect(sent[0]).toEqual({ kind: "screen", action: "画面の処理", message: "TypeError 0", place: "起動" });
    log.setErrorPlace(log.PLACE_OF_TAB["balance"]!);
    log.recordError({ kind: "calc", action: "計算", message: "E_HOST_MEMORY" });
    expect(sent.at(-1)).toEqual({ kind: "calc", action: "計算", message: "E_HOST_MEMORY", place: "資産と負債" });
    // 渡す欄はこの4つだけ（世帯の中身を渡す口は無い）
    expect(Object.keys(sent.at(-1)!).sort()).toEqual(["action", "kind", "message", "place"]);
  });

  it("記録に失敗しても、画面は止めない", () => {
    log.setErrorSink(async () => {
      throw new Error("E_ERROR_LOG_WRITE");
    });
    expect(() => log.recordError({ kind: "screen", action: "画面の処理", message: "x" })).not.toThrow();
  });

  it("本体の命令の失敗は、命令の名前と文を残してから投げ直す。記録の命令そのものは記録しない", async () => {
    log.setErrorSink(async (r) => void sent.push(r));
    log.setErrorPlace("入力");
    const host = tauriHost();
    await expect(host.store.save("hh-1", "{}", {} as never)).rejects.toBe("E_STORE_CONFLICT");
    expect(sent).toEqual([{ kind: "command", action: "世帯の保存（store_save）", message: "E_STORE_CONFLICT", place: "入力" }]);
    // 世帯の内部 ID・本文は文に入れない（命令の引数は記録に渡さない）
    expect(JSON.stringify(sent)).not.toContain("hh-1");
    await expect(host.errors!.get(540)).rejects.toBe("E_ERROR_LOG_DIR");
    expect(sent).toHaveLength(1);
    expect(calls.find((c) => c.cmd === "error_log_get")?.args).toEqual({ utcOffsetMinutes: 540 });
    // 成功した命令は記録しない
    await host.errors!.add({ kind: "screen", place: "結果", action: "画面の処理", message: "m" });
    expect(sent).toHaveLength(1);
    expect(calls.at(-1)).toEqual({ cmd: "error_log_add", args: { entry: { kind: "screen", place: "結果", action: "画面の処理", message: "m" } } });
  });

  it("投げられた物から文を作る（長さだけ切る。削るのは本体）・知らない命令は命令の名前だけ", () => {
    expect(log.messageOf("E_X")).toBe("E_X");
    expect(log.messageOf(new TypeError("Cannot read properties of undefined"))).toBe("TypeError: Cannot read properties of undefined");
    expect(log.messageOf({ message: "m" })).toBe("m");
    expect(log.messageOf(42)).toBe("42");
    expect(log.messageOf("x".repeat(5000))).toHaveLength(2000);
    expect(log.commandAction("store_open")).toBe("世帯を開く（store_open）");
    expect(log.commandAction("office_join")).toBe("本体の命令（office_join）");
    expect(log.localTime("2026-11-20T01:03:00Z")).toMatch(/^2026-11-2\d \d\d:03$/);
    expect(log.utcOffsetMinutes(new Date())).toBe(-new Date().getTimezoneOffset());
  });
});

describe("残さない決まった形の知らせ（0234 の追記）", () => {
  const app = { filename: "http://tauri.localhost/assets/index-abc.js", lineno: 12 };
  it("ResizeObserver の知らせ・出どころの分からない Script error.・拡張機能や WebView の内部・AbortError は残さない", () => {
    expect(log.isHarmlessWindowError({ ...app, message: "ResizeObserver loop completed with undelivered notifications." })).toBe(true);
    expect(log.isHarmlessWindowError({ ...app, message: "Uncaught ResizeObserver loop limit exceeded" })).toBe(true);
    expect(log.isHarmlessWindowError({ ...app, message: "", error: new Error("ResizeObserver loop limit exceeded") })).toBe(true);
    expect(log.isHarmlessWindowError({ message: "Script error.", filename: "", lineno: 0 })).toBe(true);
    for (const f of ["chrome-extension://abc/content.js", "moz-extension://x/a.js", "safari-web-extension://x/a.js", "webkit-masked-url://hidden/"]) {
      expect(log.isHarmlessWindowError({ message: "TypeError: x is undefined", filename: f, lineno: 3 })).toBe(true);
    }
    const abort = new DOMException("The operation was aborted.", "AbortError");
    expect(log.isHarmlessWindowError({ ...app, message: "AbortError", error: abort })).toBe(true);
    expect(log.isHarmlessRejection(abort)).toBe(true);
    expect(log.isHarmlessRejection(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(log.isHarmlessRejection("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
  });

  it("ふつうのエラーは残す（形が少しでも違えば除かない）", () => {
    expect(log.isHarmlessWindowError({ ...app, message: "TypeError: Cannot read properties of undefined (reading 'income')", error: new TypeError("x") })).toBe(false);
    // 行や場所の分かる Script error. は残す
    expect(log.isHarmlessWindowError({ message: "Script error.", filename: app.filename, lineno: 0 })).toBe(false);
    expect(log.isHarmlessWindowError({ message: "Script error.", filename: "", lineno: 5 })).toBe(false);
    // ResizeObserver の名前を含むだけの別のエラー
    expect(log.isHarmlessWindowError({ ...app, message: "ResizeObserver is not defined" })).toBe(false);
    expect(log.isHarmlessWindowError({ ...app, message: "ResizeObserver loop completed with undelivered notifications and more" })).toBe(false);
    // 画面のコードの場所の名前に extension を含むだけ
    expect(log.isHarmlessWindowError({ message: "x", filename: "http://tauri.localhost/chrome-extension.js", lineno: 1 })).toBe(false);
    expect(log.isHarmlessRejection("E_STORE_CONFLICT")).toBe(false);
    expect(log.isHarmlessRejection(new Error("AbortError"))).toBe(false);
    expect(log.isHarmlessRejection(new DOMException("x", "NotAllowedError"))).toBe(false);
    expect(log.isHarmlessRejection(null)).toBe(false);
    expect(log.isHarmlessRejection(undefined)).toBe(false);
  });
});

describe("「要望・不具合を送る」の中のエラーの記録", () => {
  const noop = () => undefined;
  const base = { receipts: [], template: "https://example.com/f?no={受付番号}", appVersion: "0.1.0", os: "macOS", onSend: async () => undefined, onAdd: noop, onClose: noop, initialCode: "R-7K2Q" };
  const actions = { load: async () => log.EMPTY_ERROR_LOG, clear: async () => log.EMPTY_ERROR_LOG };

  it("0件: まだありません。消すは押せない。写すは押せる（ありませんの文を写す）", () => {
    const html = renderToString(h(FeedbackPanel, { ...base, errorLog: actions, initialErrorLog: log.EMPTY_ERROR_LOG }));
    expect(html).toContain("エラーの記録（0件）");
    expect(html).toContain("data-error-log-empty");
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-error-log-clear/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*data-error-log-copy/);
    expect(html).toContain("お客さまの名前・金額・生年月日・メモ・ファイルの場所は残しません");
    expect(html).toContain("「不具合を調べて報告をまとめる」");
    expect(html).not.toContain("data-error-log-ai");
  });

  it("新しい順の一覧（画面・操作・種類・文・回数）と、AI が読んだ回数", () => {
    const view = {
      ...log.EMPTY_ERROR_LOG,
      entries: [
        { firstAt: "2026-11-20T01:02:00Z", lastAt: "2026-11-20T01:03:00Z", count: 3, appVersion: "0.1.0", os: "macOS", kind: "command", kindLabel: "本体の命令の失敗", place: "結果", action: "世帯の保存（store_save）", message: "E_STORE_CONFLICT", line: "l" },
        { firstAt: "2026-11-20T00:00:00Z", lastAt: "2026-11-20T00:00:00Z", count: 1, appVersion: "0.1.0", os: "macOS", kind: "screen", kindLabel: "画面のエラー", place: "入力", action: "画面の処理", message: "TypeError: x", line: "l" },
      ],
      aiReads: { count: 2, lastAt: "2026-11-20T02:00:00Z" },
    };
    const html = renderToString(h(FeedbackPanel, { ...base, errorLog: actions, initialErrorLog: view }));
    expect(html).toContain("エラーの記録（2件）");
    expect(html.indexOf("E_STORE_CONFLICT")).toBeLessThan(html.indexOf("TypeError: x"));
    expect(html).toContain("E_STORE_CONFLICT（3回）");
    expect(html).toContain("結果・世帯の保存（store_save）");
    expect(html).toContain("本体の命令の失敗");
    expect(html).toContain("AI がこの記録を読んだのは 2回です");
    expect(html).toContain("data-error-log-copy");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*data-error-log-clear/);
  });

  it("エラーの記録の口が無い画面では出さない", () => {
    const html = renderToString(h(FeedbackPanel, base));
    expect(html).not.toContain("data-error-log");
  });
});
