// 推定の値の欄に入ったときの動き（0254）: 本物のマウスとキーで確かめる（流すのは FINANCIA_WALKTHROUGH=1 のときだけ。見えないブラウザ。browser.ts）。
// - 押して入る・Tab（Shift+Tab）で入ると、推定の数字が全部選ばれている。そのまま打てば置き換わる。→ で選択が外れて一部を直せる
// - 何も打たずに離れたら推定のまま（値も「推定」の印も変わらない）。FP が入れた値の欄は今までどおり（全部は選ばない）
// - 年月・時点の欄（次の買い替えの時期）・数字の欄（買い替えの周期）・円の欄（基本生活費）で同じ
// - 空にして離れたときの知らせは「空にはできません。値を入れてください」だけ
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserPath, start, type Page, type Session } from "./browser.ts";
import { WALKTHROUGH } from "./fieldEffect.ts";
import { newHousehold } from "./households.ts";

const RUN = WALKTHROUGH && browserPath() !== null;

interface Raw {
  cdp: { send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> };
  session: string;
}
const send = (p: Page, method: string, params: Record<string, unknown>) => (p as unknown as Raw).cdp.send(method, params, (p as unknown as Raw).session);

/** 欄（data-field の終わりが suffix の欄の文字の入力）の今の様子 */
interface Box {
  focused: boolean;
  value: string;
  start: number | null;
  end: number | null;
  est: boolean;
}
const sel = (suffix: string) => `[data-field$=${JSON.stringify(suffix)}] .fld-c input[type=text]`;
const box = (p: Page, suffix: string) =>
  p.eval<Box>(
    `const el = document.querySelector(${JSON.stringify(sel(suffix))}); if (!el) throw new Error("欄がありません: ${suffix}");
     const f = el.closest(".fld");
     return { focused: document.activeElement === el, value: el.value, start: el.selectionStart, end: el.selectionEnd, est: f.classList.contains("is-est") }`,
  );
/** 欄の真ん中を本物のマウスで押す */
async function press(p: Page, suffix: string): Promise<void> {
  const pt = await p.eval<{ x: number; y: number }>(`const el = document.querySelector(${JSON.stringify(sel(suffix))}); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height / 2 }`);
  await p.settle();
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send(p, "Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await p.settle();
}
async function key(p: Page, name: string, code: number, shift = false): Promise<void> {
  for (const type of ["rawKeyDown", "keyUp"]) await send(p, "Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
  await p.settle();
}

describe.runIf(RUN)("推定の値の欄に入ると推定の数字が全部選ばれる（0254）", () => {
  let s: Session;
  beforeAll(async () => {
    s = await start();
    await newHousehold(s.page);
    await s.page.click("車", { exact: false });
    await s.page.until("w.panel()", "車のパネルが開く");
    await s.page.click("詳細", { within: "panel", exact: true });
    await s.page.click("＋ 今の車", { within: "panel" });
    await s.page.until(`document.querySelector(${JSON.stringify(sel("/every"))})`, "買い替えの周期の欄が出る");
  }, 240_000);
  afterAll(async () => {
    await s?.close();
  });

  it("数字の欄（買い替えの周期）: 押すと全部選ばれ、何も打たずに離れたら推定のまま", async () => {
    const p = s.page;
    const before = await box(p, "/every");
    expect(before.est).toBe(true);
    expect(before.value).toMatch(/^\d+$/);
    await press(p, "/every");
    expect(await box(p, "/every")).toEqual({ focused: true, value: before.value, start: 0, end: before.value.length, est: true });
    // → で選択が外れる（一部を直せる）
    await key(p, "ArrowRight", 39);
    expect(await box(p, "/every")).toMatchObject({ focused: true, start: before.value.length, end: before.value.length });
    await key(p, "Tab", 9);
    expect(await box(p, "/every")).toMatchObject({ focused: false, value: before.value, est: true });
    // Shift+Tab で戻って入っても全部選ばれる
    await key(p, "Tab", 9, true);
    const back = await box(p, "/every");
    if (back.focused) expect(back).toMatchObject({ start: 0, end: before.value.length });
  });

  it("時点の欄（次の買い替えの時期）: 欄の中は数字だけ、押すと全部選ばれ、離れても推定のまま", async () => {
    const p = s.page;
    const before = await box(p, "/first");
    expect(before.est).toBe(true);
    expect(before.value).toMatch(/^\d+$/);
    expect(await p.eval<string>(`return w.txt(document.querySelector('[data-field$="/first"] [data-when-unit]'))`)).toBe("年後");
    await press(p, "/first");
    expect(await box(p, "/first")).toEqual({ focused: true, value: before.value, start: 0, end: before.value.length, est: true });
    await key(p, "Tab", 9);
    expect(await box(p, "/first")).toMatchObject({ focused: false, value: before.value, est: true });
  });

  it("円の欄（車両の価格）: 押すと全部選ばれ、離れても推定のまま", async () => {
    const p = s.page;
    const before = await box(p, "/price");
    expect(before.est).toBe(true);
    expect(before.value).not.toBe("");
    await press(p, "/price");
    expect(await box(p, "/price")).toEqual({ focused: true, value: before.value, start: 0, end: before.value.length, est: true });
    await key(p, "Tab", 9);
    expect(await box(p, "/price")).toMatchObject({ focused: false, value: before.value, est: true });
  });

  it("そのまま打てば置き換わり、FP が入れた値になる。FP が入れた値の欄は押しても全部は選ばない", async () => {
    const p = s.page;
    await press(p, "/every");
    await send(p, "Input.insertText", { text: "7" });
    await p.settle();
    expect(await box(p, "/every")).toMatchObject({ focused: true, value: "7" });
    await key(p, "Tab", 9);
    expect(await box(p, "/every")).toMatchObject({ focused: false, value: "7", est: false });
    await press(p, "/every");
    const now = await box(p, "/every");
    expect(now.focused).toBe(true);
    expect(now.start === 0 && now.end === 1).toBe(false);
    await key(p, "Tab", 9);
  });

  it("空にして離れたときの知らせは「空にはできません。値を入れてください」だけ", async () => {
    const p = s.page;
    await press(p, "/every");
    await send(p, "Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, commands: ["selectAll"] });
    await send(p, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    await key(p, "Backspace", 8);
    await key(p, "Tab", 9);
    const msg = await p.eval<string>(`return w.txt(document.querySelector('[data-field$="/every"] [data-field-problem]'))`);
    expect(msg).toBe("空にはできません。値を入れてください");
    expect(await box(p, "/every")).toMatchObject({ value: "7" });
  });
});
