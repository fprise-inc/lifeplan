// 元に戻す・やり直す: 履歴の積み方・まとめ方・上限・世帯ごと・文字の欄との優先順位・ドラッグ中のまとめ・キー操作
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describeSnap, sameSnap, type AppSnap } from "../src/workspace/undo/appHistory.ts";
import { historyScope, UndoController, type TextField, type UndoEnv } from "../src/workspace/undo/controller.ts";
import { deepEqual, HistoryBook, UndoHistory } from "../src/workspace/undo/history.ts";
import { Grouper, keyAction, kindOf, noticeText, routeFor } from "../src/workspace/undo/input.ts";
import { UndoButtons } from "../src/workspace/undo/UndoButtons.tsx";
import { fromRequest } from "../src/workspace/input/household.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { modelHousehold } from "./helpers.ts";

const num = () => new UndoHistory<number>({ same: (a, b) => a === b });

describe("履歴の積み方", () => {
  it("積んで、戻して、やり直す。新しい変更でやり直しの側は消える", () => {
    const hi = num();
    expect(hi.record(0, 1, { label: "a" })).toBe("push");
    expect(hi.record(1, 2, { label: "b" })).toBe("push");
    expect(hi.undo()).toEqual({ state: 1, label: "b" });
    expect(hi.undo()).toEqual({ state: 0, label: "a" });
    expect(hi.undo()).toBeNull();
    expect(hi.redo()).toEqual({ state: 1, label: "a" });
    expect(hi.canRedo).toBe(true);
    hi.record(1, 5, { label: "c" });
    expect(hi.canRedo).toBe(false);
    expect(hi.undo()).toEqual({ state: 1, label: "c" });
  });
  it("中身が変わらない変更は積まない", () => {
    const hi = num();
    expect(hi.record(3, 3, { label: "x" })).toBe("same");
    expect(hi.canUndo).toBe(false);
  });
  it("上限（既定200件）を超えたら古いものから捨てる", () => {
    const hi = num();
    for (let i = 0; i < 250; i++) hi.record(i, i + 1, { label: String(i) });
    expect(hi.size).toBe(200);
    let last: { state: number } | null = null;
    for (let r = hi.undo(); r !== null; r = hi.undo()) last = r;
    expect(last?.state).toBe(50);
    const small = new UndoHistory<number>({ same: (a, b) => a === b, limit: 3 });
    for (let i = 0; i < 10; i++) small.record(i, i + 1, { label: "" });
    expect(small.size).toBe(3);
  });
  it("同じまとまりの続けての変更は1件。変える前に戻ったら、その1件を消す", () => {
    const hi = num();
    hi.record(0, 1, { label: "drag", group: "g1", at: 0 });
    expect(hi.record(1, 2, { label: "drag", group: "g1", at: 10 })).toBe("merge");
    expect(hi.record(2, 3, { label: "drag", group: "g1", at: 20 })).toBe("merge");
    expect(hi.size).toBe(1);
    expect(hi.undo()?.state).toBe(0);
    expect(hi.redo()?.state).toBe(3);
    // 別のまとまりは別の1件
    hi.record(3, 4, { label: "other", group: "g2", at: 30 });
    expect(hi.size).toBe(2);
    // 元に戻ったら消える
    expect(hi.record(4, 3, { label: "other", group: "g2", at: 40 })).toBe("drop");
    expect(hi.size).toBe(1);
  });
  it("まとまりの時間を過ぎたら別の1件。null のまとまりはまとめない", () => {
    const hi = num();
    hi.record(0, 1, { label: "k", group: "k1", at: 0, windowMs: 1000 });
    hi.record(1, 2, { label: "k", group: "k1", at: 900, windowMs: 1000 });
    hi.record(2, 3, { label: "k", group: "k1", at: 2500, windowMs: 1000 });
    expect(hi.size).toBe(2);
    hi.record(3, 4, { label: "b", group: null });
    hi.record(4, 5, { label: "b", group: null });
    expect(hi.size).toBe(4);
  });
  it("戻したあとの変更は、前の1件にまとめない", () => {
    const hi = num();
    hi.record(0, 1, { label: "a", group: "g", at: 0 });
    hi.record(1, 2, { label: "b", group: "g2", at: 1 });
    hi.undo();
    expect(hi.record(1, 7, { label: "a", group: "g", at: 2 })).toBe("push");
    expect(hi.size).toBe(2);
  });
});

describe("世帯ごとの履歴", () => {
  it("世帯を切り替えても、ほかの世帯の操作は戻さない。開き直したら空", () => {
    const book = new HistoryBook<number>(num);
    book.select("A").record(0, 1, { label: "A1" });
    book.select("B").record(10, 11, { label: "B1" });
    expect(book.current?.undo()?.label).toBe("B1");
    expect(book.current?.undo()).toBeNull();
    book.select("A");
    expect(book.current?.undo()?.label).toBe("A1");
    book.current?.redo();
    book.reset("A");
    expect(book.current?.canUndo).toBe(false);
    expect(book.current?.canRedo).toBe(false);
    book.drop("A");
    expect(book.current).toBeNull();
  });
});

describe("まとめる単位（ドラッグ・文字の欄・キー）", () => {
  const range = { tagName: "INPUT", type: "range" };
  const text = { tagName: "INPUT", type: "text" };
  const button = { tagName: "BUTTON" };
  it("部品の種類", () => {
    expect(kindOf(range)).toBe("range");
    expect(kindOf(text)).toBe("text");
    expect(kindOf({ tagName: "TEXTAREA" })).toBe("text");
    expect(kindOf({ tagName: "INPUT" })).toBe("text");
    expect(kindOf({ tagName: "INPUT", type: "checkbox" })).toBe("choice");
    expect(kindOf({ tagName: "SELECT" })).toBe("choice");
    expect(kindOf(button)).toBe("button");
    expect(kindOf({ tagName: "DIV", isContentEditable: true })).toBe("text");
    expect(kindOf(null)).toBe("other");
  });
  it("つまみをドラッグしている間は1件、離して次のドラッグは別の1件", () => {
    const g = new Grouper();
    const hi = num();
    g.pointerDown();
    g.begin({ type: "input", target: range, kind: "range" });
    for (let v = 1; v <= 30; v++) hi.record(v - 1, v, { label: "退職の年齢", ...g.groupFor(), at: v });
    g.end();
    g.pointerUp();
    expect(hi.size).toBe(1);
    g.pointerDown();
    hi.record(30, 31, { label: "退職の年齢", ...g.groupFor(), at: 100 });
    g.pointerUp();
    expect(hi.size).toBe(2);
    expect(hi.undo()?.state).toBe(30);
    expect(hi.undo()?.state).toBe(0);
  });
  it("文字の欄（数字の欄）は、入ってから出るまでを1件。入り直したら別の1件", () => {
    const g = new Grouper();
    const hi = num();
    g.focus(text, "text");
    for (const v of [5, 50, 500]) {
      const cue = { type: "input", target: text, kind: "text" as const };
      g.begin(cue);
      hi.record(hi.size === 0 ? 0 : v / 10, v, { label: "年収", ...g.groupFor() });
      g.end(cue);
    }
    expect(hi.size).toBe(1);
    g.focus(text, "text");
    g.begin({ type: "input", target: text, kind: "text" });
    hi.record(500, 600, { label: "年収", ...g.groupFor() });
    expect(hi.size).toBe(2);
  });
  it("つまみをキーで動かしたときは短い間だけまとめ、ボタンは1回ずつ", () => {
    const g = new Grouper();
    g.begin({ type: "input", target: range, kind: "range" });
    const k = g.groupFor();
    expect(k.group).toMatch(/^key:/);
    expect(k.windowMs).toBe(1000);
    g.end();
    g.begin({ type: "click", target: button, kind: "button" });
    expect(g.groupFor().group).toBeNull();
    g.end();
    expect(g.groupFor().group).toBeNull();
  });
  it("イベントの中で起きたイベント（Enter で欄を出る）が終わっても、外のイベントに戻る", () => {
    const g = new Grouper();
    const outer = { type: "keydown", target: text, kind: "text" as const };
    const inner = { type: "focusout", target: text, kind: "text" as const };
    g.begin(outer);
    g.begin(inner);
    g.end(inner);
    expect(g.current).toBe(outer);
  });
});

/** 画面の代わり: フォーカスのある文字の欄を1つ持ち、文字の元に戻すは「打った文字の列」を1つずつ戻す */
function fakeEnv() {
  const field = { el: { id: "f" }, typed: [] as string[], undone: [] as string[], initial: "" };
  let focused = false;
  const value = () => field.initial + field.typed.join("");
  const log: string[] = [];
  const env: UndoEnv = {
    activeText: (): TextField | null => (focused ? { el: field.el, value: value() } : null),
    native: (kind) => {
      log.push(`native:${kind}`);
      if (kind === "undo") {
        const t = field.typed.pop();
        if (t !== undefined) field.undone.push(t);
      } else {
        const t = field.undone.pop();
        if (t !== undefined) field.typed.push(t);
      }
    },
    release: () => {
      log.push("release");
      return () => log.push("refocus");
    },
    hint: () => ({ control: "年収", dialog: null }),
    now: () => 0,
  };
  return {
    env,
    field,
    log,
    value,
    focus(c: UndoController, initial: string) {
      focused = true;
      field.initial = initial;
      field.typed = [];
      field.undone = [];
      c.focus(field.el, "text", initial);
    },
    blur() {
      focused = false;
    },
  };
}

describe("文字の欄とアプリの履歴の優先順位", () => {
  it("どちらで戻すか", () => {
    expect(routeFor("undo", null)).toBe("app");
    expect(routeFor("undo", { changed: true, nativeUndos: 0 })).toBe("native");
    expect(routeFor("undo", { changed: false, nativeUndos: 3 })).toBe("app");
    expect(routeFor("redo", { changed: true, nativeUndos: 0 })).toBe("app");
    expect(routeFor("redo", { changed: false, nativeUndos: 1 })).toBe("native");
  });

  it("欄の中に戻せる入力があれば文字を戻し、なくなったらアプリの履歴を戻す（二重に戻らない）", () => {
    const f = fakeEnv();
    const c = new UndoController(f.env);
    const msgs: string[] = [];
    c.notify = (m) => msgs.push(m);
    const hi = num();
    let state: number;
    c.push(historyScope(0, () => hi, (s) => (state = s)));
    // 前の操作（欄の外）
    hi.record(0, 10, { label: "対策（退職の年齢）" });
    state = 10;
    // 欄に入って2文字打つ（打つたびに世帯に入る。欄にいる間は1件）
    f.focus(c, "1");
    for (const ch of ["2", "3"]) {
      f.field.typed.push(ch);
      const before = state;
      state = Number(f.value());
      c.grouper.begin({ type: "input", target: f.field.el, kind: "text" });
      c.record(hi, before, state, () => "入力（年収）");
      c.grouper.end();
    }
    expect(hi.size).toBe(2);
    // 1回目・2回目: 欄の中の文字を戻す（アプリの履歴は使わない）
    expect(c.run("undo")).toBe("native");
    expect(f.value()).toBe("12");
    expect(c.run("undo")).toBe("native");
    expect(f.value()).toBe("1");
    expect(hi.size).toBe(2);
    // 3回目: 欄は入ったときの中身に戻ったので、アプリの履歴を戻す。いったん欄を出てから戻し、欄へ戻る
    expect(c.run("undo")).toBe("app");
    expect(f.log.slice(-2)).toEqual(["release", "refocus"]);
    expect(msgs.at(-1)).toBe("元に戻しました: 入力（年収）");
    expect(state).toBe(10);
  });

  it("文字を戻したあとのやり直しは文字から。打ち直したら文字のやり直しはできない", () => {
    const f = fakeEnv();
    const c = new UndoController(f.env);
    const hi = num();
    hi.record(0, 1, { label: "前の操作" });
    let state = 1;
    c.push(historyScope(0, () => hi, (s) => (state = s)));
    f.focus(c, "");
    f.field.typed.push("a");
    expect(c.run("undo")).toBe("native");
    expect(c.run("redo")).toBe("native");
    expect(f.value()).toBe("a");
    expect(c.run("undo")).toBe("native");
    c.typed(f.field.el, "insertText");
    // 打ち直した（文字のやり直しは消える）→ アプリのやり直し（何もない）
    expect(c.run("redo")).toBe("app");
    expect(state).toBe(1);
  });

  it("欄の外ではアプリの履歴。戻すものがなければ知らせる", () => {
    const f = fakeEnv();
    const c = new UndoController(f.env);
    const msgs: string[] = [];
    c.notify = (m) => msgs.push(m);
    expect(c.run("undo")).toBe("app");
    expect(msgs).toEqual([noticeText("undo", null)]);
    const hi = num();
    let state = 2;
    c.push(historyScope(0, () => hi, (s) => (state = s)));
    hi.record(1, 2, { label: "案（削除する）" });
    c.run("undo");
    expect(state).toBe(1);
    expect(f.log).not.toContain("release");
    c.run("redo");
    expect(state).toBe(2);
    expect(msgs.at(-1)).toBe("やり直しました: 案（削除する）");
  });

  it("開いているパネル（上のスコープ）だけを戻す。先に足されていても level の大きい方が上", () => {
    const f = fakeEnv();
    const c = new UndoController(f.env);
    const panel = num();
    const app = num();
    let p: number;
    let a: number;
    const off = c.push(historyScope(1, () => panel, (s) => (p = s)));
    c.push(historyScope(0, () => app, (s) => (a = s)));
    app.record(0, 1, { label: "app" });
    a = 1;
    panel.record(0, 5, { label: "panel" });
    p = 5;
    c.run("undo");
    expect([p, a]).toEqual([0, 1]);
    // パネルの中に戻すものがなくても、裏の世帯は戻さない
    c.run("undo");
    expect(a).toBe(1);
    off();
    c.run("undo");
    expect(a).toBe(0);
  });
});

describe("キー操作", () => {
  const k = (key: string, m: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; code: string }> = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m });
  it("macOS は ⌘Z・⌘⇧Z", () => {
    expect(keyAction(k("z", { metaKey: true }), true)).toBe("undo");
    expect(keyAction(k("Z", { metaKey: true, shiftKey: true }), true)).toBe("redo");
    expect(keyAction(k("z", { ctrlKey: true }), true)).toBeNull();
    expect(keyAction(k("y", { metaKey: true }), true)).toBeNull();
    // かなの入力のときなど key が文字でないときは、キーの位置で見る
    expect(keyAction(k("Process", { metaKey: true, code: "KeyZ" }), true)).toBe("undo");
  });
  it("Windows は Ctrl+Z・Ctrl+Y・Ctrl+Shift+Z", () => {
    expect(keyAction(k("z", { ctrlKey: true }), false)).toBe("undo");
    expect(keyAction(k("y", { ctrlKey: true }), false)).toBe("redo");
    expect(keyAction(k("Z", { ctrlKey: true, shiftKey: true }), false)).toBe("redo");
    expect(keyAction(k("z", { metaKey: true }), false)).toBeNull();
    expect(keyAction(k("z", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(keyAction(k("a", { ctrlKey: true }), false)).toBeNull();
  });
});

describe("画面の大枠の状態", () => {
  const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"), { memo: [] });
  const work = { band: ["p1"], base: "__current__", sel: "p1", drafts: {} as Record<string, unknown> };
  const snap = (over: Partial<AppSnap> = {}): AppSnap => ({ wh, work, settings: DEFAULT_DISPLAY_SETTINGS, bs: DEFAULT_BALANCE_SETTINGS, ...over });
  it("選んだ案・基準の案だけを替えても、中身は同じ（積まない）", () => {
    expect(sameSnap(snap(), snap({ work: { ...work, sel: "__current__", base: "p1" } }))).toBe(true);
    expect(sameSnap(snap(), snap({ work: { ...work, drafts: { p1: { "lever:retireAge": 70 } } } }))).toBe(false);
    expect(sameSnap(snap(), snap({ wh: structuredClone(wh) }))).toBe(true);
  });
  it("知らせの名前は、変わったところ＋操作した部品", () => {
    const none = { control: null, dialog: null };
    expect(describeSnap(snap(), snap({ work: { ...work, drafts: { p1: { x: 1 } } } }), { control: "退職の年齢", dialog: null })).toBe("対策（退職の年齢）");
    expect(describeSnap(snap(), snap({ wh: { ...wh, memo: ["a"] } }), none)).toBe("メモ");
    expect(describeSnap(snap(), snap({ settings: { ...DEFAULT_DISPLAY_SETTINGS, atAge: 80 } }), none)).toBe("表示の設定");
    expect(describeSnap(snap(), snap({ wh: { ...wh, proposals: [] , labelsByMember: { a: "b" } } }), { control: "保存", dialog: "仕事と収入" })).toBe("入力（仕事と収入）");
  });
  it("中身の比較の仕方", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: 1 }, [1])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe("上部のボタン", () => {
  it("戻すものがなければ押せない", () => {
    const c = new UndoController(fakeEnv().env);
    const html = renderToString(h(UndoButtons, { c }));
    expect(html).toContain("data-undo");
    expect(html.match(/disabled/g)?.length).toBe(2);
    const hi = num();
    hi.record(0, 1, { label: "案（削除する）" });
    c.push(historyScope(0, () => hi, () => {}));
    const html2 = renderToString(h(UndoButtons, { c }));
    expect(html2.match(/disabled/g)?.length).toBe(1);
    expect(html2).toContain("案（削除する）");
  });
});
